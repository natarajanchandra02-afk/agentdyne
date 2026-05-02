export const runtime = "edge"

/**
 * PATCH /api/agents/[id]/save
 *
 * Server-side validated save for the builder editor.
 * The builder-editor-client.tsx calls this instead of writing directly
 * to Supabase from the browser (which bypasses all validation).
 *
 * Validation enforced server-side (cannot be bypassed by a client):
 *   - price_per_call ≤ $0.25 (marketplace ceiling)
 *   - price_per_call ≥ $0.001 when non-zero (Stripe minimum)
 *   - subscription_price_monthly ≤ $999
 *   - free plan users cannot set paid pricing
 *   - system_prompt within length bounds
 *   - model_name must be in SUPPORTED_MODELS
 *   - temperature 0–2, max_tokens 100–32000
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient }              from "@/lib/supabase/server"
import { strictRateLimit }           from "@/lib/rate-limit"
import { SUPPORTED_MODELS, MAX_SYSTEM_PROMPT_LENGTH } from "@/lib/constants"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_PRICING = new Set(["free","per_call","subscription","freemium"])
const VALID_CATEGORIES = new Set([
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
])

function sanitize(s: unknown): string {
  return String(s ?? "").replace(/\x00/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim()
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const { id } = await params
    if (!UUID_RE.test(id))
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [{ data: existing }, { data: profile }] = await Promise.all([
      supabase.from("agents").select("seller_id").eq("id", id).single(),
      supabase.from("profiles").select("subscription_plan, is_banned").eq("id", user.id).single(),
    ])

    if (!existing)
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    if (existing.seller_id !== user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (profile?.is_banned)
      return NextResponse.json({ error: "Account suspended" }, { status: 403 })

    let body: Record<string, unknown>
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    // ── Validate all mutable fields ───────────────────────────────────────────

    const pricing = String(body.pricing_model ?? "free")
    const userPlan = String(profile?.subscription_plan ?? "free")

    if (!VALID_PRICING.has(pricing))
      return NextResponse.json({ error: "Invalid pricing model" }, { status: 400 })

    if (userPlan === "free" && pricing !== "free")
      return NextResponse.json({
        error: "Starter or Pro plan required to set paid pricing.",
        code:  "PLAN_RESTRICTION",
        upgrade: "/pricing",
      }, { status: 422 })

    const ppc = parseFloat(String(body.price_per_call ?? 0))
    const spm = parseFloat(String(body.subscription_price_monthly ?? 0))

    if (!isNaN(ppc)) {
      if (ppc < 0)
        return NextResponse.json({ error: "price_per_call must be non-negative" }, { status: 400 })
      if (ppc > 0.25)
        return NextResponse.json({ error: "price_per_call cannot exceed $0.25/call.", code: "PRICE_TOO_HIGH" }, { status: 422 })
      if (ppc > 0 && ppc < 0.001)
        return NextResponse.json({ error: "price_per_call must be at least $0.001.", code: "PRICE_TOO_LOW" }, { status: 422 })
    }

    if (!isNaN(spm) && spm > 999)
      return NextResponse.json({ error: "subscription_price_monthly cannot exceed $999.", code: "PRICE_TOO_HIGH" }, { status: 422 })

    const systemPrompt = body.system_prompt !== undefined ? sanitize(body.system_prompt) : undefined
    if (systemPrompt !== undefined) {
      if (systemPrompt.length > 0 && systemPrompt.length < 10)
        return NextResponse.json({ error: "system_prompt must be at least 10 characters" }, { status: 400 })
      if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH)
        return NextResponse.json({ error: `system_prompt cannot exceed ${MAX_SYSTEM_PROMPT_LENGTH} characters` }, { status: 400 })
    }

    const modelName = body.model_name !== undefined ? String(body.model_name) : undefined
    if (modelName && !(SUPPORTED_MODELS as readonly string[]).includes(modelName))
      return NextResponse.json({ error: "Invalid model_name" }, { status: 400 })

    const temperature = body.temperature !== undefined ? parseFloat(String(body.temperature)) : undefined
    const maxTokens   = body.max_tokens  !== undefined ? parseInt(String(body.max_tokens))   : undefined
    const timeoutSecs = body.timeout_seconds !== undefined ? parseInt(String(body.timeout_seconds)) : undefined

    if (temperature !== undefined && (isNaN(temperature) || temperature < 0 || temperature > 2))
      return NextResponse.json({ error: "temperature must be 0–2" }, { status: 400 })
    if (maxTokens !== undefined && (isNaN(maxTokens) || maxTokens < 100 || maxTokens > 32_000))
      return NextResponse.json({ error: "max_tokens must be 100–32000" }, { status: 400 })
    if (timeoutSecs !== undefined && (isNaN(timeoutSecs) || timeoutSecs < 5 || timeoutSecs > 300))
      return NextResponse.json({ error: "timeout_seconds must be 5–300" }, { status: 400 })

    const category = body.category !== undefined ? String(body.category) : undefined
    if (category && !VALID_CATEGORIES.has(category))
      return NextResponse.json({ error: "Invalid category" }, { status: 400 })

    const rawTags = Array.isArray(body.tags)
      ? body.tags
      : body.tags !== undefined ? String(body.tags).split(",") : undefined
    const tags = rawTags?.map((t: unknown) => sanitize(t)).filter(Boolean).slice(0, 30)

    // ── Build update payload ──────────────────────────────────────────────────

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

    const set = (k: string, v: unknown) => { if (v !== undefined) update[k] = v }

    set("name",                       body.name        !== undefined ? sanitize(body.name) : undefined)
    set("description",                body.description !== undefined ? sanitize(body.description) : undefined)
    set("long_description",           body.long_description !== undefined ? (sanitize(body.long_description) || null) : undefined)
    set("documentation",              body.documentation    !== undefined ? (sanitize(body.documentation)    || null) : undefined)
    set("system_prompt",              systemPrompt)
    set("category",                   category)
    set("tags",                       tags)
    set("is_public",                  typeof body.is_public === "boolean" ? body.is_public : undefined)
    set("pricing_model",              pricing)
    set("price_per_call",             !isNaN(ppc) ? ppc : undefined)
    set("subscription_price_monthly", !isNaN(spm) ? spm : undefined)
    set("free_calls_per_month",       body.free_calls_per_month !== undefined
                                        ? Math.max(0, parseInt(String(body.free_calls_per_month)) || 0)
                                        : undefined)
    set("model_name",                 modelName)
    set("temperature",                temperature)
    set("max_tokens",                 maxTokens)
    set("timeout_seconds",            timeoutSecs)

    if (body.mcp_server_ids !== undefined) {
      if (!Array.isArray(body.mcp_server_ids))
        return NextResponse.json({ error: "mcp_server_ids must be an array" }, { status: 400 })
      update.mcp_server_ids = (body.mcp_server_ids as unknown[]).map(String).slice(0, 50)
    }
    if (body.security_config !== undefined && typeof body.security_config === "object")
      update.security_config = body.security_config
    if (body.input_schema !== undefined && typeof body.input_schema === "object")
      update.input_schema = body.input_schema

    // Remove undefined keys
    for (const k of Object.keys(update)) {
      if (update[k] === undefined) delete update[k]
    }

    const { data: updated, error } = await supabase
      .from("agents")
      .update(update)
      .eq("id", id)
      .select("id, name, slug, status, updated_at, pricing_model, price_per_call, subscription_price_monthly")
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, agent: updated })

  } catch (err: any) {
    console.error("PATCH /api/agents/[id]/save:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
