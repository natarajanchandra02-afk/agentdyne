export const runtime = "edge"

/**
 * POST /api/a2a/[agentId]/tasks
 *
 * Creates (and, for this v1 synchronous subset, immediately resolves) an
 * A2A task against one AgentDyne agent. Requires the API key declared in
 * the agent's Agent Card (see /api/a2a/[agentId]/card).
 *
 * Every task is persisted to a2a_tasks with the full submitted → working →
 * completed/failed lifecycle recorded, even though AgentDyne resolves it
 * inline — this keeps the endpoint spec-shaped for GET /tasks/[taskId]
 * polling and for a future async/streaming upgrade without a breaking change.
 *
 * Execution itself is fully delegated to the existing, hardened
 * /api/agents/[id]/execute route (guardrails, injection filter, credit
 * reservation, quota, WAL) — this file adds no new execution logic.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { validateApiKey, extractRawKey } from "@/lib/api-key-auth"
import { extractInputFromA2AMessage, taskRowToResponse } from "@/lib/a2a-protocol"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 32_000

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const { agentId } = await params
  if (!UUID_RE.test(agentId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400, headers: CORS_HEADERS })
  }

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const admin = createAdminClient()

  const logTaskAccess = (outcome: "ok" | "denied" | "error", apiKeyId?: string | null, detail?: string) =>
    admin.from("protocol_access_log").insert({
      protocol: "a2a", action: "task_create", agent_id: agentId, api_key_id: apiKeyId ?? null,
      caller_ip: ip, outcome, detail: detail?.slice(0, 300) ?? null,
    }).then(() => {}).catch(() => {})

  // ── Agent must be opted in ────────────────────────────────────────────
  // BUG FIX: agents' ownership column is `seller_id`, not `owner_id`
  // (confirmed against /api/agents/[id]/route.ts) — the earlier version
  // selected a column that doesn't exist, which would have made every
  // inserted a2a_tasks.owner_id NULL and failed its NOT NULL constraint.
  const { data: agent } = await admin
    .from("agents").select("id, a2a_enabled, status, seller_id").eq("id", agentId).single()
  if (!agent || !agent.a2a_enabled || agent.status !== "active") {
    logTaskAccess("denied", null, "agent not a2a_enabled/active")
    return NextResponse.json({ error: "Agent not found or not A2A-enabled" }, { status: 404, headers: CORS_HEADERS })
  }

  // ── Auth — same API-key model as every other execute path ────────────
  const rawKey = extractRawKey(req)
  if (!rawKey) {
    logTaskAccess("denied", null, "no API key")
    return NextResponse.json({ error: "Authorization required — see securitySchemes in the agent's card" }, { status: 401, headers: CORS_HEADERS })
  }
  const supabase = await createClient()
  const validation = await validateApiKey(supabase, rawKey, { agentId, ip: ip ?? undefined, required: ["execute"] })
  if (!validation.valid) {
    logTaskAccess("denied", null, validation.reason)
    return NextResponse.json({ error: validation.reason ?? "Invalid API key" }, { status: 401, headers: CORS_HEADERS })
  }

  // ── Parse body ──────────────────────────────────────────────────────
  const rawBody = await req.text()
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413, headers: CORS_HEADERS })
  }
  let body: unknown
  try { body = JSON.parse(rawBody) } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS })
  }
  const input = extractInputFromA2AMessage(body)
  if (input === undefined || input === null || input === "") {
    return NextResponse.json({ error: "message.parts[] (or `input`) is required" }, { status: 400, headers: CORS_HEADERS })
  }

  // ── Create the task row (state: submitted → working) ─────────────────
  const { data: task, error: taskErr } = await admin.from("a2a_tasks").insert({
    agent_id: agentId,
    owner_id: agent.seller_id,  // a2a_tasks' own column is named owner_id; populated from agents.seller_id (see fix above, not a typo)
    caller_key_id: validation.keyId,
    state: "working",
    input_message: typeof body === "object" ? body as Record<string, unknown> : { input },
  }).select("id, context_id").single()

  if (taskErr || !task) {
    logTaskAccess("error", validation.keyId, taskErr?.message)
    return NextResponse.json({ error: "Failed to create task" }, { status: 500, headers: CORS_HEADERS })
  }

  // ── Delegate to the existing hardened execute route ───────────────────
  const execRes = await fetch(new URL(`/api/agents/${agentId}/execute`, req.url).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${rawKey}`,
      // X-AgentDyne-Origin: a2a — see mcp/route.ts's matching header comment;
      // content may be relayed through an external A2A orchestrator, not
      // typed directly by the account owner — execute/route.ts uses this to
      // classify the input as "external" for injection scoring.
      "X-AgentDyne-Origin": "a2a",
    },
    body: JSON.stringify({ input }),
  })
  const execData = await execRes.json().catch(() => ({}))

  const finalState = execRes.ok ? "completed" : "failed"
  const { data: updatedTask } = await admin.from("a2a_tasks").update({
    state: finalState,
    output: execRes.ok ? execData.output : null,
    error_message: execRes.ok ? null : (execData.error ?? `HTTP ${execRes.status}`),
    execution_id: execData.executionId ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", task.id).select("id, context_id, state, output, error_message, updated_at").single()

  logTaskAccess(execRes.ok ? "ok" : "error", validation.keyId, execRes.ok ? undefined : execData.error)

  if (!updatedTask) {
    return NextResponse.json({ error: "Task executed but failed to persist final state" }, { status: 500, headers: CORS_HEADERS })
  }

  return NextResponse.json(taskRowToResponse(updatedTask as any), {
    status: 201,
    headers: CORS_HEADERS,
  })
}
