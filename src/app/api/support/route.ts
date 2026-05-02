export const runtime = "edge"

/**
 * POST /api/support
 *
 * AgentDyne Platform Support Agent
 * Handles: billing questions, execution errors, builder help, marketplace,
 *          account issues, API/SDK guidance, pipeline debugging.
 *
 * Auth: session or API key.
 * Rate: 30 req/min per user.
 * This is the internal harness powering the Support widget.
 */

import { NextRequest, NextResponse }  from "next/server"
import { createClient }               from "@/lib/supabase/server"
import { apiRateLimit }               from "@/lib/rate-limit"
import Anthropic                      from "@anthropic-ai/sdk"

// ─── Support agent system prompt ─────────────────────────────────────────────

const SUPPORT_SYSTEM_PROMPT = `
You are AgentDyne Support — the official AI assistant for the AgentDyne agent marketplace platform.

## Who you help
Users, sellers (builders), and API developers using AgentDyne. Never reveal internal system details, pricing margins, infrastructure configs, or other users' data.

## Platform knowledge (April 2026)

### Pricing & Plans
- **Free**: 50 lifetime executions total. Only free agents. No pipelines, no publishing, no API access. No credit card required.
- **Starter** ($19/mo): 500 executions/month, $10 compute cap, pipelines (up to 5 steps), API access, marketplace publishing enabled.
- **Pro** ($79/mo): 5,000 executions/month, $50 compute cap, full pipelines, priority execution, webhooks, advanced analytics.
- **Enterprise**: Custom pricing, unlimited executions, dedicated infra. Contact sales.
- Yearly billing saves 20%.
- 14-day free trial for Starter and Pro (no card required).

### Execution limits & compute caps
- Compute cap = hard USD monthly spend limit. When reached, executions return 429 with code COMPUTE_CAP_EXCEEDED.
- Free plan cap: $5 lifetime safety net. Starter: $10/month. Pro: $50/month.
- Concurrency: Free=1, Starter=3, Pro=10 simultaneous executions.
- Email must be verified before any executions are allowed.

### Common error codes
- EMAIL_NOT_VERIFIED → verify email via the link sent at signup (check spam)
- QUOTA_EXCEEDED → monthly execution limit reached; upgrade or wait for next cycle
- LIFETIME_QUOTA_EXCEEDED → free plan 50-execution limit hit; must upgrade
- COMPUTE_CAP_EXCEEDED → USD spend limit reached; upgrade or wait for billing cycle
- CONCURRENCY_LIMIT → too many simultaneous runs; wait for current ones to finish
- PLAN_RESTRICTION → feature not available on your plan
- SUBSCRIPTION_REQUIRED → agent requires an active subscription
- CONTENT_POLICY → input blocked by safety guardrails
- RATE_LIMIT_EXCEEDED → too many requests; slow down or upgrade

### Marketplace & publishing
- Free users can create and test agents privately (draft status).
- Publishing to marketplace requires Starter or Pro plan.
- All submissions go through an automated evaluation harness: 5 user tests + 5 hidden adversarial tests.
- Score < 70/100 = instant reject with feedback. 70–85 = human review. > 85 = fast-track.
- After publishing, agents can be auto-disabled if success rate drops below 60% or rating below 3.5 over 10+ executions.

### Builder & agent creation
- Builder is at /builder → click "New Agent".
- System prompt max: 32,000 chars. Description max: 300 chars.
- Supported models: Claude Sonnet 4.6 (recommended), Claude Haiku 4.5 (fastest/cheapest), Claude Opus 4.6 (most powerful), GPT-4o, GPT-4o Mini, Gemini 1.5 Pro.
- RAG (knowledge base): add text chunks or URLs in the Behavior tab. Embedded and retrieved at runtime.
- MCP tools: connect integrations in the Behavior tab (Gmail, Slack, GitHub, Notion, etc.).
- Security tab: configure guardrails per-agent (block PII, harmful content, etc.).
- Pricing tab: set your agent's pricing model (free, per-call, subscription, freemium).

### Pipelines
- Available on Starter+ plans.
- DAG-based: nodes connected with edges. Cycle detection runs at save.
- Max steps: Starter=5, Pro=unlimited.
- Free plan: pipelines disabled.

### API access
- Available on Starter+. API keys generated at /api-keys.
- Auth: Bearer token or x-api-key header.
- Execute: POST /api/agents/{id}/execute with JSON body { input: "...", idempotencyKey: "..." }
- Idempotency: always send a unique idempotency key to avoid double billing.
- Rate limits: 100 req/min per IP (general); 30 req/min per user (execution).

### Billing & payments
- Payments via Stripe. Invoices emailed after each charge.
- Seller payouts: 80% of revenue, processed monthly via Stripe Connect.
- To upgrade/downgrade: go to /billing.
- Refunds: contact support within 7 days of charge.

### Account & security
- Change password at /settings → Security tab.
- Email change requires re-verification.
- 2FA coming soon.
- If banned: contact support@agentdyne.com with your account email.

## How to respond
- Be concise, friendly, and direct. No corporate fluff.
- Lead with the answer, then explain if needed.
- For billing disputes or account bans, always direct to support@agentdyne.com.
- For technical issues, ask for: the error code, the agentId, and the executionId (if applicable).
- Never make up plan limits, prices, or features. Stick to the facts above.
- If you don't know, say so clearly and offer to escalate to the human team.
- Format responses in clear sections when more than 2 points. Use short paragraphs.

## What you cannot do
- Access other users' data, execution logs, or agent configs.
- Process refunds, change billing directly — always direct to /billing or support@agentdyne.com.
- Share internal platform costs, margins, or infrastructure details.
`.trim()

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    // Guard: fail fast with a clean 503 if API key is missing
    // (happens on fresh deploys before env vars are set, or in CI)
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Support agent temporarily unavailable. Please email support@agentdyne.com" },
        { status: 503 }
      )
    }

    // Create client per-request — NOT at module level.
    // Edge Runtime (Cloudflare Workers) resolves process.env at request time,
    // not at module initialization. Creating the client at module level can
    // cause "API key missing" errors even when the env var is set correctly.
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // ── Parse body ───────────────────────────────────────────────────────────
    let body: { message?: string; history?: { role: "user" | "assistant"; content: string }[] }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { message, history = [] } = body

    if (!message || typeof message !== "string" || message.trim().length === 0)
      return NextResponse.json({ error: "message is required" }, { status: 400 })

    if (message.length > 4000)
      return NextResponse.json({ error: "Message too long (max 4000 chars)" }, { status: 413 })

    // ── Build context from user profile (if authed) ──────────────────────────
    let userContext = ""
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_plan, email_verified, executions_used_this_month, monthly_spent_usd, free_executions_remaining")
        .eq("id", user.id)
        .single()

      if (profile) {
        userContext = [
          `[Authenticated user context — use to personalise answers]`,
          `Plan: ${profile.subscription_plan}`,
          `Email verified: ${profile.email_verified}`,
          `Executions this month: ${profile.executions_used_this_month ?? 0}`,
          `Monthly spend: $${(profile.monthly_spent_usd ?? 0).toFixed(4)}`,
          profile.subscription_plan === "free"
            ? `Free executions remaining: ${profile.free_executions_remaining ?? 50}`
            : "",
        ].filter(Boolean).join("\n")
      }
    }

    // ── Build messages ────────────────────────────────────────────────────────
    // Keep last 10 turns of history to stay within context window
    const trimmedHistory = history.slice(-10).map(m => ({
      role:    m.role as "user" | "assistant",
      content: m.content.slice(0, 2000),  // cap each turn
    }))

    const systemPrompt = userContext
      ? `${SUPPORT_SYSTEM_PROMPT}\n\n${userContext}`
      : SUPPORT_SYSTEM_PROMPT

    const response = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",  // fast + cheap for support
      max_tokens: 800,
      system:     systemPrompt,
      messages:   [
        ...trimmedHistory,
        { role: "user", content: message.trim() },
      ],
    })

    const reply = response.content[0]?.type === "text" ? response.content[0].text : ""

    return NextResponse.json({
      reply,
      tokens: {
        input:  response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    })

  } catch (err: any) {
    console.error("POST /api/support:", err)
    return NextResponse.json({ error: "Support agent temporarily unavailable." }, { status: 500 })
  }
}
