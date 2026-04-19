/**
 * AgentDyne — Environment Variable Validation
 *
 * Called once at process startup from layout.tsx (server-side only).
 * Never throws — logs warnings so builds don't crash on missing vars,
 * but logs clearly so developers know what to fix.
 *
 * Usage in layout.tsx:
 *   import { validateEnv } from "@/lib/env"
 *   validateEnv()   // call at module scope — runs once per process
 *
 * Usage in API routes:
 *   import { requireEnv, featureAvailable } from "@/lib/env"
 *   const key = requireEnv("OPENAI_API_KEY")        // throws if missing
 *   const ok  = featureAvailable("OPENAI_API_KEY")  // boolean check
 */

interface EnvSpec {
  key:      string
  required: boolean
  secret:   boolean   // true = never log value
  feature:  string    // what breaks without it
}

const ENV_SPECS: EnvSpec[] = [
  // ── Core (required) ───────────────────────────────────────────────────────
  {
    key:      "NEXT_PUBLIC_SUPABASE_URL",
    required: true,
    secret:   false,
    feature:  "Database (all features broken without this)",
  },
  {
    key:      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required: true,
    secret:   true,
    feature:  "Database auth (all features broken without this)",
  },
  {
    key:      "SUPABASE_SERVICE_ROLE_KEY",
    required: true,
    secret:   true,
    feature:  "Admin operations + Stripe webhooks",
  },
  {
    key:      "ANTHROPIC_API_KEY",
    required: true,
    secret:   true,
    feature:  "Claude agent execution (core feature)",
  },
  {
    key:      "NEXT_PUBLIC_APP_URL",
    required: true,
    secret:   false,
    feature:  "Stripe checkout redirect URLs + email links",
  },
  // ── Optional — disable features gracefully ─────────────────────────────────
  {
    key:      "OPENAI_API_KEY",
    required: false,
    secret:   true,
    feature:  "RAG embeddings + GPT models (RAG disabled without this)",
  },
  {
    key:      "STRIPE_SECRET_KEY",
    required: false,
    secret:   true,
    feature:  "Billing (subscriptions + credits disabled without this)",
  },
  {
    key:      "STRIPE_WEBHOOK_SECRET",
    required: false,
    secret:   true,
    feature:  "Stripe webhook verification (billing events ignored without this)",
  },
  {
    key:      "STRIPE_STARTER_PRICE_ID",
    required: false,
    secret:   false,
    feature:  "Starter plan checkout",
  },
  {
    key:      "STRIPE_PRO_PRICE_ID",
    required: false,
    secret:   false,
    feature:  "Pro plan checkout",
  },
  {
    key:      "GOOGLE_AI_API_KEY",
    required: false,
    secret:   true,
    feature:  "Gemini model routing",
  },
]

let _validated = false

/** Run once at startup from layout.tsx */
export function validateEnv(): void {
  if (_validated) return
  _validated = true

  // Client-side: skip entirely (env vars are either not set or NEXT_PUBLIC_*)
  if (typeof window !== "undefined") return

  const missing:  EnvSpec[] = []
  const optional: EnvSpec[] = []

  for (const spec of ENV_SPECS) {
    const val = process.env[spec.key]
    const empty = !val || val.trim().length === 0 || val.includes("your-") || val === "placeholder"

    if (empty) {
      if (spec.required) missing.push(spec)
      else               optional.push(spec)
    }
  }

  if (missing.length > 0) {
    const lines = missing.map(s => `   ❌  ${s.key}\n       → Feature broken: ${s.feature}`)
    console.error(
      `\n═══════════════════════════════════════════════════════\n` +
      `  AgentDyne — MISSING REQUIRED ENVIRONMENT VARIABLES\n` +
      `═══════════════════════════════════════════════════════\n` +
      lines.join("\n") +
      `\n\nSet these in:\n` +
      `  • .env.local (local development)\n` +
      `  • Cloudflare Pages → Settings → Environment Variables (production)\n` +
      `  • .env.production.local (local production preview)\n` +
      `═══════════════════════════════════════════════════════\n`
    )
  }

  if (optional.length > 0) {
    const lines = optional.map(s => `   ⚠   ${s.key}  →  ${s.feature}`)
    console.warn(
      `\n── AgentDyne: Optional env vars not configured ──────\n` +
      lines.join("\n") + "\n"
    )
  }

  if (missing.length === 0 && optional.length === 0) {
    console.log("✅  AgentDyne: All environment variables configured.")
  }
}

/**
 * requireEnv — throw if a required env var is missing.
 * Use in API route handlers that cannot function without a specific var.
 *
 * @example
 *   const apiKey = requireEnv("OPENAI_API_KEY")
 */
export function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val || val.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Add it to .env.local or Cloudflare Pages environment settings.`
    )
  }
  return val
}

/**
 * featureAvailable — check whether an optional feature is configured.
 * Use to conditionally enable features in the UI or API.
 *
 * @example
 *   if (featureAvailable("OPENAI_API_KEY")) {
 *     // RAG is available
 *   }
 */
export function featureAvailable(key: string): boolean {
  const val = process.env[key]
  return !!val && val.trim().length > 0 && !val.includes("your-")
}

/**
 * getOptionalEnv — return env var or null (never throws).
 * Use when a missing var should degrade gracefully, not error.
 */
export function getOptionalEnv(key: string): string | null {
  const val = process.env[key]
  return val && val.trim().length > 0 ? val : null
}
