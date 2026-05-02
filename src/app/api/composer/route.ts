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

// Starter agents shown when the marketplace has no active agents yet.
// Removed once real agents exist — composer prefers real marketplace agents.
const PLATFORM_STARTER_AGENTS = [
  { id: "platform-text-summarizer",    name: "Text Summariser",         description: "Summarises long text into key points",             category: "productivity", capability_tags: ["summarise","extract"],          pricing_model: "free", price_per_call: 0,    average_rating: 4.8, composite_score: 90 },
  { id: "platform-classifier",         name: "Classifier",              description: "Classifies input into predefined categories",      category: "productivity", capability_tags: ["classify","route"],            pricing_model: "free", price_per_call: 0,    average_rating: 4.7, composite_score: 88 },
  { id: "platform-sentiment-analyzer", name: "Sentiment Analyser",      description: "Detects sentiment and tone from text",             category: "data_analysis",capability_tags: ["sentiment","analyse"],         pricing_model: "free", price_per_call: 0,    average_rating: 4.6, composite_score: 85 },
  { id: "platform-reply-writer",       name: "Reply Writer",            description: "Drafts professional replies to messages",          category: "customer_support",capability_tags: ["write","draft","reply"],      pricing_model: "free", price_per_call: 0,    average_rating: 4.5, composite_score: 83 },
  { id: "platform-data-extractor",     name: "Data Extractor",          description: "Extracts structured data from unstructured text",   category: "data_analysis",capability_tags: ["extract","parse","structure"],  pricing_model: "free", price_per_call: 0,    average_rating: 4.6, composite_score: 86 },
  { id: "platform-translator",         name: "Translator",              description: "Translates text between languages",               category: "productivity", capability_tags: ["translate","language"],         pricing_model: "free", price_per_call: 0,    average_rating: 4.7, composite_score: 87 },
  { id: "platform-code-reviewer",      name: "Code Reviewer",           description: "Reviews code for bugs, security, and style",       category: "coding",       capability_tags: ["review","code","security"],    pricing_model: "free", price_per_call: 0,    average_rating: 4.5, composite_score: 84 },
  { id: "platform-report-writer",      name: "Report Writer",           description: "Generates structured reports from raw data",       category: "content",      capability_tags: ["write","report","analyse"],   pricing_model: "free", price_per_call: 0,    average_rating: 4.4, composite_score: 82 },
]

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

    const { goal, maxBudgetUsd, preferredPattern, saveAsPipeline = false, currentNodes } = body as any

    if (!goal || typeof goal !== "string" || goal.trim().length < 5)
      return NextResponse.json({ error: "goal must be a non-empty string (min 5 chars)" }, { status: 400 })

    if (goal.length > 2000)
      return NextResponse.json({ error: "goal must be 2000 characters or fewer" }, { status: 400 })

    // When currentNodes is provided, this is an AI Edit request (from the pipeline AI Edit Panel).
    // We inject the existing pipeline context into the goal so the composer can modify rather than
    // create from scratch. Without this, "Add a sentiment step after X" generates a fresh pipeline.
    const effectiveGoal = currentNodes?.length
      ? `MODIFY this existing pipeline (do NOT change steps that are working, only apply the requested change):
Current steps: ${(currentNodes as any[]).map((n: any, i: number) => `${i + 1}. "${n.label}" (${n.node_type ?? 'linear'})`).join(' → ')}

Requested change: ${goal.trim()}`
      : goal.trim()

    // Fetch available active agents for the composer
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, description, category, capability_tags, pricing_model, price_per_call, average_rating, composite_score")
      .eq("status", "active")
      .order("composite_score", { ascending: false })
      .limit(40)

    // Graceful fallback when no marketplace agents exist yet (fresh deployment / beta).
    // Use platform placeholder agents so the composer still demonstrates value.
    const availableAgents = (agents && agents.length > 0) ? agents : PLATFORM_STARTER_AGENTS

    const result = await composeWorkflow({
      goal:            effectiveGoal,
      availableAgents: availableAgents as any[],
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
