/**
 * AgentDyne — A2A (Agent-to-Agent) Protocol Helpers
 *
 * Implements the discovery + task-lifecycle subset of the A2A protocol
 * (Linux Foundation, v1.0, April 2026) needed for an AgentDyne agent to be
 * discoverable and hireable by an external A2A-compliant orchestrator
 * (LangGraph, CrewAI, another company's agent, etc.) — not just callable
 * via AgentDyne's own REST API.
 *
 * Scope of this v1 subset (documented honestly, same convention as
 * lib/thoughtgate.ts's route comments):
 *   - Agent Card publishing            ✅ (this file + /api/a2a/[id]/card)
 *   - Task lifecycle (submitted →      ✅ synchronous only — AgentDyne's
 *     working → completed/failed)         execute path is fast enough that
 *                                          tasks resolve inline; the state
 *                                          machine is still fully modelled
 *                                          in a2a_tasks for spec-compliant
 *                                          polling/GET.
 *   - input-required (multi-turn HITL) ❌ not yet — AgentDyne agents are
 *                                          single-turn today. Revisit once
 *                                          the human-approval node type
 *                                          (canvas builder roadmap) ships.
 *   - Push notifications / SSE streaming ❌ not yet — poll via GET for now.
 *   - Signed Agent Cards (crypto proof) ❌ not yet — tracked, not urgent
 *                                          per the Aug 2026 gap analysis.
 *
 * SECURITY MODEL:
 *   - GET /api/a2a/{id}/card is public (by design — A2A Agent Cards are
 *     meant to be discoverable) but only ever renders for agents that are
 *     BOTH status='active' AND a2a_enabled=true (owner opt-in).
 *   - POST /api/a2a/{id}/tasks (create a task) requires a valid AgentDyne
 *     API key via the card's declared securitySchemes, and internally
 *     calls the existing hardened /api/agents/[id]/execute route — same
 *     guardrails/billing/quota logic as every other execute path.
 *
 * Edge-runtime safe: no Node.js APIs.
 */

export const A2A_PROTOCOL_VERSION = "1.0"

export interface A2AAgentCard {
  protocolVersion: string
  name: string
  description: string
  url: string
  provider: { organization: string; url: string }
  version: string
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  securitySchemes: Record<string, { type: string; scheme?: string; in?: string; name?: string; description: string }>
  security: Array<Record<string, string[]>>
  skills: Array<{
    id: string
    name: string
    description: string
    tags: string[]
    examples?: string[]
  }>
}

export interface AgentForCard {
  id: string
  name: string
  description: string | null
  category: string | null
  protocol_metadata?: { skills?: Array<{ id?: string; name?: string; description?: string; tags?: string[]; examples?: string[] }> } | null
}

/**
 * buildAgentCard
 * baseUrl should be the deployed origin (e.g. https://agentdyne.com), passed
 * in from the request rather than hardcoded, so this works correctly across
 * preview/staging/production deployments without an env-var dependency here.
 */
export function buildAgentCard(agent: AgentForCard, baseUrl: string): A2AAgentCard {
  const customSkills = agent.protocol_metadata?.skills
  const skills = customSkills && customSkills.length > 0
    ? customSkills.map((s, i) => ({
        id: s.id ?? `${agent.id}-skill-${i}`,
        name: s.name ?? agent.name,
        description: (s.description ?? agent.description ?? "").slice(0, 500),
        tags: s.tags ?? (agent.category ? [agent.category] : []),
        examples: s.examples,
      }))
    : [{
        id: `${agent.id}-default`,
        name: agent.name,
        description: (agent.description ?? `AgentDyne agent: ${agent.name}`).slice(0, 500),
        tags: agent.category ? [agent.category] : [],
      }]

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: agent.name,
    description: agent.description ?? `AgentDyne agent: ${agent.name}`,
    url: `${baseUrl}/api/a2a/${agent.id}/tasks`,
    provider: { organization: "AgentDyne", url: baseUrl },
    version: "1.0.0",
    capabilities: {
      streaming: false,               // v1 subset — see file header
      pushNotifications: false,
      stateTransitionHistory: true,   // a2a_tasks row IS the history
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    securitySchemes: {
      agentdyneApiKey: {
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description: "Bearer <AgentDyne API key with the 'execute' permission, scoped to this agent>",
      },
    },
    security: [{ agentdyneApiKey: [] }],
    skills,
  }
}

export type A2ATaskState = "submitted" | "working" | "input-required" | "completed" | "canceled" | "failed"

export interface A2ATaskResponse {
  id: string
  contextId: string
  status: { state: A2ATaskState; timestamp: string; message?: unknown }
  artifacts?: Array<{ artifactId: string; name: string; parts: Array<{ type: "text"; text: string } | { type: "data"; data: unknown }> }>
}

/** Shapes a completed/failed a2a_tasks row into the A2A wire format. */
export function taskRowToResponse(row: {
  id: string; context_id: string; state: A2ATaskState
  output: unknown; error_message: string | null; updated_at: string
}): A2ATaskResponse {
  const base: A2ATaskResponse = {
    id: row.id,
    contextId: row.context_id,
    status: { state: row.state, timestamp: row.updated_at },
  }
  if (row.state === "completed" && row.output !== null && row.output !== undefined) {
    const outputText = typeof row.output === "string" ? row.output : JSON.stringify(row.output)
    base.artifacts = [{
      artifactId: `${row.id}-output`,
      name: "result",
      parts: typeof row.output === "string"
        ? [{ type: "text", text: outputText }]
        : [{ type: "data", data: row.output }],
    }]
  }
  if (row.state === "failed" && row.error_message) {
    base.status.message = { role: "agent", parts: [{ type: "text", text: row.error_message }] }
  }
  return base
}

/** Extracts a plain-text/JSON input from an A2A `message.parts[]` payload, falling back to raw body. */
export function extractInputFromA2AMessage(body: unknown): unknown {
  if (body && typeof body === "object" && "message" in (body as any)) {
    const parts = (body as any).message?.parts
    if (Array.isArray(parts)) {
      const textPart = parts.find((p: any) => p?.type === "text" && typeof p.text === "string")
      if (textPart) return textPart.text
      const dataPart = parts.find((p: any) => p?.type === "data")
      if (dataPart) return dataPart.data
    }
  }
  // Fallback: accept a plain { input } body too, so simple callers don't
  // need to construct a full A2A message envelope.
  if (body && typeof body === "object" && "input" in (body as any)) return (body as any).input
  return body
}
