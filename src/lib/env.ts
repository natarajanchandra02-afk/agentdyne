/**
 * AgentDyne — Runtime environment validation
 *
 * Called from layout.tsx (server component) on first render.
 * Edge-runtime safe — pure string checks, no Node.js APIs.
 *
 * Design:
 *  - REQUIRED vars: missing these = broken platform → log error
 *  - OPTIONAL vars: missing these = feature degraded → log warn
 *  - Never throws — we log and return a status object so the UI can
 *    show a setup banner in development without crashing production.
 */

export interface EnvStatus {
  ok:       boolean
  missing:  string[]
  warnings: string[]
}

type EnvSpec = {
  key:      string
  required: boolean
  feature:  string
}

const ENV_SPECS: EnvSpec[] = [
  // Platform core — required
  { key: "NEXT_PUBLIC_SUPABASE_URL",      required: true,  feature: "Database" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true,  feature: "Database auth" },
  { key: "SUPABASE_SERVICE_ROLE_KEY",     required: true,  feature: "Server-side DB" },
  { key: "ANTHROPIC_API_KEY",             required: true,  feature: "AI execution (Claude)" },
  { key: "NEXT_PUBLIC_APP_URL",           required: true,  feature: "OAuth redirects / metadata" },
  // Commerce — required for paid features
  { key: "STRIPE_SECRET_KEY",             required: false, feature: "Stripe billing" },
  { key: "STRIPE_STARTER_PRICE_ID",       required: false, feature: "Starter plan upgrades" },
  { key: "STRIPE_PRO_PRICE_ID",           required: false, feature: "Pro plan upgrades" },
  { key: "STRIPE_WEBHOOK_SECRET",         required: false, feature: "Stripe webhooks" },
  // RAG — optional
  { key: "OPENAI_API_KEY",                required: false, feature: "RAG embeddings" },
  // Additional AI providers — optional
  { key: "GOOGLE_AI_API_KEY",             required: false, feature: "Gemini models" },
]

let _checked = false
let _status: EnvStatus | null = null

export function validateEnv(): EnvStatus {
  // Cache result — only check once per process lifetime
  if (_checked && _status) return _status
  _checked = true

  const missing:  string[] = []
  const warnings: string[] = []

  for (const spec of ENV_SPECS) {
    const val = (typeof process !== "undefined" ? process.env[spec.key] : undefined)
      ?? (typeof globalThis !== "undefined" ? (globalThis as any)[spec.key] : undefined)

    const present = typeof val === "string" && val.trim().length > 0

    if (!present) {
      if (spec.required) {
        missing.push(`${spec.key} (${spec.feature})`)
      } else {
        warnings.push(`${spec.key} not set — ${spec.feature} disabled`)
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      `[AgentDyne] Missing required environment variables:\n` +
      missing.map(m => `  ✗ ${m}`).join("\n")
    )
  }

  if (warnings.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn(
      `[AgentDyne] Optional environment variables not set (features degraded):\n` +
      warnings.map(w => `  ⚠ ${w}`).join("\n")
    )
  }

  _status = { ok: missing.length === 0, missing, warnings }
  return _status
}

/** Returns true if a specific env var is configured */
export function hasEnv(key: string): boolean {
  const val = typeof process !== "undefined" ? process.env[key] : undefined
  return typeof val === "string" && val.trim().length > 0
}

/** Checked env vars at module load — safe to use in edge/API routes */
export const ENV = {
  supabaseUrl:        process.env.NEXT_PUBLIC_SUPABASE_URL      ?? "",
  supabaseAnonKey:    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  serviceRoleKey:     process.env.SUPABASE_SERVICE_ROLE_KEY     ?? "",
  anthropicApiKey:    process.env.ANTHROPIC_API_KEY             ?? "",
  openaiApiKey:       process.env.OPENAI_API_KEY                ?? "",
  googleAiApiKey:     process.env.GOOGLE_AI_API_KEY             ?? "",
  stripeSecretKey:    process.env.STRIPE_SECRET_KEY             ?? "",
  stripeStarterPrice: process.env.STRIPE_STARTER_PRICE_ID       ?? "",
  stripeProPrice:     process.env.STRIPE_PRO_PRICE_ID           ?? "",
  stripeWebhookSecret:process.env.STRIPE_WEBHOOK_SECRET         ?? "",
  appUrl:             process.env.NEXT_PUBLIC_APP_URL           ?? "https://agentdyne.com",
  nodeEnv:            process.env.NODE_ENV                      ?? "production",
  hasRAG:             !!process.env.OPENAI_API_KEY,
  hasStripe:          !!process.env.STRIPE_SECRET_KEY,
  hasGemini:          !!process.env.GOOGLE_AI_API_KEY,
  isDev:              process.env.NODE_ENV === "development",
} as const
