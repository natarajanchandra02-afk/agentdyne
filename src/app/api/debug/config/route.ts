export const runtime = "edge"

/**
 * GET /api/debug/config
 *
 * SAFE diagnostic endpoint — never exposes secret values, only
 * reports SET / MISSING / PLACEHOLDER for each environment variable.
 *
 * Open this in your browser to instantly see what's misconfigured.
 * Automatically disabled in production if DISABLE_DEBUG_ENDPOINTS=true.
 *
 * Usage:
 *   http://localhost:3000/api/debug/config     (local)
 *   https://your-site.com/api/debug/config     (staging)
 */

import { NextRequest, NextResponse } from "next/server"

type Status = "✅ SET" | "❌ MISSING" | "⚠️  PLACEHOLDER" | "○ OPTIONAL (not set)"

interface VarReport {
  key:       string
  status:    Status
  hint:      string
  required:  boolean
  docs?:     string
}

function check(
  key: string,
  required: boolean,
  hint: string,
  placeholders: string[] = [],
  docs?: string,
): VarReport {
  const val = process.env[key] ?? ""

  if (!val || val.trim() === "") {
    return { key, status: required ? "❌ MISSING" : "○ OPTIONAL (not set)", hint, required, docs }
  }

  if (
    placeholders.some(p => val.includes(p)) ||
    val.endsWith("...") ||
    val === "your-anon-key" ||
    val === "your-service-role-key" ||
    (val.startsWith("https://") && val.endsWith(".supabase.co") && val.includes("your-project"))
  ) {
    return { key, status: "⚠️  PLACEHOLDER", hint, required, docs }
  }

  return { key, status: "✅ SET", hint, required, docs }
}

export async function GET(req: NextRequest) {
  // ✅ Bug fix: flipped from opt-out to opt-in for production safety.
  // Previously this endpoint stayed LIVE in production unless someone
  // explicitly set DISABLE_DEBUG_ENDPOINTS=true — an easy thing to forget
  // when deploying, and .env.example even listed it as commented-out under
  // "optional overrides." That meant anyone who found this URL on the live
  // domain could see exactly which of your API keys, Stripe keys, and
  // Supabase config were SET vs MISSING — real reconnaissance value handed
  // to an attacker for free, even with no secret values actually exposed.
  //
  // New default: in production, this endpoint is OFF unless an operator
  // explicitly opts back in with ALLOW_DEBUG_ENDPOINTS_IN_PROD=true.
  const isProd            = process.env.NODE_ENV === "production"
  const explicitlyAllowed = process.env.ALLOW_DEBUG_ENDPOINTS_IN_PROD === "true"

  if (isProd && !explicitlyAllowed) {
    return NextResponse.json(
      { error: "Debug endpoints are disabled in production. Set ALLOW_DEBUG_ENDPOINTS_IN_PROD=true to enable temporarily." },
      { status: 403 }
    )
  }

  // Only show full details to localhost or known internal IPs
  const forwarded = req.headers.get("x-forwarded-for") ?? ""
  const ip        = forwarded.split(",")[0]?.trim() ?? ""
  const isLocal   = ip === "" || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.")

  const vars: VarReport[] = [
    // ── CRITICAL — login will not work without these ──────────────────────
    check(
      "NEXT_PUBLIC_SUPABASE_URL", true,
      "Your Supabase project URL. Must start with https:// and end with .supabase.co",
      ["your-project", "your_project"],
      "https://supabase.com/dashboard → project → Settings → API → Project URL"
    ),
    check(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY", true,
      "Your Supabase public anon key. Starts with eyJh... (JWT). This is safe to expose in the browser.",
      ["eyJh...", "your-anon-key"],
      "https://supabase.com/dashboard → project → Settings → API → Project API keys → anon public"
    ),
    check(
      "SUPABASE_SERVICE_ROLE_KEY", true,
      "Server-only Supabase key. Never expose to browser. Needed for admin operations and server-side DB access.",
      ["eyJh...", "your-service-role-key"],
      "https://supabase.com/dashboard → project → Settings → API → Project API keys → service_role"
    ),
    check(
      "ANTHROPIC_API_KEY", true,
      "Claude API key. Required for all AI agent executions.",
      ["sk-ant-..."],
      "https://console.anthropic.com → API Keys"
    ),

    // ── IMPORTANT — some features degrade without these ───────────────────
    check(
      "NEXT_PUBLIC_APP_URL", false,
      "Your production URL (e.g. https://agentdyne.com). Used in emails and embed scripts.",
      ["https://agentdyne.com"]
    ),
    check(
      "OPENAI_API_KEY", false,
      "OpenAI key. Required for semantic memory search (embeddings) and GPT agents. Falls back to keyword search without it.",
      ["sk-..."],
      "https://platform.openai.com → API Keys"
    ),
    check(
      "GOOGLE_AI_API_KEY", false,
      "Google AI key. Enables Gemini 2.5 Flash/Pro agents (cheapest tier).",
      ["AIza..."]
    ),
    check(
      "STRIPE_SECRET_KEY", false,
      "Stripe secret key. Required for billing, subscriptions, and seller payouts.",
      ["sk_live_...", "sk_test_..."]
    ),
    check(
      "STRIPE_WEBHOOK_SECRET", false,
      "Stripe webhook signing secret. Required to verify Stripe event signatures.",
      ["whsec_..."]
    ),
    check(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", false,
      "Stripe publishable key. Required for the billing UI (Stripe.js).",
      ["pk_live_...", "pk_test_..."]
    ),
    check(
      "RESEND_API_KEY", false,
      "Resend API key. Required for transactional email (agent approvals, welcome emails).",
      ["re_..."]
    ),
    check(
      "SLACK_WEBHOOK_URL", false,
      "Slack incoming webhook. Fires on 5xx errors, abuse events, billing failures.",
      ["https://hooks.slack.com/services/xxx"]
    ),
  ]

  const missing  = vars.filter(v => v.status === "❌ MISSING"    && v.required)
  const placehld = vars.filter(v => v.status === "⚠️  PLACEHOLDER" && v.required)
  const ok       = vars.filter(v => v.status === "✅ SET")

  const loginReady =
    vars.find(v => v.key === "NEXT_PUBLIC_SUPABASE_URL")?.status    === "✅ SET" &&
    vars.find(v => v.key === "NEXT_PUBLIC_SUPABASE_ANON_KEY")?.status === "✅ SET"

  const agentsReady =
    loginReady &&
    vars.find(v => v.key === "SUPABASE_SERVICE_ROLE_KEY")?.status === "✅ SET" &&
    vars.find(v => v.key === "ANTHROPIC_API_KEY")?.status          === "✅ SET"

  const summary = {
    login_works:   loginReady,
    agents_work:   agentsReady,
    billing_works: vars.find(v => v.key === "STRIPE_SECRET_KEY")?.status === "✅ SET",
    email_works:   vars.find(v => v.key === "RESEND_API_KEY")?.status    === "✅ SET",
    gemini_works:  vars.find(v => v.key === "GOOGLE_AI_API_KEY")?.status  === "✅ SET",
    rag_works:     vars.find(v => v.key === "OPENAI_API_KEY")?.status     === "✅ SET",
    set_count:     ok.length,
    missing_required: missing.length + placehld.length,
  }

  const cloudflareNote = {
    title: "Cloudflare Pages deployment guide",
    steps: [
      "1. Go to Cloudflare Dashboard → Pages → your project → Settings → Environment Variables",
      "2. Click 'Add variable' for EACH env var",
      "3. NEXT_PUBLIC_* vars MUST be added as 'Production' variables (not build-only secrets)",
      "4. After adding, trigger a new deployment (push a commit or click 'Retry deployment')",
      "5. NEVER add SUPABASE_SERVICE_ROLE_KEY as a NEXT_PUBLIC_ variable — it's server-only",
    ],
    common_mistakes: [
      "✗ Setting SUPABASE_SERVICE_ROLE_KEY but forgetting NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "✗ Adding vars as 'Preview' scope only (must include 'Production')",
      "✗ Not redeploying after adding vars (changes only take effect on next deployment)",
      "✗ Using wrangler secrets instead of Pages environment variables for NEXT_PUBLIC_ vars",
    ],
  }

  const html = !isLocal ? null : `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>AgentDyne Config Diagnostic</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
    .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 28px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 28px; }
    .card { border-radius: 12px; border: 1px solid #e5e7eb; padding: 12px 16px; }
    .card.ok { border-color: #bbf7d0; background: #f0fdf4; }
    .card.err { border-color: #fecaca; background: #fef2f2; }
    .card label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; font-weight: 700; }
    .card .val { font-size: 22px; font-weight: 900; margin-top: 2px; }
    .card.ok .val { color: #16a34a; }
    .card.err .val { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #e5e7eb; font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: 0.05em; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .st { font-size: 12px; font-weight: 700; }
    .hint { color: #6b7280; font-size: 11px; margin-top: 2px; }
    .docs { font-size: 11px; }
    .docs a { color: #6366f1; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
    h2 { font-size: 16px; font-weight: 700; margin: 28px 0 12px; border-top: 1px solid #e5e7eb; padding-top: 20px; }
    ul { font-size: 13px; color: #374151; line-height: 1.8; }
  </style>
</head>
<body>
  <h1>🔧 AgentDyne Config Diagnostic</h1>
  <p class="subtitle">Safe report — no secret values are shown, only SET/MISSING/PLACEHOLDER status</p>

  <div class="summary">
    <div class="card ${summary.login_works ? "ok" : "err"}">
      <label>Login</label>
      <div class="val">${summary.login_works ? "✓ Ready" : "✗ Broken"}</div>
    </div>
    <div class="card ${summary.agents_work ? "ok" : "err"}">
      <label>Agents</label>
      <div class="val">${summary.agents_work ? "✓ Ready" : "✗ Broken"}</div>
    </div>
    <div class="card ${summary.billing_works ? "ok" : "err"}">
      <label>Billing</label>
      <div class="val">${summary.billing_works ? "✓ Ready" : "○ Skipped"}</div>
    </div>
    <div class="card ${summary.rag_works ? "ok" : "err"}">
      <label>Semantic Memory</label>
      <div class="val">${summary.rag_works ? "✓ Ready" : "○ Fallback"}</div>
    </div>
    <div class="card ${summary.missing_required === 0 ? "ok" : "err"}">
      <label>Issues</label>
      <div class="val">${summary.missing_required === 0 ? "0" : summary.missing_required}</div>
    </div>
  </div>

  <table>
    <thead><tr><th>Variable</th><th>Status</th><th>Description</th></tr></thead>
    <tbody>
      ${vars.map(v => `
        <tr>
          <td><code>${v.key}</code></td>
          <td class="st">${v.status}</td>
          <td>
            <div class="hint">${v.hint}</div>
            ${v.docs ? `<div class="docs" style="margin-top:4px"><a href="${v.docs}" target="_blank">Documentation ↗</a></div>` : ""}
          </td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <h2>📋 Cloudflare Pages deployment</h2>
  <ul>
    ${cloudflareNote.steps.map(s => `<li>${s}</li>`).join("")}
  </ul>
  <h2>⚠️  Common mistakes</h2>
  <ul>
    ${cloudflareNote.common_mistakes.map(s => `<li>${s}</li>`).join("")}
  </ul>
</body>
</html>`

  if (html) {
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    })
  }

  return NextResponse.json({
    summary,
    variables: vars.map(v => ({ key: v.key, status: v.status, required: v.required })),
    cloudflare: cloudflareNote,
    note: "Full HTML report available at localhost:3000/api/debug/config",
  }, { headers: { "Cache-Control": "no-store" } })
}
