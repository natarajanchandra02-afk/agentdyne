/**
 * @file types.ts
 * @description Complete type definitions for the AgentDyne SDK.
 *
 * These types mirror the AgentDyne Supabase schema exactly, ensuring
 * compile-time safety across all SDK operations.
 */
export type AgentCategory = "productivity" | "coding" | "marketing" | "finance" | "legal" | "customer_support" | "data_analysis" | "content" | "research" | "hr" | "sales" | "devops" | "security" | "other";
export type PricingModel = "free" | "per_call" | "subscription" | "freemium";
export type AgentStatus = "draft" | "pending_review" | "active" | "suspended" | "archived";
export type ExecutionStatus = "queued" | "running" | "success" | "failed" | "timeout";
export type SubscriptionPlan = "free" | "starter" | "pro" | "enterprise";
export interface Agent {
    id: string;
    seller_id: string;
    name: string;
    slug: string;
    description: string;
    long_description?: string;
    category: AgentCategory;
    tags: string[];
    status: AgentStatus;
    is_featured: boolean;
    is_verified: boolean;
    pricing_model: PricingModel;
    price_per_call: number;
    subscription_price_monthly: number;
    free_calls_per_month: number;
    model_provider?: string;
    model_name: string;
    system_prompt: string;
    temperature: number;
    max_tokens: number;
    timeout_seconds: number;
    average_rating: number;
    total_reviews: number;
    total_executions: number;
    successful_executions: number;
    average_latency_ms: number;
    total_revenue: number;
    icon_url?: string;
    documentation?: string;
    version: string;
    created_at: string;
    updated_at: string;
    /** Joined seller profile — present when requested */
    profiles?: SellerProfile;
}
export interface SellerProfile {
    id: string;
    full_name: string;
    username?: string;
    avatar_url?: string;
    bio?: string;
    is_verified: boolean;
    total_earned?: number;
}
export interface Execution {
    id: string;
    agent_id: string;
    user_id: string;
    status: ExecutionStatus;
    input: unknown;
    output?: unknown;
    error_message?: string;
    tokens_input?: number;
    tokens_output?: number;
    latency_ms?: number;
    cost?: number;
    created_at: string;
    completed_at?: string;
    /** Joined agent info — present when requested */
    agents?: Pick<Agent, "id" | "name" | "icon_url">;
}
export interface ExecuteRequest {
    /** The input to the agent. Can be a string or any JSON-serialisable object. */
    input: string | Record<string, unknown> | unknown[];
    /** Optional idempotency key (UUID). Safe to retry on network failure. */
    idempotencyKey?: string;
}
export interface ExecuteResponse {
    executionId: string;
    output: unknown;
    latencyMs: number;
    tokens: {
        input: number;
        output: number;
    };
    cost: number;
}
export interface StreamChunk {
    type: "delta" | "done" | "error";
    delta?: string;
    executionId?: string;
    error?: string;
}
export interface ListAgentsParams {
    /** Full-text search query */
    q?: string;
    category?: AgentCategory;
    pricing?: PricingModel;
    /** Sort order */
    sort?: "popular" | "rating" | "newest" | "revenue";
    page?: number;
    /** Max 100 */
    limit?: number;
}
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        pages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}
export interface ListExecutionsParams {
    agentId?: string;
    status?: ExecutionStatus;
    page?: number;
    limit?: number;
    /** ISO timestamp — filter executions after this date */
    since?: string;
}
export interface UserProfile {
    id: string;
    email: string;
    full_name?: string;
    username?: string;
    avatar_url?: string;
    bio?: string;
    website?: string;
    company?: string;
    role: "user" | "seller" | "admin";
    is_verified: boolean;
    subscription_plan: SubscriptionPlan;
    subscription_status?: string;
    stripe_customer_id?: string;
    stripe_connect_account_id?: string;
    stripe_connect_onboarded: boolean;
    monthly_execution_quota: number;
    executions_used_this_month: number;
    total_earned: number;
    quota_reset_date?: string;
    created_at: string;
    updated_at: string;
}
export interface UserQuota {
    plan: SubscriptionPlan;
    quota: number;
    used: number;
    remaining: number;
    percentUsed: number;
    resetsAt: string;
}
export interface Review {
    id: string;
    agent_id: string;
    user_id: string;
    rating: number;
    title?: string;
    body?: string;
    status: "pending" | "approved" | "rejected";
    created_at: string;
    profiles?: Pick<UserProfile, "id" | "full_name" | "avatar_url">;
}
export interface CreateReviewRequest {
    rating: number;
    title?: string;
    body?: string;
}
export interface Notification {
    id: string;
    user_id: string;
    title: string;
    body: string;
    type: string;
    action_url?: string;
    is_read: boolean;
    created_at: string;
}
export type WebhookEventType = "execution.completed" | "execution.failed" | "agent.approved" | "agent.rejected" | "subscription.created" | "subscription.updated" | "subscription.canceled" | "payout.processed" | "review.posted";
export interface WebhookEvent<T = unknown> {
    id: string;
    type: WebhookEventType;
    timestamp: string;
    data: T;
}
export interface WebhookEventExecution extends WebhookEvent<{
    executionId: string;
    agentId: string;
    status: ExecutionStatus;
    latencyMs: number;
    tokens: {
        input: number;
        output: number;
    };
}> {
    type: "execution.completed" | "execution.failed";
}
export interface AgentDyneConfig {
    /** Your AgentDyne API key (starts with agd_) */
    apiKey: string;
    /**
     * API base URL. Defaults to https://api.agentdyne.com
     * Override for local development: http://localhost:3000
     */
    baseUrl?: string;
    /**
     * Maximum number of retries on transient failures (429, 5xx).
     * @default 3
     */
    maxRetries?: number;
    /**
     * Request timeout in milliseconds.
     * @default 60000
     */
    timeout?: number;
    /**
     * Custom fetch implementation. Useful for environments that require a
     * specific fetch polyfill or for testing with mocked responses.
     */
    fetch?: typeof globalThis.fetch;
}
//# sourceMappingURL=types.d.ts.map