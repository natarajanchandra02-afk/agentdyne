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
