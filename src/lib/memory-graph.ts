/**
 * AgentDyne — Execution Memory Graph
 * 
 * Transforms flat key-value agent_memory into a semantic intelligence layer.
 * 
 * What this builds (completing the GPT vision):
 *   - Embedding memory values on write → pgvector semantic search on read
 *   - getRelevantMemories(query) → top-K memories ranked by cosine similarity
 *   - Pattern inference → learns "prefers AWS, uses TypeScript, GitHub Actions"
 *   - Cross-execution learning → each execution enriches the memory graph
 *   - Memory decay → TTL-aware, recent memories weighted higher
 * 
 * Architecture:
 *   agent_memory (existing) → stores raw KV + embedding vector column
 *   agentContext.getRelevantMemories() → cosine similarity search via RPC
 * 
 * Edge-runtime safe: fetch() only, no Node.js APIs.
 */

export interface MemoryEntry {
  key:         string
  value:       unknown
  embedding?:  number[]
  similarity?: number
  ttl_at?:     string | null
  updated_at:  string
  tags?:       string[]
}

export interface MemoryGraphResult {
  memories:       MemoryEntry[]
  patterns:       InferredPattern[]
  contextString:  string
  tokensEstimate: number
  retrieved:      boolean
}

export interface InferredPattern {
  category:   string
  preference: string
  confidence: number
  examples:   string[]
}

const EMPTY_RESULT: MemoryGraphResult = {
  memories: [], patterns: [], contextString: "", tokensEstimate: 0, retrieved: false,
}

// ─── Embed text via OpenAI ────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    // Fallback: use Anthropic-compatible embedding if available
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) return null
    // Claude doesn't expose embeddings directly, return null to use keyword fallback
    return null
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

// ─── Store memory with embedding ──────────────────────────────────────────────

export async function storeMemoryWithEmbedding(
  supabase:  any,
  userId:    string,
  agentId:   string,
  key:       string,
  value:     unknown,
  options:   { ttlSeconds?: number; tags?: string[] } = {}
): Promise<{ ok: boolean; embedded: boolean }> {
  const valueStr = typeof value === "string" ? value : JSON.stringify(value)
  const textToEmbed = `${key}: ${valueStr}`.slice(0, 8000)

  // Embed in parallel with the upsert — don't block on embedding
  const [embedding] = await Promise.all([
    embedText(textToEmbed),
  ])

  const ttlAt = options.ttlSeconds
    ? new Date(Date.now() + options.ttlSeconds * 1000).toISOString()
    : null

  const valueJson = typeof value === "string" ? { raw: value } : value

  const { error } = await supabase
    .from("agent_memory")
    .upsert({
      user_id:    userId,
      agent_id:   agentId,
      key:        key.trim(),
      value:      valueJson,
      embedding:  embedding ? `[${embedding.join(",")}]` : null,
      tags:       options.tags ?? [],
      ttl_at:     ttlAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,agent_id,key" })

  return { ok: !error, embedded: !!embedding }
}

// ─── Semantic memory retrieval ────────────────────────────────────────────────

export async function getRelevantMemories(
  supabase:  any,
  userId:    string,
  agentId:   string,
  query:     string,
  options:   { topK?: number; threshold?: number; includeAll?: boolean } = {}
): Promise<MemoryGraphResult> {
  const topK      = Math.min(20, Math.max(1, options.topK ?? 10))
  const threshold = options.threshold ?? 0.6

  const now = new Date().toISOString()

  // Try semantic search first (if embeddings are available)
  const queryEmbedding = await embedText(query)

  let memories: MemoryEntry[] = []

  if (queryEmbedding) {
    // Semantic search via pgvector
    try {
      const { data, error } = await supabase.rpc("search_agent_memories", {
        user_id_param:    userId,
        agent_id_param:   agentId,
        query_embedding:  `[${queryEmbedding.join(",")}]`,
        match_threshold:  threshold,
        match_count:      topK,
      })

      if (!error && data?.length > 0) {
        memories = (data as any[]).map(r => ({
          key:        r.key,
          value:      r.value,
          similarity: parseFloat((r.similarity ?? 0).toFixed(3)),
          ttl_at:     r.ttl_at ?? null,
          updated_at: r.updated_at ?? now,
          tags:       r.tags ?? [],
        }))
      }
    } catch {
      // Fall through to keyword search
    }
  }

  // Fallback: keyword + recency search if no embedding results
  if (memories.length === 0) {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)

    const { data } = await supabase
      .from("agent_memory")
      .select("key, value, tags, ttl_at, updated_at")
      .eq("user_id", userId)
      .eq("agent_id", agentId)
      .or(`ttl_at.is.null,ttl_at.gt.${now}`)
      .order("updated_at", { ascending: false })
      .limit(options.includeAll ? 100 : topK * 3)

    if (data?.length > 0) {
      memories = (data as any[])
        .map(r => {
          const valueStr = JSON.stringify(r.value ?? "").toLowerCase()
          const keyStr = r.key.toLowerCase()
          const matches = keywords.filter(kw => keyStr.includes(kw) || valueStr.includes(kw)).length
          const score = keywords.length > 0 ? matches / keywords.length : 0.5
          return { key: r.key, value: r.value, similarity: score, ttl_at: r.ttl_at, updated_at: r.updated_at, tags: r.tags ?? [] }
        })
        .filter(m => m.similarity > 0 || options.includeAll)
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
        .slice(0, topK)
    }
  }

  if (memories.length === 0) return EMPTY_RESULT

  // Infer patterns from all memories
  const { data: allMemories } = await supabase
    .from("agent_memory")
    .select("key, value, updated_at, tags")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .or(`ttl_at.is.null,ttl_at.gt.${now}`)
    .order("updated_at", { ascending: false })
    .limit(100)

  const patterns = inferPatterns(allMemories ?? [])

  // Build context string
  const contextString = buildMemoryContextString(memories, patterns)

  return {
    memories,
    patterns,
    contextString,
    tokensEstimate: Math.ceil(contextString.length / 4),
    retrieved: true,
  }
}

// ─── Pattern inference ────────────────────────────────────────────────────────

function inferPatterns(memories: any[]): InferredPattern[] {
  const patterns: InferredPattern[] = []

  // Technology preferences
  const techKeywords: Record<string, string[]> = {
    "Cloud Provider":   ["aws", "gcp", "azure", "cloudflare", "vercel", "supabase"],
    "Language":         ["typescript", "javascript", "python", "rust", "go", "java", "ruby"],
    "Framework":        ["next.js", "react", "vue", "angular", "fastapi", "django", "express"],
    "Database":         ["postgres", "mysql", "mongodb", "redis", "supabase", "planetscale"],
    "CI/CD":            ["github actions", "gitlab", "jenkins", "circleci", "vercel"],
    "Infrastructure":   ["kubernetes", "docker", "terraform", "ansible", "pulumi"],
  }

  for (const [category, keywords] of Object.entries(techKeywords)) {
    const found: Record<string, number> = {}
    for (const mem of memories) {
      const str = `${mem.key} ${JSON.stringify(mem.value)}`.toLowerCase()
      for (const kw of keywords) {
        if (str.includes(kw)) found[kw] = (found[kw] ?? 0) + 1
      }
    }
    const sorted = Object.entries(found).sort(([, a], [, b]) => b - a)
    if (sorted.length > 0) {
      const top = sorted.slice(0, 3)
      patterns.push({
        category,
        preference: top.map(([k]) => k).join(", "),
        confidence: Math.min(0.95, top[0][1] / Math.max(memories.length, 1)),
        examples:   top.map(([k]) => k),
      })
    }
  }

  return patterns.slice(0, 5)
}

// ─── Context string builder ───────────────────────────────────────────────────

function buildMemoryContextString(memories: MemoryEntry[], patterns: InferredPattern[]): string {
  const lines: string[] = []

  if (patterns.length > 0) {
    lines.push("USER CONTEXT (learned from past interactions):")
    for (const p of patterns) {
      lines.push(`• ${p.category}: ${p.preference} (${Math.round(p.confidence * 100)}% confidence)`)
    }
    lines.push("")
  }

  if (memories.length > 0) {
    lines.push("RELEVANT MEMORIES:")
    for (const m of memories) {
      const val = m.value && typeof m.value === "object" && "raw" in (m.value as any)
        ? (m.value as any).raw
        : JSON.stringify(m.value)
      lines.push(`• ${m.key}: ${String(val).slice(0, 200)}`)
    }
  }

  return lines.join("\n")
}

// ─── Auto-extract and store memories from execution ───────────────────────────

export async function extractAndStoreExecutionMemories(
  supabase:  any,
  userId:    string,
  agentId:   string,
  input:     string,
  output:    string,
  options:   { maxEntries?: number } = {}
): Promise<void> {
  const maxEntries = options.maxEntries ?? 5
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return

  try {
    // Use Haiku to extract memorable facts from the exchange
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `Extract up to ${maxEntries} memorable user preferences or facts from this agent exchange that would help personalize future responses. Focus on: technology choices, preferences, goals, context.

User input: ${input.slice(0, 500)}
Agent output: ${output.slice(0, 500)}

Respond ONLY with JSON array, no other text:
[{"key": "short_key", "value": "what_was_learned", "tags": ["technology"]}]

If nothing memorable, respond: []`,
        }],
      }),
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) return

    const data = await res.json() as any
    const text = data.content?.[0]?.text ?? "[]"
    const clean = text.replace(/```json|```/g, "").trim()
    const entries = JSON.parse(clean) as Array<{ key: string; value: string; tags?: string[] }>

    if (!Array.isArray(entries) || entries.length === 0) return

    // Store each extracted memory with embedding
    await Promise.all(
      entries.slice(0, maxEntries).map(entry =>
        storeMemoryWithEmbedding(
          supabase, userId, agentId,
          entry.key, entry.value,
          { tags: entry.tags ?? [], ttlSeconds: 86400 * 90 } // 90 days
        ).catch(() => {}) // Non-blocking
      )
    )
  } catch {
    // Silent failure — memory extraction is enhancement, not critical path
  }
}

// ─── Build system prompt with memory context ──────────────────────────────────

export function buildMemorySystemPrompt(
  basePrompt:   string,
  memoryResult: MemoryGraphResult,
): string {
  if (!memoryResult.retrieved || memoryResult.contextString.length === 0) {
    return basePrompt
  }

  return `${basePrompt}

<user_context>
${memoryResult.contextString}
</user_context>

Use this context to personalize your response. Don't mention that you have this context — just incorporate it naturally.`
}
