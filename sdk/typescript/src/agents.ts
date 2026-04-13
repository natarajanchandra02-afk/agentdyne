/**
 * @file agents.ts
 * @description Agents resource — list, get, execute, stream, search, paginate.
 */

import type { HttpClient } from "./http.js";
import type {
  Agent,
  CreateReviewRequest,
  ExecuteRequest,
  ExecuteResponse,
  ListAgentsParams,
  PaginatedResponse,
  Review,
  StreamChunk,
} from "./types.js";

export class AgentsResource {
  constructor(private readonly http: HttpClient) {}

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
  async list(params?: ListAgentsParams): Promise<PaginatedResponse<Agent>> {
    return this.http.get<PaginatedResponse<Agent>>("/v1/agents", params as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Get a single agent by its ID.
   *
   * @example
   * const agent = await client.agents.get("agent_id");
   * console.log(agent.name, agent.average_rating);
   */
  async get(agentId: string): Promise<Agent> {
    return this.http.get<Agent>(`/v1/agents/${agentId}`);
  }

  /**
   * Search agents by keyword.
   * Convenience wrapper around `list()` with the `q` param.
   *
   * @example
   * const { data } = await client.agents.search("email summarizer");
   */
  async search(query: string, params?: Omit<ListAgentsParams, "q">): Promise<PaginatedResponse<Agent>> {
    return this.list({ ...params, q: query });
  }

  /**
   * Return the platform's featured agents.
   *
   * @example
   * const featured = await client.agents.featured();
   */
  async featured(): Promise<Agent[]> {
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
  async *paginate(params?: Omit<ListAgentsParams, "page">): AsyncGenerator<Agent, void, unknown> {
    let page = 1;
    while (true) {
      const result = await this.list({ ...params, page });
      yield* result.data;
      if (!result.pagination.hasNext) break;
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
  async execute(agentId: string, request: ExecuteRequest): Promise<ExecuteResponse> {
    return this.http.post<ExecuteResponse>(
      `/v1/agents/${agentId}/execute`,
      {
        input: request.input,
        ...(request.idempotencyKey && { idempotencyKey: request.idempotencyKey }),
      }
    );
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
  async *stream(agentId: string, request: ExecuteRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const rawStream = this.http.stream(`/v1/agents/${agentId}/execute`, {
      input: request.input,
      stream: true,
    });

    for await (const raw of rawStream) {
      try {
        const parsed = JSON.parse(raw) as StreamChunk;
        yield parsed;
        if (parsed.type === "done") return;
      } catch {
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
      list: (agentId: string, params?: { page?: number; limit?: number }) =>
        this.http.get<PaginatedResponse<Review>>(
          `/v1/agents/${agentId}/reviews`,
          params as Record<string, string | number | boolean | undefined>
        ),

      create: (agentId: string, review: CreateReviewRequest) =>
        this.http.post<Review>(`/v1/agents/${agentId}/reviews`, review),
    };
  }
}
