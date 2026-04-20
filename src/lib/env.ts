/**
 * @module env
 * @path   src/lib/env.ts
 *
 * Environment variable validation for AgentDyne.
 *
 * Validates required vs optional env vars at startup.
 * Called from src/app/layout.tsx on first render.
 *
 * Required (platform won't start without these):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   ANTHROPIC_API_KEY
 *
 * Strongly recommended (features degrade without these):
 *   RESEND_API_KEY          — transactional email
 *   OPENAI_API_KEY          — RAG embeddings, semantic search
 *   SUPABASE_SERVICE_ROLE_KEY — admin client (required for admin panel)
 *
 * Optional (enables additional providers):
 *   GOOGLE_AI_API_KEY
 *   VLLM_BASE_URL
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   ADMIN_ALERT_EMAIL
 *   NEXT_PUBLIC_APP_URL
 */

export interface EnvValidationResult {
  ok:       boolean
  missing:  string[]   // required vars that are absent
  warnings: string[]   // recommended vars that are absent
  summary:  string
}

interface EnvSpec {
  key:         string
  required:    boolean
  description: string
  example?:    string
}

const ENV_SPECS: EnvSpec[] = [
  // ── Required ──────────────────────────────────────────────────────────────
  {
    key:         "NEXT_PUBLIC_SUPABASE_URL",
    required:    true,
    description: "Supabase project URL",
    example:     "https://xxxx.supabase.co",
  },
  {
    key:         "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required:    true,
    description: "Supabase anon key (public)",
  },
  {
    key:         "ANTHROPIC_API_KEY",
    required:    true,
    description: "Anthropic API key (required for Claude agents)",
    example:     "sk-ant-...",
  },
  {
    key:         "SUPABASE_SERVICE_ROLE_KEY",
    required:    true,
    description: "Supabase service role key (required for admin panel and server-side operations)",
  },
  // ── Strongly recommended ─────────────────────────────────────────────────
  {
    key:         "RESEND_API_KEY",
    required:    false,
    description: "Resend API key — required for transactional email (agent approvals, welcome emails, alerts)",
    example:     "re_...",
  },
  {
    key:         "OPENAI_API_KEY",
    required:    false,
    description: "OpenAI API key — required for RAG embeddings (semantic search) and GPT agents",
    example:     "sk-...",
  },
  // ── Optional ──────────────────────────────────────────────────────────────
  {
    key:         "GOOGLE_AI_API_KEY",
    required:    false,
    description: "Google AI API key — enables Gemini model agents",
  },
  {
    key:         "STRIPE_SECRET_KEY",
    required:    false,
    description: "Stripe secret key — required for billing and payouts",
    example:     "sk_live_...",
  },
  {
    key:         "STRIPE_WEBHOOK_SECRET",
    required:    false,
    description: "Stripe webhook signing secret",
    example:     "whsec_...",
  },
  {
    key:         "NEXT_PUBLIC_APP_URL",
    required:    false,
    description: "Production URL (used in emails and HITL approval links)",
    example:     "https://agentdyne.com",
  },
  {
    key:         "ADMIN_ALERT_EMAIL",
    required:    false,
    description: "Email address for admin alerts",
    example:     "support@inteleion.com",
  },
]

/**
 * validateEnv
 *
 * Call once at startup. Returns a result object — does not throw.
 * In development, logs warnings. In production, missing required vars
 * are surfaced as a critical error in logs.
 *
 * @example
 * // In src/app/layout.tsx:
 * import { validateEnv } from "@/lib/env"
 * validateEnv()
 */
export function validateEnv(): EnvValidationResult {
  const missing:  string[] = []
  const warnings: string[] = []

  for (const spec of ENV_SPECS) {
    const val = process.env[spec.key]
    const isSet = val && val.trim().length > 0

    if (!isSet) {
      if (spec.required) {
        missing.push(spec.key)
      } else {
        warnings.push(spec.key)
      }
    }
  }

  const ok = missing.length === 0

  if (!ok) {
    const lines = missing.map(k => {
      const spec = ENV_SPECS.find(s => s.key === k)!
      return `  ❌ ${k} — ${spec.description}${spec.example ? ` (e.g. ${spec.example})` : ""}`
    })
    console.error(`[AgentDyne] CRITICAL: Missing required environment variables:\n${lines.join("\n")}`)
    console.error("[AgentDyne] Set these in Cloudflare Pages → Settings → Environment Variables")
  }

  if (warnings.length > 0) {
    const lines = warnings.map(k => {
      const spec = ENV_SPECS.find(s => s.key === k)!
      return `  ⚠️  ${k} — ${spec.description}`
    })
    console.warn(`[AgentDyne] Optional env vars not set (some features disabled):\n${lines.join("\n")}`)
  }

  const featureStatus = [
    `Email:         ${process.env.RESEND_API_KEY            ? "✓" : "✗ (set RESEND_API_KEY)"}`,
    `RAG/Embeddings:${process.env.OPENAI_API_KEY            ? "✓" : "✗ (set OPENAI_API_KEY)"}`,
    `Billing:       ${process.env.STRIPE_SECRET_KEY         ? "✓" : "✗ (set STRIPE_SECRET_KEY)"}`,
    `Admin panel:   ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "✓" : "✗ (set SUPABASE_SERVICE_ROLE_KEY)"}`,
    `Gemini agents: ${process.env.GOOGLE_AI_API_KEY         ? "✓" : "○ (optional)"}`,
  ].join("\n  ")

  const summary = ok
    ? `[AgentDyne] Environment OK. Feature status:\n  ${featureStatus}`
    : `[AgentDyne] CRITICAL: ${missing.length} required env var(s) missing`

  if (ok) console.log(summary)

  return { ok, missing, warnings, summary }
}

/**
 * getRequiredEnv
 * Throws a descriptive error if a required env var is missing.
 * Use in API routes that need a specific var.
 *
 * @example
 * const apiKey = getRequiredEnv("ANTHROPIC_API_KEY")
 */
export function getRequiredEnv(key: string): string {
  const val = process.env[key]
  if (!val || !val.trim()) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Set it in Cloudflare Pages → Settings → Environment Variables.`
    )
  }
  return val
}

/**
 * isFeatureEnabled — check if an optional feature is available
 */
export function isFeatureEnabled(feature: "email" | "rag" | "billing" | "gemini" | "vllm"): boolean {
  const MAP: Record<string, string[]> = {
    email:   ["RESEND_API_KEY"],
    rag:     ["OPENAI_API_KEY"],
    billing: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    gemini:  ["GOOGLE_AI_API_KEY"],
    vllm:    ["VLLM_BASE_URL"],
  }
  return (MAP[feature] ?? []).every(k => !!process.env[k]?.trim())
}
