/**
 * MCP Tool Executor — AgentDyne
 *
 * Converts mcp_server_ids stored on an agent into Anthropic tool definitions,
 * then runs the full tool-use loop:
 *   1. Build tool schemas from agent's selected MCP servers
 *   2. Call Anthropic with tools
 *   3. For each tool_use block, execute the tool via MCP server URL
 *   4. Feed tool_result back — repeat until stop_reason !== "tool_use"
 *   5. Cap at MAX_TOOL_LOOPS to prevent runaway agents
 *
 * Only runs for Anthropic models (claude-*). OpenAI / Gemini paths fall back
 * to the existing direct-call path in routeCompletion.
 */

import { getMCPById } from "./mcp-servers"

export const MAX_TOOL_LOOPS = 6

// ─── Tool schema builder ──────────────────────────────────────────────────────
// Each MCP server maps to a set of Anthropic tool definitions.
// We define the most useful 1-3 tools per server to keep context lean.

export interface AnthropicTool {
  name:         string
  description:  string
  input_schema: {
    type:       "object"
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required:   string[]
  }
}

function buildToolsForServer(serverId: string): AnthropicTool[] {
  const SCHEMAS: Record<string, AnthropicTool[]> = {
    // ── Databases ─────────────────────────────────────────────────────────
    supabase: [
      {
        name: "supabase_query",
        description: "Query a Supabase table with filters, ordering, and pagination.",
        input_schema: {
          type: "object",
          properties: {
            table:  { type: "string", description: "Table name to query" },
            select: { type: "string", description: "Columns to select (comma-separated, default *)" },
            filter: { type: "string", description: "JSON filter object, e.g. {\"status\":\"active\"}" },
            limit:  { type: "string", description: "Max rows to return (default 20)" },
          },
          required: ["table"],
        },
      },
      {
        name: "supabase_insert",
        description: "Insert one or more rows into a Supabase table.",
        input_schema: {
          type: "object",
          properties: {
            table: { type: "string", description: "Table name" },
            data:  { type: "string", description: "JSON object or array of objects to insert" },
          },
          required: ["table", "data"],
        },
      },
    ],

    postgres: [
      {
        name: "postgres_query",
        description: "Execute a SQL SELECT query against the connected Postgres database.",
        input_schema: {
          type: "object",
          properties: {
            sql:    { type: "string", description: "SQL SELECT statement to execute" },
            params: { type: "string", description: "JSON array of parameterized values (optional)" },
          },
          required: ["sql"],
        },
      },
    ],

    github: [
      {
        name: "github_search_code",
        description: "Search GitHub code across repositories.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "GitHub code search query" },
            repo:  { type: "string", description: "Optional: owner/repo to scope the search" },
          },
          required: ["query"],
        },
      },
      {
        name: "github_create_issue",
        description: "Create a GitHub issue in a repository.",
        input_schema: {
          type: "object",
          properties: {
            repo:  { type: "string", description: "Repository in owner/repo format" },
            title: { type: "string", description: "Issue title" },
            body:  { type: "string", description: "Issue body (markdown)" },
          },
          required: ["repo", "title"],
        },
      },
    ],

    slack: [
      {
        name: "slack_post_message",
        description: "Post a message to a Slack channel.",
        input_schema: {
          type: "object",
          properties: {
            channel: { type: "string", description: "Channel name or ID (e.g. #general or C01234)" },
            text:    { type: "string", description: "Message text (supports Slack markdown)" },
          },
          required: ["channel", "text"],
        },
      },
      {
        name: "slack_search_messages",
        description: "Search messages in a Slack workspace.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            count: { type: "string", description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
    ],

    gmail: [
      {
        name: "gmail_search",
        description: "Search Gmail messages using Gmail search syntax.",
        input_schema: {
          type: "object",
          properties: {
            query:   { type: "string", description: "Gmail search query (e.g. 'from:alice subject:invoice')" },
            max:     { type: "string", description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "gmail_send",
        description: "Send an email via Gmail.",
        input_schema: {
          type: "object",
          properties: {
            to:      { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body:    { type: "string", description: "Email body (plain text or HTML)" },
          },
          required: ["to", "subject", "body"],
        },
      },
    ],

    notion: [
      {
        name: "notion_search",
        description: "Search Notion pages and databases by title.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "string", description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "notion_create_page",
        description: "Create a new Notion page.",
        input_schema: {
          type: "object",
          properties: {
            parent_id: { type: "string", description: "Parent page or database ID" },
            title:     { type: "string", description: "Page title" },
            content:   { type: "string", description: "Page content in plain text" },
          },
          required: ["parent_id", "title"],
        },
      },
    ],

    stripe: [
      {
        name: "stripe_get_customer",
        description: "Look up a Stripe customer by email or ID.",
        input_schema: {
          type: "object",
          properties: {
            email:       { type: "string", description: "Customer email (use email or id)" },
            customer_id: { type: "string", description: "Stripe customer ID (use email or id)" },
          },
          required: [],
        },
      },
      {
        name: "stripe_list_charges",
        description: "List recent Stripe charges, optionally filtered by customer.",
        input_schema: {
          type: "object",
          properties: {
            customer_id: { type: "string", description: "Filter by Stripe customer ID (optional)" },
            limit:       { type: "string", description: "Max results (default 10)" },
          },
          required: [],
        },
      },
    ],

    hubspot: [
      {
        name: "hubspot_search_contacts",
        description: "Search HubSpot contacts by name, email, or company.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "string", description: "Max results (default 10)" },
          },
          required: ["query"],
        },
      },
    ],

    "google-calendar": [
      {
        name: "gcal_list_events",
        description: "List upcoming Google Calendar events.",
        input_schema: {
          type: "object",
          properties: {
            days:     { type: "string", description: "Number of days ahead to look (default 7)" },
            calendar: { type: "string", description: "Calendar ID (default: primary)" },
          },
          required: [],
        },
      },
      {
        name: "gcal_create_event",
        description: "Create a Google Calendar event.",
        input_schema: {
          type: "object",
          properties: {
            title:      { type: "string", description: "Event title" },
            start:      { type: "string", description: "Start datetime ISO 8601 (e.g. 2026-04-20T14:00:00Z)" },
            end:        { type: "string", description: "End datetime ISO 8601" },
            description:{ type: "string", description: "Event description (optional)" },
          },
          required: ["title", "start", "end"],
        },
      },
    ],

    pinecone: [
      {
        name: "pinecone_query",
        description: "Semantic search in a Pinecone index using a text query.",
        input_schema: {
          type: "object",
          properties: {
            index:  { type: "string", description: "Pinecone index name" },
            query:  { type: "string", description: "Query text (will be embedded automatically)" },
            top_k:  { type: "string", description: "Number of results (default 5)" },
          },
          required: ["index", "query"],
        },
      },
    ],

    aws: [
      {
        name: "aws_s3_list",
        description: "List objects in an S3 bucket with optional prefix.",
        input_schema: {
          type: "object",
          properties: {
            bucket: { type: "string", description: "S3 bucket name" },
            prefix: { type: "string", description: "Key prefix filter (optional)" },
          },
          required: ["bucket"],
        },
      },
      {
        name: "aws_s3_get",
        description: "Get the content of an S3 object as text.",
        input_schema: {
          type: "object",
          properties: {
            bucket: { type: "string", description: "S3 bucket name" },
            key:    { type: "string", description: "Object key/path" },
          },
          required: ["bucket", "key"],
        },
      },
    ],

    browserbase: [
      {
        name: "web_navigate",
        description: "Navigate to a URL and return the page title and main text content.",
        input_schema: {
          type: "object",
          properties: {
            url:     { type: "string", description: "URL to navigate to" },
            extract: { type: "string", description: "CSS selector to extract specific content (optional)" },
          },
          required: ["url"],
        },
      },
    ],
  }

  // Generic fallback for servers without a predefined schema
  const tools = SCHEMAS[serverId]
  if (tools) return tools

  // Build a generic tool from server metadata
  const srv = getMCPById(serverId)
  if (!srv) return []

  return [{
    name: `${serverId.replace(/[^a-z0-9_]/g, "_")}_call`,
    description: srv.description,
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: `Action to perform: ${srv.capabilities.slice(0, 4).join(", ")}` },
        params: { type: "string", description: "JSON string of action parameters" },
      },
      required: ["action"],
    },
  }]
}

export function buildToolDefinitions(mcpServerIds: string[]): AnthropicTool[] {
  const tools: AnthropicTool[] = []
  for (const id of mcpServerIds) {
    tools.push(...buildToolsForServer(id))
  }
  return tools
}

// ─── Tool executor ─────────────────────────────────────────────────────────────
// Makes HTTP calls to the actual MCP server URL with the tool arguments.
// Returns a string result to feed back into the model.

export async function executeTool(
  toolName:  string,
  toolInput: Record<string, unknown>,
  mcpServerIds: string[]
): Promise<string> {
  // Find which server this tool belongs to
  let matchedServerId: string | null = null
  for (const id of mcpServerIds) {
    const tools = buildToolsForServer(id)
    if (tools.some(t => t.name === toolName)) {
      matchedServerId = id
      break
    }
  }

  if (!matchedServerId) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }

  const srv = getMCPById(matchedServerId)
  if (!srv?.url) {
    // Server has no URL configured — return a descriptive mock result
    // so the agent can still respond meaningfully
    return JSON.stringify({
      note: `Tool ${toolName} requires ${srv?.name || matchedServerId} to be configured with valid credentials. This is a simulation — connect ${srv?.name || matchedServerId} in Builder Studio → MCP Tools to enable real execution.`,
      tool:   toolName,
      input:  toolInput,
      status: "simulated",
    })
  }

  try {
    // MCP servers accept JSON-RPC tool calls
    const resp = await fetch(srv.url, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept":       "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id:      1,
        method:  "tools/call",
        params:  { name: toolName, arguments: toolInput },
      }),
      signal: AbortSignal.timeout(8_000), // 8s per tool call
    })

    if (!resp.ok) {
      return JSON.stringify({ error: `Tool call failed: HTTP ${resp.status}` })
    }

    const data = await resp.json() as any
    if (data.error) {
      return JSON.stringify({ error: data.error.message ?? "Tool error" })
    }

    // MCP result content is an array of { type, text } blocks
    const content = data.result?.content
    if (Array.isArray(content)) {
      const texts = content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
      return texts || JSON.stringify(data.result)
    }

    return JSON.stringify(data.result ?? data)
  } catch (err: any) {
    if (err.name === "TimeoutError") {
      return JSON.stringify({ error: `Tool ${toolName} timed out after 8s` })
    }
    return JSON.stringify({ error: err.message ?? "Tool execution failed" })
  }
}

// ─── Main tool-use loop ───────────────────────────────────────────────────────

export interface ToolLoopResult {
  text:         string
  inputTokens:  number
  outputTokens: number
  costUsd:      number
  toolCallCount: number
}

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6":           { input: 0.015,   output: 0.075   },
  "claude-sonnet-4-20250514":  { input: 0.003,   output: 0.015   },
  "claude-haiku-4-5-20251001": { input: 0.00025, output: 0.00125 },
  _default:                    { input: 0.003,   output: 0.015   },
}

function estimateCost(model: string, inputTok: number, outputTok: number): number {
  const rates = COST_PER_1K[model] ?? COST_PER_1K["_default"]!
  return (inputTok / 1000) * rates.input + (outputTok / 1000) * rates.output
}

export async function runAnthropicToolLoop(params: {
  model:        string
  system:       string
  userMessage:  string
  maxTokens:    number
  temperature:  number
  mcpServerIds: string[]
}): Promise<ToolLoopResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const tools = buildToolDefinitions(params.mcpServerIds)
  const messages: any[] = [{ role: "user", content: params.userMessage }]

  let totalInput  = 0
  let totalOutput = 0
  let toolCallCount = 0
  let finalText   = ""

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const resp = await client.messages.create({
      model:       params.model,
      max_tokens:  params.maxTokens,
      system:      params.system,
      temperature: params.temperature,
      tools:       tools as any,
      messages,
    })

    totalInput  += resp.usage.input_tokens
    totalOutput += resp.usage.output_tokens

    // Collect text content
    const textBlocks = resp.content.filter(b => b.type === "text")
    if (textBlocks.length > 0) {
      finalText = textBlocks.map(b => (b as any).text).join("")
    }

    // Done — no more tool calls
    if (resp.stop_reason !== "tool_use") break

    // Process tool calls
    const toolUseBlocks = resp.content.filter(b => b.type === "tool_use")
    if (toolUseBlocks.length === 0) break

    toolCallCount += toolUseBlocks.length

    // Add assistant turn with all content blocks
    messages.push({ role: "assistant", content: resp.content })

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block: any) => {
        const result = await executeTool(block.name, block.input, params.mcpServerIds)
        return {
          type:        "tool_result",
          tool_use_id: block.id,
          content:     result,
        }
      })
    )

    // Add user turn with tool results
    messages.push({ role: "user", content: toolResults })
  }

  return {
    text:         finalText,
    inputTokens:  totalInput,
    outputTokens: totalOutput,
    costUsd:      estimateCost(params.model, totalInput, totalOutput),
    toolCallCount,
  }
}
