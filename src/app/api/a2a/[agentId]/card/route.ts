export const runtime = "edge"

/**
 * GET /api/a2a/[agentId]/card
 *
 * Publishes the A2A "Agent Card" for one AgentDyne agent — the public,
 * machine-readable capability descriptor external A2A orchestrators use to
 * discover what this agent does and how to call it. Per the A2A spec this
 * is intentionally unauthenticated (discovery is meant to be open); only
 * task execution (/tasks) requires the API key the card itself declares.
 *
 * Only ever renders for agents that are BOTH status='active' AND
 * a2a_enabled=true (owner opt-in, migration 039). Everything else 404s —
 * this endpoint never leaks the existence of agents that haven't opted in.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiRateLimit } from "@/lib/rate-limit"
import { buildAgentCard } from "@/lib/a2a-protocol"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const { agentId } = await params
  if (!UUID_RE.test(agentId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400, headers: CORS_HEADERS })
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, name, description, category, status, a2a_enabled, protocol_metadata")
    .eq("id", agentId)
    .single()

  if (!agent || !agent.a2a_enabled || agent.status !== "active") {
    return NextResponse.json({ error: "Agent card not found" }, { status: 404, headers: CORS_HEADERS })
  }

  admin.from("protocol_access_log").insert({
    protocol: "a2a", action: "card_fetch", agent_id: agentId, outcome: "ok",
  }).then(() => {}).catch(() => {})

  const baseUrl = new URL(req.url).origin
  const card = buildAgentCard(agent, baseUrl)

  return NextResponse.json(card, {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" },  // cards change rarely — 5 min edge cache
  })
}
