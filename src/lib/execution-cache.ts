/**
 * AgentDyne — Execution Cache
 *
 * Semantic response caching: identical inputs to the same agent return cached
 * outputs without calling the LLM. This cuts cost and latency dramatically.
 *
 * Cache key: SHA-256(agent_id + ":" + normalized_input)
 * TTL: 1 hour by default (configurable per agent via cache_ttl_seconds)
 *
 * Cache invalidation:
 *   - System prompt change → new cache miss (different agent config)
 *   - TTL expiry → automatic (pg_cron cleanup + expires_at filter)
 *   - Manual: DELETE /api/agents/:id/cache (admin only)
 *
 * When to cache vs not:
 *   ✅ Cache: deterministic queries (classification, extraction, factual QA)
 *   ❌ Skip: streaming requests, random temperature > 0.5, user explicitly opts out
 *
 * Cache-Control: no-cache header or ?no_cache=1 bypasses the cache.
 *
 * Edge-runtime safe: Web Crypto API only.
 */

export interface CacheResult {
  hit:           boolean
  output?:       unknown
  tokensInput?:  number
  tokensOutput?: number
  costUsd?:      number
  cachedAt?:     string
}

/**
 * buildCacheKey
 * SHA-256(agent_id + ":" + normalized input text)
 * Normalization: lowercase, collapse whitespace, trim.
 * This makes "Hello World" and "hello world" hit the same cache entry.
 */
export async function buildCacheKey(agentId: string, inputText: string): Promise<string> {
  const normalized = inputText.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 8192)
  const raw        = `${agentId}:${normalized}`
  const buf        = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * checkExecutionCache
 *
 * Returns { hit: true, output, ... } if a valid cached response exists.
 * Returns { hit: false } on miss, error, or bypass.
 *
 * Non-throwing: cache miss is always the safe fallback.
 */
export async function checkExecutionCache(
  supabase:  any,
  agentId:   string,
  inputText: string,
  options: {
    bypass?:      boolean  // Cache-Control: no-cache or user preference
    temperature?: number   // high temp = non-deterministic = don't cache
  } = {}
): Promise<CacheResult> {
  // Never cache high-temperature or explicitly bypassed requests
  if (options.bypass || (options.temperature !== undefined && options.temperature > 0.3)) {
    return { hit: false }
  }

  try {
    const cacheKey = await buildCacheKey(agentId, inputText)

    const { data } = await supabase
      .from("execution_cache")
      .select("output, tokens_input, tokens_output, cost_usd, created_at")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle()

    if (!data) return { hit: false }

    // Increment hit count (fire-and-forget — never block on this)
    supabase
      .from("execution_cache")
      .update({ hit_count: supabase.rpc("increment_cache_hits", { key: cacheKey }) })
      .eq("cache_key", cacheKey)
      .then(() => {})
      .catch(() => {})

    return {
      hit:          true,
      output:       data.output?.text ?? data.output,
      tokensInput:  data.tokens_input  ?? 0,
      tokensOutput: data.tokens_output ?? 0,
      costUsd:      0, // cached = no LLM cost
      cachedAt:     data.created_at,
    }
  } catch {
    return { hit: false }
  }
}

/**
 * writeExecutionCache
 *
 * Store a successful response. Fire-and-forget — never await.
 *
 * @param ttlSeconds  How long to cache. Default 3600 (1 hour).
 *                    Set to 0 to skip caching.
 */
export async function writeExecutionCache(
  supabase:     any,
  agentId:      string,
  inputText:    string,
  output:       unknown,
  tokensInput:  number,
  tokensOutput: number,
  costUsd:      number,
  options: {
    ttlSeconds?:  number
    temperature?: number
  } = {}
): Promise<void> {
  const ttl = options.ttlSeconds ?? 3600
  if (ttl === 0) return
  if (options.temperature !== undefined && options.temperature > 0.3) return

  try {
    const cacheKey  = await buildCacheKey(agentId, inputText)
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()

    // Store output as jsonb — wrap primitive strings
    const outputJson = typeof output === "object" && output !== null
      ? output
      : { text: String(output) }

    await supabase
      .from("execution_cache")
      .upsert({
        cache_key:    cacheKey,
        agent_id:     agentId,
        output:       outputJson,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        cost_usd:     costUsd,
        expires_at:   expiresAt,
        hit_count:    0,
      }, { onConflict: "cache_key" })
  } catch {
    // Cache write failure is never fatal
  }
}

/**
 * invalidateAgentCache
 *
 * Delete all cached entries for an agent.
 * Call when: agent system prompt updated, agent suspended, admin request.
 */
export async function invalidateAgentCache(supabase: any, agentId: string): Promise<void> {
  try {
    await supabase
      .from("execution_cache")
      .delete()
      .eq("agent_id", agentId)
  } catch {
    // Non-critical
  }
}
