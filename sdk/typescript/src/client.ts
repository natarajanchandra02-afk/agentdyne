/**
 * @file client.ts — AgentDyne TypeScript SDK v2.0.0
 *
 * @example
 * import AgentDyne from "@agentdyne/sdk"
 *
 * const client = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! })
 *
 * // Execute
 * const result = await client.execute("agent-id", "Summarise this email...")
 * console.log(result.output, result.cost)
 *
 * // Stream (token-by-token)
 * for await (const chunk of client.stream("agent-id", "Write a blog post")) {
 *   if (chunk.type === "token") process.stdout.write(chunk.delta ?? "")
 * }
 *
 * // Multi-agent swarm
 * const session = await client.swarm({
 *   task: "Research AI agent platforms and write a competitive analysis",
 *   agentIds: ["agent-a", "agent-b", "agent-c"],
 *   mode: "orchestrate",
 * })
 * console.log(session.finalAnswer)
 */

import { HttpClient } from "./http.js"
import { AgentsResource } from "./agents.js"
import {
  ExecutionsResource,
  NotificationsResource,
  UserResource,
  WebhooksResource,
} from "./resources.js"
import type {
  AgentDyneConfig,
  ExecuteRequest,
  ExecuteResponse,
  StreamChunk,
  SwarmRequest,
  SwarmSession,
  PipelineExecuteRequest,
  PipelineExecuteResponse,
  PipelineProgressChunk,
  BrowserExecuteRequest,
  BrowserExecuteResponse,
} from "./types.js"

export class AgentDyne {
  /** Browse, execute, stream, and review agents */
  readonly agents:        AgentsResource
  /** Execution history and polling */
  readonly executions:    ExecutionsResource
  /** User profile and quota */
  readonly user:          UserResource
  /** In-platform notifications */
  readonly notifications: NotificationsResource
  /** Webhook signature verification */
  readonly webhooks:      WebhooksResource

  private readonly _http: HttpClient

  constructor(config: AgentDyneConfig) {
    if (!config.apiKey) {
      throw new Error(
        "[AgentDyne SDK] apiKey is required. " +
        "Get yours at https://agentdyne.com/api-keys"
      )
    }
    this._http         = new HttpClient(config)
    this.agents        = new AgentsResource(this._http)
    this.executions    = new ExecutionsResource(this._http)
    this.user          = new UserResource(this._http)
    this.notifications = new NotificationsResource(this._http)
    this.webhooks      = new WebhooksResource()
  }

  // ── Top-level shorthands ───────────────────────────────────────────────────

  /**
   * Execute an agent and return the full response.
   *
   * @example
   * const result = await client.execute("agent-id", "What is 2+2?")
   * console.log(result.output)          // "4"
   * console.log(result.cost)            // 0.000021
   * console.log(result.latencyMs)       // 840
   * console.log(result.correctionAttempts) // 0
   */
  execute(agentId: string, request: ExecuteRequest | string): Promise<ExecuteResponse> {
    const req: ExecuteRequest = typeof request === "string" ? { input: request } : request
    return this.agents.execute(agentId, req)
  }

  /**
   * Stream an agent's output token-by-token via SSE.
   *
   * With self-correction: if the agent's confidence drops below threshold,
   * the SDK automatically re-prompts and streams the corrected output.
   *
   * @example
   * for await (const chunk of client.stream("agent-id", "Write a haiku")) {
   *   if (chunk.type === "token")      process.stdout.write(chunk.delta ?? "")
   *   if (chunk.type === "correction") console.warn("Self-correcting:", chunk.metadata)
   *   if (chunk.type === "done")       console.log("Cost:", chunk.metadata?.cost)
   * }
   */
  stream(agentId: string, request: ExecuteRequest | string): AsyncGenerator<StreamChunk, void, unknown> {
    const req: ExecuteRequest = typeof request === "string" ? { input: request } : request
    return this.agents.stream(agentId, req)
  }

  /**
   * Launch a multi-agent swarm session.
   *
   * Modes:
   *   - `orchestrate` (default): Agent[0] decomposes task, specialists execute, Agent[0] synthesises
   *   - `debate`:    Agents iterate over each other's proposals
   *   - `parallel`:  All agents work independently, results merged
   *
   * Requires Starter plan or above.
   *
   * @example
   * const session = await client.swarm({
   *   task: "Research the top 5 AI agent frameworks and compare them",
   *   agentIds: ["researcher-id", "writer-id", "critic-id"],
   *   mode: "orchestrate",
   * })
   * console.log(session.finalAnswer)
   * console.log(session.messageLog)
   */
  async swarm(request: SwarmRequest): Promise<SwarmSession> {
    return this._http.post("/api/swarm", request) as Promise<SwarmSession>
  }

  /**
   * Execute a pipeline by ID.
   *
   * Pipelines run in parallel where the DAG allows it.
   * Returns per-node results, cost, and latency breakdown.
   *
   * @example
   * const result = await client.runPipeline("pipeline-id", { input: "Analyse this..." })
   * console.log(result.output)
   * console.log(result.summary)
   */
  async runPipeline(
    pipelineId: string,
    request:    PipelineExecuteRequest,
  ): Promise<PipelineExecuteResponse> {
    return this._http.post(
      `/api/pipelines/${pipelineId}/execute`,
      request,
    ) as Promise<PipelineExecuteResponse>
  }

  /**
   * Execute a pipeline with LIVE per-node progress, instead of blocking
   * until the entire multi-node run finishes.
   *
   * Under the hood: fires the same execute call as runPipeline() without
   * blocking on it, then polls the pipeline's execution record (on a
   * separate connection) to discover the execution id and stream real
   * per-node status as it lands — the exact mechanism powering live
   * progress in the AgentDyne dashboard itself (Compose, Pipeline Studio).
   * No SSE, no websockets — plain polling, which works identically in any
   * JS runtime this SDK supports (Node, Workers, Deno, Bun, browsers).
   *
   * @example
   * for await (const chunk of client.streamPipeline("pipeline-id", { input: "..." })) {
   *   if (chunk.type === "step") {
   *     for (const s of chunk.steps) console.log(s.nodeId, s.status)
   *   }
   *   if (chunk.type === "done") console.log("Final output:", chunk.final?.output)
   * }
   */
  async *streamPipeline(
    pipelineId: string,
    request:    PipelineExecuteRequest,
    options:    { intervalMs?: number; timeoutMs?: number } = {},
  ): AsyncGenerator<PipelineProgressChunk, void, unknown> {
    const { intervalMs = 700, timeoutMs = 300_000 } = options
    const runStartedAt = new Date().toISOString()

    // Fire the real execute call — do NOT await it yet, so polling can run
    // concurrently while this long-running request is still in flight.
    const execPromise = this._http.post(
      `/api/pipelines/${pipelineId}/execute`,
      request,
    ) as Promise<PipelineExecuteResponse>

    let settled = false
    execPromise.then(() => { settled = true }).catch(() => { settled = true })

    let executionId: string | null = null
    const deadline = Date.now() + timeoutMs

    while (!settled && Date.now() < deadline) {
      try {
        if (!executionId) {
          const discover = await this._http.get<{ executionId: string | null; status: string | null }>(
            `/api/pipelines/${pipelineId}/executions/latest`,
            { createdAfter: runStartedAt },
          )
          if (discover.executionId) executionId = discover.executionId
        } else {
          const poll = await this._http.get<{
            executionId: string; status: string; isDone: boolean
            steps: PipelineProgressChunk["steps"]
            final?: PipelineProgressChunk["final"]
          }>(`/api/pipelines/${pipelineId}/executions/${executionId}/steps`)

          yield { type: "step", steps: poll.steps, isDone: poll.isDone, final: poll.final }

          if (poll.isDone) break
        }
      } catch {
        // A single polling hiccup isn't fatal — the authoritative result
        // still lands once execPromise resolves below. Just skip this tick.
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }

    // Authoritative final result always wins over anything polling assembled.
    try {
      const result = await execPromise
      yield {
        type: "done", isDone: true, steps: [],
        final: {
          output:         result.output,
          errorMessage:   result.status === "failed" ? "Pipeline execution failed" : null,
          totalCostUsd:   parseFloat(result.summary?.total_cost_usd ?? "0"),
          totalLatencyMs: result.summary?.total_latency_ms ?? 0,
          totalTokensIn:  result.summary?.total_tokens?.input ?? 0,
          totalTokensOut: result.summary?.total_tokens?.output ?? 0,
          completedAt:    new Date().toISOString(),
        },
      }
    } catch (err: any) {
      yield { type: "error", isDone: true, steps: [], error: err?.message ?? String(err) }
    }
  }

  /**
   * Execute a browser agent that can navigate websites, fill forms,
   * and extract structured data.
   *
   * Wraps Anthropic claude computer-use API.
   * Requires Pro plan or above.
   *
   * @example
   * const result = await client.runBrowserAgent("browser-agent-id", {
   *   task: "Go to https://example.com and extract all product names and prices",
   *   targetUrl: "https://example.com",
   *   extractSchema: { "product_name": "string", "price": "number" },
   * })
   * console.log(result.result)    // { products: [...] }
   * console.log(result.steps)     // 7
   */
  async runBrowserAgent(
    agentId: string,
    request: BrowserExecuteRequest,
  ): Promise<BrowserExecuteResponse> {
    return this._http.post("/api/execute/browser", {
      agentId,
      ...request,
    }) as Promise<BrowserExecuteResponse>
  }

  /**
   * Get the embed config and script tag for deploying an agent as
   * a chat widget on any website.
   *
   * @example
   * const embed = await client.getEmbedCode("agent-id", {
   *   theme: "light",
   *   position: "bottom-right",
   *   primaryColor: "#6366f1",
   * })
   * console.log(embed.scriptTag)   // <script src="..." ...></script>
   */
  async getEmbedCode(
    agentId: string,
    options: { theme?: string; position?: string; primaryColor?: string; domain?: string } = {},
  ): Promise<{ scriptTag: string; iframeTag: string; previewUrl: string }> {
    return this._http.post(`/api/agents/${agentId}/embed`, options) as Promise<any>
  }
}

export default AgentDyne
