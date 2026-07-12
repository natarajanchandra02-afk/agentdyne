export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { validateApiKey, extractRawKey } from "@/lib/api-key-auth"

// ✅ Bug fix: was doing a bare SHA-256 hash lookup with no HMAC support,
// no permission/agent/IP scoping, and no expiry check — a duplicate,
// weaker reimplementation of what lib/api-key-auth.ts already does
// properly. Any API key created after the HMAC migration (see that file's
// header comment, migration 029) would silently fail to authenticate here
// even though it worked correctly against /api/execute. Switched to the
// canonical validateApiKey() helper for consistency and correctness.
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
    const { id }  = await params
    const userId  = await resolveUserId(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = await createClient()

    const { data: execution, error } = await supabase
      .from("executions")
      .select(
        `id, agent_id, user_id, status, input, output, error_message,
         tokens_input, tokens_output, latency_ms, cost, created_at, completed_at,
         agents!agent_id(id, name, icon_url)`
      )
      .eq("id",      id)
      .eq("user_id", userId)
      .single()

    if (error || !execution) {
      return NextResponse.json({ error: "Execution not found" }, { status: 404 })
    }

    // ✅ Bug fix: this SDK-facing route returned zero routing/trust data even
    // after execution_traces started getting populated this session — an SDK
    // user calling get_execution() had no way to see which model was actually
    // selected, why, or replay the exact prompt/response. The web dashboard's
    // admin Governance panel and /executions/[id] page both already surface
    // this; the API was the one place still missing it.
    const { data: trace } = await supabase
      .from("execution_traces")
      .select("selected_model, routing_reason, depth_assessment, system_prompt, user_message, assistant_reply, temperature")
      .eq("execution_id", id)
      .eq("user_id", userId)
      .maybeSingle()

    return NextResponse.json({
      ...execution,
      routing: trace ? {
        selectedModel:   trace.selected_model,
        routingReason:   trace.routing_reason,
        depthAssessment: trace.depth_assessment,
        temperature:     trace.temperature,
      } : null,
      replay: trace ? {
        systemPrompt:   trace.system_prompt,
        userMessage:    trace.user_message,
        assistantReply: trace.assistant_reply,
      } : null,
    })
  } catch (err: any) {
    console.error("GET /api/executions/[id]:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
