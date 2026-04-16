export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { strictRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/rag/ingest
 *
 * Ingest text documents into a knowledge base for RAG-augmented agents.
 * Documents are chunked, embedded via OpenAI text-embedding-3-small,
 * and stored in the rag_documents table (with pgvector embeddings).
 *
 * Security posture:
 * - Auth required (session or API key)
 * - Only knowledge base owner can ingest
 * - Document size cap: 100KB raw text
 * - Max 1000 docs per knowledge base
 * - Strict rate limit: 10/min (embedding is expensive)
 *
 * Body:
 *   knowledge_base_id  string   — UUID of the target knowledge base
 *   content            string   — raw text content to ingest
 *   title              string?  — human-readable document title
 *   metadata           object?  — arbitrary key-value pairs stored with the doc
 *   chunk_size         number?  — chars per chunk (default 1200, max 3000)
 *   chunk_overlap      number?  — chars of overlap between chunks (default 200)
 */
export async function POST(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // ── Parse body ────────────────────────────────────────────────────────
    let body: Record<string, any>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const {
      knowledge_base_id,
      content,
      title       = "Untitled Document",
      metadata    = {},
      chunk_size  = 1200,
      chunk_overlap = 200,
    } = body

    if (!knowledge_base_id || typeof knowledge_base_id !== "string") {
      return NextResponse.json({ error: "knowledge_base_id is required" }, { status: 400 })
    }
    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "content is required and must be a string" }, { status: 400 })
    }
    if (content.length > 100_000) {
      return NextResponse.json({ error: "Document too large. Max 100KB per ingest request." }, { status: 413 })
    }
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      return NextResponse.json({ error: "metadata must be a JSON object" }, { status: 400 })
    }

    // Validate chunk params
    const chunkSz  = Math.min(3000, Math.max(200,  parseInt(String(chunk_size    ?? 1200))))
    const chunkOlp = Math.min(500,  Math.max(0,    parseInt(String(chunk_overlap ?? 200))))

    // UUID validation
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    if (!UUID_RE.test(knowledge_base_id)) {
      return NextResponse.json({ error: "Invalid knowledge_base_id" }, { status: 400 })
    }

    // ── Ownership check ───────────────────────────────────────────────────
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("id, owner_id, name, doc_count, max_docs")
      .eq("id", knowledge_base_id)
      .single()

    if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 })
    if (kb.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Doc count guard
    const maxDocs = kb.max_docs ?? 1000
    if ((kb.doc_count ?? 0) >= maxDocs) {
      return NextResponse.json({
        error: `Knowledge base is full. Max ${maxDocs} documents reached.`,
        code:  "KB_FULL",
      }, { status: 429 })
    }

    // ── Chunk the document ────────────────────────────────────────────────
    const chunks = chunkText(content.trim(), chunkSz, chunkOlp)
    if (chunks.length === 0) {
      return NextResponse.json({ error: "Document is empty after processing" }, { status: 400 })
    }
    if (chunks.length > 200) {
      return NextResponse.json({
        error: `Document produces ${chunks.length} chunks. Max 200 per request. Split into smaller documents.`,
      }, { status: 400 })
    }

    // ── Embed chunks via OpenAI ───────────────────────────────────────────
    const openAIKey = process.env.OPENAI_API_KEY
    if (!openAIKey) {
      return NextResponse.json({ error: "Embedding service not configured" }, { status: 503 })
    }

    // Batch embedding — OpenAI supports up to 2048 inputs per call
    const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${openAIKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: chunks,
      }),
    })

    if (!embeddingRes.ok) {
      const errText = await embeddingRes.text()
      console.error("OpenAI embedding error:", errText)
      return NextResponse.json({ error: "Embedding service error. Please try again." }, { status: 502 })
    }

    const embeddingData = await embeddingRes.json() as {
      data: Array<{ embedding: number[]; index: number }>
    }

    if (!embeddingData.data || embeddingData.data.length !== chunks.length) {
      return NextResponse.json({ error: "Embedding response mismatch" }, { status: 502 })
    }

    // ── Insert document record ────────────────────────────────────────────
    const { data: doc, error: docErr } = await supabase
      .from("rag_documents")
      .insert({
        knowledge_base_id,
        owner_id:     user.id,
        title:        String(title).slice(0, 200),
        content:      content.slice(0, 100_000),
        metadata:     metadata,
        chunk_count:  chunks.length,
        status:       "indexed",
      })
      .select("id")
      .single()

    if (docErr || !doc) {
      console.error("rag_documents insert error:", docErr)
      return NextResponse.json({ error: "Failed to store document" }, { status: 500 })
    }

    // ── Insert chunks with embeddings ─────────────────────────────────────
    const chunkRows = chunks.map((chunkContent, i) => ({
      document_id:       doc.id,
      knowledge_base_id,
      owner_id:          user.id,
      chunk_index:       i,
      content:           chunkContent,
      embedding:         `[${embeddingData.data[i]!.embedding.join(",")}]`,
      char_count:        chunkContent.length,
    }))

    // Insert in batches of 50 to avoid payload limits
    const BATCH = 50
    for (let i = 0; i < chunkRows.length; i += BATCH) {
      const { error: chunkErr } = await supabase
        .from("rag_chunks")
        .insert(chunkRows.slice(i, i + BATCH))

      if (chunkErr) {
        console.error("rag_chunks insert error:", chunkErr)
        // Rollback document on chunk failure
        await supabase.from("rag_documents").delete().eq("id", doc.id)
        return NextResponse.json({ error: "Failed to index document chunks" }, { status: 500 })
      }
    }

    // ── Update doc count on knowledge base ────────────────────────────────
    await supabase.rpc("increment_kb_doc_count", { kb_id_param: knowledge_base_id })

    return NextResponse.json({
      document_id:   doc.id,
      chunks_indexed: chunks.length,
      knowledge_base: { id: knowledge_base_id, name: kb.name },
      status:        "indexed",
    }, { status: 201 })

  } catch (err: any) {
    console.error("POST /api/rag/ingest:", err)
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 })
  }
}

// ── GET /api/rag/ingest — list documents in a knowledge base ─────────────────

export async function GET(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const kbId  = searchParams.get("knowledge_base_id")
    const page  = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20"))

    if (!kbId) {
      // List all knowledge bases for this user
      const { data: kbs } = await supabase
        .from("knowledge_bases")
        .select("id, name, description, doc_count, max_docs, created_at, updated_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })

      return NextResponse.json({ knowledge_bases: kbs ?? [] })
    }

    // Ownership check
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("owner_id, name")
      .eq("id", kbId)
      .single()

    if (!kb || kb.owner_id !== user.id) {
      return NextResponse.json({ error: "Knowledge base not found or access denied" }, { status: 404 })
    }

    const { data: docs, count } = await supabase
      .from("rag_documents")
      .select("id, title, chunk_count, status, created_at, metadata", { count: "exact" })
      .eq("knowledge_base_id", kbId)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    const total = count ?? 0

    return NextResponse.json({
      knowledge_base: { id: kbId, name: kb.name },
      documents:      docs ?? [],
      pagination: {
        total, page, limit,
        pages:   Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE /api/rag/ingest — delete a document ───────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const docId = searchParams.get("document_id")
    if (!docId) return NextResponse.json({ error: "document_id required" }, { status: 400 })

    // Ownership check via join
    const { data: doc } = await supabase
      .from("rag_documents")
      .select("id, knowledge_base_id, owner_id")
      .eq("id", docId)
      .single()

    if (!doc)               return NextResponse.json({ error: "Document not found" }, { status: 404 })
    if (doc.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Chunks deleted via CASCADE
    const { error } = await supabase.from("rag_documents").delete().eq("id", docId)
    if (error) throw error

    // Decrement doc count
    await supabase.rpc("decrement_kb_doc_count", { kb_id_param: doc.knowledge_base_id })

    return NextResponse.json({ ok: true, deleted_document_id: docId })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Text chunking ─────────────────────────────────────────────────────────────
// Splits on paragraph/sentence boundaries first, falls back to character splits.

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = []
  // Split on double newlines first (paragraph boundaries)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)

  let current = ""

  for (const para of paragraphs) {
    // If adding this paragraph still fits, append it
    if (current.length + para.length + 2 <= chunkSize) {
      current = current ? `${current}\n\n${para}` : para
    } else {
      // Flush current chunk
      if (current.length > 0) {
        chunks.push(current.trim())
        // Overlap: keep last `overlap` chars of current
        if (overlap > 0 && current.length > overlap) {
          current = current.slice(-overlap) + "\n\n" + para
        } else {
          current = para
        }
      } else {
        // Single paragraph too large — split by sentences
        const sentences = para.match(/[^.!?]+[.!?]+/g) || [para]
        for (const sent of sentences) {
          if (current.length + sent.length + 1 <= chunkSize) {
            current = current ? `${current} ${sent}` : sent
          } else {
            if (current.length > 0) chunks.push(current.trim())
            current = sent
          }
        }
      }
    }
  }

  if (current.trim().length > 0) chunks.push(current.trim())

  // Filter out empty chunks and truncate to chunkSize
  return chunks
    .filter(c => c.length > 0)
    .map(c => c.slice(0, chunkSize))
}
