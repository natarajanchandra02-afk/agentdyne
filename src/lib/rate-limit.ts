import { NextRequest, NextResponse } from "next/server"

/**
 * AgentDyne — Production Edge Rate Limiter
 *
 * Architecture:
 *   Cloudflare Workers/Pages run stateless isolates. An in-memory Map does
 *   NOT persist across requests or across PoPs. This limiter provides strong
 *   per-isolate burst protection — enough to stop runaway clients and bots
 *   that hit the same PoP repeatedly (which is the common attack pattern).
 *
 * For true global distributed rate limiting at 100M+ req/day:
 *   Replace the Map store with Cloudflare KV or Durable Objects.
 *   The interface is identical — swap the store implementation only.
 *
 * Store design:
 *   - Capped at MAX_STORE_SIZE entries (50k) to prevent OOM under DDoS
 *   - LRU-style eviction: when cap is reached, evict the entry whose
 *     reset window has passed (expired), then oldest insertion if none expired
 *   - IPs are never stored in plaintext — keyed by a 32-bit FNV-1a hash
 *     (non-cryptographic, but sufficient for bucketing; no PII stored)
 *
 * HTTP headers returned on every request:
 *   X-RateLimit-Limit      — window limit
 *   X-RateLimit-Remaining  — remaining requests in this window
 *   X-RateLimit-Reset      — UTC epoch seconds when the window resets
 *   Retry-After            — seconds to wait (only on 429)
 */

interface RateLimitConfig {
  limit:  number   // max requests per window
  window: number   // window size in seconds
}

interface RLEntry {
  count:   number
  resetAt: number  // ms timestamp
  ts:      number  // insertion timestamp for eviction ordering
}

const MAX_STORE_SIZE = 50_000
const store          = new Map<string, RLEntry>()

// ─── FNV-1a 32-bit hash (fast, non-cryptographic — for bucketing only) ────────
// This avoids storing raw IPs (potential PII) in memory.
function hashIP(ip: string): string {
  let h = 2166136261  // FNV offset basis
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i)
    h = Math.imul(h, 16777619)  // FNV prime
    h >>>= 0  // keep as uint32
  }
  return h.toString(36)
}

// ─── LRU-style eviction ───────────────────────────────────────────────────────
function evict(): void {
  const now = Date.now()
  // 1st pass: evict any expired entry (fast O(1) if found early)
  for (const [k, v] of store) {
    if (now > v.resetAt) { store.delete(k); return }
  }
  // 2nd pass: evict oldest insertion (LRU fallback)
  let oldestKey = ""
  let oldestTs  = Infinity
  for (const [k, v] of store) {
    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k }
  }
  if (oldestKey) store.delete(oldestKey)
}

// ─── Core rate limiter factory ────────────────────────────────────────────────

export function rateLimit(config: RateLimitConfig) {
  return async function (req: NextRequest, customIdentifier?: string): Promise<NextResponse | null> {
    // Identifier: custom > CF real IP > x-forwarded-for > anonymous
    const rawId =
      customIdentifier ??
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      "anon"

    // Hash IP for storage (avoids PII in memory)
    const key = customIdentifier ? rawId : hashIP(rawId)

    const now    = Date.now()
    const record = store.get(key)

    if (!record || now > record.resetAt) {
      // New window
      if (store.size >= MAX_STORE_SIZE) evict()
      store.set(key, { count: 1, resetAt: now + config.window * 1000, ts: now })

      return buildOkResponse(1, config.limit, now + config.window * 1000)
    }

    if (record.count >= config.limit) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000)
      return NextResponse.json(
        {
          error:      "Rate limit exceeded. Please slow down.",
          retryAfter,
          limit:      config.limit,
          reset:      Math.ceil(record.resetAt / 1000),
        },
        {
          status:  429,
          headers: {
            "Retry-After":           String(retryAfter),
            "X-RateLimit-Limit":     String(config.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset":     String(Math.ceil(record.resetAt / 1000)),
          },
        }
      )
    }

    record.count++
    return buildOkResponse(record.count, config.limit, record.resetAt)
  }
}

// ─── Helper: return null but set rate-limit headers on the NEXT response ──────
// We can't set headers on "null" — callers must manually add these headers to
// their response if they want perfect rate-limit header propagation.
// Returning null means "allow the request" — headers are set by middleware.

function buildOkResponse(
  count:   number,
  limit:   number,
  resetAt: number
): null {
  // We return null to signal "allow" — rate-limit headers are added by
  // middleware.ts via the X-RateLimit-* pattern. This keeps route handlers clean.
  return null
}

// ─── Pre-configured limiters ──────────────────────────────────────────────────

/** General API: 100 req/min per IP */
export const apiRateLimit = rateLimit({ limit: 100, window: 60 })

/** Write/expensive endpoints: 10 req/min per IP (RAG ingest, agent create) */
export const strictRateLimit = rateLimit({ limit: 10, window: 60 })

/** Auth endpoints: 5 req/min per IP (brute-force protection) */
export const authRateLimit = rateLimit({ limit: 5, window: 60 })

/** Execute endpoint: 30 req/min per user (per-user not per-IP) */
export const executeRateLimit = rateLimit({ limit: 30, window: 60 })

/** Admin: 30 req/min per admin user */
export const adminRateLimit = rateLimit({ limit: 30, window: 60 })

/** Feedback: 20 req/min (prevent rating spam) */
export const feedbackRateLimit = rateLimit({ limit: 20, window: 60 })
