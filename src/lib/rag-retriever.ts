/**
 * AgentDyne RAG Retriever
 *
 * Full embed → pgvector search → format pipeline for RAG-augmented agents.
 *
 * Critical fix (applied here):
 *   The search_rag_chunks RPC requires a pgvector float[] embedding vector,
 *   NOT raw query text. The execute route previously passed raw text directly
 *   to the RPC — this caused silent failures on every RAG execution.
 *   This module correctly embeds the query via OpenAI before calling the RPC.
 *
 * Design principles:
 *   - Non-throwing: any failure returns { retrieved: false, skipped: true }
 *     so the execute route falls back gracefully to the base system prompt
 *   - Edge-runtime safe: fetch() only, no Node.js APIs
 *   - Timeout-guarded: 5s for embedding, 3s for search
 *   - Context is truncated at MAX_CONTEXT_CHARS to prevent token overflow
 */

export interface RAGChunk {
  chunk_id:       string | number
  document_id:    string
  document_title: string
  content:        string
  similarity:     number
}

export interface RAGResult {
  chunks:         RAGChunk[]
  contextString:  string
  tokensEstimate: number
  retrieved:      boolean
  skipped:        boolean   // true when skipped due to missing API key or no results
}

const EMPTY: RAGResult = {
  chunks: [], contextString: "", tokensEstimate: 0, retrieved: false, skipped: true,
}

const MAX_CONTEXT_CHARS = 12_000   // ~3000 tokens of context — safe budget

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null   // feature unavailable — caller falls back gracefully

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body:   JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8192) }),
      signal: AbortSignal.timeout(5_000),
    })

    if (!res.ok) return null

    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

// ─── Main retrieval function ──────────────────────────────────────────────────

export async function retrieveRAGContext(
  supabase:        any,
  knowledgeBaseId: string,
  userQuery:       string,
  options: { topK?: number; threshold?: number } = {}
): Promise<RAGResult> {
  const topK      = Math.min(10, Math.max(1, options.topK      ?? 5))
  const threshold = Math.max(0,  Math.min(1, options.threshold ?? 0.75))  // Raised from 0.65

  // Step 1: Embed query via OpenAI
  const embedding = await embedQuery(userQuery)
  if (!embedding) return { ...EMPTY }  // OpenAI unavailable — skip gracefully

  // Step 2: pgvector similarity search
  let chunks: RAGChunk[] = []
  try {
    const { data, error } = await supabase.rpc("search_rag_chunks", {
      kb_id_param:     knowledgeBaseId,
      query_embedding: `[${embedding.join(",")}]`,  // pgvector text literal format
      match_threshold: threshold,
      match_count:     topK,
    })

    if (error) {
      // Log for observability but don't throw — fallback is safe
      console.warn("[RAG] search_rag_chunks error:", error.message)
      return { ...EMPTY }
    }

    if (!data || data.length === 0) return { ...EMPTY, skipped: false }

    chunks = (data as any[]).map(r => ({
      chunk_id:       r.chunk_id ?? r.id ?? "",
      document_id:    r.document_id ?? "",
      document_title: r.document_title ?? "Unknown",
      content:        r.content ?? "",
      similarity:     parseFloat((r.similarity ?? 0).toFixed(4)),
    }))
  } catch (err: any) {
    console.warn("[RAG] retrieval exception:", err.message)
    return { ...EMPTY }
  }

  // Step 3: Build context string
  let contextString = chunks
    .map((c, i) => `[Source ${i + 1}: ${c.document_title}]\n${c.content}`)
    .join("\n\n---\n\n")

  if (contextString.length > MAX_CONTEXT_CHARS) {
    contextString = contextString.slice(0, MAX_CONTEXT_CHARS) + "\n\n[Context truncated — token budget reached]"
  }

  return {
    chunks,
    contextString,
    tokensEstimate: Math.ceil(contextString.length / 4),
    retrieved:      true,
    skipped:        false,
  }
}

// ─── System prompt builder ────────────────────────────────────────────────────

export function buildRAGSystemPrompt(basePrompt: string, ragResult: RAGResult): string {
  if (!ragResult.retrieved || ragResult.chunks.length === 0) {
    return basePrompt
  }

  return `${basePrompt}

<knowledge_base_context>
The following information was retrieved from the agent's knowledge base based on your query.

IMPORTANT INSTRUCTIONS:
- Use this context as your PRIMARY source of truth for answering.
- Cite sources by their number [1], [2] etc. when referencing specific facts.
- If the retrieved context does NOT contain relevant information for the query, explicitly say so — do NOT hallucinate or infer beyond what is provided.
- Do NOT mention "the context" or "the knowledge base" directly — respond naturally as if this is your own knowledge.

${ragResult.contextString}
</knowledge_base_context>`
}
