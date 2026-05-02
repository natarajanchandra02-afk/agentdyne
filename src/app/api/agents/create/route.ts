export const runtime = 'edge'

/**
 * POST /api/agents/create
 *
 * FIX (April 2026): Switched DB insert from session-aware createClient()
 * to createAdminClient(). The session client applies RLS — if no INSERT
 * policy exists for the agents table (common on fresh deployments),
 * the insert fails silently with a permissions error, returning 500,
 * and the builder never navigates to the editor.
 *
 * Auth is still verified via the session client BEFORE the admin insert.
 * Ownership is enforced by setting seller_id = user.id server-side.
 * This is the correct pattern: verify auth with anon key, write with service key.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { strictRateLimit } from "@/lib/rate-limit"
import {
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_AGENT_DESCRIPTION_LENGTH,
  SUPPORTED_MODELS,
  MAX_AGENTS_PER_USER,
  PLAN_QUOTAS,
} from "@/lib/constants"

const VALID_CATEGORIES = new Set([
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
])
const VALID_PRICING = new Set(["free","per_call","subscription","freemium"])
const VALID_MODELS  = new Set(SUPPORTED_MODELS)

function sanitizeText(s: string): string {
  return s.replace(/\x00/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim()
}

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 50)
}

function generateSlug(name: string): string {
  const arr = new Uint8Array(4)
  crypto.getRandomValues(arr)
  const suffix = Array.from(arr, b => b.toString(36)).join("").slice(0, 6)
  return `${slugify(name)}-${suffix}`
}

export async function POST(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    // ── 1. Verify auth with SESSION client (respects RLS, reads cookie) ──────
    const authClient = await createClient()
    const { data: { user }, error: authErr } = await authClient.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // ── 2. Profile checks: ban, plan, and agent count limits ──────────────────
    const { data: userProfile } = await authClient
      .from("profiles")
      .select("is_banned, subscription_plan")
      .eq("id", user.id)
      .single()

    if (userProfile?.is_banned)
      return NextResponse.json({ error: "Account suspended. Contact support@agentdyne.com" }, { status: 403 })

    const userPlan = userProfile?.subscription_plan ?? "free"

    // Max agents per user guard (prevents spam)
    const { count: agentCount } = await authClient
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", user.id)

    const maxAgents = MAX_AGENTS_PER_USER ?? 50
    if ((agentCount ?? 0) >= maxAgents)
      return NextResponse.json(
        { error: `Maximum ${maxAgents} agents per account. Delete unused agents to create more.` },
        { status: 422 }
      )

    // ── 3. Parse body ─────────────────────────────────────────────────────────
    let body: Record<string, any>
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const {
      name, description, category,
      pricing_model, price_per_call, subscription_price_monthly,
      system_prompt, model_name, temperature, max_tokens,
    } = body

    // ── 3. Validate ───────────────────────────────────────────────────────────
    const errs: string[] = []
    const cleanName   = sanitizeText(String(name          || ""))
    const cleanDesc   = sanitizeText(String(description   || ""))
    const cleanPrompt = sanitizeText(String(system_prompt || ""))
    const cleanModel  = String(model_name || SUPPORTED_MODELS[0])

    if (cleanName.length   < 3  || cleanName.length   > MAX_AGENT_NAME_LENGTH)
      errs.push(`Name must be 3–${MAX_AGENT_NAME_LENGTH} characters`)
    if (cleanDesc.length   < 20 || cleanDesc.length   > MAX_AGENT_DESCRIPTION_LENGTH)
      errs.push(`Description must be 20–${MAX_AGENT_DESCRIPTION_LENGTH} characters`)
    if (!VALID_CATEGORIES.has(String(category)))
      errs.push("Invalid category")
    if (!VALID_PRICING.has(String(pricing_model)))
      errs.push("Invalid pricing model")
    if (cleanPrompt.length < 20 || cleanPrompt.length > MAX_SYSTEM_PROMPT_LENGTH)
      errs.push(`System prompt must be 20–${MAX_SYSTEM_PROMPT_LENGTH} characters`)
    if (!VALID_MODELS.has(cleanModel as any))
      errs.push("Invalid model selection")

    const temp   = parseFloat(String(temperature ?? 0.7))
    const tokens = parseInt(String(max_tokens    ?? 4096))
    if (isNaN(temp)   || temp < 0   || temp > 2)          errs.push("Temperature must be 0–2")
    if (isNaN(tokens) || tokens < 100 || tokens > 32_000) errs.push("Max tokens must be 100–32,000")

    if (errs.length > 0)
      return NextResponse.json({ error: errs[0], errors: errs }, { status: 400 })

    const pricingModelStr = String(pricing_model)

    // ── Server-side plan gate: free plan users cannot create paid agents ────────────
    if (userPlan === "free" && pricingModelStr !== "free") {
      return NextResponse.json(
        { error: "Starter or Pro plan required to create paid agents. Free plan agents must use the Free pricing model.", code: "PLAN_RESTRICTION", upgrade: "/pricing" },
        { status: 422 }
      )
    }

    const ppc = (pricingModelStr === "per_call" || pricingModelStr === "freemium")
      ? Math.max(0, parseFloat(String(price_per_call ?? 0)))
      : 0
    const spm = pricingModelStr === "subscription"
      ? Math.max(0, parseFloat(String(subscription_price_monthly ?? 0)))
      : 0

    // Price range validation: protect marketplace from $0.001 races and $99 scams
    if (ppc > 0.25)
      return NextResponse.json(
        { error: "Price per call cannot exceed $0.25. Maximum allowed is $0.25/call.", code: "PRICE_TOO_HIGH" },
        { status: 422 }
      )
    if (ppc > 0 && ppc < 0.001)
      return NextResponse.json(
        { error: "Price per call must be at least $0.001 to cover Stripe fees.", code: "PRICE_TOO_LOW" },
        { status: 422 }
      )
    if (spm > 999)
      return NextResponse.json(
        { error: "Subscription price cannot exceed $999/month.", code: "PRICE_TOO_HIGH" },
        { status: 422 }
      )

    // ── 4. Write with ADMIN client (bypasses RLS — auth already verified above) ─
    // This is the correct pattern. We've proven the user is authenticated.
    // We set seller_id = user.id server-side, so there's no ownership risk.
    const db = createAdminClient()

    const tryInsert = async (slug: string) =>
      db.from("agents").insert({
        seller_id:                  user.id,
        name:                       cleanName,
        slug,
        description:                cleanDesc,
        category:                   String(category),
        pricing_model:              String(pricing_model),
        price_per_call:             ppc,
        subscription_price_monthly: spm,
        system_prompt:              cleanPrompt,
        model_name:                 cleanModel,
        temperature:                temp,
        max_tokens:                 tokens,
        status:                     "draft",
        tags:                       [],
        capability_tags:            [],
        input_types:                ["text"],
        output_types:               ["text"],
        languages:                  ["en"],
        version:                    "1.0.0",
      }).select("id, name, slug, status").single()

    let { data: agent, error: insertErr } = await tryInsert(generateSlug(cleanName))

    // Rare slug collision — retry once with new random suffix
    if (insertErr?.code === "23505") {
      const retry = await tryInsert(generateSlug(cleanName))
      agent      = retry.data
      insertErr  = retry.error
    }

    if (insertErr || !agent) {
      console.error("POST /api/agents/create insert error:", insertErr)
      return NextResponse.json({
        error: "Failed to create agent. Please try again.",
        detail: process.env.NODE_ENV === "development" ? insertErr?.message : undefined,
      }, { status: 500 })
    }

    return NextResponse.json(agent, { status: 201 })

  } catch (err: any) {
    console.error("POST /api/agents/create:", err)
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 })
  }
}
