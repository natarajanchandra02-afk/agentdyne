/**
 * AgentDyne Multi-Provider Model Router
 *
 * Dispatches LLM calls to the correct provider using native fetch.
 * NO external npm packages beyond @anthropic-ai/sdk (already in package.json).
 *
 * Supported providers:
 *   claude-*   → Anthropic (via @anthropic-ai/sdk)
 *   gpt-*      → OpenAI (via fetch to api.openai.com — OpenAI-compatible REST)
 *   gemini-*   → Google Gemini (via fetch to generativelanguage.googleapis.com)
 *   vllm/*     → Self-hosted vLLM (fetch to VLLM_BASE_URL — OpenAI-compatible)
 *
 * Design:
 *   - All providers return the same LLMResult interface
 *   - Stream path calls onChunk for each text delta
 *   - Unknown models fall back to Anthropic (safe default)
 *   - Zero Node.js runtime deps — works in Cloudflare Workers
 *
 * Cost tracking:
 *   Update COST_PER_1K_TOKENS when providers change pricing.
 */

export interface LLMCallParams {
  model:       string
  system:      string
  userMessage: string
  maxTokens:   number
  temperature: number
}

export interface LLMResult {
  text:         string
  inputTokens:  number
  outputTokens: number
  costUsd:      number
}

export type StreamChunkHandler = (chunk: string) => void

// ── Per-provider cost (USD per 1K tokens) — update as pricing changes ─────────
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  // Anthropic (April 2026)
  "claude-opus-4-6":           { input: 0.015,    output: 0.075    },
  "claude-sonnet-4-20250514":  { input: 0.003,    output: 0.015    },
  "claude-haiku-4-5-20251001": { input: 0.00025,  output: 0.00125  },
  // OpenAI (April 2026)
  "gpt-4o":                    { input: 0.005,    output: 0.015    },
  "gpt-4o-mini":               { input: 0.00015,  output: 0.0006   },
  // Google (April 2026)
  "gemini-1.5-pro":            { input: 0.00125,  output: 0.005    },
  "gemini-1.5-flash":          { input: 0.000075, output: 0.0003   },
  // Safe default for unknown models
  _default:                    { input: 0.003,    output: 0.015    },
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1K[model] ?? COST_PER_1K["_default"]!
  return (inputTokens  / 1000) * rates.input
       + (outputTokens / 1000) * rates.output
}

// ── Provider detection ────────────────────────────────────────────────────────

type Provider = "anthropic" | "openai" | "google" | "vllm"

function detectProvider(model: string): Provider {
  if (model.startsWith("claude-"))  return "anthropic"
  if (model.startsWith("gpt-"))     return "openai"
  if (model.startsWith("gemini-"))  return "google"
  if (model.startsWith("vllm/"))    return "vllm"
  return "anthropic"  // safe fallback
}

// ── ANTHROPIC (via SDK — already in package.json) ────────────────────────────

async function callAnthropic(p: LLMCallParams): Promise<LLMResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const resp   = await client.messages.create({
    model:       p.model,
    max_tokens:  p.maxTokens,
    system:      p.system,
    messages:    [{ role: "user", content: p.userMessage }],
    temperature: p.temperature,
  })

  const text         = resp.content[0]?.type === "text" ? resp.content[0].text : ""
  const inputTokens  = resp.usage.input_tokens
  const outputTokens = resp.usage.output_tokens
  return { text, inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

async function streamAnthropic(
  p: LLMCallParams,
  onChunk: StreamChunkHandler
): Promise<{ inputTokens: number; outputTokens: number; costUsd: number }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let inputTokens = 0; let outputTokens = 0

  const stream = client.messages.stream({
    model:       p.model,
    max_tokens:  p.maxTokens,
    system:      p.system,
    messages:    [{ role: "user", content: p.userMessage }],
    temperature: p.temperature,
  })

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onChunk(event.delta.text)
    }
    if (event.type === "message_start") inputTokens  = event.message.usage.input_tokens
    if (event.type === "message_delta") outputTokens = event.usage?.output_tokens ?? 0
  }

  return { inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

// ── OPENAI / vLLM (via fetch — OpenAI-compatible REST, no npm package) ────────
// Using fetch directly avoids adding the `openai` package as a dependency.
// vLLM exposes the same /v1/chat/completions endpoint, so both share this code.

function getOpenAIEndpoint(model: string): { baseUrl: string; apiKey: string; modelName: string } {
  if (model.startsWith("vllm/")) {
    const base = process.env.VLLM_BASE_URL
    if (!base) throw new Error("VLLM_BASE_URL is not set. Add it to your environment variables.")
    return { baseUrl: base.replace(/\/$/, ""), apiKey: "EMPTY", modelName: model.slice(5) }
  }
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error("OPENAI_API_KEY is not set. Add it to your environment variables.")
  return { baseUrl: "https://api.openai.com", apiKey: key, modelName: model }
}

async function callOpenAI(p: LLMCallParams): Promise<LLMResult> {
  const { baseUrl, apiKey, modelName } = getOpenAIEndpoint(p.model)

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      model:       modelName,
      max_tokens:  p.maxTokens,
      temperature: p.temperature,
      messages: [
        { role: "system", content: p.system      },
        { role: "user",   content: p.userMessage  },
      ],
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenAI API error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const data         = await resp.json() as any
  const text         = data.choices?.[0]?.message?.content ?? ""
  const inputTokens  = data.usage?.prompt_tokens     ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0
  return { text, inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

async function streamOpenAI(
  p: LLMCallParams,
  onChunk: StreamChunkHandler
): Promise<{ inputTokens: number; outputTokens: number; costUsd: number }> {
  const { baseUrl, apiKey, modelName } = getOpenAIEndpoint(p.model)

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      model:       modelName,
      max_tokens:  p.maxTokens,
      temperature: p.temperature,
      stream:      true,
      messages: [
        { role: "system", content: p.system     },
        { role: "user",   content: p.userMessage },
      ],
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenAI API error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const reader  = resp.body?.getReader()
  const decoder = new TextDecoder()
  let inputTokens = 0; let outputTokens = 0

  if (!reader) throw new Error("OpenAI stream: no response body")

  // Correctly exit loop on stream end
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:"))    continue
      const payload = trimmed.slice(5).trim()
      if (payload === "[DONE]")            break

      try {
        const json = JSON.parse(payload) as any
        const delta = json.choices?.[0]?.delta?.content
        if (delta) onChunk(delta)
        // Some providers include usage in the stream final chunk
        if (json.usage) {
          inputTokens  = json.usage.prompt_tokens     ?? inputTokens
          outputTokens = json.usage.completion_tokens ?? outputTokens
        }
      } catch {
        // Malformed chunk — skip silently
      }
    }
  }

  return { inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

// ── GOOGLE GEMINI (via fetch — edge-native REST) ───────────────────────────────

async function callGoogle(p: LLMCallParams): Promise<LLMResult> {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) throw new Error("GOOGLE_AI_API_KEY is not set. Add it to your environment variables.")

  // Model name in Gemini API includes the full identifier
  const modelId  = p.model  // e.g. "gemini-1.5-pro"
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`

  const resp = await fetch(endpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: p.system }] },
      contents: [{ role: "user", parts: [{ text: p.userMessage }] }],
      generationConfig: { maxOutputTokens: p.maxTokens, temperature: p.temperature },
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const data         = await resp.json() as any
  const text         = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  const inputTokens  = data.usageMetadata?.promptTokenCount     ?? 0
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0
  return { text, inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

async function streamGoogle(
  p: LLMCallParams,
  onChunk: StreamChunkHandler
): Promise<{ inputTokens: number; outputTokens: number; costUsd: number }> {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) throw new Error("GOOGLE_AI_API_KEY is not set. Add it to your environment variables.")

  const modelId  = p.model
  // alt=sse returns Server-Sent Events (line-by-line JSON)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${key}&alt=sse`

  const resp = await fetch(endpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: p.system }] },
      contents: [{ role: "user", parts: [{ text: p.userMessage }] }],
      generationConfig: { maxOutputTokens: p.maxTokens, temperature: p.temperature },
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini stream error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const reader  = resp.body?.getReader()
  const decoder = new TextDecoder()
  let inputTokens = 0; let outputTokens = 0

  if (!reader) throw new Error("Gemini stream: no response body")

  // FIX: use while(true) + break on done — NOT while(reader) which is always truthy
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === "[DONE]") continue

      try {
        const json  = JSON.parse(payload) as any
        const chunk = json.candidates?.[0]?.content?.parts?.[0]?.text
        if (chunk) onChunk(chunk)
        if (json.usageMetadata) {
          inputTokens  = json.usageMetadata.promptTokenCount     ?? inputTokens
          outputTokens = json.usageMetadata.candidatesTokenCount ?? outputTokens
        }
      } catch {
        // Malformed SSE chunk — skip
      }
    }
  }

  return { inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * routeCompletion — single blocking LLM call.
 * Dispatches to the correct provider based on model_name prefix.
 */
export async function routeCompletion(p: LLMCallParams): Promise<LLMResult> {
  const provider = detectProvider(p.model)
  switch (provider) {
    case "anthropic": return callAnthropic(p)
    case "openai":    return callOpenAI(p)
    case "vllm":      return callOpenAI(p)    // vLLM is OpenAI-compatible
    case "google":    return callGoogle(p)
    default:          return callAnthropic(p) // safe fallback
  }
}

/**
 * routeStream — streaming LLM call.
 * Calls onChunk for each text delta as it arrives.
 * Returns total token counts + estimated cost when stream ends.
 */
export async function routeStream(
  p: LLMCallParams,
  onChunk: StreamChunkHandler
): Promise<{ inputTokens: number; outputTokens: number; costUsd: number }> {
  const provider = detectProvider(p.model)
  switch (provider) {
    case "anthropic": return streamAnthropic(p, onChunk)
    case "openai":    return streamOpenAI(p, onChunk)
    case "vllm":      return streamOpenAI(p, onChunk)
    case "google":    return streamGoogle(p, onChunk)
    default:          return streamAnthropic(p, onChunk)
  }
}

/**
 * checkModelSupport — verify a model is supported and its env var is set.
 * Use this in builder validation to give sellers a clear error.
 */
export function checkModelSupport(model: string): {
  supported:      boolean
  provider:       string
  missingEnvVar?: string
} {
  const provider = detectProvider(model)
  const envMap: Record<Provider, { envVar: string; label: string }> = {
    anthropic: { envVar: "ANTHROPIC_API_KEY", label: "Anthropic" },
    openai:    { envVar: "OPENAI_API_KEY",    label: "OpenAI"    },
    vllm:      { envVar: "VLLM_BASE_URL",     label: "vLLM"      },
    google:    { envVar: "GOOGLE_AI_API_KEY", label: "Google"    },
  }
  const info    = envMap[provider]
  const missing = process.env[info.envVar] ? undefined : info.envVar
  return { supported: !missing, provider: info.label, missingEnvVar: missing }
}
