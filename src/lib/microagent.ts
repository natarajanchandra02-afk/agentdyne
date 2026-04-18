/**
 * AgentDyne MicroAgent — Core Type System
 *
 * This is the foundational schema that every agent in the marketplace must
 * conform to. It defines:
 *
 *   1. MicroAgent interface       — the strict execution contract
 *   2. JSON Schema types          — for input/output validation
 *   3. Composability rules        — how agents chain together
 *   4. Agent capability registry  — declarative capability tagging
 *   5. Execution context          — runtime state passed to execute()
 *   6. Execution result           — standardised output envelope
 *
 * Architecture principle:
 *   Every agent is a function: (context: ExecutionContext) => Promise<ExecutionResult>
 *   The MicroAgent interface wraps this function with metadata that enables:
 *     - Type-safe composition (output schema → input schema matching)
 *     - Cost estimation before execution
 *     - Capability discovery in the registry
 *     - Versioned deployments with backward compatibility
 *
 * Usage:
 *   - Marketplace listings are stored as AgentManifest (serialisable subset)
 *   - The execute route validates input against inputSchema before calling LLM
 *   - The pipeline executor uses outputSchema to validate inter-node data flow
 *   - ThoughtGate uses the capability tags for intent matching
 */

// ─────────────────────────────────────────────────────────────────────────────
// JSON SCHEMA TYPES (edge-compatible, no ajv)
// ─────────────────────────────────────────────────────────────────────────────

export type JSONSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null"

export interface JSONSchema {
  type:                 JSONSchemaType | JSONSchemaType[]
  title?:               string
  description?:         string
  properties?:          Record<string, JSONSchema>
  items?:               JSONSchema
  required?:            string[]
  enum?:                unknown[]
  format?:              string            // "email" | "uri" | "date-time" | "uuid"
  minLength?:           number
  maxLength?:           number
  minimum?:             number
  maximum?:             number
  pattern?:             string
  additionalProperties?: boolean | JSONSchema
  default?:             unknown
  examples?:            unknown[]
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT TYPE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent types define how the agent processes data.
 * The execute route uses this to determine routing and timeout strategy.
 */
export type MicroAgentType =
  | "llm"         // Standard LLM agent — system prompt + user message → text
  | "retriever"   // RAG retrieval — query → ranked document chunks
  | "tool"        // MCP tool agent — calls external APIs/services
  | "validator"   // Validates structured data against a schema
  | "router"      // Routes input to one of N downstream agents
  | "transform"   // Pure data transformation (no LLM required)
  | "classifier"  // Classifies input into one of N categories
  | "composer"    // Orchestrates a pipeline of sub-agents

/**
 * Pricing model for marketplace agents.
 * Determines how executions are billed.
 */
export type PricingModel =
  | "free"
  | "per_call"
  | "subscription"
  | "freemium"

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ExecutionContext — runtime state passed to every agent execution.
 * Agents receive this and may read memory, RAG context, and tool state.
 */
export interface ExecutionContext {
  // Identity
  executionId:   string            // Unique ID for this execution (UUID)
  agentId:       string            // Agent being executed
  userId:        string            // Caller's user ID
  sessionId?:    string            // Optional session for multi-turn memory

  // Input
  input:         unknown           // Raw input from caller (validated against inputSchema)
  variables?:    Record<string, string>  // Template variables for prompt interpolation

  // Knowledge / memory
  ragContext?:   string            // Pre-built context string from RAG retrieval
  memory?:       AgentMemory       // Short + long term memory for this user/agent pair

  // Execution parameters
  model?:        string            // Override model for this call
  maxTokens?:    number            // Override max tokens
  temperature?:  number            // Override temperature [0,1]
  stream?:       boolean           // Whether to stream the response

  // Runtime state (pipeline context)
  pipelineId?:   string            // Set when running inside a pipeline
  nodeId?:       string            // Set when running as a pipeline node
  nodeIndex?:    number            // Position in pipeline (0-based)
  previousOutput?: unknown         // Output of the upstream node in a pipeline

  // Security
  guardrailsEnabled?: boolean      // Default true
  strictPII?:         boolean      // Block requests with PII in input
}

/**
 * ExecutionResult — standardised output envelope from every agent execution.
 * This is what the execute route returns to callers.
 */
export interface ExecutionResult {
  // Core output
  output:        unknown           // Validated against outputSchema; JSON or string
  rawText?:      string            // Raw LLM response before any post-processing

  // Observability
  executionId:   string
  latencyMs:     number
  tokens?:       { input: number; output: number }
  costUsd?:      number

  // Quality signals
  flagged?:      boolean           // True if guardrails detected something
  flagReason?:   string            // Which guardrail triggered
  ragUsed?:      boolean           // Whether RAG context was injected
  toolCallCount?: number           // Number of MCP tool calls made

  // Structured output validation
  outputValid?:  boolean           // Whether output conforms to outputSchema
  outputErrors?: string[]          // Schema validation errors (if any)

  // ThoughtGate metadata (when ThoughtGate is active)
  thoughtgate?: {
    intentType:          string
    intentDepth:         string
    templateUsed?:       string
    tokenBudgetUsed:     number
    tokenBudgetAllocated: number
    intentPreservation?: number   // 0–1 score
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT MEMORY
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  key:        string
  value:      unknown
  ttl_at?:    string      // ISO 8601 — null means permanent
  created_at: string
  updated_at: string
}

export interface AgentMemory {
  shortTerm:  MemoryEntry[]   // Current session (volatile, in-context)
  longTerm:   MemoryEntry[]   // Persisted across sessions (from agent_memory table)
}

// ─────────────────────────────────────────────────────────────────────────────
// MICROAGENT INTERFACE (the core contract)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MicroAgent — the strict schema every agent must conform to.
 *
 * Agents in the marketplace are stored as AgentManifest (DB record).
 * At runtime they are hydrated into a MicroAgent by the execute route.
 */
export interface MicroAgent {
  // Identity
  id:           string            // UUID — matches agents.id in Postgres
  name:         string            // Human-readable name
  slug:         string            // URL-safe identifier
  version:      string            // Semver: "1.0.0"

  // Type + capabilities
  type:         MicroAgentType
  capabilities: string[]          // e.g. ["summarize", "classify", "extract"]
  inputTypes:   string[]          // e.g. ["text", "json", "url"]
  outputTypes:  string[]          // e.g. ["text", "json", "markdown"]
  languages:    string[]          // ISO 639-1: ["en", "es", "fr"]

  // I/O schema (enables type-safe pipeline composition)
  inputSchema:  JSONSchema
  outputSchema: JSONSchema

  // LLM configuration
  model:        string            // e.g. "claude-sonnet-4-20250514"
  systemPrompt: string            // Base system prompt
  maxTokens:    number            // Hard cap on output tokens
  temperature:  number            // [0, 1]

  // Cost model
  pricing:      PricingModel
  pricePerCall: number            // USD; 0 for free agents
  estimatedCost(inputTokens: number): number  // Cost estimator function

  // Performance characteristics (from agent_scores)
  avgLatencyMs: number
  successRate:  number            // 0–1

  // Composability rules
  composability: ComposabilityRules

  // Execution function
  execute(ctx: ExecutionContext): Promise<ExecutionResult>
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSABILITY RULES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ComposabilityRules define how this agent can chain with others.
 * The pipeline builder uses these to validate connections and suggest chains.
 */
export interface ComposabilityRules {
  // What this agent can feed into (output compatible with)
  outputCompatibleWith: string[]  // Input types this agent's output can feed

  // What this agent can accept from (input compatible with)
  inputCompatibleWith:  string[]  // Output types this agent can accept

  // Whether this agent is safe to run in parallel with itself
  parallelSafe:         boolean   // Default: true

  // Max concurrent instances (rate-limiting for expensive agents)
  maxConcurrency:       number    // Default: 10; -1 = unlimited

  // Whether this agent maintains state between calls
  stateful:             boolean   // Stateful agents can't be parallelised safely

  // Agents that work particularly well before this one
  suggestedPredecessors?: string[]  // Agent slugs

  // Agents that work particularly well after this one
  suggestedSuccessors?:   string[]  // Agent slugs
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT MANIFEST (serialisable DB record subset)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AgentManifest — the serialisable, DB-storable form of a MicroAgent.
 * This is what gets stored in the agents table and returned by the registry API.
 * It does NOT include the execute() function (functions are not serialisable).
 */
export interface AgentManifest {
  id:             string
  name:           string
  slug:           string
  description:    string
  version:        string
  type:           MicroAgentType
  capabilities:   string[]
  inputTypes:     string[]
  outputTypes:    string[]
  languages:      string[]
  inputSchema:    JSONSchema
  outputSchema:   JSONSchema
  model:          string
  maxTokens:      number
  temperature:    number
  pricing:        PricingModel
  pricePerCall:   number
  avgLatencyMs:   number
  successRate:    number
  composability:  ComposabilityRules
  sellerId:       string
  createdAt:      string
  updatedAt:      string
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA VALIDATION (edge-native, no ajv)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid:  boolean
  errors: string[]
}

/**
 * validateAgainstSchema — lightweight JSON Schema validator for the edge.
 * Validates type, required fields, and string length constraints.
 * Not a full JSON Schema implementation — covers 95% of real-world cases.
 */
export function validateAgainstSchema(
  data:   unknown,
  schema: JSONSchema,
  path  = "root"
): ValidationResult {
  const errors: string[] = []

  if (data === null || data === undefined) {
    if (!Array.isArray(schema.type) || !schema.type.includes("null")) {
      errors.push(`${path}: value is null/undefined but schema does not allow null`)
    }
    return { valid: errors.length === 0, errors }
  }

  // Type check
  const actualType = Array.isArray(data) ? "array" : typeof data
  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]

  if (!allowedTypes.some(t => t === actualType || (t === "integer" && Number.isInteger(data)))) {
    errors.push(`${path}: expected type ${allowedTypes.join("|")}, got ${actualType}`)
    return { valid: false, errors }
  }

  // String constraints
  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${path}: string too short (min ${schema.minLength}, got ${data.length})`)
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push(`${path}: string too long (max ${schema.maxLength}, got ${data.length})`)
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(data)) {
      errors.push(`${path}: string does not match pattern ${schema.pattern}`)
    }
    if (schema.enum !== undefined && !schema.enum.includes(data)) {
      errors.push(`${path}: value "${data}" not in enum [${schema.enum.join(", ")}]`)
    }
  }

  // Number constraints
  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${path}: ${data} < minimum ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${path}: ${data} > maximum ${schema.maximum}`)
    }
  }

  // Object properties + required fields
  if (typeof data === "object" && !Array.isArray(data) && data !== null) {
    const obj = data as Record<string, unknown>

    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          errors.push(`${path}.${field}: required field is missing`)
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          const nested = validateAgainstSchema(obj[key], propSchema, `${path}.${key}`)
          errors.push(...nested.errors)
        }
      }
    }
  }

  // Array items
  if (Array.isArray(data) && schema.items) {
    data.forEach((item, i) => {
      const nested = validateAgainstSchema(item, schema.items!, `${path}[${i}]`)
      errors.push(...nested.errors)
    })
  }

  return { valid: errors.length === 0, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSABILITY CHECKER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if agentA's output is compatible with agentB's input.
 * Used by the pipeline builder to validate connections.
 */
export function isCompatible(a: Pick<MicroAgent, "composability" | "outputTypes">, b: Pick<MicroAgent, "composability" | "inputTypes">): boolean {
  // Check if any of A's output types appear in B's input-compatible list
  return a.outputTypes.some(outType =>
    b.inputTypes.includes(outType) ||
    b.composability.inputCompatibleWith.includes(outType)
  )
}

/**
 * Estimate cost of a single execution in USD.
 */
export function estimateExecutionCost(
  agent: Pick<AgentManifest, "pricePerCall" | "pricing">,
  inputChars: number
): number {
  if (agent.pricing === "free") return 0
  // Rough token estimate: 4 chars ≈ 1 token
  const estTokens = Math.ceil(inputChars / 4)
  return agent.pricePerCall + estTokens * 0.000003 // $0.003 per 1K tokens baseline
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDARD SCHEMAS (reusable input/output schemas for common agent types)
// ─────────────────────────────────────────────────────────────────────────────

export const STANDARD_SCHEMAS = {
  textInput: {
    type: "object" as const,
    properties: {
      input: { type: "string" as const, description: "The text input to process", maxLength: 32000 },
    },
    required: ["input"],
  } satisfies JSONSchema,

  textOutput: {
    type: "object" as const,
    properties: {
      output: { type: "string" as const, description: "The processed text output" },
    },
    required: ["output"],
  } satisfies JSONSchema,

  jsonInput: {
    type: "object" as const,
    description: "Accepts any valid JSON object as input",
    additionalProperties: true,
  } satisfies JSONSchema,

  classifierOutput: {
    type: "object" as const,
    properties: {
      label:       { type: "string" as const, description: "Predicted class label" },
      confidence:  { type: "number" as const, minimum: 0, maximum: 1 },
      explanation: { type: "string" as const, description: "Reasoning for the classification" },
    },
    required: ["label", "confidence"],
  } satisfies JSONSchema,

  summaryOutput: {
    type: "object" as const,
    properties: {
      summary:    { type: "string" as const, description: "The summary text" },
      key_points: { type: "array" as const, items: { type: "string" as const }, description: "Key bullet points" },
      word_count: { type: "integer" as const, minimum: 0 },
    },
    required: ["summary"],
  } satisfies JSONSchema,
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT COMPOSABILITY RULES
// ─────────────────────────────────────────────────────────────────────────────

export function defaultComposability(
  overrides: Partial<ComposabilityRules> = {}
): ComposabilityRules {
  return {
    outputCompatibleWith: ["text", "json", "markdown"],
    inputCompatibleWith:  ["text", "json", "markdown"],
    parallelSafe:         true,
    maxConcurrency:       10,
    stateful:             false,
    ...overrides,
  }
}
