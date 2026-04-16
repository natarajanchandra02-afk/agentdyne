/**
 * AgentDyne Prompt Injection Filter
 *
 * Detects and blocks prompt injection attempts before they reach the LLM.
 * Public marketplace context: any registered user can execute any active agent.
 * Malicious users can attempt to:
 *   1. Override the agent's system prompt (jailbreak the seller's agent)
 *   2. Exfiltrate the system prompt contents
 *   3. Make the agent perform unintended actions
 *   4. Inject instructions through indirect content (URLs, files)
 *
 * Defense strategy:
 *   - Pattern-based detection (fast, zero-latency, catches 90% of attacks)
 *   - Suspicious score threshold (catches obfuscated attacks)
 *   - Output scanning (catch data exfiltration attempts)
 *   - Log all blocked/flagged attempts to injection_attempts table
 *
 * What this does NOT replace:
 *   - Anthropic's built-in guardrails (active by default)
 *   - Input size limits (in execute route)
 *   - Auth + quota enforcement (in execute route)
 */

export type FilterResult =
  | { allowed: true  }
  | { allowed: false; reason: string; pattern: string; score: number }

export type OutputScanResult =
  | { safe: true  }
  | { safe: false; reason: string }

// ── Injection patterns ────────────────────────────────────────────────────────
// Each pattern has a weight (0-10). Cumulative score > BLOCK_THRESHOLD = block.

const INJECTION_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Classic jailbreak — direct instruction override
  { weight: 10, label: "instruction_override",
    pattern: /ignore\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|prompts?|rules?|context)/i },
  { weight: 10, label: "system_override",
    pattern: /(?:new\s+)?(?:system\s*prompt|instructions?)\s*:/i },
  { weight: 8,  label: "role_hijack",
    pattern: /you\s+are\s+now\s+(a|an)\s+(?!assistant|helpful|AI)/i },
  { weight: 8,  label: "forget_context",
    pattern: /forget\s+(everything|all|your|previous|prior|above)/i },
  { weight: 7,  label: "disregard_instructions",
    pattern: /disregard\s+(all\s+)?(your|previous|prior|the)?\s*(instructions?|rules?|constraints?)/i },
  { weight: 7,  label: "override_instructions",
    pattern: /override\s+(your|the|all)?\s*(instructions?|rules?|system)/i },
  // Prompt extraction
  { weight: 9,  label: "prompt_extraction",
    pattern: /repeat\s+(your|the)?\s*(system\s+)?prompt|print\s+(your|the)?\s*(system\s+)?prompt/i },
  { weight: 9,  label: "show_instructions",
    pattern: /show\s+me\s+(your|the|all)?\s*(system\s+)?(instructions?|prompt|rules?)/i },
  { weight: 8,  label: "reveal_prompt",
    pattern: /(?:reveal|expose|leak|display|output)\s+(your|the)?\s*(system\s+)?(instructions?|prompt|rules?)/i },
  // Special tokens used to confuse tokenizers
  { weight: 6,  label: "special_tokens",
    pattern: /<\|(?:system|user|assistant|im_start|im_end|endoftext)\|>/i },
  { weight: 6,  label: "xml_injection",
    pattern: /<(?:system|instruction|prompt|role)\s*>/i },
  // DAN / developer mode jailbreaks
  { weight: 8,  label: "dan_jailbreak",
    pattern: /\b(?:DAN|JAILBREAK|developer\s+mode|god\s+mode|unrestricted\s+mode)\b/i },
  { weight: 7,  label: "act_as_jailbreak",
    pattern: /act\s+as\s+(?:if\s+you\s+(?:have\s+no|were\s+without)\s+(?:restrictions?|rules?|guidelines?))/i },
  // Prompt chaining / continuation attacks
  { weight: 5,  label: "continue_from",
    pattern: /continue\s+from\s+where\s+you\s+left/i },
  { weight: 5,  label: "pretend_no_rules",
    pattern: /pretend\s+(you\s+have\s+no|there\s+are\s+no)\s+(rules?|restrictions?|guidelines?)/i },
  // Encoded injection (base64, rot13 obfuscation)
  { weight: 6,  label: "encoded_injection",
    pattern: /(?:decode|base64|rot13|hex|cipher)\s+(?:this|the following|and follow)/i },
]

const BLOCK_THRESHOLD  = 8   // Score >= this → block
const FLAG_THRESHOLD   = 4   // Score >= this (but < BLOCK) → log as suspicious, allow

// ── Output scanning (catch data exfiltration) ─────────────────────────────────

const OUTPUT_DANGER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // API key patterns
  { label: "api_key_leak",    pattern: /sk-[A-Za-z0-9]{20,}/                          },
  { label: "anthropic_key",   pattern: /sk-ant-[A-Za-z0-9-]{20,}/                    },
  { label: "agentdyne_key",   pattern: /agd_[A-Za-z0-9]{20,}/                        },
  { label: "openai_key",      pattern: /(?:sk|sess)-[A-Za-z0-9-_]{32,}/              },
  // System prompt exposure markers
  { label: "system_prompt_exposure",
    pattern: /(?:my system prompt is|the system prompt says|as instructed in the system)/i },
  // Common jailbreak output markers
  { label: "jailbreak_success_marker",
    pattern: /\[DAN\]|\[JAILBREAK\]|\[SYSTEM\](?:\s*:|\s*\n)/i },
]

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * Scan user-provided input for injection attempts.
 * Called BEFORE the LLM call.
 *
 * @param input     The raw user input string
 * @param source    'user' | 'tool' | 'external' — external content is scanned more aggressively
 * @returns FilterResult
 */
export function filterInput(
  input:  string,
  source: "user" | "tool" | "external" = "user"
): FilterResult {
  if (!input || typeof input !== "string") return { allowed: true }

  let cumulativeScore = 0
  let firstMatch: { label: string; pattern: string } | null = null

  // External content (from MCP tools, URLs, etc.) gets a 1.5x multiplier
  const multiplier = source === "external" ? 1.5 : 1.0

  for (const { pattern, weight, label } of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      cumulativeScore += weight * multiplier
      if (!firstMatch) {
        firstMatch = { label, pattern: pattern.source }
      }
    }
  }

  if (cumulativeScore >= BLOCK_THRESHOLD) {
    return {
      allowed: false,
      reason:  "Input contains patterns that may attempt to override agent instructions.",
      pattern: firstMatch?.label ?? "unknown",
      score:   cumulativeScore,
    }
  }

  // Return allowed even if flagged — logging happens at call site
  return { allowed: true }
}

/**
 * Get the injection score without blocking (for logging suspicious-but-allowed inputs).
 */
export function getInjectionScore(input: string): number {
  let score = 0
  for (const { pattern, weight } of INJECTION_PATTERNS) {
    if (pattern.test(input)) score += weight
  }
  return score
}

/**
 * Scan agent output for data exfiltration attempts.
 * Called AFTER the LLM response, before returning to user.
 *
 * If the output contains an API key or system prompt exposure,
 * replace it with a safe placeholder rather than surfacing the data.
 */
export function sanitizeOutput(output: string): { text: string; flagged: boolean; reason?: string } {
  if (!output || typeof output !== "string") return { text: output, flagged: false }

  for (const { pattern, label } of OUTPUT_DANGER_PATTERNS) {
    if (pattern.test(output)) {
      // Redact the dangerous content rather than blocking entirely
      const redacted = output.replace(pattern, "[REDACTED]")
      return {
        text:    redacted,
        flagged: true,
        reason:  label,
      }
    }
  }

  return { text: output, flagged: false }
}

/**
 * Full pipeline: filter input, return result with metadata for logging.
 */
export function runInjectionPipeline(input: string, source: "user" | "tool" | "external" = "user"): {
  filterResult: FilterResult
  score:        number
  shouldLog:    boolean
} {
  const filterResult = filterInput(input, source)
  const score        = getInjectionScore(input)
  const shouldLog    = !filterResult.allowed || score >= FLAG_THRESHOLD

  return { filterResult, score, shouldLog }
}
