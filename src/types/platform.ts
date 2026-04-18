/**
 * AgentDyne Platform — Canonical TypeScript Type System
 *
 * This file defines the strict interface contracts for every major entity.
 * Import from this file throughout the codebase to ensure type safety.
 *
 * Structure:
 *   1. MicroAgent — core execution unit
 *   2. Pipeline / DAG — multi-agent workflows
 *   3. Execution — runtime records
 *   4. RAG — knowledge & retrieval
 *   5. Registry — capability discovery
 *   6. Commerce — billing, credits, payouts
 *   7. Platform — users, API keys
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. MICROAGENT — Core execution unit
// ─────────────────────────────────────────────────────────────────────────────

/** Agent type determines the execution path and capabilities */
export type AgentType =
  | "llm"        // Pure language model: system_prompt + LLM call
  | "rag"        // RAG-augmented: embeds query, retrieves chunks, then LLM call
  | "tool"       // MCP tool-use loop: LLM + external tool execution
  | "validator"  // Post-processing: validates and transforms another agent's output
  | "router"     // Routes input to one of N downstream agents based on intent

export type AgentStatus =
  | "draft"
  | "pending_review"
  | "active"
  | "suspended"
  | "archived"

export type PricingModel =
  | "free"
  | "per_call"
  | "subscription"
  | "freemium"

export type AgentCategory =
  | "productivity"
  | "coding"
  | "marketing"
  | "finance"
  | "legal"
  | "customer_support"
  | "data_analysis"
  | "content"
  | "research"
  | "hr"
  | "sales"
  | "devops"
  | "security"
  | "other"

/**
 * MicroAgent — the canonical agent schema.
 * Maps 1:1 to the `agents` Postgres table.
 */
export interface MicroAgent {
  // Identity
  id:           string
  seller_id:    string
  name:         string
  slug:         string
  description:  string
  long_description?: string | null
  icon_url?:    string | null
  version:      string

  // Classification
  category:    AgentCategory
  tags:        string[]
  status:      AgentStatus

  // Execution config
  system_prompt: string
  model_name:    string
  temperature:   number
  max_tokens:    number
  timeout_seconds: number

  // Type & capabilities
  agent_type:      AgentType
  capability_tags: string[]
  input_types:     string[]   // e.g. ["text", "json", "code"]
  output_types:    string[]   // e.g. ["text", "json"]
  languages:       string[]   // ISO 639-1 codes
  compliance_tags: string[]   // e.g. ["gdpr", "hipaa", "soc2"]

  // RAG
  knowledge_base_id?: string | null

  // Tools
  mcp_server_ids: string[]

  // Schema
  input_schema?:  JSONSchema
  output_schema?: JSONSchema

  // Pricing
  pricing_model:              PricingModel
  price_per_call?:            number | null
  subscription_price_monthly?: number | null
  free_calls_per_month?:      number

  // Performance stats (denormalised, updated by triggers)
  total_executions:    number
  successful_executions: number
  average_latency_ms:  number
  average_rating:      number
  total_reviews:       number
  total_revenue:       number
  composite_score:     number

  // Badges (from agent_scores)
  is_verified:     boolean
  is_featured:     boolean
  is_top_rated:    boolean
  is_fastest:      boolean
  is_cheapest:     boolean
  is_most_reliable: boolean

  // Docs
  documentation?: string | null
  is_public:      boolean

  created_at: string
  updated_at: string
}

/** Minimal agent representation for listing and discovery */
export type AgentSummary = Pick<
  MicroAgent,
  "id" | "name" | "slug" | "description" | "category" | "pricing_model"
  | "price_per_call" | "average_rating" | "total_executions" | "composite_score"
  | "is_verified" | "is_featured" | "icon_url" | "status"
>

// ─────────────────────────────────────────────────────────────────────────────
// 2. PIPELINE / DAG — Multi-agent workflows
// ─────────────────────────────────────────────────────────────────────────────

/** A node in the pipeline DAG — wraps a MicroAgent with execution config */
export interface DAGNode {
  id:                      string  // pipeline-local node ID (not agent ID)
  agent_id:                string  // references agents.id
  label:                   string  // display name on canvas
  system_prompt_override?: string  // overrides agent's system_prompt for this node
  input_mapping?:          Record<string, string>  // remaps upstream output fields
  continue_on_failure?:    boolean  // if true, passes null downstream on error
  config?:                 Record<string, unknown>  // arbitrary node-level config
}

/** A directed edge in the pipeline DAG */
export interface DAGEdge {
  from:       string   // source node ID
  to:         string   // target node ID
  condition?: string   // optional: JSONPath condition to traverse edge (future)
}

/** DAG definition stored as JSONB in pipelines.dag */
export interface DAG {
  nodes: DAGNode[]
  edges: DAGEdge[]
}

export type PipelineStatus = "idle" | "running" | "success" | "failed"

/** Pipeline entity — maps to `pipelines` table */
export interface Pipeline {
  id:          string
  owner_id:    string
  name:        string
  description: string | null
  dag:         DAG
  is_public:   boolean
  is_active:   boolean
  status:      PipelineStatus

  // Execution settings
  timeout_seconds:  number
  retry_on_failure: boolean
  max_retries:      number

  // Stats
  total_runs:     number
  successful_runs: number
  run_count:      number
  avg_latency_ms: number
  last_run_at:    string | null

  tags:    string[]
  version: string

  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXECUTION — Runtime records
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionStatus = "queued" | "running" | "success" | "failed" | "timeout"

/** Single agent execution record — maps to `executions` table */
export interface Execution {
  id:         string
  agent_id:   string | null
  user_id:    string | null
  status:     ExecutionStatus
  input:      unknown
  output:     unknown
  error_message?: string | null

  latency_ms:    number | null
  tokens_input:  number | null
  tokens_output: number | null
  cost:          number | null
  cost_usd:      number | null

  created_at:    string
  completed_at:  string | null
}

/** Per-node result within a pipeline execution */
export interface NodeExecutionResult {
  node_id:    string
  agent_id:   string
  agent_name: string
  status:     "success" | "failed"
  input:      unknown
  output:     unknown
  latency_ms: number
  cost:       number
  tokens?:    { input: number; output: number }
  error?:     string
}

/** Pipeline execution record — maps to `pipeline_executions` table */
export interface PipelineExecution {
  id:          string
  pipeline_id: string | null
  user_id:     string | null
  status:      ExecutionStatus
  input:       unknown
  output:      unknown
  error_message?: string | null

  node_results:     NodeExecutionResult[]
  total_latency_ms: number | null
  total_cost:       number
  total_tokens_in:  number
  total_tokens_out: number

  created_at:   string
  completed_at: string | null
}

/**
 * Execution trace — full LLM observability record.
 * Maps to `execution_traces` table.
 */
export interface ExecutionTrace {
  id:              number
  execution_id:    string
  agent_id:        string | null
  user_id:         string | null
  model:           string | null
  system_prompt:   string | null
  user_message:    string | null
  assistant_reply: string | null
  ttft_ms:         number | null   // time to first token
  total_ms:        number | null
  tokens_input:    number | null
  tokens_output:   number | null
  cost_usd:        number | null
  status:          string | null
  error_message:   string | null
  tool_calls:      ToolCall[] | null
  temperature:     number | null
  seed:            number | null
  created_at:      string
}

export interface ToolCall {
  tool_name: string
  input:     Record<string, unknown>
  output:    string
  latency_ms: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RAG — Knowledge & retrieval
// ─────────────────────────────────────────────────────────────────────────────

/** Knowledge base — maps to `knowledge_bases` table */
export interface KnowledgeBase {
  id:          string
  owner_id:    string
  name:        string
  description: string | null
  is_public:   boolean
  doc_count:   number
  max_docs:    number
  created_at:  string
  updated_at:  string
}

/** Raw document ingested into a knowledge base */
export interface RAGDocument {
  id:                string
  knowledge_base_id: string
  owner_id:          string
  title:             string
  content:           string
  chunk_count:       number
  metadata:          Record<string, unknown>
  status:            "pending" | "indexed" | "failed" | "deleted"
  created_at:        string
  updated_at:        string
}

/** Embedded chunk stored with pgvector */
export interface RAGChunk {
  id:                number
  document_id:       string
  knowledge_base_id: string
  owner_id:          string
  chunk_index:       number
  content:           string
  embedding:         number[] | null  // vector(1536)
  char_count:        number
  created_at:        string
}

/** Result from search_rag_chunks RPC */
export interface RAGSearchResult {
  chunk_id:       string
  document_id:    string
  document_title: string
  content:        string
  similarity:     number
  metadata:       Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. REGISTRY — Capability discovery
// ─────────────────────────────────────────────────────────────────────────────

/** Versioned snapshot of a published agent — maps to `agent_registry_versions` */
export interface AgentRegistryVersion {
  id:        string
  agent_id:  string
  version:   string
  changelog: string | null
  snapshot:  Partial<MicroAgent>
  created_at: string
}

/** Quality score record — maps to `agent_scores` */
export interface AgentScore {
  id:               string
  agent_id:         string
  accuracy_score:   number
  latency_score:    number
  cost_score:       number
  reliability_score: number
  popularity_score: number
  composite_score:  number
  is_top_rated:     boolean
  is_fastest:       boolean
  is_cheapest:      boolean
  is_most_reliable: boolean
  category_rank:    number | null
  global_rank:      number | null
  sample_size:      number
  computed_at:      string
  updated_at:       string
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. COMMERCE — Billing, credits, payouts
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionPlan = "free" | "starter" | "pro" | "enterprise"
export type SubscriptionStatus = "active" | "canceled" | "past_due" | "trialing"

/** Platform user profile — maps to `profiles` table */
export interface UserProfile {
  id:         string
  email:      string
  full_name:  string | null
  username:   string | null
  bio:        string | null
  avatar_url: string | null

  role:                      "user" | "seller" | "admin"
  subscription_plan:         SubscriptionPlan
  subscription_status?:      SubscriptionStatus | null
  stripe_customer_id?:       string | null
  stripe_connect_account_id?: string | null
  stripe_connect_onboarded?: boolean

  monthly_execution_quota:    number
  executions_used_this_month: number
  quota_reset_date:           string

  total_earned: number
  is_verified:  boolean

  notification_prefs: NotificationPrefs

  created_at: string
  updated_at: string
}

export interface NotificationPrefs {
  execution_alerts?:   boolean
  revenue_updates?:    boolean
  review_alerts?:      boolean
  system_updates?:     boolean
  weekly_digest?:      boolean
}

/** User credit balance — maps to `credits` table */
export interface UserCredits {
  user_id:         string
  balance_usd:     number
  total_purchased: number
  total_spent:     number
  hard_limit_usd:  number
  alert_threshold: number
  updated_at:      string
}

/** Credit transaction — maps to `credit_transactions` table */
export interface CreditTransaction {
  id:           number
  user_id:      string
  type:         "topup" | "deduction" | "refund" | "bonus"
  amount_usd:   number
  balance_after: number
  description:  string | null
  reference_id: string | null
  created_at:   string
}

/** Payout to a seller — maps to `payouts` table */
export interface Payout {
  id:                string
  seller_id:         string
  amount:            number
  currency:          string
  status:            "pending" | "processing" | "paid" | "failed"
  stripe_transfer_id?: string | null
  period_start:      string
  period_end:        string
  created_at:        string
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. PLATFORM — API keys, notifications, reviews
// ─────────────────────────────────────────────────────────────────────────────

/** API key — maps to `api_keys` table */
export interface ApiKey {
  id:           string
  user_id:      string
  name:         string
  key_hash:     string    // SHA-256 of the raw key
  key_prefix:   string    // first 12 chars (for display)
  is_active:    boolean
  last_used_at: string | null
  total_calls:  number
  created_at:   string
}

/** Notification — maps to `notifications` table */
export interface Notification {
  id:           number
  user_id:      string
  type:         NotificationType
  title:        string
  body:         string
  data:         Record<string, unknown>
  is_read:      boolean
  created_at:   string
}

export type NotificationType =
  | "execution_complete"
  | "execution_failed"
  | "agent_approved"
  | "agent_rejected"
  | "payout_sent"
  | "review_received"
  | "quota_warning"
  | "system"

/** Agent review — maps to `reviews` table */
export interface AgentReview {
  id:        string
  agent_id:  string
  user_id:   string
  rating:    1 | 2 | 3 | 4 | 5
  title?:    string | null
  body?:     string | null
  status:    "pending" | "approved" | "rejected"
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. API CONTRACTS — Request / response types
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/agents/[id]/execute — request body */
export interface ExecuteAgentRequest {
  input:   unknown
  stream?: boolean
}

/** POST /api/agents/[id]/execute — success response */
export interface ExecuteAgentResponse {
  executionId: string
  output:      unknown
  latencyMs:   number
  tokens:      { input: number; output: number }
  cost:        number
  toolCalls?:  number
  ragUsed?:    boolean
  flagged?:    boolean
}

/** POST /api/pipelines/[id]/execute — request body */
export interface ExecutePipelineRequest {
  input:      unknown
  variables?: Record<string, string>
}

/** POST /api/pipelines/[id]/execute — success response */
export interface ExecutePipelineResponse {
  executionId:  string
  status:       "success"
  output:       unknown
  node_results: NodeExecutionResult[]
  summary: {
    nodes_executed:   number
    total_latency_ms: number
    total_cost_usd:   string
    total_tokens:     { input: number; output: number }
  }
}

/** POST /api/rag/ingest — response */
export interface IngestDocumentResponse {
  document_id:    string
  chunks_indexed: number
  knowledge_base: { id: string; name: string }
  status:         "indexed"
}

/** POST /api/rag/query — response */
export interface QueryKnowledgeBaseResponse {
  knowledge_base: { id: string; name: string }
  query:          string
  results:        RAGSearchResult[]
  context_string: string
  result_count:   number
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Basic JSON Schema type for agent input/output schema validation */
export interface JSONSchema {
  type:        "object" | "array" | "string" | "number" | "boolean" | "null"
  properties?: Record<string, JSONSchema>
  items?:      JSONSchema
  required?:   string[]
  enum?:       unknown[]
  description?: string
  default?:    unknown
}

/** Paginated API response wrapper */
export interface PaginatedResponse<T> {
  data:       T[]
  pagination: {
    total:   number
    page:    number
    limit:   number
    pages:   number
    hasNext: boolean
    hasPrev: boolean
  }
}

/** Standard API error response */
export interface APIError {
  error:   string
  code?:   string
  details?: unknown
}
