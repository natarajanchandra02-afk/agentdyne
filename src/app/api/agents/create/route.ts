export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { strictRateLimit } from "@/lib/rate-limit"
import { MAX_SYSTEM_PROMPT_LENGTH, MAX_AGENT_NAME_LENGTH, MAX_AGENT_DESCRIPTION_LENGTH, SUPPORTED_MODELS } from "@/lib/constants"

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

/**
 * POST /api/agents/create
 * Server-side agent creation with full validation + sanitisation.
 * The builder form posts here instead of inserting directly via Supabase client,
 * which means validation is enforced even if client-side Zod is bypassed.
 */
export async function POST(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    let body: Record<string, any>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const {
      name, description, category,
      pricing_model, price_per_call, subscription_price_monthly,
      system_prompt, model_name, temperature, max_tokens,
    } = body

    const errors: string[] = []

    const cleanName   = sanitizeText(String(name   || ""))
    const cleanDesc   = sanitizeText(String(description || ""))
    const cleanPrompt = sanitizeText(String(system_prompt || ""))
    const cleanModel  = String(model_name || SUPPORTED_MODELS[0])  // safe fallback to first supported model

    if (cleanName.length < 3 || cleanName.length > MAX_AGENT_NAME_LENGTH)
      errors.push(`Name must be 3–${MAX_AGENT_NAME_LENGTH} characters`)
    if (cleanDesc.length < 20 || cleanDesc.length > MAX_AGENT_DESCRIPTION_LENGTH)
      errors.push(`Description must be 20–${MAX_AGENT_DESCRIPTION_LENGTH} characters`)
    if (!VALID_CATEGORIES.has(String(category)))
      errors.push("Invalid category")
    if (!VALID_PRICING.has(String(pricing_model)))
      errors.push("Invalid pricing model")
    if (cleanPrompt.length < 20 || cleanPrompt.length > MAX_SYSTEM_PROMPT_LENGTH)
      errors.push(`System prompt must be 20–${MAX_SYSTEM_PROMPT_LENGTH} characters`)
    if (!VALID_MODELS.has(cleanModel as any))
      errors.push("Invalid model")

    const temp   = parseFloat(String(temperature ?? 0.7))
    const tokens = parseInt(String(max_tokens    ?? 4096))
    if (isNaN(temp)   || temp < 0   || temp > 2)         errors.push("Temperature must be 0–2")
    if (isNaN(tokens) || tokens < 100 || tokens > 32000) errors.push("Max tokens must be 100–32000")

    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 })
    }

    const ppc = pricing_model === "per_call" || pricing_model === "freemium"
      ? Math.max(0, parseFloat(String(price_per_call ?? 0))) : 0
    const spm = pricing_model === "subscription"
      ? Math.max(0, parseFloat(String(subscription_price_monthly ?? 0))) : 0

    const tryInsert = async (slug: string) =>
      supabase.from("agents").insert({
        seller_id:   user.id,
        name:        cleanName,
        slug,
        description: cleanDesc,
        category:    String(category),
        pricing_model: String(pricing_model),
        price_per_call:             ppc,
        subscription_price_monthly: spm,
        system_prompt:  cleanPrompt,
        model_name:     cleanModel,
        temperature:    temp,
        max_tokens:     tokens,
        status:         "draft",
        tags:           [],
        capability_tags: [],
        input_types:    ["text"],
        output_types:   ["text"],
        languages:      ["en"],
        version:        "1.0.0",
      }).select("id, name, slug, status").single()

    let { data: agent, error: insertErr } = await tryInsert(generateSlug(cleanName))

    // Rare slug collision — retry once
    if (insertErr?.code === "23505") {
      const retry = await tryInsert(generateSlug(cleanName))
      agent     = retry.data
      insertErr = retry.error
    }

    if (insertErr) {
      console.error("POST /api/agents/create:", insertErr)
      return NextResponse.json({ error: "Failed to create agent. Please try again." }, { status: 500 })
    }

    return NextResponse.json(agent, { status: 201 })

  } catch (err: any) {
    console.error("POST /api/agents/create:", err)
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 })
  }
}
