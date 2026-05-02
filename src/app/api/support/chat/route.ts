export const runtime = "edge"

/**
 * POST /api/support/chat
 * AgentDyne AI Support Assistant — streaming SSE response via Haiku.
 */

import { NextRequest } from "next/server"
import { apiRateLimit } from "@/lib/rate-limit"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are Dyne, the AgentDyne AI support assistant. Be friendly, concise, accurate.

PLATFORM:
- Marketplace: browse/buy/execute agents. Free agents run on free plan.
- Builder: 3-step wizard (Details → AI Config → Pricing). Agents start as drafts.
- Composer: describe goal → AI builds pipeline → preview → run.
- Pipelines: DAG workflows, max 10 nodes. Patterns: linear/parallel/branch/mixed.
- Plans: Free=50 lifetime runs, Starter=$19/mo 500 runs $10 cap, Pro=$79/mo 5K runs $50 cap.
- API Keys: prefix agd_, use as Bearer or x-api-key header. Generate at /api-keys.
- Seller: 80% revenue, Stripe Express payout 1st of month, min $1.

FIXES:
- "Agent creation stays on page" → All 3 steps must be valid. System prompt ≥20 chars, name ≥3 chars, category selected.
- "Execution failed" → Check Executions page error_message. Causes: timeout, quota exceeded, insufficient credits.
- "Composer error" → Works with starter agents even when marketplace is empty. Ensure ANTHROPIC_API_KEY is set.
- "API key rejected" → Check: starts with agd_, is_active=true, has execute permission, not expired.
- "Agent stuck in review" → Takes up to 48h. Eval score must be ≥70. Check auto_disable_reason.

Keep responses under 200 words. Give specific actionable next steps. Direct to /docs or /contact if unsure.`

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    let body: any
    try { body = await req.json() }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }) }

    const { messages } = body
    if (!Array.isArray(messages) || !messages.length)
      return new Response(JSON.stringify({ error: "messages required" }), { status: 400 })

    const safe = messages
      .filter((m: any) => m?.role && typeof m?.content === "string")
      .slice(-12)
      .map((m: any) => ({
        role:    (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: String(m.content).slice(0, 4000),
      }))

    if (!safe.length)
      return new Response(JSON.stringify({ error: "No valid messages" }), { status: 400 })

    if (!process.env.ANTHROPIC_API_KEY)
      return new Response(
        JSON.stringify({ error: "AI support not configured. Contact support@agentdyne.com" }),
        { status: 503 }
      )

    const stream   = client.messages.stream({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system: SYSTEM, messages: safe })
    const readable = new ReadableStream({
      async start(ctrl) {
        const enc = new TextEncoder()
        try {
          for await (const ev of stream) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta")
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text: ev.delta.text })}\n\n`))
            if (ev.type === "message_stop")
              ctrl.enqueue(enc.encode("data: [DONE]\n\n"))
          }
        } catch (e: any) {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`))
        } finally { ctrl.close() }
      },
    })

    return new Response(readable, {
      headers: {
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache, no-store",
        "Connection":        "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Support unavailable" }), { status: 500 })
  }
}
