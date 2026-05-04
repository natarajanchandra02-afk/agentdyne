/**
 * POST /api/sandbox
 *
 * Anonymous "Try without login" execution endpoint.
 *
 * Design:
 *   - No authentication required
 *   - 2 runs per device fingerprint (enforced by DB count)
 *   - 2 runs per IP prefix (secondary guard against fingerprint spoofing)
 *   - Cache-first: same input → return cached result at zero LLM cost
 *   - Only whitelisted agents (sandbox_enabled = true, status = active)
 *   - Haiku only — cheapest model, 500 token cap
 *   - No pipelines — single agent only
 *   - After 2 runs: 401 with upgrade prompt
 *
 * Economics:
 *   - Cache hit:  ~$0 (DB read only)
 *   - Cache miss: ~$0.00005 per run (Haiku, 500 tokens max)
 *   - Break-even: even at 100% cache miss rate, 1K sandbox runs = $0.05
 *   - This is a conversion mechanism, not a cost center
 */

export const runtime = "edge"

import { NextRequest, NextResponse }  from "next/server"
import { createAdminClient }          from "@/lib/supabase/admin"
import { routeCompletion }            from "@/lib/model-router"
import { runInjectionPipeline, sanitizeOutput } from "@/lib/injection-filter"
import { checkExecutionCache, writeExecutionCache } from "@/lib/execution-cache"
import { sha256hex }                  from "@/lib/trust-layer"
import { apiRateLimit }               from "@/lib/rate-limit"

const SANDBOX_MODEL      = "claude-haiku-4-5-20251001"
const SANDBOX_MAX_TOKENS = 500
const SANDBOX_RUN_LIMIT  = 2
const IP_RUN_LIMIT       = 6

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Sandbox temporarily unavailable." }, { status: 503 })
    }

    const supabase = createAdminClient()

    let body: { agent_id?: string; input?: string; fingerprint?: string }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

    const { agent_id, input, fingerprint: rawFingerprint } = body

    if (!agent_id || !input?.trim())
      return NextResponse.json({ error: "agent_id and input are required" }, { status: 400 })
    if (input.length > 2000)
      return NextResponse.json({ error: "Input must be 2000 characters or fewer" }, { status: 400 })

    // ── Fingerprint + IP tracking ─────────────────────────────────────────────
    const ip       = req.headers.get("cf-connecting-ip") ??
                     req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
    const ipPrefix = ip.split(".").slice(0, 3).join(".")

    const fingerprintHash = rawFingerprint?.trim()
      ? await sha256hex(`fp:${rawFingerprint.trim()}`)
      : await sha256hex(`ip:${ip}`)

    const [{ count: fpCount }, { count: ipCount }] = await Promise.all([
      supabase.from("sandbox_runs").select("id", { count: "exact", head: true }).eq("fingerprint", fingerprintHash),
      supabase.from("sandbox_runs").select("id", { count: "exact", head: true }).eq("ip_prefix", ipPrefix),
    ])

    const runsUsed   = fpCount ?? 0
    const ipRunsUsed = ipCount ?? 0

    if (runsUsed >= SANDBOX_RUN_LIMIT || ipRunsUsed >= IP_RUN_LIMIT) {
      return NextResponse.json({
        error:        "You've used your 2 free previews.",
        code:         "SANDBOX_LIMIT_REACHED",
        runs_used:    runsUsed,
        runs_allowed: SANDBOX_RUN_LIMIT,
        message:      "Create a free account — 50 executions included, no credit card required.",
        signup_url:   "/signup",
      }, { status: 401 })
    }

    // ── Load agent ────────────────────────────────────────────────────────────
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    if (!UUID_RE.test(agent_id))
      return NextResponse.json({ error: "Invalid agent_id" }, { status: 400 })

    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, system_prompt, status, sandbox_enabled")
      .eq("id", agent_id)
      .eq("status", "active")
      .eq("sandbox_enabled", true)
      .single()

    if (!agent) {
      return NextResponse.json({
        error:    "This agent is not available for sandbox preview.",
        code:     "AGENT_NOT_SANDBOX_ELIGIBLE",
        signup_url: "/signup",
      }, { status: 404 })
    }

    if (!agent.system_prompt)
      return NextResponse.json({ error: "Agent is not configured" }, { status: 422 })

    // ── Injection filter ──────────────────────────────────────────────────────
    const { filterResult } = runInjectionPipeline(input.trim(), "user")
    if (!filterResult.allowed)
      return NextResponse.json({ error: "Input rejected by security filter" }, { status: 400 })

    // ── Cache-first (this is how sandbox stays near-$0) ───────────────────────
    const cacheResult = await checkExecutionCache(supabase, agent_id, input.trim(), {
      bypass: false, temperature: 0.0,
    })

    let outputText: string
    let tokensIn  = 0, tokensOut = 0, costUsd = 0, cacheHit = false

    if (cacheResult.hit && cacheResult.output) {
      outputText = typeof cacheResult.output === "string"
        ? cacheResult.output
        : (cacheResult.output as any)?.text ?? JSON.stringify(cacheResult.output)
      tokensIn   = cacheResult.tokensInput  ?? 0
      tokensOut  = cacheResult.tokensOutput ?? 0
      cacheHit   = true
    } else {
      const result = await routeCompletion({
        model:       SANDBOX_MODEL,
        system:      agent.system_prompt,
        userMessage: input.trim().slice(0, 1000),
        maxTokens:   SANDBOX_MAX_TOKENS,
        temperature: 0.0,   // deterministic = max cache hit rate on future runs
      })
      const { text: safeText } = sanitizeOutput(result.text)
      outputText = safeText
      tokensIn   = result.inputTokens
      tokensOut  = result.outputTokens
      costUsd    = result.costUsd

      writeExecutionCache(
        supabase, agent_id, input.trim(), { text: safeText },
        tokensIn, tokensOut, costUsd,
        { ttlSeconds: 86_400, temperature: 0.0 }
      ).catch(() => {})
    }

    // ── Record run (fire-and-forget) ──────────────────────────────────────────
    supabase.from("sandbox_runs").insert({
      fingerprint: fingerprintHash, ip_prefix: ipPrefix,
      agent_id, input_text: input.trim().slice(0, 300),
      output_text: outputText.slice(0, 300),
      model_used:  cacheHit ? "(cached)" : SANDBOX_MODEL,
      tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: costUsd, cache_hit: cacheHit,
    }).then(() => {}).catch(() => {})

    const isLastFreeRun = runsUsed === SANDBOX_RUN_LIMIT - 1

    return NextResponse.json({
      output:       outputText,
      agent_name:   agent.name,
      cache_hit:    cacheHit,
      model_used:   cacheHit ? "cached" : SANDBOX_MODEL,
      runs_used:    runsUsed + 1,
      runs_allowed: SANDBOX_RUN_LIMIT,
      ...(isLastFreeRun && {
        upgrade_prompt: {
          title:   "That was your 2nd free preview",
          message: "Create a free account for 50 full executions — no credit card needed.",
          cta:     "Sign up free",
          url:     "/signup",
        },
      }),
    })

  } catch (err: any) {
    console.error("[sandbox]", err)
    return NextResponse.json({ error: "Sandbox execution failed" }, { status: 500 })
  }
}
