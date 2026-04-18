/**
 * AgentDyne Environment Validation
 *
 * Validates all required environment variables at module load time.
 * Gives clear, actionable error messages instead of cryptic runtime failures.
 *
 * Usage:
 *   import { validateEnv } from "@/lib/env"
 *   validateEnv()   ← call once in layout.tsx or a shared server module
 *
 * Or import { env } to get a fully-typed, pre-validated env object:
 *   import { env } from "@/lib/env"
 *   console.log(env.SUPABASE_URL)
 */

export interface EnvConfig {
  // Supabase (required)
  NEXT_PUBLIC_SUPABASE_URL:      string
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY:     string

  // App
  NEXT_PUBLIC_APP_URL:           string
  NEXT_PUBLIC_APP_NAME:          string

  // AI providers (Anthropic required, others optional)
  ANTHROPIC_API_KEY:             string
  OPENAI_API_KEY?:               string   // Required for RAG embeddings
  GOOGLE_AI_API_KEY?:            string   // Required for Gemini agents
  VLLM_BASE_URL?:                string   // Required for self-hosted vLLM

  // Stripe (optional — platform works without billing in dev)
  STRIPE_SECRET_KEY?:            string
  STRIPE_WEBHOOK_SECRET?:        string
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string
  STRIPE_STARTER_PRICE_ID?:     string
  STRIPE_PRO_PRICE_ID?:         string

  // Internal
  INTERNAL_API_SECRET?:          string
}

interface EnvVar {
  key:      string
  required: boolean
  minLength?: number
  description: string
  docUrl?:    string
  validate?: (val: string) => string | null   // return error string or null
}

const ENV_VARS: EnvVar[] = [
  // ── Supabase ──────────────────────────────────────────────────────────────
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    required: true,
    minLength: 20,
    description: "Supabase project URL",
    docUrl: "https://app.supabase.com → Settings → API → Project URL",
    validate: (v) => v.includes("supabase.co") || v.includes("localhost") ? null
      : "Must be a valid Supabase URL (e.g. https://xxx.supabase.co)",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required: true,
    minLength: 100,
    description: "Supabase anonymous (public) key",
    docUrl: "https://app.supabase.com → Settings → API → anon public",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    required: true,
    minLength: 100,
    description: "Supabase service role key (server-only, never expose client-side)",
    docUrl: "https://app.supabase.com → Settings → API → service_role",
  },
  // ── App ───────────────────────────────────────────────────────────────────
  {
    key: "NEXT_PUBLIC_APP_URL",
    required: true,
    minLength: 8,
    description: "Public URL of your app (e.g. https://agentdyne.com)",
    validate: (v) => v.startsWith("http") ? null : "Must start with http:// or https://",
  },
  {
    key: "NEXT_PUBLIC_APP_NAME",
    required: false,
    description: "App display name (default: AgentDyne)",
  },
  // ── AI ────────────────────────────────────────────────────────────────────
  {
    key: "ANTHROPIC_API_KEY",
    required: true,
    minLength: 30,
    description: "Anthropic API key — required for all Claude agents",
    docUrl: "https://console.anthropic.com → API Keys",
    validate: (v) => v.startsWith("sk-ant-") ? null
      : "Anthropic API keys start with sk-ant-",
  },
  {
    key: "OPENAI_API_KEY",
    required: false,
    minLength: 30,
    description: "OpenAI API key — required for RAG embeddings and GPT agents",
    docUrl: "https://platform.openai.com/api-keys",
  },
  {
    key: "GOOGLE_AI_API_KEY",
    required: false,
    description: "Google AI (Gemini) API key — required for Gemini agents",
    docUrl: "https://makersuite.google.com/app/apikey",
  },
  {
    key: "VLLM_BASE_URL",
    required: false,
    description: "Base URL for self-hosted vLLM server (e.g. http://localhost:8000)",
  },
  // ── Stripe ────────────────────────────────────────────────────────────────
  {
    key: "STRIPE_SECRET_KEY",
    required: false,
    minLength: 20,
    description: "Stripe secret key — required for billing",
    docUrl: "https://dashboard.stripe.com → Developers → API keys",
    validate: (v) => v.startsWith("sk_") ? null : "Stripe secret keys start with sk_",
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    required: false,
    minLength: 20,
    description: "Stripe webhook signing secret — required for webhook verification",
    docUrl: "https://dashboard.stripe.com → Developers → Webhooks → signing secret",
    validate: (v) => v.startsWith("whsec_") ? null : "Stripe webhook secrets start with whsec_",
  },
  {
    key: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    required: false,
    description: "Stripe publishable key — required for client-side Stripe.js",
    validate: (v) => v.startsWith("pk_") ? null : "Stripe publishable keys start with pk_",
  },
  {
    key: "STRIPE_STARTER_PRICE_ID",
    required: false,
    description: "Stripe Price ID for the Starter plan",
    validate: (v) => v.startsWith("price_") ? null : "Stripe Price IDs start with price_",
  },
  {
    key: "STRIPE_PRO_PRICE_ID",
    required: false,
    description: "Stripe Price ID for the Pro plan",
    validate: (v) => v.startsWith("price_") ? null : "Stripe Price IDs start with price_",
  },
  // ── Internal ──────────────────────────────────────────────────────────────
  {
    key: "INTERNAL_API_SECRET",
    required: false,
    minLength: 32,
    description: "Secret for internal API-to-API calls (must be at least 32 chars)",
  },
]

export interface EnvValidationResult {
  valid:    boolean
  errors:   string[]
  warnings: string[]
}

/**
 * validateEnv — validate all environment variables.
 *
 * In production (NODE_ENV=production): required vars throw on failure.
 * In development: logs warnings but doesn't throw for optional missing vars.
 *
 * @param throwOnError  If true (default in production), throws on any required-var failure.
 */
export function validateEnv(throwOnError?: boolean): EnvValidationResult {
  const isProd = process.env.NODE_ENV === "production"
  const shouldThrow = throwOnError ?? isProd

  const errors:   string[] = []
  const warnings: string[] = []

  for (const spec of ENV_VARS) {
    const val = process.env[spec.key]

    // Missing check
    if (!val || val.trim().length === 0) {
      if (spec.required) {
        errors.push(
          `❌ ${spec.key} is required but not set.\n` +
          `   Purpose: ${spec.description}` +
          (spec.docUrl ? `\n   Where to get it: ${spec.docUrl}` : "")
        )
      } else {
        warnings.push(`⚠️  ${spec.key} is not set — ${spec.description}`)
      }
      continue
    }

    // Placeholder check — catches copy-paste mistakes
    if (
      val.includes("your-project") ||
      val.includes("your_key") ||
      val.includes("REPLACE_ME") ||
      val === "xxx"
    ) {
      errors.push(`❌ ${spec.key} appears to still be a placeholder value: "${val.slice(0, 40)}"`)
      continue
    }

    // Length check
    if (spec.minLength && val.trim().length < spec.minLength) {
      errors.push(
        `❌ ${spec.key} is too short (${val.trim().length} chars, min ${spec.minLength}).\n` +
        `   This usually means it was copied incorrectly.`
      )
      continue
    }

    // Custom validation
    if (spec.validate) {
      const err = spec.validate(val.trim())
      if (err) {
        errors.push(`❌ ${spec.key}: ${err}`)
      }
    }
  }

  // Special cross-field validation: RAG requires OpenAI
  const hasRAGField = !!process.env.OPENAI_API_KEY
  if (!hasRAGField && isProd) {
    warnings.push("⚠️  OPENAI_API_KEY is not set — RAG knowledge bases will not work")
  }

  // Stripe cross-field: if secret key set, webhook secret must also be set
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    warnings.push("⚠️  STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — webhooks will not verify")
  }

  const result: EnvValidationResult = { valid: errors.length === 0, errors, warnings }

  if (!result.valid && shouldThrow) {
    const msg = [
      "",
      "═══════════════════════════════════════════════════",
      "  AgentDyne — Environment Configuration Errors",
      "═══════════════════════════════════════════════════",
      ...errors,
      "",
      "Fix the above issues and restart the server.",
      "═══════════════════════════════════════════════════",
      "",
    ].join("\n")
    throw new Error(msg)
  }

  if (!isProd && errors.length > 0) {
    console.error("\n[AgentDyne env] Configuration errors:\n" + errors.join("\n"))
  }
  if (warnings.length > 0 && isProd) {
    console.warn("\n[AgentDyne env] Warnings:\n" + warnings.join("\n"))
  }

  return result
}

/**
 * getEnvStatus — lightweight check for the admin panel.
 * Returns which services are configured, without exposing values.
 */
export function getEnvStatus() {
  const has = (key: string) => !!(process.env[key]?.trim())
  return {
    supabase:     has("NEXT_PUBLIC_SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY"),
    anthropic:    has("ANTHROPIC_API_KEY"),
    openai:       has("OPENAI_API_KEY"),
    google:       has("GOOGLE_AI_API_KEY"),
    stripe:       has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET"),
    stripeConnect: has("STRIPE_SECRET_KEY"),
    vllm:         has("VLLM_BASE_URL"),
    rag:          has("OPENAI_API_KEY"),   // RAG requires OpenAI embeddings
    billing:      has("STRIPE_SECRET_KEY"),
  }
}
