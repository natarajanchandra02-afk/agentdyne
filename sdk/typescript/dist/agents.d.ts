/**
 * @file agents.ts
 * @description Agents resource — list, get, execute, stream, search, paginate.
 */
import type { HttpClient } from "./http.js";
import type { Agent, CreateReviewRequest, ExecuteRequest, ExecuteResponse, ListAgentsParams, PaginatedResponse, Review, StreamChunk } from "./types.js";
export declare class AgentsResource {
    private readonly http;
    constructor(http: HttpClient);
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
    list(params?: ListAgentsParams): Promise<PaginatedResponse<Agent>>;
    /**
     * Get a single agent by its ID.
     *
     * @example
     * const agent = await client.agents.get("agent_id");
     * console.log(agent.name, agent.average_rating);
     */
    get(agentId: string): Promise<Agent>;
    /**
     * Search agents by keyword.
     * Convenience wrapper around `list()` with the `q` param.
     *
     * @example
     * const { data } = await client.agents.search("email summarizer");
     */
    search(query: string, params?: Omit<ListAgentsParams, "q">): Promise<PaginatedResponse<Agent>>;
    /**
     * Return the platform's featured agents.
     *
     * @example
     * const featured = await client.agents.featured();
     */
    featured(): Promise<Agent[]>;
    /**
     * Async generator that pages through ALL matching agents automatically.
     *
     * @example
     * for await (const agent of client.agents.paginate({ category: "finance" })) {
     *   console.log(agent.name);
     * }
     */
    paginate(params?: Omit<ListAgentsParams, "page">): AsyncGenerator<Agent, void, unknown>;
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
    execute(agentId: string, request: ExecuteRequest): Promise<ExecuteResponse>;
    /**
     * Stream an agent's output as it is generated.
     * Yields `StreamChunk` objects containing incremental text deltas.
     *
     * @example
     * for await (const chunk of client.agents.stream("agent_id", { input: "Hello" })) {
     *   if (chunk.type === "delta") process.stdout.write(chunk.delta ?? "");
     * }
     */
    stream(agentId: string, request: ExecuteRequest): AsyncGenerator<StreamChunk, void, unknown>;
    /**
     * List approved reviews for an agent.
     *
     * @example
     * const { data: reviews } = await client.agents.reviews.list("agent_id");
     */
    get reviews(): {
        list: (agentId: string, params?: {
            page?: number;
            limit?: number;
        }) => Promise<PaginatedResponse<Review>>;
        create: (agentId: string, review: CreateReviewRequest) => Promise<Review>;
    };
}
//# sourceMappingURL=agents.d.ts.map