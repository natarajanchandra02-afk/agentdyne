export const runtime = 'edge'

/**
 * GET /api/health
 *
 * Public health check endpoint for:
 *   - Better Stack uptime monitoring (30s interval)
 *   - Cloudflare health checks
 *   - Load balancer probes
 *   - Your own "is the platform up?" check
 *
 * Returns:
 *   200 { status: "ok", ... }          — platform is healthy
 *   503 { status: "degraded", ... }    — DB/providers unavailable
 *
 * Register with Better Stack:
 *   betterstack.com → Uptime → New Monitor → URL: https://agentdyne.com/api/health
 *   Check interval: 30 seconds | Alert via: Slack + Email
 */

import { NextRequest, NextResponse } from "next/server"
import { pingHeartbeat } from "@/lib/monitoring"
import { createClient } from "@/lib/supabase/server"

const START_TIME = Date.now()

export async function GET(req: NextRequest) {
  const startMs = Date.now()

  // Ping Better Stack heartbeat (so it knows we're alive)
  pingHeartbeat()

  // Check all providers
  const checks = {
    database:   false,
    anthropic:  !!process.env.ANTHROPIC_API_KEY,
    openai:     !!process.env.OPENAI_API_KEY,
    stripe:     !!process.env.STRIPE_SECRET_KEY,
  }

  // DB connectivity check (lightweight — just count 1 row)
  try {
    const supabase  = await createClient()
    const { error } = await supabase
      .from("platform_config")
      .select("key")
      .limit(1)
    checks.database = !error
  } catch {
    checks.database = false
  }

  const allOk    = checks.database
  const latencyMs = Date.now() - startMs
  const uptime    = Math.floor((Date.now() - START_TIME) / 1000)

  const body = {
    status:    allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    latency_ms: latencyMs,
    uptime_seconds: uptime,
    version:   process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0",
    checks,
    maintenance: process.env.MAINTENANCE_MODE === "true",
  }

  return NextResponse.json(body, {
    status:  allOk ? 200 : 503,
    headers: {
      "Cache-Control":   "no-store, max-age=0",
      "X-Health-Status": allOk ? "ok" : "degraded",
    },
  })
}
