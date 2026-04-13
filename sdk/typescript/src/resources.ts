/**
 * @file resources.ts
 * @description Executions, User, Notifications, and Webhooks resources.
 */

import type { HttpClient } from "./http.js";
import type {
  Execution,
  ListExecutionsParams,
  Notification,
  PaginatedResponse,
  UserProfile,
  UserQuota,
  WebhookEvent,
} from "./types.js";
import { WebhookSignatureError } from "./errors.js";

// ---------------------------------------------------------------------------
// ExecutionsResource
// ---------------------------------------------------------------------------

export class ExecutionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Retrieve a single execution by ID.
   *
   * @example
   * const exec = await client.executions.get("exec_id");
   * console.log(exec.status, exec.output);
   */
  async get(executionId: string): Promise<Execution> {
    return this.http.get<Execution>(`/v1/executions/${executionId}`);
  }

  /**
   * List your executions with optional filters.
   *
   * @example
   * const { data } = await client.executions.list({ status: "failed", limit: 20 });
   */
  async list(params?: ListExecutionsParams): Promise<PaginatedResponse<Execution>> {
    return this.http.get<PaginatedResponse<Execution>>(
      "/v1/executions",
      params as Record<string, string | number | boolean | undefined>
    );
  }

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
  async poll(
    executionId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<Execution> {
    const { intervalMs = 1_000, timeoutMs = 120_000 } = options;
    const deadline = Date.now() + timeoutMs;
    const TERMINAL = new Set(["success", "failed", "timeout"]);

    while (Date.now() < deadline) {
      const exec = await this.get(executionId);
      if (TERMINAL.has(exec.status)) return exec;
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(`Execution "${executionId}" did not complete within ${timeoutMs}ms`);
  }
}

// ---------------------------------------------------------------------------
// UserResource
// ---------------------------------------------------------------------------

export class UserResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get the currently authenticated user's profile.
   *
   * @example
   * const me = await client.user.me();
   * console.log(me.subscription_plan, me.executions_used_this_month);
   */
  async me(): Promise<UserProfile> {
    return this.http.get<UserProfile>("/v1/user/me");
  }

  /**
   * Update the authenticated user's profile.
   *
   * @example
   * await client.user.update({ full_name: "Ada Lovelace", bio: "AI researcher" });
   */
  async update(updates: Partial<Pick<UserProfile, "full_name" | "username" | "bio" | "website" | "company">>): Promise<UserProfile> {
    return this.http.patch<UserProfile>("/v1/user/me", updates);
  }

  /**
   * Get the authenticated user's current quota usage.
   *
   * @example
   * const quota = await client.user.quota();
   * console.log(`${quota.used}/${quota.quota} calls used (${quota.percentUsed}%)`);
   */
  async quota(): Promise<UserQuota> {
    return this.http.get<UserQuota>("/v1/user/quota");
  }
}

// ---------------------------------------------------------------------------
// NotificationsResource
// ---------------------------------------------------------------------------

export class NotificationsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List the current user's notifications.
   *
   * @example
   * const { data } = await client.notifications.list();
   */
  async list(params?: { limit?: number }): Promise<{ notifications: Notification[] }> {
    return this.http.get<{ notifications: Notification[] }>(
      "/v1/notifications",
      params as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Mark all unread notifications as read.
   *
   * @example
   * await client.notifications.markAllRead();
   */
  async markAllRead(): Promise<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>("/v1/notifications");
  }
}

// ---------------------------------------------------------------------------
// WebhooksResource
// ---------------------------------------------------------------------------

export class WebhooksResource {
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
  async constructEvent<T = unknown>(
    rawBody: string,
    signature: string,
    secret: string
  ): Promise<WebhookEvent<T>> {
    const isValid = await this.verifySignature(rawBody, signature, secret);
    if (!isValid) throw new WebhookSignatureError();

    try {
      return JSON.parse(rawBody) as WebhookEvent<T>;
    } catch {
      throw new WebhookSignatureError("Webhook payload is not valid JSON");
    }
  }

  private async verifySignature(
    payload: string,
    signature: string,
    secret: string
  ): Promise<boolean> {
    try {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig      = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
      const expected = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Constant-time comparison to prevent timing attacks
      return this.timingSafeEqual(expected, signature.replace(/^sha256=/, ""));
    } catch {
      return false;
    }
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
