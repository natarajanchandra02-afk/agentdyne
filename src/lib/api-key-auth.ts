/**
 * AgentDyne — API Key Authentication Utility
 *
 * SECURITY MODEL (April 2026):
 *   New keys:    HMAC-SHA256(rawKey, INTERNAL_API_SECRET) → stored hash
 *   Legacy keys: SHA-256(rawKey) → stored hash  (backward compat)
 *
 * Why HMAC over plain SHA-256?
 *   SHA-256 is fast → brute-forceable if DB leaks (rainbow tables feasible
 *   for short tokens). HMAC adds a server-side secret that an attacker
 *   cannot know even after DB compromise. Stripe, GitHub all use HMAC.
 *
 * Edge-runtime safe: Web Crypto API only.
 */

export interface ApiKeyValidation {
  valid:   boolean
  userId:  string | null
  keyId:   string | null
  keyRow:  ApiKeyRow | null
  reason?: string
}

export interface ApiKeyRow {
  id:                 string
  user_id:            string
  is_active:          boolean
  expires_at:         string | null
  permissions:        string[]
  rate_limit_per_minute: number
  rate_limit_per_day: number
  allowed_agent_ids:  string[]
  ip_allowlist:       string[]
  environment:        string
  hash_algo:          string
  calls_today:        number
  errors_today:       number
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

/**
 * hashApiKey
 * Primary: HMAC-SHA256(rawKey, INTERNAL_API_SECRET)
 * Used for all new keys created after migration 029.
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  const secret = process.env.INTERNAL_API_SECRET ?? "agentdyne-fallback-secret-change-me"
  const enc    = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(rawKey))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * hashApiKeyLegacy
 * SHA-256(rawKey) — used to validate keys created before migration 029.
 */
export async function hashApiKeyLegacy(rawKey: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0")).join("")
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * validateApiKey
 *
 * 1. HMAC hash lookup (new keys)
 * 2. Fallback to SHA-256 (legacy keys)
 * 3. Check active, not expired, within rate limits
 * 4. Optionally check agent scope (pass agentId)
 * 5. Update last_used_at, calls_today, last_used_ip (fire-and-forget)
 */
export async function validateApiKey(
  supabase:  any,
  rawKey:    string,
  options: {
    agentId?:  string
    ip?:       string
    required?: string[]  // required permissions e.g. ["execute"]
  } = {}
): Promise<ApiKeyValidation> {
  const INVALID: ApiKeyValidation = { valid: false, userId: null, keyId: null, keyRow: null }

  if (!rawKey || rawKey.length > 200) return { ...INVALID, reason: "Invalid key format" }

  // Try HMAC first, then legacy SHA-256
  const [hmacHash, sha256Hash] = await Promise.all([
    hashApiKey(rawKey),
    hashApiKeyLegacy(rawKey),
  ])

  const { data: keyRow } = await supabase
    .from("api_keys")
    .select("id, user_id, is_active, expires_at, permissions, rate_limit_per_minute, rate_limit_per_day, allowed_agent_ids, ip_allowlist, environment, hash_algo, calls_today, errors_today, key_hash")
    .or(`key_hash.eq.${hmacHash},key_hash.eq.${sha256Hash}`)
    .eq("is_active", true)
    .maybeSingle() as { data: (ApiKeyRow & { key_hash: string }) | null }

  if (!keyRow) return { ...INVALID, reason: "Key not found or revoked" }

  // Expiry check
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date())
    return { ...INVALID, reason: "Key expired" }

  // Permission check
  if (options.required?.length) {
    const missing = options.required.filter(p => !keyRow.permissions?.includes(p))
    if (missing.length > 0)
      return { ...INVALID, reason: `Missing permissions: ${missing.join(", ")}` }
  }

  // Agent scope check
  if (options.agentId && keyRow.allowed_agent_ids?.length > 0) {
    if (!keyRow.allowed_agent_ids.includes(options.agentId))
      return { ...INVALID, reason: "Key not authorized for this agent" }
  }

  // IP allowlist check
  if (options.ip && keyRow.ip_allowlist?.length > 0) {
    if (!keyRow.ip_allowlist.includes(options.ip))
      return { ...INVALID, reason: "IP not in allowlist" }
  }

  // Per-day limit check
  const dayLimit = keyRow.rate_limit_per_day ?? 10000
  if ((keyRow.calls_today ?? 0) >= dayLimit)
    return { ...INVALID, reason: "Daily rate limit exceeded for this key" }

  // Fire-and-forget usage tracking
  supabase.from("api_keys").update({
    last_used_at: new Date().toISOString(),
    last_used_ip: options.ip ?? null,
    calls_today:  (keyRow.calls_today ?? 0) + 1,
    total_calls:  supabase.rpc ? undefined : undefined,  // handled by trigger
  }).eq("id", keyRow.id).then(() => {})

  // Migrate legacy key to HMAC on next use
  if (keyRow.hash_algo === 'sha256' && keyRow.key_hash === sha256Hash) {
    supabase.from("api_keys").update({
      key_hash:  hmacHash,
      hash_algo: 'hmac-sha256',
    }).eq("id", keyRow.id).then(() => {})
  }

  return {
    valid:  true,
    userId: keyRow.user_id,
    keyId:  keyRow.id,
    keyRow,
  }
}

/**
 * extractRawKey
 * Pull raw key from Authorization header or X-Api-Key header.
 */
export function extractRawKey(req: Request | { headers: { get: (k: string) => string | null } }): string | null {
  const auth = req.headers.get("authorization")
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim()
  return req.headers.get("x-api-key")
}
