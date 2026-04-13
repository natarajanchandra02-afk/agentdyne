/**
 * @file resources.ts
 * @description Executions, User, Notifications, and Webhooks resources.
 */
import type { HttpClient } from "./http.js";
import type { Execution, ListExecutionsParams, Notification, PaginatedResponse, UserProfile, UserQuota, WebhookEvent } from "./types.js";
export declare class ExecutionsResource {
    private readonly http;
    constructor(http: HttpClient);
    /**
     * Retrieve a single execution by ID.
     *
     * @example
     * const exec = await client.executions.get("exec_id");
     * console.log(exec.status, exec.output);
     */
    get(executionId: string): Promise<Execution>;
    /**
     * List your executions with optional filters.
     *
     * @example
     * const { data } = await client.executions.list({ status: "failed", limit: 20 });
     */
    list(params?: ListExecutionsParams): Promise<PaginatedResponse<Execution>>;
    /**
     * Poll an execution until it is in a terminal state (success, failed, timeout).
     *
     * @param executionId - The execution to poll
     * @param options.intervalMs - Polling interval in milliseconds (default: 1000)
     * @param options.timeoutMs - Maximum time to poll in milliseconds (default: 120000)
     *
     * @example
     * const result = await client.executions.poll("exec_id", { intervalMs: 500 });
     */
    poll(executionId: string, options?: {
        intervalMs?: number;
        timeoutMs?: number;
    }): Promise<Execution>;
}
export declare class UserResource {
    private readonly http;
    constructor(http: HttpClient);
    /**
     * Get the currently authenticated user's profile.
     *
     * @example
     * const me = await client.user.me();
     * console.log(me.subscription_plan, me.executions_used_this_month);
     */
    me(): Promise<UserProfile>;
    /**
     * Update the authenticated user's profile.
     *
     * @example
     * await client.user.update({ full_name: "Ada Lovelace", bio: "AI researcher" });
     */
    update(updates: Partial<Pick<UserProfile, "full_name" | "username" | "bio" | "website" | "company">>): Promise<UserProfile>;
    /**
     * Get the authenticated user's current quota usage.
     *
     * @example
     * const quota = await client.user.quota();
     * console.log(`${quota.used}/${quota.quota} calls used (${quota.percentUsed}%)`);
     */
    quota(): Promise<UserQuota>;
}
export declare class NotificationsResource {
    private readonly http;
    constructor(http: HttpClient);
    /**
     * List the current user's notifications.
     *
     * @example
     * const { data } = await client.notifications.list();
     */
    list(params?: {
        limit?: number;
    }): Promise<{
        notifications: Notification[];
    }>;
    /**
     * Mark all unread notifications as read.
     *
     * @example
     * await client.notifications.markAllRead();
     */
    markAllRead(): Promise<{
        ok: boolean;
    }>;
}
export declare class WebhooksResource {
    /**
     * Verify and parse an incoming AgentDyne webhook payload.
     *
     * Uses HMAC-SHA256 to verify the `X-AgentDyne-Signature` header against
     * the raw request body. Throws `WebhookSignatureError` if invalid.
     *
     * @example
     * // In a Next.js API route:
     * const rawBody = await request.text();
     * const sig = request.headers.get("x-agentdyne-signature") ?? "";
     * const event = await client.webhooks.constructEvent(rawBody, sig, process.env.WEBHOOK_SECRET);
     */
    constructEvent<T = unknown>(rawBody: string, signature: string, secret: string): Promise<WebhookEvent<T>>;
    private verifySignature;
    private timingSafeEqual;
}
//# sourceMappingURL=resources.d.ts.map