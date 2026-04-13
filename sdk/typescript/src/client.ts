/**
 * @file client.ts
 * @description The main AgentDyne client class.
 *
 * @example
 * import AgentDyne from "@agentdyne/sdk";
 *
 * const client = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! });
 *
 * // Execute an agent
 * const result = await client.execute("agent_id", "Summarize this email...");
 *
 * // Stream output
 * for await (const chunk of client.stream("agent_id", "Hello!")) {
 *   process.stdout.write(chunk.delta ?? "");
 * }
 */

import { HttpClient } from "./http.js";
import { AgentsResource } from "./agents.js";
import {
  ExecutionsResource,
  NotificationsResource,
  UserResource,
  WebhooksResource,
} from "./resources.js";
import type { AgentDyneConfig, ExecuteRequest, ExecuteResponse, StreamChunk } from "./types.js";

export class AgentDyne {
  /** Access agent discovery, execution, and reviews */
  readonly agents: AgentsResource;
  /** Access execution history and polling */
  readonly executions: ExecutionsResource;
  /** Access user profile and quota */
  readonly user: UserResource;
  /** Access notifications */
  readonly notifications: NotificationsResource;
  /** Verify and parse incoming webhook events */
  readonly webhooks: WebhooksResource;

  private readonly _http: HttpClient;

  constructor(config: AgentDyneConfig) {
    if (!config.apiKey) {
      throw new Error(
        "[AgentDyne] apiKey is required. Get yours at https://agentdyne.com/api-keys"
      );
    }

    this._http         = new HttpClient(config);
    this.agents        = new AgentsResource(this._http);
    this.executions    = new ExecutionsResource(this._http);
    this.user          = new UserResource(this._http);
    this.notifications = new NotificationsResource(this._http);
    this.webhooks      = new WebhooksResource();
  }

  /**
   * Shorthand — execute an agent directly from the top-level client.
   *
   * @example
   * const result = await client.execute("agent_id", { input: "Hello" });
   */
  execute(agentId: string, request: ExecuteRequest | string): Promise<ExecuteResponse> {
    const req: ExecuteRequest = typeof request === "string" ? { input: request } : request;
    return this.agents.execute(agentId, req);
  }

  /**
   * Shorthand — stream an agent's output directly from the top-level client.
   *
   * @example
   * for await (const chunk of client.stream("agent_id", "Hello!")) {
   *   process.stdout.write(chunk.delta ?? "");
   * }
   */
  stream(agentId: string, request: ExecuteRequest | string): AsyncGenerator<StreamChunk, void, unknown> {
    const req: ExecuteRequest = typeof request === "string" ? { input: request } : request;
    return this.agents.stream(agentId, req);
  }
}
