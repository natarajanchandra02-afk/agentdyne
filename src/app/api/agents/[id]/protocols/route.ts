export const runtime = "edge"

/**
 * GET  /api/agents/[id]/protocols — current MCP/A2A opt-in state + preview URLs
 * PATCH /api/agents/[id]/protocols — owner toggles mcp_enabled / a2a_enabled
 *
 * Owner-only (session auth, RLS-equivalent ownership check — same pattern
 * as every other /api/agents/[id]/* settings route). This is the only
 * place these two flags can be flipped; the public MCP/A2A endpoints only
 * ever read them.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getOwnedAgent(supabase: any, userId: string, agentId: string) {
  // BUG FIX: agents' ownership column is `seller_id` (confirmed against
  // /api/agents/[id]/route.ts and /api/agents/[id]/try/route.ts), not
  // `owner_id` — the earlier version of this check used the wrong column
  // name, which would have rejected every legitimate agent owner.
  const { data } = await supabase
    .from("agents")
    .select("id, seller_id, status, mcp_enabled, a2a_enabled, protocol_metadata")
    .eq("id", agentId)
    .single()
  if (!data || data.seller_id !== userId) return null
  return data
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  if (!UUID_RE.test(agentId)) return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const agent = await getOwnedAgent(supabase, user.id, agentId)
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

  const baseUrl = new URL(req.url).origin
  return NextResponse.json({
    mcpEnabled: agent.mcp_enabled,
    a2aEnabled: agent.a2a_enabled,
    canPublish: agent.status === "active",
    mcpEndpoint: `${baseUrl}/api/mcp`,
    a2aCardUrl: `${baseUrl}/api/a2a/${agentId}/card`,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  if (!UUID_RE.test(agentId)) return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const agent = await getOwnedAgent(supabase, user.id, agentId)
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

  let body: { mcpEnabled?: boolean; a2aEnabled?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (typeof body.mcpEnabled !== "boolean" && typeof body.a2aEnabled !== "boolean") {
    return NextResponse.json({ error: "mcpEnabled and/or a2aEnabled (boolean) required" }, { status: 400 })
  }

  // Publishing to either protocol requires the agent to actually be live —
  // mirrors the "must be active to embed" rule in the Deploy tab, so an
  // owner can't expose a draft/unevaluated agent externally.
  if ((body.mcpEnabled === true || body.a2aEnabled === true) && agent.status !== "active") {
    return NextResponse.json({ error: "Agent must be active (pass review) before enabling MCP or A2A." }, { status: 422 })
  }

  const update: Record<string, boolean> = {}
  if (typeof body.mcpEnabled === "boolean") update.mcp_enabled = body.mcpEnabled
  if (typeof body.a2aEnabled === "boolean") update.a2a_enabled = body.a2aEnabled

  const { error } = await supabase.from("agents").update(update).eq("id", agentId)
  if (error) return NextResponse.json({ error: "Failed to update protocol settings" }, { status: 500 })

  return NextResponse.json({
    mcpEnabled: update.mcp_enabled ?? agent.mcp_enabled,
    a2aEnabled: update.a2a_enabled ?? agent.a2a_enabled,
  })
}
