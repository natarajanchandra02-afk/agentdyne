export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/rag/query
 *
 * Semantic retrieval against a RAG knowledge base.
 * Used by agents with RAG-augmentation: embed the user's query,
 * find most similar chunks via cosine similarity, return them for
 * inclusion in the agent's context.
 *
 * Security:
 * - Auth required (session or API key)
 * - Knowledge base must be owned by caller OR be public
 * - Query string sanitized: max 2000 chars
 * - Rate limited: 100/min
 *
 * Body:
 *   knowledge_base_id  string   — UUID of target knowledge base
 *   query              string   — natural language query
 *   top_k              number?  — number of chunks to return (default 5, max 20)
 *   threshold          number?  — minimum similarity 0–1 (default 0.65)
 *   include_metadata   boolean? — include document metadata in response (default true)
 */
export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
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
      query,
      top_k            = 5,
      threshold        = 0.65,
      include_metadata = true,
    } = body

    if (!knowledge_base_id || typeof knowledge_base_id !== "string") {
      return NextResponse.json({ error: "knowledge_base_id is required" }, { status: 400 })
    }
    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "query is required and must be a string" }, { status: 400 })
    }
    if (query.length > 2000) {
      return NextResponse.json({ error: "query too long. Max 2000 characters." }, { status: 400 })
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    if (!UUID_RE.test(knowledge_base_id)) {
      return NextResponse.json({ error: "Invalid knowledge_base_id" }, { status: 400 })
    }

    const topK      = Math.min(20, Math.max(1, parseInt(String(top_k    ?? 5))))
    const minScore  = Math.min(1,  Math.max(0, parseFloat(String(threshold ?? 0.65))))

    // ── Access check ──────────────────────────────────────────────────────
    const { data: kb } = await supabase
      .from("knowledge_bases")
      .select("id, owner_id, is_public, name")
      .eq("id", knowledge_base_id)
      .single()

    if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 })

    if (!kb.is_public && kb.owner_id !== user.id) {
      return NextResponse.json({ error: "Access denied to this knowledge base" }, { status: 403 })
    }

    // ── Embed query ───────────────────────────────────────────────────────
    const openAIKey = process.env.OPENAI_API_KEY
    if (!openAIKey) {
      return NextResponse.json({ error: "Embedding service not configured" }, { status: 503 })
    }

    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${openAIKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query.trim(),
      }),
    })

    if (!embedRes.ok) {
      const errText = await embedRes.text()
      console.error("OpenAI embedding error:", errText)
      return NextResponse.json({ error: "Embedding service error" }, { status: 502 })
    }

    const embedData = await embedRes.json() as {
      data: Array<{ embedding: number[] }>
    }

    const queryEmbedding = embedData.data[0]?.embedding
    if (!queryEmbedding) {
      return NextResponse.json({ error: "Failed to generate query embedding" }, { status: 502 })
    }

    // ── Vector similarity search via RPC ─────────────────────────────────
    // Using Supabase RPC that calls pgvector's cosine distance operator (<=>)
    const { data: chunks, error } = await supabase.rpc("search_rag_chunks", {
      kb_id_param:      knowledge_base_id,
      query_embedding:  `[${queryEmbedding.join(",")}]`,
      match_threshold:  minScore,
      match_count:      topK,
    })

    if (error) {
      console.error("search_rag_chunks RPC error:", error)
      return NextResponse.json({ error: "Search failed" }, { status: 500 })
    }

    const results = (chunks ?? []).map((chunk: any) => ({
      chunk_id:        chunk.chunk_id,
      document_id:     chunk.document_id,
      document_title:  chunk.document_title,
      content:         chunk.content,
      similarity:      parseFloat(chunk.similarity?.toFixed(4) ?? "0"),
      ...(include_metadata ? { metadata: chunk.metadata } : {}),
    }))

    // ── Build context string (ready for agent system prompt injection) ─────
    const context = results
      .map((r: any, i: number) => `[${i + 1}] ${r.document_title}\n${r.content}`)
      .join("\n\n---\n\n")

    return NextResponse.json({
      knowledge_base: { id: knowledge_base_id, name: kb.name },
      query,
      results,
      context_string: context,     // Paste directly into agent system prompt
      result_count:   results.length,
      top_k,
      threshold:      minScore,
    })

  } catch (err: any) {
    console.error("POST /api/rag/query:", err)
    return NextResponse.json({ error: "Query failed" }, { status: 500 })
  }
}

// ── GET /api/rag/query — list knowledge bases accessible to user ─────────────
export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // Return all KBs owned by user + public ones
    const { data: kbs } = await supabase
      .from("knowledge_bases")
      .select("id, name, description, is_public, doc_count, created_at")
      .or(`owner_id.eq.${user.id},is_public.eq.true`)
      .order("created_at", { ascending: false })
      .limit(50)

    return NextResponse.json({ knowledge_bases: kbs ?? [] })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
