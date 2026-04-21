export const runtime = "edge"

/**
 * GET /api/agents/[id]/pipeline-usage
 *
 * Returns how many pipelines this agent is used in.
 * Drives the "Used in X pipelines" network effects widget on agent detail pages.
 *
 * This is a lightweight read — counts pipeline DAG nodes containing this agent_id.
 * Rate-limited but public — network effect data should be visible to all.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id } = await params
    if (!UUID_RE.test(id))
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

    const supabase = await createClient()

    // Count pipelines where the DAG contains this agent_id as a node
    // Using Postgres JSON containment: dag->'nodes' @> '[{"agent_id": "..."}]'
    // This is efficient with a GIN index on dag.
    //
    // Fallback: if the RPC/JSON query isn't supported, return 0 gracefully.
    const { count, error } = await supabase
      .from("pipelines")
      .select("id", { count: "exact", head: true })
      .filter("dag", "cs", JSON.stringify({ nodes: [{ agent_id: id }] }))

    if (error) {
      // Silently fall back — don't surface DB errors on a cosmetic widget
      return NextResponse.json({ count: 0, agentId: id })
    }

    // Also check agent_pipeline_usage table if it exists (more accurate)
    let usageCount = count ?? 0
    try {
      const { count: usageTableCount } = await supabase
        .from("agent_pipeline_usage")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", id)
      if ((usageTableCount ?? 0) > usageCount) usageCount = usageTableCount ?? 0
    } catch {
      // agent_pipeline_usage table may not exist — fine, use the pipelines count
    }

    return NextResponse.json({
      agentId: id,
      count:   usageCount,
    })
  } catch (err: any) {
    // Never expose errors from a cosmetic widget
    return NextResponse.json({ count: 0 })
  }
}
