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
// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------
export class AgentDyneError extends Error {
    statusCode;
    code;
    raw;
    constructor(message, options) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = options?.statusCode;
        this.code = options?.code;
        this.raw = options?.raw;
        if (options?.cause instanceof Error) {
            this.cause = options.cause;
        }
        Object.setPrototypeOf(this, new.target.prototype);
    }
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            statusCode: this.statusCode,
            code: this.code,
        };
    }
}
// ---------------------------------------------------------------------------
// Authentication & authorization
// ---------------------------------------------------------------------------
/** HTTP 401 — API key missing, invalid, or revoked. */
export class AuthenticationError extends AgentDyneError {
    constructor(message = "Invalid or missing API key", raw) {
        super(message, { statusCode: 401, code: "AUTHENTICATION_ERROR", raw });
    }
}
/** HTTP 403 — insufficient permissions. */
export class PermissionDeniedError extends AgentDyneError {
    constructor(message = "You do not have permission to perform this action", raw) {
        super(message, { statusCode: 403, code: "PERMISSION_DENIED", raw });
    }
}
/** HTTP 403 / SUBSCRIPTION_REQUIRED — agent requires subscription. */
export class SubscriptionRequiredError extends AgentDyneError {
    agentId;
    constructor(agentId, raw) {
        super(agentId
            ? `Agent "${agentId}" requires an active subscription`
            : "An active subscription is required to use this agent", { statusCode: 403, code: "SUBSCRIPTION_REQUIRED", raw });
        this.agentId = agentId;
    }
}
// ---------------------------------------------------------------------------
// Resource errors
// ---------------------------------------------------------------------------
/** HTTP 404 — resource not found. */
export class NotFoundError extends AgentDyneError {
    resourceType;
    resourceId;
    constructor(resourceType, resourceId, raw) {
        const what = resourceType ? `${resourceType}${resourceId ? ` "${resourceId}"` : ""}` : "Resource";
        super(`${what} not found`, { statusCode: 404, code: "NOT_FOUND", raw });
        this.resourceType = resourceType;
        this.resourceId = resourceId;
    }
}
/** HTTP 400 — malformed request or missing required fields. */
export class ValidationError extends AgentDyneError {
    fields;
    constructor(message, fields, raw) {
        super(message, { statusCode: 400, code: "VALIDATION_ERROR", raw });
        this.fields = fields;
    }
}
// ---------------------------------------------------------------------------
// Rate limiting & quotas
// ---------------------------------------------------------------------------
/** HTTP 429 — per-minute rate limit exceeded. */
export class RateLimitError extends AgentDyneError {
    retryAfterMs;
    constructor(retryAfterMs = 60_000, raw) {
        super(`Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s`, {
            statusCode: 429,
            code: "RATE_LIMIT_EXCEEDED",
            raw,
        });
        this.retryAfterMs = retryAfterMs;
    }
}
/** HTTP 429 / QUOTA_EXCEEDED — monthly execution quota exhausted. */
export class QuotaExceededError extends AgentDyneError {
    plan;
    constructor(plan, raw) {
        super(plan
            ? `Monthly execution quota exceeded on the "${plan}" plan. Please upgrade.`
            : "Monthly execution quota exceeded. Please upgrade your plan.", { statusCode: 429, code: "QUOTA_EXCEEDED", raw });
        this.plan = plan;
    }
}
// ---------------------------------------------------------------------------
// Network & server errors
// ---------------------------------------------------------------------------
/** Execution exceeded its configured timeout. */
export class ExecutionTimeoutError extends AgentDyneError {
    executionId;
    constructor(executionId, raw) {
        super(executionId ? `Execution "${executionId}" timed out` : "Execution timed out", { statusCode: 408, code: "EXECUTION_TIMEOUT", raw });
        this.executionId = executionId;
    }
}
/** Unrecoverable 5xx response. */
export class InternalServerError extends AgentDyneError {
    constructor(message = "An internal server error occurred", raw) {
        super(message, { statusCode: 500, code: "INTERNAL_SERVER_ERROR", raw });
    }
}
/** Client-side request timeout exceeded. */
export class RequestTimeoutError extends AgentDyneError {
    constructor(timeoutMs) {
        super(`Request timed out after ${timeoutMs}ms`, { code: "REQUEST_TIMEOUT" });
    }
}
/** Network-level failure (no internet, DNS, TLS). */
export class NetworkError extends AgentDyneError {
    constructor(message, cause) {
        super(message, { code: "NETWORK_ERROR", cause });
    }
}
// ---------------------------------------------------------------------------
// Webhook errors
// ---------------------------------------------------------------------------
/** Webhook HMAC-SHA256 signature verification failed. */
export class WebhookSignatureError extends AgentDyneError {
    constructor(message = "Webhook signature verification failed") {
        super(message, { code: "WEBHOOK_SIGNATURE_INVALID" });
    }
}
//# sourceMappingURL=errors.js.map