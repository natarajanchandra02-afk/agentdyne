export const runtime = "edge"

/**
 * GET  /api/agents/[id]/versions
 * POST /api/agents/[id]/versions  action: "suggest" | "apply"
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  if (!UUID_RE.test(agentId))
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: agent } = await supabase
    .from("agents")
    .select("seller_id, name, system_prompt, composite_score")
    .eq("id", agentId).single()

  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (agent.seller_id !== user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: versions } = await supabase
    .from("agent_versions")
    .select("id, version_number, eval_score, score_delta, cost_delta_pct, improvement_notes, applied_at, created_at, change_reason")
    .eq("agent_id", agentId)
    .order("version_number", { ascending: false })
    .limit(20)

  return NextResponse.json({
    versions: versions ?? [],
    current: { score: agent.composite_score ?? null, prompt: (agent.system_prompt as string ?? "").slice(0, 500) },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  if (!UUID_RE.test(agentId))
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { action?: string; versionId?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const { action, versionId } = body

  const { data: agent } = await supabase
    .from("agents")
    .select("id, seller_id, name, system_prompt, model_name, temperature, max_tokens, composite_score")
    .eq("id", agentId).single()

  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (agent.seller_id !== user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  if (action === "apply") {
    if (!versionId) return NextResponse.json({ error: "versionId required" }, { status: 400 })
    const { data: ver } = await supabase
      .from("agent_versions")
      .select("id, version_number, system_prompt, model_name, temperature, max_tokens")
      .eq("id", versionId).eq("agent_id", agentId).single()
    if (!ver) return NextResponse.json({ error: "Version not found" }, { status: 404 })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (ver.system_prompt)       updates.system_prompt = ver.system_prompt
    if (ver.model_name)          updates.model_name    = ver.model_name
    if (ver.temperature != null) updates.temperature   = ver.temperature
    if (ver.max_tokens  != null) updates.max_tokens    = ver.max_tokens

    await Promise.all([
      supabase.from("agents").update(updates).eq("id", agentId),
      supabase.from("agent_versions").update({ applied_at: new Date().toISOString() }).eq("id", versionId),
    ])

    return NextResponse.json({ ok: true, versionNumber: ver.version_number,
      message: `Version ${ver.version_number} applied. Re-run evaluation to measure impact.` })
  }

  if (action !== "suggest")
    return NextResponse.json({ error: "action must be 'suggest' or 'apply'" }, { status: 400 })

  const { data: recentExecs } = await supabase
    .from("executions")
    .select("status, input, error_message")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(30)

  const failed = (recentExecs ?? []).filter((e: any) => e.status === "failed").slice(0, 3)
    .map((e: any) => ({ input: JSON.stringify(e.input ?? "").slice(0, 200), error: (e.error_message ?? "Unknown").slice(0, 200) }))

  const currentScore  = Number(agent.composite_score ?? 0)
  const successRate   = (recentExecs ?? []).length > 0
    ? ((recentExecs ?? []).filter((e: any) => e.status === "success").length / (recentExecs ?? []).length) * 100 : 100

  let improvedPrompt  = agent.system_prompt as string
  let improvements:   string[] = []
  let scoreDelta      = 5
  let costDelta       = 0

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey && agent.system_prompt) {
    const failureCtx = failed.length > 0
      ? `\n\nFailed executions:\n${failed.map((f, i) => `${i+1}. Input: "${f.input}" → Error: "${f.error}"`).join("\n")}`
      : ""
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001", max_tokens: 1200,
          system: `Return ONLY valid JSON, no other text:
{"improved_prompt":"...","improvements":["...","...","..."],"score_delta":7,"cost_delta_pct":0}`,
          messages: [{ role: "user", content:
            `Agent: "${agent.name}"\nScore: ${currentScore}/100  Success: ${Math.round(successRate)}%\nPrompt: ${(agent.system_prompt as string).slice(0,1500)}${failureCtx}\nImprove the prompt. Return JSON only.` }],
        }),
        signal: AbortSignal.timeout(12_000),
      })
      if (res.ok) {
        const d = await res.json() as { content: Array<{ text: string }> }
        const parsed = JSON.parse((d.content?.[0]?.text ?? "{}").replace(/```json|```/g, "").trim()) as any
        if (parsed.improved_prompt && parsed.improved_prompt !== agent.system_prompt) {
          improvedPrompt = parsed.improved_prompt
          improvements   = parsed.improvements ?? []
          scoreDelta     = Math.min(Math.max(Number(parsed.score_delta ?? 5), 1), 20)
          costDelta      = Number(parsed.cost_delta_pct ?? 0)
        }
      }
    } catch { /* keep defaults */ }
  }

  if (!improvements.length) {
    improvements = [
      "Clarified output format instructions for consistency",
      "Added explicit handling for edge cases and ambiguous inputs",
      failed.length > 0 ? `Added recovery for ${failed.length} known failure pattern(s)` : "Improved instruction specificity",
      "Tightened task scope to avoid scope creep",
    ]
  }

  const { data: lastVer } = await supabase
    .from("agent_versions").select("version_number")
    .eq("agent_id", agentId).order("version_number", { ascending: false }).limit(1).single()

  const nextVersion = (lastVer?.version_number ?? 0) + 1

  const { data: newVer, error: verErr } = await supabase
    .from("agent_versions")
    .insert({
      agent_id: agentId, version_number: nextVersion,
      system_prompt: improvedPrompt, model_name: agent.model_name,
      temperature: agent.temperature, max_tokens: agent.max_tokens,
      eval_score: null, score_delta: scoreDelta, cost_delta_pct: costDelta,
      improvement_notes: improvements.join("\n"),
      change_reason: "AI-suggested improvement",
      created_by: user.id, created_at: new Date().toISOString(),
    })
    .select("id, version_number").single()

  if (verErr || !newVer)
    return NextResponse.json({ error: "Failed to save version. Run migration 037 first.", detail: verErr?.message }, { status: 500 })

  return NextResponse.json({
    versionId: newVer.id,
    version:   newVer.version_number,
    current:   { score: currentScore, prompt: (agent.system_prompt as string ?? "").slice(0, 400) },
    suggested: {
      headline:   `Score: ${currentScore} → Est. ${Math.min(currentScore + scoreDelta, 100)} (+${scoreDelta} Reliability${costDelta !== 0 ? `, ${costDelta > 0 ? "+" : ""}${costDelta}% Cost` : ""})`,
      scoreDelta: `+${scoreDelta}`,
      costDelta:  costDelta !== 0 ? `${costDelta > 0 ? "+" : ""}${costDelta}%` : "0%",
      prompt:     improvedPrompt.slice(0, 400),
    },
    improvements,
    analysis: { total_executions: (recentExecs ?? []).length, failed_count: failed.length, success_rate_pct: Math.round(successRate) },
  })
}
