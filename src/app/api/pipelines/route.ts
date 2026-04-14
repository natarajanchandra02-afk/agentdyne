export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/pipelines   — list the user's pipelines
 * POST /api/pipelines  — create a new pipeline
 */

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const includePublic = searchParams.get("public") === "true"
    const page          = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit         = Math.min(50, parseInt(searchParams.get("limit") || "20"))

    let query = supabase
      .from("pipelines")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (includePublic) {
      query = query.or(`owner_id.eq.${user.id},is_public.eq.true`) as typeof query
    } else {
      query = query.eq("owner_id", user.id) as typeof query
    }

    const { data, count, error } = await query
    if (error) throw error

    const total = count ?? 0
    return NextResponse.json({
      data: data ?? [],
      pagination: {
        total, page, limit,
        pages:   Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const { name, description, dag, is_public, timeout_seconds, tags } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    // Validate DAG structure
    if (!dag || !Array.isArray(dag.nodes) || !Array.isArray(dag.edges)) {
      return NextResponse.json(
        { error: "dag must have { nodes: [], edges: [] }" },
        { status: 400 }
      )
    }

    if (dag.nodes.length === 0) {
      return NextResponse.json(
        { error: "Pipeline must have at least one agent node" },
        { status: 400 }
      )
    }

    // Validate all nodes reference real active agents
    const agentIds = dag.nodes.map((n: any) => n.agent_id).filter(Boolean)
    if (agentIds.length !== dag.nodes.length) {
      return NextResponse.json(
        { error: "Every node must have a valid agent_id" },
        { status: 400 }
      )
    }

    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, status")
      .in("id", agentIds)
      .eq("status", "active")

    if (!agents || agents.length !== agentIds.length) {
      return NextResponse.json(
        { error: "One or more agent IDs are invalid or inactive" },
        { status: 422 }
      )
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({
        owner_id:        user.id,
        name:            name.trim(),
        description:     description ?? null,
        dag,
        is_public:       is_public ?? false,
        timeout_seconds: timeout_seconds ?? 300,
        tags:            tags ?? [],
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(pipeline, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
