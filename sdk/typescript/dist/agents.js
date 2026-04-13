/**
 * @file agents.ts
 * @description Agents resource — list, get, execute, stream, search, paginate.
 */
export class AgentsResource {
    http;
    constructor(http) {
        this.http = http;
    }
    // ---------------------------------------------------------------------------
    // Discovery
    // ---------------------------------------------------------------------------
    /**
     * List agents with optional filters, sorting, and pagination.
     *
     * @example
     * const { data, pagination } = await client.agents.list({
     *   category: "coding",
     *   sort: "rating",
     *   limit: 10,
     * });
     */
    async list(params) {
        return this.http.get("/v1/agents", params);
    }
    /**
     * Get a single agent by its ID.
     *
     * @example
     * const agent = await client.agents.get("agent_id");
     * console.log(agent.name, agent.average_rating);
     */
    async get(agentId) {
        return this.http.get(`/v1/agents/${agentId}`);
    }
    /**
     * Search agents by keyword.
     * Convenience wrapper around `list()` with the `q` param.
     *
     * @example
     * const { data } = await client.agents.search("email summarizer");
     */
    async search(query, params) {
        return this.list({ ...params, q: query });
    }
    /**
     * Return the platform's featured agents.
     *
     * @example
     * const featured = await client.agents.featured();
     */
    async featured() {
        const result = await this.list({ sort: "popular", limit: 6 });
        return result.data.filter((a) => a.is_featured);
    }
    /**
     * Async generator that pages through ALL matching agents automatically.
     *
     * @example
     * for await (const agent of client.agents.paginate({ category: "finance" })) {
     *   console.log(agent.name);
     * }
     */
    async *paginate(params) {
        let page = 1;
        while (true) {
            const result = await this.list({ ...params, page });
            yield* result.data;
            if (!result.pagination.hasNext)
                break;
            page++;
        }
    }
    // ---------------------------------------------------------------------------
    // Execution
    // ---------------------------------------------------------------------------
    /**
     * Execute an agent synchronously. Returns the complete output once the
     * execution is finished (up to the agent's `timeout_seconds`).
     *
     * @example
     * const result = await client.agents.execute("agent_id", {
     *   input: "Summarize the Q3 earnings report...",
     * });
     * console.log(result.output, result.latencyMs);
     */
    async execute(agentId, request) {
        return this.http.post(`/v1/agents/${agentId}/execute`, {
            input: request.input,
            ...(request.idempotencyKey && { idempotencyKey: request.idempotencyKey }),
        });
    }
    /**
     * Stream an agent's output as it is generated.
     * Yields `StreamChunk` objects containing incremental text deltas.
     *
     * @example
     * for await (const chunk of client.agents.stream("agent_id", { input: "Hello" })) {
     *   if (chunk.type === "delta") process.stdout.write(chunk.delta ?? "");
     * }
     */
    async *stream(agentId, request) {
        const rawStream = this.http.stream(`/v1/agents/${agentId}/execute`, {
            input: request.input,
            stream: true,
        });
        for await (const raw of rawStream) {
            try {
                const parsed = JSON.parse(raw);
                yield parsed;
                if (parsed.type === "done")
                    return;
            }
            catch {
                // Non-JSON chunk — treat as raw delta
                yield { type: "delta", delta: raw };
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Reviews
    // ---------------------------------------------------------------------------
    /**
     * List approved reviews for an agent.
     *
     * @example
     * const { data: reviews } = await client.agents.reviews.list("agent_id");
     */
    get reviews() {
        return {
            list: (agentId, params) => this.http.get(`/v1/agents/${agentId}/reviews`, params),
            create: (agentId, review) => this.http.post(`/v1/agents/${agentId}/reviews`, review),
        };
    }
}
//# sourceMappingURL=agents.js.map