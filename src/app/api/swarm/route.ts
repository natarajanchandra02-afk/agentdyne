export const runtime = "edge"

/**
 * POST /api/swarm — Create a multi-agent swarm session (Gap 4)
 *
 * Enables true peer-to-peer agent communication via shared context workspace.
 * Implements Google A2A-compatible message passing pattern.
 *
 * Flow:
 *   1. Orchestrator receives task
 *   2. Routes sub-tasks to specialist agents
 *   3. Agents collaborate via shared_context
 *   4. Results aggregated back to orchestrator
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion } from "@/lib/model-router"
import { checkInput } from "@/lib/guardrails"
import { dispatchWebhooks } from "@/lib/webhook-dispatcher"

const MAX_SWARM_AGENTS = 8
const MAX_ROUNDS = 5

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase
    .from("profiles").select("subscription_plan, is_banned").eq("id", user.id).single()
  if (profile?.is_banned) return NextResponse.json({ error: "Account suspended" }, { status: 403 })

  const plan = profile?.subscription_plan ?? "free"
  if (plan === "free") return NextResponse.json({
    error: "Multi-agent swarm requires Starter plan or above", code: "PLAN_REQUIRED"
  }, { status: 402 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const { task, agentIds, name, maxRounds = 3, mode = "orchestrate" } = body as {
    task?: string; agentIds?: string[]; name?: string
    maxRounds?: number; mode?: "orchestrate" | "debate" | "parallel"
  }

  if (!task || typeof task !== "string" || task.trim().length < 5)
    return NextResponse.json({ error: "task is required (min 5 chars)" }, { status: 400 })
  if (!Array.isArray(agentIds) || agentIds.length < 2 || agentIds.length > MAX_SWARM_AGENTS)
    return NextResponse.json({ error: `agentIds must be 2–${MAX_SWARM_AGENTS} agents` }, { status: 400 })

  const guardrail = checkInput(task)
  if (!guardrail.allowed) return NextResponse.json({ error: "Task rejected by content policy" }, { status: 400 })

  // Load all agents
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, system_prompt, model_name, max_tokens, temperature, status")
    .in("id", agentIds)

  const activeAgents = (agents ?? []).filter((a: any) => a.status === "active")
  if (activeAgents.length < 2)
    return NextResponse.json({ error: "Need at least 2 active agents" }, { status: 400 })

  // Create swarm session
  const { data: session } = await supabase
    .from("multi_agent_sessions")
    .insert({
      owner_id: user.id,
      name: name ?? `Swarm: ${task.slice(0, 40)}`,
      status: "active",
      agent_ids: activeAgents.map((a: any) => a.id),
      shared_context: { task, mode, started_at: new Date().toISOString() },
      message_log: [],
    })
    .select("id").single()

  if (!session) return NextResponse.json({ error: "Failed to create swarm session" }, { status: 500 })

  const rounds = Math.min(maxRounds, MAX_ROUNDS)
  const messageLog: any[] = []
  const sharedContext: Record<string, unknown> = { task, round_outputs: {} }
  let finalAnswer = ""

  try {
    if (mode === "orchestrate") {
      // Agent 0 is orchestrator — breaks task into sub-tasks for others
      const orchestrator = activeAgents[0] as any
      const specialists  = activeAgents.slice(1) as any[]

      // Step 1: Orchestrator plans
      const planPrompt = `You are an orchestrator. Break this task into ${specialists.length} subtasks, one per specialist.
Task: ${task}
Specialists: ${specialists.map((s: any, i: number) => `Agent ${i+1}: ${s.name} (${(s.system_prompt as string ?? "").slice(0, 100)})`).join("\n")}

Respond with JSON only:
{"subtasks": [{"agent_index": 1, "subtask": "..."}]}`

      const planResult = await routeCompletion({
        model: orchestrator.model_name || "claude-sonnet-4-6",
        system: orchestrator.system_prompt as string || "You are a helpful orchestrator.",
        userMessage: planPrompt,
        maxTokens: 1024, temperature: 0.3,
      })

      let subtasks: Array<{ agent_index: number; subtask: string }> = []
      try {
        const cleaned = planResult.text.replace(/```json|```/g, "").trim()
        subtasks = JSON.parse(cleaned).subtasks ?? []
      } catch {
        subtasks = specialists.map((_: any, i: number) => ({ agent_index: i + 1, subtask: task }))
      }

      messageLog.push({ from: "orchestrator", content: { type: "plan", subtasks }, timestamp: new Date().toISOString() })

      // Step 2: Specialists execute sub-tasks
      const specialistResults = await Promise.all(
        subtasks.slice(0, specialists.length).map(async ({ agent_index, subtask }) => {
          const agent = specialists[(agent_index - 1) % specialists.length] as any
          const result = await routeCompletion({
            model: agent.model_name || "claude-sonnet-4-6",
            system: agent.system_prompt as string || "You are a helpful specialist.",
            userMessage: `Your specific task: ${subtask}\n\nOverall goal: ${task}`,
            maxTokens: Math.min(agent.max_tokens || 2048, 4096),
            temperature: agent.temperature ?? 0.7,
          })
          return { agent_name: agent.name, agent_id: agent.id, subtask, result: result.text }
        })
      )

      messageLog.push({ from: "specialists", content: { type: "results", results: specialistResults }, timestamp: new Date().toISOString() })

      // Step 3: Orchestrator synthesizes
      const synthPrompt = `You orchestrated a multi-agent task. Here are the specialist results:
${specialistResults.map(r => `**${r.agent_name}**: ${r.result.slice(0, 500)}`).join("\n\n")}

Original task: ${task}

Synthesize these into a single coherent final answer.`

      const synthResult = await routeCompletion({
        model: orchestrator.model_name || "claude-sonnet-4-6",
        system: orchestrator.system_prompt as string || "You are a helpful synthesizer.",
        userMessage: synthPrompt,
        maxTokens: 2048, temperature: 0.5,
      })

      finalAnswer = synthResult.text
      messageLog.push({ from: "orchestrator", content: { type: "synthesis", answer: finalAnswer }, timestamp: new Date().toISOString() })

    } else if (mode === "debate") {
      // Agents debate: each proposes, then critiques, orchestrator decides
      let currentProposal = task

      for (let round = 0; round < rounds; round++) {
        const roundOutputs = await Promise.all(
          activeAgents.map(async (agent: any, i: number) => {
            const isFirst = round === 0
            const prompt = isFirst
              ? `Task: ${task}\nProvide your best solution or analysis.`
              : `Current proposal: ${currentProposal}\nCritique and improve it from your perspective.`

            const result = await routeCompletion({
              model: agent.model_name || "claude-sonnet-4-6",
              system: agent.system_prompt as string || "You are a debate participant.",
              userMessage: prompt,
              maxTokens: 1024, temperature: 0.8,
            })
            return { agent_name: agent.name, output: result.text, round }
          })
        )
        currentProposal = roundOutputs.map(r => `${r.agent_name}: ${r.output}`).join("\n\n---\n\n")
        messageLog.push({ type: "debate_round", round: round + 1, outputs: roundOutputs, timestamp: new Date().toISOString() })
      }
      finalAnswer = currentProposal

    } else {
      // Parallel: all agents work independently, results merged
      const parallelResults = await Promise.all(
        activeAgents.map(async (agent: any) => {
          const result = await routeCompletion({
            model: agent.model_name || "claude-sonnet-4-6",
            system: agent.system_prompt as string || "You are a helpful assistant.",
            userMessage: task,
            maxTokens: Math.min((agent.max_tokens as number) || 2048, 4096),
            temperature: agent.temperature ?? 0.7,
          })
          return { agent_name: agent.name, output: result.text }
        })
      )
      finalAnswer = parallelResults.map(r => `**${r.agent_name}**:\n${r.output}`).join("\n\n---\n\n")
      messageLog.push({ type: "parallel_results", results: parallelResults, timestamp: new Date().toISOString() })
    }

    // Update session with results
    await supabase.from("multi_agent_sessions").update({
      status: "completed",
      shared_context: { ...sharedContext, final_answer: finalAnswer },
      message_log: messageLog,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id)

    // Background: webhook dispatch
    dispatchWebhooks(supabase, user.id, "execution.success", {
      sessionId: session.id, mode, agentCount: activeAgents.length,
      type: "swarm", status: "completed",
    }).catch(() => {})

    return NextResponse.json({
      sessionId: session.id,
      status: "completed",
      mode,
      agentCount: activeAgents.length,
      finalAnswer,
      messageLog,
      rounds: messageLog.length,
    })

  } catch (err: any) {
    await supabase.from("multi_agent_sessions").update({
      status: "failed", updated_at: new Date().toISOString()
    }).eq("id", session.id)
    return NextResponse.json({ error: err.message ?? "Swarm execution failed" }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data } = await supabase
    .from("multi_agent_sessions")
    .select("id, name, status, agent_ids, shared_context, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)

  return NextResponse.json({ sessions: data ?? [] })
}
