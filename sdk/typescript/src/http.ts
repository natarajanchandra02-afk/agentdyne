/**
 * @file http.ts
 * @description Production-grade HTTP client with automatic retries,
 * exponential back-off with jitter, and SSE streaming.
 *
 * Compatible with Node.js 18+, Cloudflare Workers, Vercel Edge, Deno, Bun.
 */

import {
  AgentDyneError,
  AuthenticationError,
  InternalServerError,
  NetworkError,
  NotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
  RateLimitError,
  RequestTimeoutError,
  SubscriptionRequiredError,
  ValidationError,
} from "./errors.js";
import type { AgentDyneConfig } from "./types.js";

const DEFAULT_BASE_URL   = "https://api.agentdyne.com";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS  = 60_000;

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ApiErrorBody {
  error?: string;
  message?: string;
  code?: string;
  fields?: Record<string, string>;
}

interface ResolvedConfig {
  apiKey:     string;
  baseUrl:    string;
  maxRetries: number;
  timeout:    number;
  fetch:      typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const NON_RETRYABLE = new Set([400, 401, 403, 404, 422]);

function shouldRetry(status: number): boolean {
  return !NON_RETRYABLE.has(status);
}

/** Full-jitter exponential back-off. */
function backoffDelay(attempt: number): number {
  const BASE = 500;
  const CAP  = 30_000;
  const ceil = Math.min(CAP, BASE * Math.pow(2, attempt));
  return Math.random() * ceil;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// HttpClient
// ---------------------------------------------------------------------------

export class HttpClient {
  private readonly config: ResolvedConfig;

  constructor(userConfig: AgentDyneConfig) {
    this.config = {
      apiKey:     userConfig.apiKey,
      baseUrl:    (userConfig.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
      maxRetries: userConfig.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeout:    userConfig.timeout    ?? DEFAULT_TIMEOUT_MS,
      fetch:      userConfig.fetch      ?? globalThis.fetch.bind(globalThis),
    };
  }

  // ── Public methods ──────────────────────────────────────────────────────

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("GET", path, undefined, params);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  /** Stream a Server-Sent Events response. Yields raw data lines. */
  async *stream(path: string, body: unknown): AsyncGenerator<string, void, unknown> {
    const url     = `${this.config.baseUrl}${path}`;
    const headers = this.buildHeaders({ stream: true });

    let response: Response;
    try {
      response = await this.withTimeout(
        this.config.fetch(url, {
          method:  "POST",
          headers,
          body:    JSON.stringify(body),
        })
      );
    } catch (err) {
      throw this.wrapFetchError(err);
    }

    if (!response.ok) {
      await this.throwFromResponse(response);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new AgentDyneError("Response body is not readable");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;
          yield data;
        }
      }
    }
  }

  // ── Core request loop ───────────────────────────────────────────────────

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url     = this.buildUrl(path, params);
    const headers = this.buildHeaders();
    // Use null (not undefined) so fetch doesn't reject the body field
    const serialisedBody: string | null =
      body !== undefined ? JSON.stringify(body) : null;

    let lastError: Error = new AgentDyneError("Unknown error");

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      let response: Response;

      try {
        response = await this.withTimeout(
          this.config.fetch(url, {
            method,
            headers,
            body: serialisedBody,
          })
        );
      } catch (err) {
        lastError = this.wrapFetchError(err);
        if (attempt < this.config.maxRetries) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return this.parseResponse<T>(response);
      }

      if (response.status === 429) {
        const retryAfterMs = this.parseRetryAfter(response);
        const err = await this.buildError(response);
        if (attempt < this.config.maxRetries) {
          await sleep(retryAfterMs ?? backoffDelay(attempt));
          lastError = err;
          continue;
        }
        throw err;
      }

      if (response.status >= 500 && shouldRetry(response.status) && attempt < this.config.maxRetries) {
        lastError = await this.buildError(response);
        await sleep(backoffDelay(attempt));
        continue;
      }

      throw await this.buildError(response);
    }

    throw lastError;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(options?: { stream?: boolean }): Record<string, string> {
    return {
      "Authorization":  `Bearer ${this.config.apiKey}`,
      "Content-Type":   "application/json",
      "Accept":         options?.stream ? "text/event-stream" : "application/json",
      "X-SDK-Version":  "1.0.0",
      "X-SDK-Language": "typescript",
    };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text) return undefined as unknown as T;
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }

  private parseRetryAfter(response: Response): number | undefined {
    const h = response.headers.get("Retry-After");
    if (!h) return undefined;
    const s = parseFloat(h);
    return isNaN(s) ? undefined : s * 1000;
  }

  private async throwFromResponse(response: Response): Promise<never> {
    throw await this.buildError(response);
  }

  private async buildError(response: Response): Promise<AgentDyneError> {
    let body: ApiErrorBody = {};
    try { body = (await response.json()) as ApiErrorBody; } catch { /* ignore */ }

    const message = body.error ?? body.message ?? `HTTP ${response.status}`;
    const code    = body.code ?? undefined;
    const raw     = body;

    switch (response.status) {
      case 400: return new ValidationError(message, body.fields, raw);
      case 401: return new AuthenticationError(message, raw);
      case 403:
        if (code === "SUBSCRIPTION_REQUIRED") return new SubscriptionRequiredError(undefined, raw);
        return new PermissionDeniedError(message, raw);
      case 404: return new NotFoundError(undefined, undefined, raw);
      case 429:
        if (code === "QUOTA_EXCEEDED") return new QuotaExceededError(undefined, raw);
        return new RateLimitError(undefined, raw);
      default:
        if (response.status >= 500) return new InternalServerError(message, raw);
        return new AgentDyneError(message, { statusCode: response.status, code, raw });
    }
  }

  private wrapFetchError(err: unknown): AgentDyneError {
    if (err instanceof AgentDyneError) return err;
    if (err instanceof Error) {
      if (err.name === "AbortError") return new RequestTimeoutError(this.config.timeout);
      return new NetworkError(err.message, err);
    }
    return new NetworkError(String(err));
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new RequestTimeoutError(this.config.timeout)),
          this.config.timeout
        )
      ),
    ]);
  }
}
