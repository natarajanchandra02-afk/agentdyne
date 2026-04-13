/**
 * @file http.ts
 * @description Production-grade HTTP client with automatic retries,
 * exponential back-off with jitter, and SSE streaming.
 *
 * Compatible with Node.js 18+, Cloudflare Workers, Vercel Edge, Deno, Bun.
 */
import type { AgentDyneConfig } from "./types.js";
export declare class HttpClient {
    private readonly config;
    constructor(userConfig: AgentDyneConfig);
    get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
    /** Stream a Server-Sent Events response. Yields raw data lines. */
    stream(path: string, body: unknown): AsyncGenerator<string, void, unknown>;
    private request;
    private buildUrl;
    private buildHeaders;
    private parseResponse;
    private parseRetryAfter;
    private throwFromResponse;
    private buildError;
    private wrapFetchError;
    private withTimeout;
}
//# sourceMappingURL=http.d.ts.map