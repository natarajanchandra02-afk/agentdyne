/**
 * AgentDyne — Execution Cache
 *
 * Semantic response caching: identical inputs to the same agent return cached
 * outputs without calling the LLM. Cuts cost and latency for deterministic queries.
 *
 * Cache key: SHA-256(agent_id + ":" + normalized_input)
 * Normalization: lowercase + collapse whitespace + trim + first 8192 chars.
 *
 * Cache invalidation:
 *   - TTL expiry (pg_cron cleans expired rows hourly)
 *   - Agent system prompt update → invalidateAgentCache()
 *   - Cache-Control: no-cache header from client
 *
 * When NOT to cache:
 *   - Streaming requests (never cache partial streams)
 *   - Temperature > 0.3 (non-deterministic — different output each time)
 *   - Client sends Cache-Control: no-cache or no_cache=true body param
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
 * SHA-256(agent_id + ":" + normalized input)
 * "Hello World" and "hello  world" → same cache key (normalized).
 */
export async function buildCacheKey(agentId: string, inputText: string): Promise<string> {
  const normalized = inputText
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8192)
  const raw = `${agentId}:${normalized}`
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * checkExecutionCache
 *
 * Returns { hit: true, output, ... } if a valid cached response exists.
 * Returns { hit: false } on miss, error, or bypass condition.
 *
 * Non-throwing: cache miss is always the safe fallback.
 */
export async function checkExecutionCache(
  supabase:  any,
  agentId:   string,
  inputText: string,
  options: {
    bypass?:      boolean   // Cache-Control: no-cache or user preference
    temperature?: number    // high temp = non-deterministic = never cache
  } = {}
): Promise<CacheResult> {
  // Never cache high-temperature or explicitly bypassed requests
  if (options.bypass) return { hit: false }
  if (options.temperature !== undefined && options.temperature > 0.3) return { hit: false }

  try {
    const cacheKey = await buildCacheKey(agentId, inputText)

    const { data } = await supabase
      .from("execution_cache")
      .select("output, tokens_input, tokens_output, cost_usd, created_at")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle()

    if (!data) return { hit: false }

    // FIX: increment hit_count via standalone RPC call (not inside .update().set())
    // The previous implementation incorrectly embedded rpc() as a JS value in an
    // update payload, which serialized the Promise object as JSON instead of calling it.
    supabase
      .rpc("increment_cache_hits", { key: cacheKey })
      .then(() => {})
      .catch(() => {})

    const output = data.output?.text !== undefined ? data.output.text : data.output

    return {
      hit:          true,
      output,
      tokensInput:  data.tokens_input  ?? 0,
      tokensOutput: data.tokens_output ?? 0,
      costUsd:      0,           // cached = $0 LLM cost
      cachedAt:     data.created_at,
    }
  } catch {
    // Cache failure is never fatal — fall through to LLM
    return { hit: false }
  }
}

/**
 * writeExecutionCache
 *
 * Stores a successful LLM response for future cache hits.
 * Fire-and-forget — never await in the critical path.
 *
 * @param ttlSeconds  How long to cache. 0 = skip. Default 3600 (1 hour).
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
  // Never cache non-deterministic responses
  if (options.temperature !== undefined && options.temperature > 0.3) return

  try {
    const cacheKey  = await buildCacheKey(agentId, inputText)
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()

    // Normalise: always store as { text: string } or the object directly
    const outputJson =
      typeof output === "string"  ? { text: output } :
      output !== null && typeof output === "object" ? output :
      { text: String(output) }

    await supabase
      .from("execution_cache")
      .upsert({
        cache_key:     cacheKey,
        agent_id:      agentId,
        output:        outputJson,
        tokens_input:  tokensInput,
        tokens_output: tokensOutput,
        cost_usd:      costUsd,
        expires_at:    expiresAt,
        hit_count:     0,
      }, { onConflict: "cache_key" })
  } catch {
    // Cache write failure is never fatal
  }
}

/**
 * invalidateAgentCache
 *
 * Delete ALL cached entries for an agent.
 * Call when: system prompt updated, agent suspended, admin request.
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
