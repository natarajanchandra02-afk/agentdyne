/**
 * RAG Retriever — AgentDyne
 *
 * Thin edge-compatible wrapper around the Supabase pgvector search.
 * Used by the pipeline executor and the agent execute route to inject
 * relevant knowledge-base context into agent system prompts.
 *
 * Design:
 *  - Embeds the user query via OpenAI text-embedding-3-small
 *  - Calls the search_rag_chunks Postgres RPC (cosine similarity via pgvector)
 *  - Returns plain structs — no framework deps, runs in Cloudflare Workers
 *
 * Failure policy: all errors are non-fatal.
 * If embedding or search fails the caller receives an empty result
 * and falls back to the base system prompt. Agents MUST work without RAG.
 */

export interface RAGChunk {
  chunk_id:       number
  document_id:    string
  document_title: string
  content:        string
  similarity:     number
  metadata?:      Record<string, unknown>
}

export interface RAGResult {
  chunks:   RAGChunk[]
  skipped:  boolean   // true when retrieval was skipped (no KB, missing key, etc.)
  reason?:  string    // why it was skipped — for debug logs
}

export interface RAGOptions {
  topK?:      number   // max chunks to retrieve (default 5)
  threshold?: number   // minimum cosine similarity 0–1 (default 0.65)
}

// ── Retrieval ──────────────────────────────────────────────────────────────────

/**
 * Retrieve relevant chunks from a knowledge base for a given query string.
 * Returns empty RAGResult on any failure — never throws.
 */
export async function retrieveRAGContext(
  supabase:        any,
  knowledgeBaseId: string,
  query:           string,
  opts:            RAGOptions = {}
): Promise<RAGResult> {
  const topK      = Math.min(20, Math.max(1, opts.topK      ?? 5))
  const threshold = Math.min(1,  Math.max(0, opts.threshold ?? 0.65))

  const openAIKey = process.env.OPENAI_API_KEY
  if (!openAIKey) {
    return { chunks: [], skipped: true, reason: "OPENAI_API_KEY not configured" }
  }

  if (!knowledgeBaseId || !query?.trim()) {
    return { chunks: [], skipped: true, reason: "Missing kb_id or query" }
  }

  try {
    // 1. Embed the query
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${openAIKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query.trim().slice(0, 512),
      }),
      signal: AbortSignal.timeout(8_000),
    })

    if (!embedRes.ok) {
      return { chunks: [], skipped: true, reason: `Embedding API error: ${embedRes.status}` }
    }

    const embedData = await embedRes.json() as { data: Array<{ embedding: number[] }> }
    const embedding = embedData.data[0]?.embedding
    if (!embedding) {
      return { chunks: [], skipped: true, reason: "No embedding returned" }
    }

    // 2. Vector search via pgvector RPC
    const { data, error } = await supabase.rpc("search_rag_chunks", {
      kb_id_param:     knowledgeBaseId,
      query_embedding: `[${embedding.join(",")}]`,
      match_threshold: threshold,
      match_count:     topK,
    })

    if (error) {
      return { chunks: [], skipped: true, reason: `pgvector search error: ${error.message}` }
    }

    const chunks: RAGChunk[] = (data ?? []).map((c: any) => ({
      chunk_id:       c.chunk_id,
      document_id:    c.document_id,
      document_title: c.document_title ?? "Unknown",
      content:        c.content,
      similarity:     parseFloat((c.similarity ?? 0).toFixed(4)),
      metadata:       c.metadata ?? undefined,
    }))

    return { chunks, skipped: false }

  } catch (err: any) {
    return { chunks: [], skipped: true, reason: err.message }
  }
}

// ── Context builder ────────────────────────────────────────────────────────────

/**
 * Inject RAG chunks into a system prompt.
 * Prepends a <knowledge_base_context> block before the base prompt.
 * If no chunks were retrieved, returns the base prompt unchanged.
 */
export function buildRAGSystemPrompt(
  baseSystemPrompt: string,
  ragResult:        RAGResult
): string {
  if (ragResult.skipped || ragResult.chunks.length === 0) {
    return baseSystemPrompt
  }

  const contextBlock = ragResult.chunks
    .map((c, i) => `[${i + 1}] ${c.document_title}\n${c.content}`)
    .join("\n\n---\n\n")

  return [
    "<knowledge_base_context>",
    contextBlock,
    "</knowledge_base_context>",
    "",
    "Use the above context to answer the user. Cite source numbers [1], [2] etc. when referencing specific facts.",
    "If the context does not contain relevant information, say so and answer from general knowledge.",
    "",
    baseSystemPrompt,
  ].join("\n")
}
