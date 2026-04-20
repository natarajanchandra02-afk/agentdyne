export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

// GET /api/pipelines/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .select("*")
      .eq("id", id)
      .single()

    if (error || !pipeline)
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })

    if (!pipeline.is_public && pipeline.owner_id !== user?.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Enrich nodes with agent info (for pipeline editor display)
    const dag       = pipeline.dag as { nodes: any[]; edges: any[]; strict_schema_mode?: boolean }
    const agentIds  = dag.nodes.map((n: any) => n.agent_id).filter(Boolean)

    let agentMap: Record<string, any> = {}
    if (agentIds.length > 0) {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, name, description, category, pricing_model, price_per_call, composite_score, average_latency_ms, icon_url, input_schema, output_schema")
        .in("id", agentIds)
      for (const a of agents ?? []) agentMap[a.id] = a
    }

    const enrichedNodes = dag.nodes.map((n: any) => ({
      ...n,
      agent: agentMap[n.agent_id] ?? null,
    }))

    return NextResponse.json({
      ...pipeline,
      dag: { ...dag, nodes: enrichedNodes },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/pipelines/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }   = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: existing } = await supabase
      .from("pipelines").select("owner_id").eq("id", id).single()
    if (!existing) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    if (existing.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await req.json()
    const ALLOWED = [
      "name", "description", "dag", "is_public", "is_active",
      "timeout_seconds", "retry_on_failure", "max_retries", "tags", "version",
    ]
    const updates: Record<string, unknown> = {}
    for (const key of ALLOWED) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })

    // Validate DAG if being updated
    if (updates.dag) {
      const dag = updates.dag as any
      if (!Array.isArray(dag.nodes) || !Array.isArray(dag.edges))
        return NextResponse.json({ error: "dag must have { nodes: [], edges: [] }" }, { status: 400 })
      if (dag.nodes.length > 50)
        return NextResponse.json({ error: "Pipeline cannot exceed 50 nodes" }, { status: 400 })
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(pipeline)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/pipelines/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }   = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: existing } = await supabase
      .from("pipelines").select("owner_id").eq("id", id).single()
    if (!existing) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    if (existing.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { error } = await supabase.from("pipelines").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
