/**
 * Environment variable validation
 * Called once at startup from layout.tsx
 * Never throws — logs warnings only so builds don't crash on missing vars
 */

interface EnvVar {
  key:      string
  required: boolean
  secret:   boolean   // true = never log the value
  hint:     string
}

const ENV_VARS: EnvVar[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL",   required: true,  secret: false, hint: "Supabase project URL — find at supabase.com/dashboard → Settings → API" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, secret: true, hint: "Supabase anon key — find at supabase.com/dashboard → Settings → API" },
  { key: "SUPABASE_SERVICE_ROLE_KEY",  required: true,  secret: true,  hint: "Supabase service role key — admin operations only, keep secret" },
  { key: "ANTHROPIC_API_KEY",          required: true,  secret: true,  hint: "Anthropic API key — console.anthropic.com" },
  { key: "OPENAI_API_KEY",             required: false, secret: true,  hint: "OpenAI API key — required for embeddings (RAG) and GPT models" },
  { key: "STRIPE_SECRET_KEY",          required: false, secret: true,  hint: "Stripe secret key — required for billing" },
  { key: "STRIPE_WEBHOOK_SECRET",      required: false, secret: true,  hint: "Stripe webhook signing secret — required to verify webhook events" },
  { key: "STRIPE_STARTER_PRICE_ID",    required: false, secret: false, hint: "Stripe price ID for Starter plan" },
  { key: "STRIPE_PRO_PRICE_ID",        required: false, secret: false, hint: "Stripe price ID for Pro plan" },
  { key: "NEXT_PUBLIC_APP_URL",        required: true,  secret: false, hint: "Full URL of the app, e.g. https://agentdyne.com" },
  { key: "GOOGLE_AI_API_KEY",          required: false, secret: true,  hint: "Google AI API key — required for Gemini models" },
]

let _validated = false

export function validateEnv(): void {
  // Only run once per process lifetime
  if (_validated) return
  _validated = true

  if (typeof window !== "undefined") return  // client-side: skip

  const missing:  string[] = []
  const optional: string[] = []

  for (const v of ENV_VARS) {
    const val = process.env[v.key]
    const isEmpty = !val || val.includes("your-") || val === "your-anon-key"

    if (isEmpty) {
      if (v.required) missing.push(v.key)
      else            optional.push(v.key)
    }
  }

  if (missing.length > 0) {
    console.error(
      `\n❌ [AgentDyne] Missing required environment variables:\n` +
      missing.map(k => {
        const v = ENV_VARS.find(e => e.key === k)!
        return `   ${k}\n   → ${v.hint}`
      }).join("\n") +
      `\n\nSet these in .env.local (development) or Cloudflare Pages dashboard (production).\n`
    )
  }

  if (optional.length > 0) {
    console.warn(
      `\n⚠️  [AgentDyne] Optional env vars not set (some features disabled):\n` +
      optional.map(k => `   ${k}`).join("\n") + "\n"
    )
  }

  if (missing.length === 0 && optional.length === 0) {
    console.log("✅ [AgentDyne] All environment variables configured")
  }
}

/** Runtime check — use in API routes to guard against missing vars */
export function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}. See /lib/env.ts for setup instructions.`)
  }
  return val
}

/** Check if a feature is available based on env var presence */
export function featureAvailable(key: string): boolean {
  const val = process.env[key]
  return !!val && !val.includes("your-")
}
