/**
 * AgentDyne Multi-Provider Model Router
 *
 * Platform holds ONE set of API keys. Users never need their own.
 * This is the standard marketplace model — platform pays LLM providers,
 * charges users via credits/subscriptions, keeps the spread.
 *
 * Required env vars (set in Cloudflare Pages → Environment Variables):
 *   ANTHROPIC_API_KEY   — for all claude-* agents (most common)
 *   OPENAI_API_KEY      — for gpt-* agents AND RAG embeddings
 *   GOOGLE_AI_API_KEY   — for gemini-* agents
 *
 * You do NOT need all three at launch. Start with ANTHROPIC_API_KEY only.
 * Agents using unconfigured providers will get a clear 503 error, not a crash.
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

// ── Cost tracking (USD per 1K tokens, April 2026) ─────────────────────────────

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  // Anthropic — must match SUPPORTED_MODELS in constants.ts exactly
  "claude-opus-4-6":           { input: 0.015,    output: 0.075    },
  "claude-sonnet-4-6":         { input: 0.003,    output: 0.015    },
  "claude-sonnet-4-20250514":  { input: 0.003,    output: 0.015    }, // alias kept for backwards compat
  "claude-haiku-4-5-20251001": { input: 0.00025,  output: 0.00125  },
  // OpenAI
  "gpt-4o":                    { input: 0.005,    output: 0.015    },
  "gpt-4o-mini":               { input: 0.00015,  output: 0.0006   },
  // Google
  "gemini-1.5-pro":            { input: 0.00125,  output: 0.005    },
  "gemini-1.5-flash":          { input: 0.000075, output: 0.0003   },
  _default:                    { input: 0.003,    output: 0.015    },
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const r = COST_PER_1K[model] ?? COST_PER_1K["_default"]!
  return (inputTokens / 1000) * r.input + (outputTokens / 1000) * r.output
}

// ── Provider detection ────────────────────────────────────────────────────────

export type Provider = "anthropic" | "openai" | "google" | "vllm"

export function detectProvider(model: string): Provider {
  if (model.startsWith("claude-"))  return "anthropic"
  if (model.startsWith("gpt-"))     return "openai"
  if (model.startsWith("gemini-"))  return "google"
  if (model.startsWith("vllm/"))    return "vllm"
  return "anthropic"
}

// ── API key validation ────────────────────────────────────────────────────────

const PROVIDER_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai:    "OPENAI_API_KEY",
  google:    "GOOGLE_AI_API_KEY",
  vllm:      "VLLM_BASE_URL",
}

/**
 * validateProviderKey — throws a clear, actionable error if the env var
 * for the required provider is not set. Called before every LLM call so
 * the execute route gets a useful error code instead of a generic 500.
 */
function validateProviderKey(provider: Provider): void {
  const envVar = PROVIDER_ENV[provider]
  const value  = process.env[envVar]
  if (!value || value.trim().length === 0) {
    const providerName = {
      anthropic: "Anthropic (Claude)",
      openai:    "OpenAI (GPT)",
      google:    "Google (Gemini)",
      vllm:      "vLLM (self-hosted)",
    }[provider]
    throw Object.assign(
      new Error(
        `${providerName} API key is not configured. ` +
        `Set ${envVar} in Cloudflare Pages → Settings → Environment Variables. ` +
        `This agent uses a ${providerName} model and cannot run without it.`
      ),
      { code: "PROVIDER_NOT_CONFIGURED", envVar, provider }
    )
  }
}

// ── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(p: LLMCallParams): Promise<LLMResult> {
  validateProviderKey("anthropic")
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const resp = await client.messages.create({
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
  validateProviderKey("anthropic")
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let inputTokens = 0, outputTokens = 0

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

// ── OpenAI / vLLM ─────────────────────────────────────────────────────────────

function getOpenAIConfig(model: string): { baseUrl: string; apiKey: string; modelName: string } {
  if (model.startsWith("vllm/")) {
    validateProviderKey("vllm")
    const base = process.env.VLLM_BASE_URL!
    return { baseUrl: base.replace(/\/$/, ""), apiKey: "EMPTY", modelName: model.slice(5) }
  }
  validateProviderKey("openai")
  return { baseUrl: "https://api.openai.com", apiKey: process.env.OPENAI_API_KEY!, modelName: model }
}

async function callOpenAI(p: LLMCallParams): Promise<LLMResult> {
  const { baseUrl, apiKey, modelName } = getOpenAIConfig(p.model)

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({
      model:       modelName,
      max_tokens:  p.maxTokens,
      temperature: p.temperature,
      messages: [
        { role: "system", content: p.system     },
        { role: "user",   content: p.userMessage },
      ],
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    // Surface the actual API error — not a generic message
    throw new Error(`OpenAI API error ${resp.status}: ${err.slice(0, 300)}`)
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
  const { baseUrl, apiKey, modelName } = getOpenAIConfig(p.model)

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
    throw new Error(`OpenAI API error ${resp.status}: ${err.slice(0, 300)}`)
  }

  const reader  = resp.body?.getReader()
  const decoder = new TextDecoder()
  let inputTokens = 0, outputTokens = 0

  if (!reader) throw new Error("OpenAI stream: no response body")

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (payload === "[DONE]") break
      try {
        const json  = JSON.parse(payload) as any
        const delta = json.choices?.[0]?.delta?.content
        if (delta) onChunk(delta)
        if (json.usage) {
          inputTokens  = json.usage.prompt_tokens     ?? inputTokens
          outputTokens = json.usage.completion_tokens ?? outputTokens
        }
      } catch { /* malformed chunk — skip */ }
    }
  }

  return { inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

// ── Google Gemini ──────────────────────────────────────────────────────────────

async function callGoogle(p: LLMCallParams): Promise<LLMResult> {
  validateProviderKey("google")
  const key      = process.env.GOOGLE_AI_API_KEY!
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${key}`

  const resp = await fetch(endpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      system_instruction: { parts: [{ text: p.system }] },
      contents:           [{ role: "user", parts: [{ text: p.userMessage }] }],
      generationConfig:   { maxOutputTokens: p.maxTokens, temperature: p.temperature },
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error ${resp.status}: ${err.slice(0, 300)}`)
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
  validateProviderKey("google")
  const key      = process.env.GOOGLE_AI_API_KEY!
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:streamGenerateContent?key=${key}&alt=sse`

  const resp = await fetch(endpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      system_instruction: { parts: [{ text: p.system }] },
      contents:           [{ role: "user", parts: [{ text: p.userMessage }] }],
      generationConfig:   { maxOutputTokens: p.maxTokens, temperature: p.temperature },
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini stream error ${resp.status}: ${err.slice(0, 300)}`)
  }

  const reader  = resp.body?.getReader()
  const decoder = new TextDecoder()
  let inputTokens = 0, outputTokens = 0

  if (!reader) throw new Error("Gemini stream: no response body")

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
      } catch { /* malformed SSE chunk */ }
    }
  }

  return { inputTokens, outputTokens, costUsd: estimateCost(p.model, inputTokens, outputTokens) }
}

// ── Public interface ──────────────────────────────────────────────────────────

export async function routeCompletion(p: LLMCallParams): Promise<LLMResult> {
  const provider = detectProvider(p.model)
  switch (provider) {
    case "anthropic": return callAnthropic(p)
    case "openai":    return callOpenAI(p)
    case "vllm":      return callOpenAI(p)
    case "google":    return callGoogle(p)
    default:          return callAnthropic(p)
  }
}

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
 * checkModelSupport — call this in the agent builder before allowing publish.
 * Returns the missing env var name so you can show a clear error in the UI.
 */
export function checkModelSupport(model: string): {
  supported:       boolean
  provider:        string
  providerLabel:   string
  missingEnvVar?:  string
  setupGuide:      string
} {
  const provider = detectProvider(model)
  const envVar   = PROVIDER_ENV[provider]
  const val      = process.env[envVar]
  const missing  = !val || val.trim().length === 0 ? envVar : undefined

  const LABELS: Record<Provider, string> = {
    anthropic: "Anthropic (Claude)",
    openai:    "OpenAI (GPT)",
    google:    "Google (Gemini)",
    vllm:      "Self-hosted vLLM",
  }

  const GUIDES: Record<Provider, string> = {
    anthropic: "console.anthropic.com → API Keys",
    openai:    "platform.openai.com → API Keys",
    google:    "aistudio.google.com → API Keys",
    vllm:      "Set VLLM_BASE_URL to your cluster endpoint",
  }

  return {
    supported:     !missing,
    provider,
    providerLabel: LABELS[provider],
    missingEnvVar: missing,
    setupGuide:    GUIDES[provider],
  }
}

/**
 * getSupportedModels — return only the models whose provider key is configured.
 * Use this in the builder to show only available models, not all theoretical ones.
 */
export function getSupportedModels(): string[] {
  const all = [
    // Anthropic — use exact model strings from constants.ts
    { model: "claude-sonnet-4-6",           provider: "anthropic" as Provider },
    { model: "claude-haiku-4-5-20251001",   provider: "anthropic" as Provider },
    { model: "claude-opus-4-6",             provider: "anthropic" as Provider },
    // OpenAI
    { model: "gpt-4o",      provider: "openai" as Provider },
    { model: "gpt-4o-mini", provider: "openai" as Provider },
    // Google
    { model: "gemini-1.5-pro",   provider: "google" as Provider },
    { model: "gemini-1.5-flash", provider: "google" as Provider },
  ]

  return all
    .filter(({ provider }) => {
      const key = process.env[PROVIDER_ENV[provider]]
      return !!key && key.trim().length > 0
    })
    .map(({ model }) => model)
}
