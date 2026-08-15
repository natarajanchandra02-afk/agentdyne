/**
 * AgentDyne — MCP Server-Hosting Protocol Helpers
 *
 * AgentDyne is already an MCP *client* (lib/mcp-servers.ts, lib/mcp-tool-executor.ts
 * let AgentDyne agents call 40+ external MCP servers as tools). This file is the
 * other direction: it lets AgentDyne act as an MCP *server*, so external MCP
 * clients (Claude, ChatGPT, another company's agent runtime) can call an
 * AgentDyne-hosted agent as a tool.
 *
 * Transport: Streamable HTTP (JSON-RPC 2.0 over a single POST endpoint),
 * per the MCP spec's HTTP transport. Protocol version pinned to the
 * 2026-07-28 spec generation current as of this build.
 *
 * SECURITY MODEL:
 *   - `initialize` and `tools/list` are readable without an API key, but
 *     only ever return agents that are BOTH status='active' AND explicitly
 *     mcp_enabled=true (owner opt-in — see migration 039). No agent is ever
 *     listed by default.
 *   - `tools/call` always requires a valid AgentDyne API key with the
 *     "execute" permission, scoped exactly like every other execute path
 *     (lib/api-key-auth.ts). It internally calls the existing, hardened
 *     /api/agents/[id]/execute route — guardrails, injection filtering,
 *     credit reservation, quota/rate-limit enforcement, and WAL logging
 *     all apply unchanged. Nothing about billing or safety is duplicated
 *     or bypassed here; this file only translates protocol shapes.
 *
 * Edge-runtime safe: no Node.js APIs.
 */

export const MCP_PROTOCOL_VERSION = "2026-07-28"

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AgentForMcp {
  id: string
  name: string
  description: string | null
  category: string | null
  input_schema?: Record<string, unknown> | null
}

/** MCP tool names are namespaced so callers can tell these apart from other servers' tools. */
export function agentToolName(agent: { id: string }): string {
  return `agentdyne_agent_${agent.id.replace(/-/g, "").slice(0, 24)}`
}

export function parseAgentIdFromToolName(toolName: string, agentIds: string[]): string | null {
  // Look up by matching the sanitized prefix rather than trying to invert the
  // truncation — safer against collisions and cheap since the caller already
  // has the full candidate list (their own allowed/enabled agents).
  return agentIds.find(id => agentToolName({ id }) === toolName) ?? null
}

/**
 * buildToolsList
 * Converts AgentDyne agents into MCP `tools/list` entries. Falls back to a
 * generic free-text `input` schema when an agent has no declared input_schema
 * — matches how /api/agents/[id]/execute already accepts either a string or
 * a JSON object as `input`.
 */
export function buildToolsList(agents: AgentForMcp[]): McpToolDefinition[] {
  return agents.map(agent => ({
    name: agentToolName(agent),
    description: (agent.description ?? `AgentDyne agent: ${agent.name}`).slice(0, 500),
    inputSchema: agent.input_schema && Object.keys(agent.input_schema).length > 0
      ? agent.input_schema
      : {
          type: "object",
          properties: {
            input: { type: "string", description: "Input to send to the agent." },
          },
          required: ["input"],
        },
  }))
}

// ── JSON-RPC envelope helpers ───────────────────────────────────────────────

export function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result }
}

export function rpcError(id: string | number | null | undefined, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

// Standard JSON-RPC error codes used across this endpoint
export const RPC_PARSE_ERROR      = -32700
export const RPC_INVALID_REQUEST  = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS   = -32602
export const RPC_INTERNAL_ERROR   = -32603
// MCP/application-level (outside the reserved -32768..-32000 JSON-RPC range)
export const MCP_AUTH_REQUIRED    = -32001
export const MCP_TOOL_NOT_FOUND   = -32002
export const MCP_RATE_LIMITED     = -32003

const MAX_PARAMS_BYTES = 32_000

/** Defensive size check before any params are touched — first line against abuse. */
export function paramsWithinLimit(params: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(params ?? {})).length <= MAX_PARAMS_BYTES
  } catch {
    return false
  }
}
