export const runtime = 'edge'

/**
 * GET /api/agents/models
 *
 * Returns which LLM models are available on this platform instance.
 * Used by Builder Studio to show only models whose API keys are configured.
 * Prevents agents from being built with models that would always fail at runtime.
 */

import { NextRequest, NextResponse } from "next/server"
import { apiRateLimit } from "@/lib/rate-limit"

const MODELS = [
  { id: "claude-sonnet-4-20250514",  name: "Claude Sonnet 4 (Recommended)", provider: "anthropic", envVar: "ANTHROPIC_API_KEY", tier: "balanced", costPer1k: { input: 0.003,    output: 0.015    }, maxTokens: 8192, description: "Best balance of speed and capability. Recommended for most agents." },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (Fastest)",    provider: "anthropic", envVar: "ANTHROPIC_API_KEY", tier: "fast",     costPer1k: { input: 0.00025,  output: 0.00125  }, maxTokens: 8192, description: "Fastest and cheapest Claude. Best for simple, high-volume tasks." },
  { id: "claude-opus-4-6",           name: "Claude Opus 4.6 (Most Capable)", provider: "anthropic", envVar: "ANTHROPIC_API_KEY", tier: "premium",  costPer1k: { input: 0.015,    output: 0.075    }, maxTokens: 8192, description: "Most powerful reasoning. Best for complex analysis tasks." },
  { id: "gpt-4o",                    name: "GPT-4o",                         provider: "openai",    envVar: "OPENAI_API_KEY",    tier: "balanced", costPer1k: { input: 0.005,    output: 0.015    }, maxTokens: 4096, description: "OpenAI flagship model with vision support." },
  { id: "gpt-4o-mini",               name: "GPT-4o Mini",                    provider: "openai",    envVar: "OPENAI_API_KEY",    tier: "fast",     costPer1k: { input: 0.00015,  output: 0.0006   }, maxTokens: 4096, description: "Lightest OpenAI model. Cheapest GPT option." },
  { id: "gemini-1.5-pro",            name: "Gemini 1.5 Pro",                 provider: "google",    envVar: "GOOGLE_AI_API_KEY", tier: "balanced", costPer1k: { input: 0.00125,  output: 0.005    }, maxTokens: 8192, description: "Google's flagship model with 1M context window." },
  { id: "gemini-1.5-flash",          name: "Gemini 1.5 Flash",               provider: "google",    envVar: "GOOGLE_AI_API_KEY", tier: "fast",     costPer1k: { input: 0.000075, output: 0.0003   }, maxTokens: 8192, description: "Fast and efficient Google model." },
]

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const providers = {
    anthropic: !!process.env.ANTHROPIC_API_KEY?.trim(),
    openai:    !!process.env.OPENAI_API_KEY?.trim(),
    google:    !!process.env.GOOGLE_AI_API_KEY?.trim(),
  }

  const models = MODELS.map(m => ({
    ...m,
    available:         providers[m.provider as keyof typeof providers] ?? false,
    unavailable_reason: !providers[m.provider as keyof typeof providers]
      ? `${m.envVar} is not configured on this platform. Contact the platform administrator.`
      : undefined,
  }))

  const availableModels  = models.filter(m => m.available)
  const defaultModel     = availableModels[0]?.id ?? null

  return NextResponse.json({
    models,
    providers,
    default_model:   defaultModel,
    available_count: availableModels.length,
    setup_required:  availableModels.length === 0,
    message: availableModels.length === 0
      ? "No AI providers configured. Add ANTHROPIC_API_KEY to your environment variables to enable agent execution."
      : `${availableModels.length} model${availableModels.length !== 1 ? "s" : ""} available.`,
  })
}
