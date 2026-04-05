import { NextRequest, NextResponse } from "next/server";

interface RateLimitConfig {
  limit: number;
  window: number; // seconds
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(config: RateLimitConfig) {
  return async function (req: NextRequest, identifier?: string) {
    const key = identifier || req.headers.get("x-forwarded-for") || "anonymous";
    const now = Date.now();

    const record = rateLimitStore.get(key);

    if (!record || now > record.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + config.window * 1000 });
      return null;
    }

    if (record.count >= config.limit) {
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter: Math.ceil((record.resetAt - now) / 1000) },
        { status: 429, headers: { "Retry-After": String(Math.ceil((record.resetAt - now) / 1000)) } }
      );
    }

    record.count++;
    return null;
  };
}

export const apiRateLimit = rateLimit({ limit: 100, window: 60 });
export const strictRateLimit = rateLimit({ limit: 10, window: 60 });
export const authRateLimit = rateLimit({ limit: 5, window: 60 });
