export const runtime = "edge"

/**
 * GET /api/a2a/[agentId]/tasks/[taskId]
 *
 * Polls the state of a previously created A2A task. AgentDyne resolves
 * tasks synchronously today (see POST /tasks), so in practice this will
 * almost always return `completed` or `failed` immediately — but it's kept
 * spec-shaped so a caller that polls (per the A2A task lifecycle) works
 * correctly, and so this endpoint can absorb a future async/streaming
 * upgrade without a breaking change.
 *
 * Auth: same API-key model as task creation. A key may only read tasks
 * against agents it's authorized to call.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { validateApiKey, extractRawKey } from "@/lib/api-key-auth"
import { taskRowToResponse } from "@/lib/a2a-protocol"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; taskId: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const { agentId, taskId } = await params
  if (!UUID_RE.test(agentId) || !UUID_RE.test(taskId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400, headers: CORS_HEADERS })
  }

  const rawKey = extractRawKey(req)
  if (!rawKey) {
    return NextResponse.json({ error: "Authorization required" }, { status: 401, headers: CORS_HEADERS })
  }
  const supabase = await createClient()
  const validation = await validateApiKey(supabase, rawKey, { agentId, ip: req.headers.get("cf-connecting-ip") ?? undefined, required: ["execute"] })
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason ?? "Invalid API key" }, { status: 401, headers: CORS_HEADERS })
  }

  const admin = createAdminClient()
  const { data: task } = await admin
    .from("a2a_tasks")
    .select("id, context_id, state, output, error_message, updated_at, agent_id, caller_key_id")
    .eq("id", taskId)
    .eq("agent_id", agentId)
    .single()

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404, headers: CORS_HEADERS })
  }
  // A key may only read tasks it created, or the agent owner reading via
  // their own account-scoped key — kept simple and conservative for v1.
  if (task.caller_key_id && task.caller_key_id !== validation.keyId) {
    return NextResponse.json({ error: "Not authorized for this task" }, { status: 403, headers: CORS_HEADERS })
  }

  admin.from("protocol_access_log").insert({
    protocol: "a2a", action: "task_get", agent_id: agentId, api_key_id: validation.keyId, outcome: "ok",
  }).then(() => {}).catch(() => {})

  return NextResponse.json(taskRowToResponse(task as any), { headers: CORS_HEADERS })
}
