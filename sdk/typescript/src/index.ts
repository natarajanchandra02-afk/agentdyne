/**
 * @module @agentdyne/sdk
 * @description Official JavaScript / TypeScript SDK for AgentDyne v2.0.0
 *
 * @example
 * import AgentDyne from "@agentdyne/sdk"
 * const client = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! })
 *
 * // Execute
 * const result = await client.execute("agent-id", "Summarise this...")
 *
 * // Stream
 * for await (const chunk of client.stream("agent-id", "Write a post")) {
 *   if (chunk.type === "token") process.stdout.write(chunk.delta ?? "")
 * }
 *
 * // Swarm
 * const session = await client.swarm({
 *   task: "Research AI agent frameworks",
 *   agentIds: ["agent-a", "agent-b"],
 * })
 */

export { AgentDyne } from "./client.js"
export { AgentDyne as default } from "./client.js"

// Resources
export { AgentsResource }                                                        from "./agents.js"
export { ExecutionsResource, UserResource, NotificationsResource, WebhooksResource } from "./resources.js"

// Errors
export {
  AgentDyneError,
  AuthenticationError,
  ExecutionTimeoutError,
  InternalServerError,
  NetworkError,
  NotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
  RateLimitError,
  RequestTimeoutError,
  SubscriptionRequiredError,
  ValidationError,
  WebhookSignatureError,
} from "./errors.js"

// Types
export type {
  Agent,
  AgentCategory,
  AgentDyneConfig,
  AgentStatus,
  BrowserExecuteRequest,
  BrowserExecuteResponse,
  CreateReviewRequest,
  Execution,
  ExecuteRequest,
  ExecuteResponse,
  ExecutionStatus,
  ListAgentsParams,
  ListExecutionsParams,
  Notification,
  PaginatedResponse,
  PipelineExecuteRequest,
  PipelineExecuteResponse,
  PipelineNodeResult,
  PipelineProgressChunk,
  PipelineStepProgress,
  PricingModel,
  Review,
  SellerProfile,
  StreamChunk,
  SubscriptionPlan,
  SwarmMode,
  SwarmRequest,
  SwarmSession,
  UserProfile,
  UserQuota,
  WebhookEvent,
  WebhookEventExecution,
  WebhookEventType,
} from "./types.js"
