import { NextRequest, NextResponse } from "next/server"

/**
 * Edge-compatible rate limiter.
 *
 * NOTE: Cloudflare Workers/Pages run stateless edge isolates — an in-memory Map
 * does NOT persist across requests. For true distributed rate limiting, use
 * Cloudflare KV or Durable Objects. This implementation provides lightweight
 * per-isolate throttling which is sufficient for most low-traffic scenarios.
 * For production scale, swap the store below for a KV-backed counter.
 */

interface RateLimitConfig {
  limit: number
  window: number // seconds
}

// Isolate-scoped store — resets when the isolate is recycled by Cloudflare
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(config: RateLimitConfig) {
  return async function (req: NextRequest, identifier?: string): Promise<NextResponse | null> {
    // Prefer Cloudflare's real-IP header, fallback to x-forwarded-for
    const key = identifier
      || req.headers.get("cf-connecting-ip")
      || req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || "anonymous"

    const now = Date.now()
    const record = rateLimitStore.get(key)

    if (!record || now > record.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + config.window * 1000 })
      return null
    }

    if (record.count >= config.limit) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000)
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      )
    }

    record.count++
    return null
  }
}

export const apiRateLimit    = rateLimit({ limit: 100, window: 60 })
export const strictRateLimit = rateLimit({ limit: 10,  window: 60 })
export const authRateLimit   = rateLimit({ limit: 5,   window: 60 })
