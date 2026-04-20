export const runtime = "edge"

/**
 * POST /api/composer
 *
 * LLM-driven workflow composer endpoint.
 * Takes a natural language goal, returns a ready-to-run pipeline DAG.
 *
 * Body:
 *   { goal: string, maxBudgetUsd?: number, preferredPattern?: string, saveAsPipeline?: boolean }
 *
 * Response:
 *   { ok, dag, reasoning, patternUsed, confidence, pipelineId? }
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { composeWorkflow } from "@/core/composer/llmComposer"

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { goal, maxBudgetUsd, preferredPattern, saveAsPipeline = false } = body as any

    if (!goal || typeof goal !== "string" || goal.trim().length < 5)
      return NextResponse.json({ error: "goal must be a non-empty string (min 5 chars)" }, { status: 400 })

    if (goal.length > 2000)
      return NextResponse.json({ error: "goal must be 2000 characters or fewer" }, { status: 400 })

    // Fetch available active agents for the composer
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, description, category, capability_tags, pricing_model, price_per_call, average_rating, composite_score")
      .eq("status", "active")
      .order("composite_score", { ascending: false })
      .limit(40)

    if (!agents?.length)
      return NextResponse.json({ error: "No active agents available in the marketplace to compose a workflow" }, { status: 404 })

    const result = await composeWorkflow({
      goal:            goal.trim(),
      availableAgents: agents as any[],
      preferredPattern: preferredPattern as any,
      maxBudgetUsd:    typeof maxBudgetUsd === "number" ? maxBudgetUsd : undefined,
    })

    if (!result.ok)
      return NextResponse.json({ ok: false, error: result.error, reasoning: result.reasoning }, { status: 422 })

    // Optionally save as a pipeline
    let pipelineId: string | undefined
    if (saveAsPipeline && result.dag) {
      const { data: pipeline } = await supabase
        .from("pipelines")
        .insert({
          owner_id:        user.id,
          name:            result.dag.description.slice(0, 100),
          description:     `Auto-composed from: "${goal.slice(0, 200)}"`,
          dag:             { nodes: result.dag.nodes, edges: result.dag.edges },
          is_public:       false,
          timeout_seconds: 300,
          tags:            [result.dag.pattern, "ai-composed"],
        })
        .select("id")
        .single()

      pipelineId = pipeline?.id
    }

    return NextResponse.json({
      ok:          true,
      dag:         result.dag,
      reasoning:   result.reasoning,
      patternUsed: result.patternUsed,
      confidence:  result.confidence,
      agentsUsed:  result.agentsUsed,
      pipelineId,
    })

  } catch (err: any) {
    console.error("POST /api/composer:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
