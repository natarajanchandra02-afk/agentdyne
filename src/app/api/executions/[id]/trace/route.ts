export const runtime = 'edge'

/**
 * GET /api/executions/[id]/trace
 *
 * Returns one execution as an OTLP/HTTP JSON trace, so a customer's own
 * observability stack (Datadog, Honeycomb, Grafana Tempo, any OTLP
 * collector) can ingest AgentDyne execution data directly — the
 * programmatic counterpart to the /dashboard/executions UI, for teams who
 * don't want "the dashboard or nothing."
 *
 * Read-only. Auth is identical to the sibling /api/executions/[id] route
 * (session or API key with "read" permission), and the ownership check
 * (`user_id = userId`) is unchanged — this endpoint cannot see another
 * user's executions. Nothing in the existing execution-write path is
 * touched; this only shapes already-written rows into OTLP JSON.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { validateApiKey, extractRawKey } from "@/lib/api-key-auth"
import { buildExecutionTrace } from "@/lib/otel-export"

// Mirrors the sibling route's resolveUserId exactly — see that file's
// header comment for why validateApiKey() (not a bare hash lookup) is
// required here.
async function resolveUserId(req: NextRequest): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.id) return user.id

  const rawKey = extractRawKey(req)
  if (!rawKey) return null

  const result = await validateApiKey(supabase, rawKey, { required: ["read"] })
  return result.valid ? result.userId : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id } = await params
    const userId = await resolveUserId(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = await createClient()

    const { data: execution, error } = await supabase
      .from("executions")
      .select("id, agent_id, user_id, status, error_message, tokens_input, tokens_output, latency_ms, cost, created_at, completed_at")
      .eq("id", id)
      .eq("user_id", userId)
      .single()

    if (error || !execution) {
      return NextResponse.json({ error: "Execution not found" }, { status: 404 })
    }

    const { data: trace } = await supabase
      .from("execution_traces")
      .select("selected_model")
      .eq("execution_id", id)
      .eq("user_id", userId)
      .maybeSingle()

    const otlp = await buildExecutionTrace({
      id: execution.id,
      agent_id: execution.agent_id,
      model: trace?.selected_model ?? null,
      status: execution.status,
      latency_ms: execution.latency_ms,
      cost: execution.cost,
      tokens_input: execution.tokens_input,
      tokens_output: execution.tokens_output,
      error_message: execution.error_message,
      created_at: execution.created_at,
      completed_at: execution.completed_at,
    })

    return NextResponse.json(otlp)
  } catch (err: any) {
    console.error("GET /api/executions/[id]/trace:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
