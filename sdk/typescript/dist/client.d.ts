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
import { AgentsResource } from "./agents.js";
import { ExecutionsResource, NotificationsResource, UserResource, WebhooksResource } from "./resources.js";
import type { AgentDyneConfig, ExecuteRequest, ExecuteResponse, StreamChunk } from "./types.js";
export declare class AgentDyne {
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
    private readonly _http;
    constructor(config: AgentDyneConfig);
    /**
     * Shorthand — execute an agent directly from the top-level client.
     *
     * @example
     * const result = await client.execute("agent_id", { input: "Hello" });
     */
    execute(agentId: string, request: ExecuteRequest | string): Promise<ExecuteResponse>;
    /**
     * Shorthand — stream an agent's output directly from the top-level client.
     *
     * @example
     * for await (const chunk of client.stream("agent_id", "Hello!")) {
     *   process.stdout.write(chunk.delta ?? "");
     * }
     */
    stream(agentId: string, request: ExecuteRequest | string): AsyncGenerator<StreamChunk, void, unknown>;
}
//# sourceMappingURL=client.d.ts.map