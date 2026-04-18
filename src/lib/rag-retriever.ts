/**
 * AgentDyne RAG Retriever
 *
 * Encapsulates the full embed → search → format pipeline for RAG-augmented agents.
 * Used by the execute route to inject knowledge-base context before LLM calls.
 *
 * Critical design:
 *   search_rag_chunks RPC requires a pgvector float[] embedding, NOT raw text.
 *   This module handles the OpenAI embedding step before calling the RPC,
 *   which was the silent failure bug in the original execute route.
 *
 * Edge-runtime safe: uses fetch() only, no Node.js APIs.
 */

// ─────────────────────────────────────────────────────────────────────────────

export interface RAGChunk {
  chunk_id:       string
  document_id:    string
  document_title: string
  content:        string
  similarity:     number
}

export interface RAGResult {
  chunks:         RAGChunk[]
  contextString:  string   // ready to inject into system prompt
  tokensEstimate: number   // rough token count of context
  retrieved:      boolean  // false if RAG was skipped or failed
}

// Maximum context length to inject (chars) — ~4000 tokens
const MAX_CONTEXT_CHARS = 12_000

// ─── Embed via OpenAI text-embedding-3-small ─────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8192), // model max
      }),
      signal: AbortSignal.timeout(5_000), // 5s timeout
    })

    if (!res.ok) return null

    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    return data.data[0]?.embedding ?? null
  } catch {
    return null
  }
}

// ─── Main retrieval function ──────────────────────────────────────────────────

/**
 * retrieveRAGContext
 *
 * 1. Embeds the user query via OpenAI
 * 2. Calls search_rag_chunks RPC with the embedding vector
 * 3. Formats results into a context string for system prompt injection
 *
 * Non-throwing: returns { retrieved: false } on any failure so the
 * execute route falls back to the base system prompt gracefully.
 */
export async function retrieveRAGContext(
  supabase:        any,
  knowledgeBaseId: string,
  userQuery:       string,
  options: {
    topK?:      number
    threshold?: number
  } = {}
): Promise<RAGResult> {
  const empty: RAGResult = { chunks: [], contextString: "", tokensEstimate: 0, retrieved: false }

  const topK      = Math.min(10, options.topK      ?? 5)
  const threshold = Math.max(0,  options.threshold ?? 0.65)

  // Step 1: Embed the query
  const embedding = await embedText(userQuery)
  if (!embedding) return empty // OpenAI not configured or timed out

  // Step 2: Search pgvector
  let chunks: RAGChunk[] = []
  try {
    const { data, error } = await supabase.rpc("search_rag_chunks", {
      kb_id_param:     knowledgeBaseId,
      query_embedding: `[${embedding.join(",")}]`,  // pgvector text format
      match_threshold: threshold,
      match_count:     topK,
    })

    if (error || !data) return empty
    chunks = (data as any[]).map(r => ({
      chunk_id:       r.chunk_id       ?? r.id ?? "",
      document_id:    r.document_id    ?? "",
      document_title: r.document_title ?? "Unknown",
      content:        r.content        ?? "",
      similarity:     parseFloat((r.similarity ?? 0).toFixed(4)),
    }))
  } catch {
    return empty
  }

  if (chunks.length === 0) return empty

  // Step 3: Build context string for system prompt injection
  let contextString = chunks
    .map((c, i) => `[Source ${i + 1}: ${c.document_title}]\n${c.content}`)
    .join("\n\n---\n\n")

  // Truncate to prevent context overflow
  if (contextString.length > MAX_CONTEXT_CHARS) {
    contextString = contextString.slice(0, MAX_CONTEXT_CHARS) + "\n[Context truncated…]"
  }

  // Rough token estimate: ~4 chars per token
  const tokensEstimate = Math.ceil(contextString.length / 4)

  return { chunks, contextString, tokensEstimate, retrieved: true }
}

// ─── System prompt builder ────────────────────────────────────────────────────

/**
 * buildRAGSystemPrompt
 *
 * Injects retrieved context into the agent's system prompt.
 * Places context between the system instructions and a citation instruction.
 */
export function buildRAGSystemPrompt(
  baseSystemPrompt: string,
  ragResult:        RAGResult
): string {
  if (!ragResult.retrieved || ragResult.chunks.length === 0) {
    return baseSystemPrompt
  }

  return `${baseSystemPrompt}

<knowledge_base_context>
The following information was retrieved from the agent's knowledge base based on the user's query.
Use this context to answer accurately. Cite sources by their number [1], [2] etc. when referencing specific facts.
If the retrieved context does not contain relevant information for the query, say so clearly — do not hallucinate.

${ragResult.contextString}
</knowledge_base_context>

Instructions: Answer the user's question using the context above as your primary source of truth.`
}
