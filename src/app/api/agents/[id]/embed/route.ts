export const runtime = "edge"

/**
 * GET  /api/agents/[id]/embed — Public embed config
 * POST /api/agents/[id]/embed — Generate embed token + script tag (P1)
 *
 * "Stripe Checkout for AI" — viral distribution via embeddable widgets.
 * Every agent owner can deploy <script src="agentdyne.com/embed/{id}.js">
 * to any website. Agents run in an iframe widget powered by AgentDyne.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const supabase = await createClient()

  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, description, icon_url, embed_config, embed_enabled, status")
    .eq("id", agentId)
    .single()

  if (!agent || agent.status !== "active")
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })

  return NextResponse.json({
    agentId,
    name: agent.name,
    description: agent.description,
    iconUrl: agent.icon_url,
    embedEnabled: agent.embed_enabled ?? false,
    embedConfig: {
      theme:        (agent.embed_config as any)?.theme        ?? "light",
      position:     (agent.embed_config as any)?.position     ?? "bottom-right",
      primaryColor: (agent.embed_config as any)?.primaryColor ?? "#6366f1",
      placeholder:  (agent.embed_config as any)?.placeholder  ?? `Chat with ${agent.name}`,
    },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, seller_id, status, embed_config")
    .eq("id", agentId)
    .single()

  if (!agent)
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  if (agent.seller_id !== user.id)
    return NextResponse.json({ error: "Not your agent" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const {
    domain        = "*",
    theme         = "light",
    position      = "bottom-right",
    primaryColor  = "#6366f1",
    placeholder,
    allowedOrigins = [],
  } = body

  // Create embed token (1-year TTL)
  const { data: token } = await supabase
    .from("embed_tokens")
    .upsert({
      agent_id:   agentId,
      user_id:    user.id,
      domain,
      origin:     allowedOrigins.join(",") || "*",
      is_active:  true,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    }, { onConflict: "agent_id,user_id" })
    .select("id")
    .single()

  // Enable embed on agent
  await supabase.from("agents").update({
    embed_enabled: true,
    embed_config: {
      theme, position, primaryColor,
      placeholder: placeholder ?? `Chat with ${agent.name}`,
    },
  }).eq("id", agentId)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://agentdyne.com"
  const tokenId = token?.id ?? agentId

  const scriptTag = `<script
  src="${baseUrl}/embed/${agentId}.js"
  data-agent="${agentId}"
  data-token="${tokenId}"
  data-theme="${theme}"
  data-position="${position}"
  data-color="${primaryColor}"
  async
></script>`

  const iframeTag = `<iframe
  src="${baseUrl}/embed/widget/${agentId}?token=${tokenId}"
  width="420"
  height="620"
  frameborder="0"
  style="border:none;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12);"
></iframe>`

  return NextResponse.json({
    embedId:    tokenId,
    agentId,
    scriptTag,
    iframeTag,
    previewUrl: `${baseUrl}/embed/widget/${agentId}?token=${tokenId}`,
    config:     { theme, position, primaryColor, domain },
    instructions: {
      step1: "Copy the script tag",
      step2: "Paste before </body> on any webpage",
      step3: "A chat widget appears — visitors run your agent for free or pay-per-call",
      viral:  "Every embedded widget is a link back to your AgentDyne profile",
    },
  })
}
