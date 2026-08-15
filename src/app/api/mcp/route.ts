export const runtime = "edge"

/**
 * POST /api/mcp — AgentDyne as an MCP server
 *
 * Streamable-HTTP MCP transport (single JSON-RPC 2.0 endpoint). Lets any
 * MCP client (Claude, ChatGPT, another platform's agent runtime) discover
 * and call AgentDyne agents as tools — the reverse direction of AgentDyne's
 * existing MCP *client* integration (lib/mcp-servers.ts).
 *
 * Methods:
 *   initialize   — handshake, returns server capabilities + protocol version
 *   tools/list   — lists agents that are status='active' AND mcp_enabled=true,
 *                  scoped to the caller's API key if one is presented
 *   tools/call   — executes one tool; REQUIRES a valid API key with the
 *                  "execute" permission. Internally calls the existing,
 *                  hardened /api/agents/[id]/execute route — this file adds
 *                  zero new execution or billing logic, only protocol
 *                  translation.
 *   ping         — liveness check
 *
 * Security, matching every other public-facing route in this codebase:
 *   - IP burst rate limiting (apiRateLimit)
 *   - API-key validation via lib/api-key-auth.ts (same HMAC model as
 *     /api/agents/[id]/execute)
 *   - Every call logged to protocol_access_log for the governance dashboard
 *   - Discovery-only methods never reveal agents the owner hasn't opted in
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { validateApiKey, extractRawKey } from "@/lib/api-key-auth"
import {
  MCP_PROTOCOL_VERSION, buildToolsList, agentToolName, parseAgentIdFromToolName,
  rpcResult, rpcError, paramsWithinLimit,
  RPC_PARSE_ERROR, RPC_INVALID_REQUEST, RPC_METHOD_NOT_FOUND, RPC_INVALID_PARAMS,
  MCP_AUTH_REQUIRED, MCP_TOOL_NOT_FOUND,
  type JsonRpcRequest,
} from "@/lib/mcp-protocol"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

function logAccess(admin: ReturnType<typeof createAdminClient>, fields: {
  action: string; agentId?: string | null; apiKeyId?: string | null; ip?: string | null
  outcome: "ok" | "denied" | "error" | "rate_limited"; detail?: string
}) {
  admin.from("protocol_access_log").insert({
    protocol:   "mcp",
    action:     fields.action,
    agent_id:   fields.agentId ?? null,
    api_key_id: fields.apiKeyId ?? null,
    caller_ip:  fields.ip ?? null,
    outcome:    fields.outcome,
    detail:     fields.detail?.slice(0, 300) ?? null,
  }).then(() => {}).catch(() => {})
}

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const admin = createAdminClient()

  let body: JsonRpcRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(rpcError(null, RPC_PARSE_ERROR, "Invalid JSON body"), { status: 400, headers: CORS_HEADERS })
  }

  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return NextResponse.json(rpcError(body?.id, RPC_INVALID_REQUEST, "Not a valid JSON-RPC 2.0 request"), { status: 400, headers: CORS_HEADERS })
  }
  if (body.params !== undefined && !paramsWithinLimit(body.params)) {
    return NextResponse.json(rpcError(body.id, RPC_INVALID_PARAMS, "params exceeds size limit"), { status: 413, headers: CORS_HEADERS })
  }

  const { id, method, params } = body

  // ── initialize ─────────────────────────────────────────────────────────
  if (method === "initialize") {
    return NextResponse.json(rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: "agentdyne", version: "2.3.0" },
      capabilities: { tools: {} },
    }), { headers: CORS_HEADERS })
  }

  // ── ping ───────────────────────────────────────────────────────────────
  if (method === "ping") {
    return NextResponse.json(rpcResult(id, {}), { headers: CORS_HEADERS })
  }

  // ── tools/list ─────────────────────────────────────────────────────────
  if (method === "tools/list") {
    // Optional API key — if present, scope the list to what that key is
    // allowed to call (same allowed_agent_ids semantics as /api/agents/[id]/execute).
    const rawKey = extractRawKey(req)
    let allowedIds: string[] | null = null
    if (rawKey) {
      const supabase = await createClient()
      const validation = await validateApiKey(supabase, rawKey, { ip: ip ?? undefined })
      if (validation.valid && validation.keyRow?.allowed_agent_ids?.length) {
        allowedIds = validation.keyRow.allowed_agent_ids
      }
    }

    let query = admin
      .from("agents")
      .select("id, name, description, category, input_schema")
      .eq("status", "active")
      .eq("mcp_enabled", true)
      .limit(200)
    if (allowedIds) query = query.in("id", allowedIds)

    const { data: agents } = await query
    logAccess(admin, { action: "tools/list", ip, outcome: "ok" })

    return NextResponse.json(rpcResult(id, { tools: buildToolsList(agents ?? []) }), { headers: CORS_HEADERS })
  }

  // ── tools/call ─────────────────────────────────────────────────────────
  if (method === "tools/call") {
    const toolName = params?.name as string | undefined
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>

    if (!toolName || typeof toolName !== "string") {
      return NextResponse.json(rpcError(id, RPC_INVALID_PARAMS, "params.name is required"), { status: 400, headers: CORS_HEADERS })
    }

    const rawKey = extractRawKey(req)
    if (!rawKey) {
      logAccess(admin, { action: "tools/call", ip, outcome: "denied", detail: "no API key" })
      return NextResponse.json(rpcError(id, MCP_AUTH_REQUIRED, "This tool requires an AgentDyne API key (Authorization: Bearer <key> or X-Api-Key header)."), { status: 401, headers: CORS_HEADERS })
    }

    const supabase = await createClient()
    const validation = await validateApiKey(supabase, rawKey, { ip: ip ?? undefined, required: ["execute"] })
    if (!validation.valid) {
      logAccess(admin, { action: "tools/call", ip, outcome: "denied", detail: validation.reason })
      return NextResponse.json(rpcError(id, MCP_AUTH_REQUIRED, validation.reason ?? "Invalid API key"), { status: 401, headers: CORS_HEADERS })
    }

    // Resolve the tool name back to an agent this key may call and that is
    // still opted into MCP (opt-in is re-checked at call time, not just at
    // list time, so revoking mcp_enabled takes effect immediately).
    const candidateIds = validation.keyRow?.allowed_agent_ids?.length
      ? validation.keyRow.allowed_agent_ids
      : (await admin.from("agents").select("id").eq("mcp_enabled", true).eq("status", "active")).data?.map(a => a.id) ?? []

    const agentId = parseAgentIdFromToolName(toolName, candidateIds)
    if (!agentId) {
      logAccess(admin, { action: "tools/call", ip, apiKeyId: validation.keyId, outcome: "denied", detail: `unknown tool ${toolName}` })
      return NextResponse.json(rpcError(id, MCP_TOOL_NOT_FOUND, `Unknown or unauthorized tool: ${toolName}`), { status: 404, headers: CORS_HEADERS })
    }

    const { data: agent } = await admin.from("agents").select("id, mcp_enabled, status").eq("id", agentId).single()
    if (!agent || !agent.mcp_enabled || agent.status !== "active") {
      logAccess(admin, { action: "tools/call", ip, apiKeyId: validation.keyId, agentId, outcome: "denied", detail: "agent not mcp_enabled/active" })
      return NextResponse.json(rpcError(id, MCP_TOOL_NOT_FOUND, "Agent is no longer available via MCP"), { status: 404, headers: CORS_HEADERS })
    }

    // Delegate to the existing, hardened execute route — internal same-origin
    // call, forwarding the caller's own API key so every downstream check
    // (guardrails, credits, quota, rate limit, WAL) runs exactly as it does
    // for a direct REST call. No logic duplicated here.
    //
    // X-AgentDyne-Origin: mcp — tells execute/route.ts this input arrived via
    // an external MCP client, not the account owner typing directly into their
    // own dashboard/SDK. execute/route.ts uses this to classify the input as
    // "external" for injection scoring (OWASP ASI07 inter-agent-communication
    // risk: content relayed through an intermediary agent shouldn't inherit
    // first-party trust just because it arrives on an authenticated API key).
    const execRes = await fetch(new URL(`/api/agents/${agentId}/execute`, req.url).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${rawKey}`,
        "X-AgentDyne-Origin": "mcp",
      },
      body: JSON.stringify({ input: (toolArgs as any).input ?? toolArgs }),
    })
    const execData = await execRes.json().catch(() => ({}))

    logAccess(admin, {
      action: "tools/call", ip, apiKeyId: validation.keyId, agentId,
      outcome: execRes.ok ? "ok" : "error",
      detail: execRes.ok ? undefined : (execData.error ?? `HTTP ${execRes.status}`),
    })

    if (!execRes.ok) {
      return NextResponse.json(rpcResult(id, {
        content: [{ type: "text", text: `Error: ${execData.error ?? "execution failed"}` }],
        isError: true,
      }), { headers: CORS_HEADERS })
    }

    const outputText = typeof execData.output === "string" ? execData.output : JSON.stringify(execData.output)
    return NextResponse.json(rpcResult(id, {
      content: [{ type: "text", text: outputText }],
      isError: false,
    }), { headers: CORS_HEADERS })
  }

  return NextResponse.json(rpcError(id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`), { status: 404, headers: CORS_HEADERS })
}
