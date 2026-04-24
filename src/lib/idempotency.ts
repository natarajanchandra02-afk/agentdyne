/**
 * AgentDyne — Idempotency Layer
 *
 * Prevents duplicate executions when clients retry (network errors, timeouts).
 * Standard pattern used by Stripe, Shopify, and every serious payment API.
 *
 * How it works:
 *   1. Client sends X-Idempotency-Key header (any UUID or string ≤64 chars)
 *   2. Server hashes: SHA-256(userId + agentId + key) → 32-char hex
 *   3. On first call: insert 'pending' row, execute, update with response
 *   4. On retry: return cached response immediately, no re-execution
 *   5. Rows expire after 24 hours
 *
 * Edge-runtime safe: uses crypto.subtle (Web Crypto API).
 */

export interface IdempotencyCheckResult {
  isFirstRequest: boolean           // true = execute normally
  cachedResponse: object | null     // non-null = return this immediately
  reservationId:  string | null     // DB row id for updating after execution
}

/**
 * hashIdempotencyKey
 * SHA-256(userId + ":" + agentId + ":" + clientKey) → hex string
 * Scoped to (user, agent) so different users with same key don't collide.
 */
export async function hashIdempotencyKey(
  userId:    string,
  agentId:   string,
  clientKey: string
): Promise<string> {
  const input  = `${userId}:${agentId}:${clientKey}`
  const buf    = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * checkIdempotency
 *
 * Call at the START of every execute handler.
 * Returns { isFirstRequest: true } → proceed with execution
 * Returns { isFirstRequest: false, cachedResponse } → return cache immediately
 *
 * Non-throwing: if DB fails, returns { isFirstRequest: true } (fail-open).
 * Better to occasionally double-execute than to block all retries on DB error.
 */
export async function checkIdempotency(
  supabase:  any,
  userId:    string,
  agentId:   string,
  clientKey: string
): Promise<IdempotencyCheckResult> {
  const empty: IdempotencyCheckResult = {
    isFirstRequest: true,
    cachedResponse: null,
    reservationId:  null,
  }

  if (!clientKey || clientKey.length > 64) return empty

  try {
    const keyHash = await hashIdempotencyKey(userId, agentId, clientKey)

    // Try to find existing row
    const { data: existing } = await supabase
      .from("idempotency_keys")
      .select("id, status, response")
      .eq("key_hash", keyHash)
      .maybeSingle()

    if (existing) {
      if (existing.status === "success" && existing.response) {
        // Exact duplicate — return cached response
        return {
          isFirstRequest: false,
          cachedResponse: existing.response as object,
          reservationId:  existing.id,
        }
      }
      if (existing.status === "pending") {
        // Still in-flight — tell client to retry
        return {
          isFirstRequest: false,
          cachedResponse: { error: "Request is already being processed. Retry in a few seconds.", code: "IDEMPOTENCY_PENDING" },
          reservationId:  existing.id,
        }
      }
      // failed — allow retry
      return { ...empty, reservationId: existing.id }
    }

    // First time seeing this key — insert pending row
    const { data: inserted } = await supabase
      .from("idempotency_keys")
      .insert({
        key_hash: keyHash,
        user_id:  userId,
        status:   "pending",
      })
      .select("id")
      .single()

    return {
      isFirstRequest: true,
      cachedResponse: null,
      reservationId:  inserted?.id ?? null,
    }

  } catch {
    // Fail-open: DB error → let execution proceed
    return empty
  }
}

/**
 * commitIdempotency
 *
 * Call AFTER successful execution to cache the response for future retries.
 * Fire-and-forget — never await this in the critical path.
 */
export async function commitIdempotency(
  supabase:      any,
  reservationId: string | null,
  executionId:   string | null,
  response:      object
): Promise<void> {
  if (!reservationId) return
  try {
    await supabase
      .from("idempotency_keys")
      .update({
        status:       "success",
        execution_id: executionId,
        response,
      })
      .eq("id", reservationId)
  } catch {
    // Non-critical — idempotency cache miss just means retry re-executes
  }
}

/**
 * failIdempotency
 * Mark key as failed so the client can retry.
 */
export async function failIdempotency(
  supabase:      any,
  reservationId: string | null
): Promise<void> {
  if (!reservationId) return
  try {
    await supabase
      .from("idempotency_keys")
      .update({ status: "failed" })
      .eq("id", reservationId)
  } catch {
    // Non-critical
  }
}
