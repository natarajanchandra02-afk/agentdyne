export const runtime = "edge"

/**
 * POST /api/swarm — Multi-agent swarm execution (v10)
 *
 * Modes:
 *   orchestrate — Planner decomposes → specialists execute → synthesiser merges
 *   debate      — Agents propose & critique across N rounds → consensus
 *   parallel    — All agents run independently → results merged
 *
 * Request body (JSON or FormData):
 *   task          string    required  — the task for the swarm
 *   agentIds      string[]  required  — 2–8 agent UUIDs
 *   mode          string    optional  — orchestrate|debate|parallel (default: orchestrate)
 *   maxRounds     number    optional  — 1–10 debate rounds (default: 3)
 *   name          string    optional  — session display name
 *   enableMemory  boolean   optional  — persist learnings to memory
 *   consensusType string    optional  — consensus method label
 *   files         File[]    optional  — attached files (FormData only)
 *
 * Response:
 *   { sessionId, status, mode, agentCount, finalAnswer, messageLog, rounds }
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient }             from "@/lib/supabase/server"
import { apiRateLimit }             from "@/lib/rate-limit"
import { routeCompletion }          from "@/lib/model-router"
import { checkInput }               from "@/lib/guardrails"
import { dispatchWebhooks }         from "@/lib/webhook-dispatcher"

const MAX_AGENTS = 8
const MAX_ROUNDS = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

async function parseBody(req: NextRequest): Promise<{
  task:          string
  agentIds:      string[]
  mode:          string
  maxRounds:     number
  name?:         string
  enableMemory:  boolean
  consensusType: string
  hasFiles:      boolean
  contextText?:  string
}> {
  const ct = req.headers.get("content-type") ?? ""
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData()
    const task         = (fd.get("task") as string | null)         ?? ""
    const agentIdsRaw  = (fd.get("agentIds") as string | null)     ?? "[]"
    const mode         = (fd.get("mode") as string | null)         ?? "orchestrate"
    const maxRounds    = parseInt((fd.get("maxRounds") as string)  ?? "3", 10)
    const name         = (fd.get("name") as string | null)         ?? undefined
    const enableMemory = (fd.get("enableMemory") as string)        === "true"
    const consensusType= (fd.get("consensusType") as string | null)?? "Majority Vote"
    const contextText  = (fd.get("context") as string | null)      ?? undefined
    let agentIds: string[] = []
    try { agentIds = JSON.parse(agentIdsRaw) } catch { agentIds = [] }
    return { task, agentIds, mode, maxRounds, name, enableMemory, consensusType, hasFiles: true, contextText }
  }
  const body = await req.json().catch(() => ({}))
  return {
    task:          body.task          ?? "",
    agentIds:      body.agentIds      ?? [],
    mode:          body.mode          ?? "orchestrate",
    maxRounds:     body.maxRounds     ?? 3,
    name:          body.name,
    enableMemory:  body.enableMemory  ?? false,
    consensusType: body.consensusType ?? "Majority Vote",
    hasFiles:      false,
    contextText:   body.contextText,
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Rate limit
  const limited = await apiRateLimit(req)
  if (limited) return limited

  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Plan gate
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_plan, is_banned")
    .eq("id", user.id)
    .single()

  if (profile?.is_banned)
    return NextResponse.json({ error: "Account suspended" }, { status: 403 })

  const plan = profile?.subscription_plan ?? "free"
  if (plan === "free")
    return NextResponse.json({
      error: "Multi-agent swarm requires Starter plan or above",
      code:  "PLAN_REQUIRED",
    }, { status: 402 })

  // Parse body
  const {
    task, agentIds, mode, maxRounds: rawRounds,
    name, enableMemory, consensusType, hasFiles, contextText,
  } = await parseBody(req)

  // Validate
  if (!task || task.trim().length < 5)
    return NextResponse.json({ error: "task is required (min 5 chars)" }, { status: 400 })
  if (!Array.isArray(agentIds) || agentIds.length < 2 || agentIds.length > MAX_AGENTS)
    return NextResponse.json({ error: `agentIds must be 2–${MAX_AGENTS} agents` }, { status: 400 })
  if (!["orchestrate", "debate", "parallel"].includes(mode))
    return NextResponse.json({ error: "mode must be orchestrate|debate|parallel" }, { status: 400 })

  // Content policy
  const guardrail = checkInput(task)
  if (!guardrail.allowed)
    return NextResponse.json({ error: "Task rejected by content policy" }, { status: 400 })

  // Load agents (must belong to this user)
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, system_prompt, model_name, max_tokens, temperature, status, seller_id")
    .in("id", agentIds)

  const activeAgents = (agents ?? []).filter(
    (a: any) => a.status === "active" && a.seller_id === user.id
  )
  if (activeAgents.length < 2)
    return NextResponse.json({ error: "Need at least 2 active agents that belong to you" }, { status: 400 })

  const rounds  = Math.min(Math.max(1, rawRounds), MAX_ROUNDS)
  const fullTask = contextText?.trim()
    ? `${task.trim()}\n\n---\nAdditional context:\n${contextText.trim()}`
    : task.trim()

  // Create session in DB
  const startedAt = new Date().toISOString()
  const { data: session, error: sessionErr } = await supabase
    .from("multi_agent_sessions")
    .insert({
      owner_id:       user.id,
      name:           name ?? `Swarm: ${task.slice(0, 40)}`,
      swarm_name:     name ?? `Swarm: ${task.slice(0, 40)}`,
      status:         "active",
      agent_ids:      activeAgents.map((a: any) => a.id),
      shared_context: { task: fullTask, mode, started_at: startedAt },
      message_log:    [],
      remember_learnings: enableMemory,
      consensus_method:   consensusType,
      files_attached:     hasFiles,
      context_text:       contextText ?? null,
    })
    .select("id")
    .single()

  if (sessionErr || !session)
    return NextResponse.json({ error: "Failed to create swarm session" }, { status: 500 })

  const messageLog: any[] = []
  let   finalAnswer  = ""
  const executionStart = Date.now()

  try {
    // ──────────────────────────────────────────────────────
    // ORCHESTRATE: Planner → Specialists → Synthesiser
    // ──────────────────────────────────────────────────────
    if (mode === "orchestrate") {
      const orchestrator = activeAgents[0] as any
      const specialists  = activeAgents.slice(1) as any[]

      // Step 1: Orchestrator plans sub-tasks
      const planPrompt =
        `You are an orchestrator coordinating a multi-agent team.\n` +
        `Task: ${fullTask}\n` +
        `Specialists available:\n` +
        specialists.map((s: any, i: number) =>
          `  Agent ${i+1}: ${s.name} — ${(s.system_prompt as string ?? "").slice(0, 120)}`
        ).join("\n") +
        `\n\nBreak the task into ${specialists.length} distinct subtasks, one per specialist.\n` +
        `Respond ONLY with valid JSON:\n{"subtasks":[{"agent_index":1,"subtask":"..."}]}`

      const planResult = await routeCompletion({
        model:       orchestrator.model_name || "claude-sonnet-4-6",
        system:      orchestrator.system_prompt || "You are a helpful orchestrator.",
        userMessage: planPrompt,
        maxTokens:   1024,
        temperature: 0.3,
      })

      let subtasks: Array<{ agent_index: number; subtask: string }> = []
      try {
        const clean = planResult.text.replace(/```json|```/g, "").trim()
        subtasks = JSON.parse(clean).subtasks ?? []
      } catch {
        // Fallback: give each specialist the full task
        subtasks = specialists.map((_: any, i: number) => ({
          agent_index: i + 1, subtask: fullTask,
        }))
      }

      messageLog.push({
        from:      "orchestrator",
        content:   { type: "plan", subtasks },
        timestamp: new Date().toISOString(),
      })

      // Step 2: Specialists run their sub-tasks in parallel
      const specialistResults = await Promise.all(
        subtasks.slice(0, specialists.length).map(async ({ agent_index, subtask }) => {
          const agent  = specialists[(agent_index - 1) % specialists.length] as any
          const result = await routeCompletion({
            model:       agent.model_name || "claude-sonnet-4-6",
            system:      agent.system_prompt || "You are a helpful specialist.",
            userMessage: `Your assigned sub-task: ${subtask}\n\nOverall goal: ${fullTask}`,
            maxTokens:   Math.min(agent.max_tokens || 2048, 4096),
            temperature: agent.temperature ?? 0.7,
          })
          return { agent_name: agent.name, agent_id: agent.id, subtask, result: result.text }
        })
      )

      messageLog.push({
        from:      "specialists",
        content:   { type: "results", results: specialistResults },
        timestamp: new Date().toISOString(),
      })

      // Step 3: Orchestrator synthesises
      const synthPrompt =
        `You orchestrated a multi-agent team. Here are the specialist results:\n\n` +
        specialistResults.map(r => `**${r.agent_name}**:\n${r.result.slice(0, 600)}`).join("\n\n---\n\n") +
        `\n\nOriginal task: ${fullTask}\n\n` +
        `Synthesise these results into a single coherent, well-structured final answer.`

      const synthResult = await routeCompletion({
        model:       orchestrator.model_name || "claude-sonnet-4-6",
        system:      orchestrator.system_prompt || "You are a helpful synthesiser.",
        userMessage: synthPrompt,
        maxTokens:   2048,
        temperature: 0.5,
      })

      finalAnswer = synthResult.text
      messageLog.push({
        from:      "orchestrator",
        content:   { type: "synthesis", answer: finalAnswer },
        timestamp: new Date().toISOString(),
      })

    // ──────────────────────────────────────────────────────
    // DEBATE: Propose → Critique × N rounds → Final
    // ──────────────────────────────────────────────────────
    } else if (mode === "debate") {
      let currentProposal = fullTask

      for (let round = 0; round < rounds; round++) {
        const isFirst     = round === 0
        const roundOutputs = await Promise.all(
          activeAgents.map(async (agent: any, i: number) => {
            const prompt = isFirst
              ? `Task: ${fullTask}\n\nProvide your best solution or analysis. Be specific and thorough.`
              : `Current best proposal:\n${currentProposal}\n\n` +
                `Task: ${fullTask}\n\n` +
                `Critique this proposal and provide an improved version from your perspective.`

            const result = await routeCompletion({
              model:       agent.model_name || "claude-sonnet-4-6",
              system:      agent.system_prompt || "You are a debate participant seeking the best answer.",
              userMessage: prompt,
              maxTokens:   1024,
              temperature: 0.8,
            })
            return { agent_name: agent.name, agent_id: agent.id, output: result.text, round }
          })
        )

        currentProposal = roundOutputs
          .map(r => `**${r.agent_name}**:\n${r.output}`)
          .join("\n\n---\n\n")

        messageLog.push({
          type:      "debate_round",
          round:     round + 1,
          outputs:   roundOutputs,
          timestamp: new Date().toISOString(),
        })
      }
      finalAnswer = currentProposal

    // ──────────────────────────────────────────────────────
    // PARALLEL: All agents independently → merge
    // ──────────────────────────────────────────────────────
    } else {
      const parallelResults = await Promise.all(
        activeAgents.map(async (agent: any) => {
          const result = await routeCompletion({
            model:       agent.model_name || "claude-sonnet-4-6",
            system:      agent.system_prompt || "You are a helpful assistant.",
            userMessage: fullTask,
            maxTokens:   Math.min(agent.max_tokens || 2048, 4096),
            temperature: agent.temperature ?? 0.7,
          })
          return { agent_name: agent.name, agent_id: agent.id, output: result.text }
        })
      )

      finalAnswer = parallelResults
        .map(r => `**${r.agent_name}**:\n${r.output}`)
        .join("\n\n---\n\n")

      messageLog.push({
        type:      "parallel_results",
        results:   parallelResults,
        timestamp: new Date().toISOString(),
      })
    }

    const runtimeSec = (Date.now() - executionStart) / 1000

    // Save completed session
    await supabase
      .from("multi_agent_sessions")
      .update({
        status:         "completed",
        shared_context: { task: fullTask, mode, final_answer: finalAnswer, completed_at: new Date().toISOString() },
        message_log:    messageLog,
        runtime_sec:    runtimeSec,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", session.id)

    // Background: record metrics + webhooks
    Promise.allSettled([
      supabase.rpc("record_swarm_run", {
        p_session_id:        session.id,
        p_mode:              mode,
        p_agent_count:       activeAgents.length,
        p_success:           true,
        p_runtime_sec:       runtimeSec,
        p_debate_rounds:     mode === "debate" ? rounds : null,
        p_consensus_reached: mode === "debate" ? true : null,
      }),
      dispatchWebhooks(supabase, user.id, "execution.success", {
        sessionId:  session.id,
        mode,
        agentCount: activeAgents.length,
        type:       "swarm",
        status:     "completed",
      }),
    ]).catch(() => {})

    return NextResponse.json({
      sessionId:   session.id,
      status:      "completed",
      mode,
      agentCount:  activeAgents.length,
      finalAnswer,
      messageLog,
      rounds:      messageLog.length,
      runtimeSec,
    })

  } catch (err: any) {
    // Mark session failed
    await supabase
      .from("multi_agent_sessions")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", session.id)

    return NextResponse.json(
      { error: err.message ?? "Swarm execution failed" },
      { status: 500 }
    )
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data } = await supabase
    .from("multi_agent_sessions")
    .select("id, name, swarm_name, status, agent_ids, shared_context, runtime_sec, total_cost_usd, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)

  // Format sessions for UI
  const sessions = (data ?? []).map((s: any) => ({
    id:     s.id,
    name:   s.swarm_name ?? s.name ?? "Unnamed swarm",
    status: s.status,
    mode:   s.shared_context?.mode ?? "orchestrate",
    date:   new Date(s.created_at).toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    agentCount: Array.isArray(s.agent_ids) ? s.agent_ids.length : 0,
    created_at: s.created_at,
  }))

  return NextResponse.json({ sessions })
}
