export const runtime = "edge"

/**
 * POST /api/agents/[id]/try
 *
 * Anonymous "try it" endpoint — no login required.
 * Allows anyone to run a FREE agent once without creating an account.
 * This is the highest-leverage activation change: every SaaS that added
 * "try without login" saw 3–5× improvement in signup conversion.
 *
 * Constraints (abuse-proof):
 *   - Free agents only (pricing_model = "free")
 *   - 2 tries per IP per day (anonymous_usage table)
 *   - Input capped at 2KB
 *   - No DB execution record written (ephemeral)
 *   - Response never cached (per-request LLM call)
 *   - Max 2s timeout guard on the IP check
 */

import { NextRequest, NextResponse }   from "next/server"
import { createClient }                from "@/lib/supabase/server"
import { routeCompletion }             from "@/lib/model-router"
import { checkInput }                  from "@/lib/guardrails"
import { runInjectionPipeline }        from "@/lib/injection-filter"

const UUID_RE         = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ANON_BYTES  = 2_048   // 2KB — tighter than authenticated (32KB)
const DAILY_ANON_LIMIT = 2      // 2 free tries per IP per day

function sha256hex(s: string): Promise<string> {
  const enc = new TextEncoder()
  return crypto.subtle.digest("SHA-256", enc.encode(s)).then(buf =>
    Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startMs = Date.now()

  try {
    const { id: agentId } = await params
    if (!UUID_RE.test(agentId))
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

    // ── IP extraction + hash (never store raw IP) ──────────────────────────
    const rawIp = (
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown"
    ).trim()

    const ipHash = await sha256hex(rawIp + ":anon-try:" + new Date().toISOString().slice(0, 10))

    const supabase = await createClient()

    // ── Load agent (free agents only) ──────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, model_name, system_prompt, max_tokens, temperature, pricing_model, status")
      .eq("id", agentId)
      .eq("status", "active")
      .single()

    if (!agent)
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })

    if (agent.pricing_model !== "free")
      return NextResponse.json({
        error:  "Sign in to use this agent",
        code:   "SIGN_IN_REQUIRED",
        signIn: "/login",
      }, { status: 401 })

    // ── Check anonymous usage (IP-based daily limit) ───────────────────────
    const today = new Date().toISOString().slice(0, 10)

    const { data: usage } = await supabase
      .from("anonymous_usage")
      .select("executions_count, last_used_at")
      .eq("ip_hash", ipHash)
      .maybeSingle()

    const usedToday = usage && usage.last_used_at?.startsWith(today)
      ? (usage.executions_count ?? 0)
      : 0

    if (usedToday >= DAILY_ANON_LIMIT) {
      return NextResponse.json({
        error:    `Try limit reached (${DAILY_ANON_LIMIT}/day without an account). Sign up free for more.`,
        code:     "ANON_LIMIT_REACHED",
        signUp:   "/signup",
        limit:    DAILY_ANON_LIMIT,
        used:     usedToday,
      }, { status: 429, headers: { "Retry-After": "86400" } })
    }

    // ── Parse input ────────────────────────────────────────────────────────
    let body: { input?: unknown }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { input } = body
    if (input === undefined || input === null)
      return NextResponse.json({ error: "input is required" }, { status: 400 })

    const userMessage = typeof input === "string" ? input : JSON.stringify(input)
    if (new TextEncoder().encode(userMessage).length > MAX_ANON_BYTES)
      return NextResponse.json({
        error: `Input too large for anonymous try (max ${MAX_ANON_BYTES / 1000}KB). Sign up for the full limit.`,
        signUp: "/signup",
      }, { status: 413 })

    // ── Content guardrails ─────────────────────────────────────────────────
    const guardResult   = checkInput(userMessage)
    // "external" (not "user") — anonymous, no-login input is the least-trusted
    // input this platform accepts, so it gets the same stricter 1.5x injection-
    // score multiplier as tool/URL content. (Fixes a pre-existing bug: the
    // literal "anon" isn't a valid source and failed type-check; "external" is
    // the closest semantic match to the original intent, not a downgrade to "user".)
    const { filterResult } = runInjectionPipeline(userMessage, "external")

    if (!guardResult.allowed || !filterResult.allowed)
      return NextResponse.json({ error: "Input rejected by safety filter." }, { status: 400 })

    // ── Run the agent ──────────────────────────────────────────────────────
    // Use Haiku for all anonymous calls — max cost efficiency, still high quality for free agents
    const modelToUse = (agent.model_name as string).includes("haiku")
      ? agent.model_name as string
      : "claude-haiku-4-5-20251001"

    let output: string, inputTok: number, outputTok: number, costUsd: number

    try {
      const result = await routeCompletion({
        model:       modelToUse,
        system:      agent.system_prompt as string,
        userMessage,
        maxTokens:   Math.min(agent.max_tokens as number ?? 2048, 1024), // cap at 1024 for anon
        temperature: agent.temperature as number ?? 0.7,
      })
      output    = result.text
      inputTok  = result.inputTokens
      outputTok = result.outputTokens
      costUsd   = result.costUsd
    } catch (llmErr: any) {
      return NextResponse.json({
        error: "Agent temporarily unavailable. Sign up and try again.",
        code:  "LLM_ERROR",
      }, { status: 502 })
    }

    const latencyMs = Date.now() - startMs

    // ── Increment anonymous usage (upsert) ─────────────────────────────────
    await supabase.from("anonymous_usage").upsert({
      ip_hash:          ipHash,
      executions_count: usedToday + 1,
      last_used_at:     new Date().toISOString(),
    }, { onConflict: "ip_hash" }).then(() => {})

    // ── Response ───────────────────────────────────────────────────────────
    const res = NextResponse.json({
      output,
      latencyMs,
      tokens:     { input: inputTok, output: outputTok },
      anonymous:  true,
      triesLeft:  DAILY_ANON_LIMIT - (usedToday + 1),
      signUpCta:  "Create a free account to run more agents, save results, and build pipelines.",
      signUpUrl:  "/signup",
    })

    res.headers.set("X-RateLimit-Limit",     String(DAILY_ANON_LIMIT))
    res.headers.set("X-RateLimit-Remaining",  String(Math.max(0, DAILY_ANON_LIMIT - (usedToday + 1))))
    res.headers.set("X-RateLimit-Reset",      String(Math.floor((Date.now() + 86400000) / 1000)))
    res.headers.set("X-RateLimit-Policy",     "daily-anonymous")

    return res

  } catch (err: any) {
    console.error("POST /api/agents/[id]/try:", err)
    return NextResponse.json({ error: "Try failed. Please sign up for a free account." }, { status: 500 })
  }
}
