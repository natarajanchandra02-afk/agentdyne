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
import { ExecutionsResource, NotificationsResource, UserResource, WebhooksResource, } from "./resources.js";
export class AgentDyne {
    /** Access agent discovery, execution, and reviews */
    agents;
    /** Access execution history and polling */
    executions;
    /** Access user profile and quota */
    user;
    /** Access notifications */
    notifications;
    /** Verify and parse incoming webhook events */
    webhooks;
    _http;
    constructor(config) {
        if (!config.apiKey) {
            throw new Error("[AgentDyne] apiKey is required. Get yours at https://agentdyne.com/api-keys");
        }
        this._http = new HttpClient(config);
        this.agents = new AgentsResource(this._http);
        this.executions = new ExecutionsResource(this._http);
        this.user = new UserResource(this._http);
        this.notifications = new NotificationsResource(this._http);
        this.webhooks = new WebhooksResource();
    }
    /**
     * Shorthand — execute an agent directly from the top-level client.
     *
     * @example
     * const result = await client.execute("agent_id", { input: "Hello" });
     */
    execute(agentId, request) {
        const req = typeof request === "string" ? { input: request } : request;
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
    stream(agentId, request) {
        const req = typeof request === "string" ? { input: request } : request;
        return this.agents.stream(agentId, req);
    }
}
//# sourceMappingURL=client.js.map