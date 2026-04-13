/**
 * @file errors.ts
 * @description Typed error hierarchy for the AgentDyne SDK.
 *
 * @example
 * import { AgentDyneError, RateLimitError, QuotaExceededError } from "@agentdyne/sdk";
 *
 * try {
 *   await client.agents.execute("agent_id", { input: "hello" });
 * } catch (err) {
 *   if (err instanceof QuotaExceededError) {
 *     // Prompt user to upgrade plan
 *   } else if (err instanceof RateLimitError) {
 *     await sleep(err.retryAfterMs);
 *   } else if (err instanceof AgentDyneError) {
 *     console.error(err.message, err.statusCode);
 *   }
 * }
 */
export declare class AgentDyneError extends Error {
    readonly statusCode: number | undefined;
    readonly code: string | undefined;
    readonly raw: unknown;
    constructor(message: string, options?: {
        statusCode?: number;
        code?: string;
        raw?: unknown;
        cause?: unknown;
    });
    toJSON(): Record<string, unknown>;
}
/** HTTP 401 — API key missing, invalid, or revoked. */
export declare class AuthenticationError extends AgentDyneError {
    constructor(message?: string, raw?: unknown);
}
/** HTTP 403 — insufficient permissions. */
export declare class PermissionDeniedError extends AgentDyneError {
    constructor(message?: string, raw?: unknown);
}
/** HTTP 403 / SUBSCRIPTION_REQUIRED — agent requires subscription. */
export declare class SubscriptionRequiredError extends AgentDyneError {
    readonly agentId: string | undefined;
    constructor(agentId?: string, raw?: unknown);
}
/** HTTP 404 — resource not found. */
export declare class NotFoundError extends AgentDyneError {
    readonly resourceType: string | undefined;
    readonly resourceId: string | undefined;
    constructor(resourceType?: string, resourceId?: string, raw?: unknown);
}
/** HTTP 400 — malformed request or missing required fields. */
export declare class ValidationError extends AgentDyneError {
    readonly fields: Record<string, string> | undefined;
    constructor(message: string, fields?: Record<string, string>, raw?: unknown);
}
/** HTTP 429 — per-minute rate limit exceeded. */
export declare class RateLimitError extends AgentDyneError {
    readonly retryAfterMs: number;
    constructor(retryAfterMs?: number, raw?: unknown);
}
/** HTTP 429 / QUOTA_EXCEEDED — monthly execution quota exhausted. */
export declare class QuotaExceededError extends AgentDyneError {
    readonly plan: string | undefined;
    constructor(plan?: string, raw?: unknown);
}
/** Execution exceeded its configured timeout. */
export declare class ExecutionTimeoutError extends AgentDyneError {
    readonly executionId: string | undefined;
    constructor(executionId?: string, raw?: unknown);
}
/** Unrecoverable 5xx response. */
export declare class InternalServerError extends AgentDyneError {
    constructor(message?: string, raw?: unknown);
}
/** Client-side request timeout exceeded. */
export declare class RequestTimeoutError extends AgentDyneError {
    constructor(timeoutMs: number);
}
/** Network-level failure (no internet, DNS, TLS). */
export declare class NetworkError extends AgentDyneError {
    constructor(message: string, cause?: Error);
}
/** Webhook HMAC-SHA256 signature verification failed. */
export declare class WebhookSignatureError extends AgentDyneError {
    constructor(message?: string);
}
//# sourceMappingURL=errors.d.ts.map