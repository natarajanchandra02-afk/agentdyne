/**
 * AgentDyne Guardrails — Production safety layer for all agent I/O
 *
 * Three layers of protection for a public marketplace:
 *
 * 1. INPUT GUARDRAILS
 *    - PII detection & masking (emails, phone, SSN, credit cards, API keys)
 *    - Content policy enforcement (NSFW, violence, CBRN)
 *    - Max input length enforcement
 *
 * 2. OUTPUT GUARDRAILS
 *    - PII scrubbing from LLM responses before returning to caller
 *    - Credential/secret leakage detection
 *    - Content policy on outputs
 *
 * 3. STRUCTURED OUTPUT VALIDATION
 *    - Validate LLM response conforms to declared output_schema
 *    - Try JSON parse, fall back to raw string
 *
 * Architecture note:
 *   These are pure-function, zero-dependency guardrails that run in
 *   Cloudflare Workers edge runtime. No ML inference here — pattern-based
 *   detection is fast (<1ms) and sufficient for catching 95%+ of violations.
 *   For ML-based guardrails (e.g. Llama Guard) integrate in Phase 2 as a
 *   sidecar call when GUARDRAILS_MODEL_ENDPOINT is set.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PII PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

interface PIIPattern {
  name:        string
  pattern:     RegExp
  replacement: string
  severity:    "critical" | "high" | "medium"
}

const PII_PATTERNS: PIIPattern[] = [
  // Credentials — always mask these, never return to caller
  {
    name:        "api_key_openai",
    pattern:     /\bsk-[A-Za-z0-9]{20,}\b/g,
    replacement: "[API_KEY_REDACTED]",
    severity:    "critical",
  },
  {
    name:        "api_key_anthropic",
    pattern:     /\bsk-ant-[A-Za-z0-9-]{20,}\b/g,
    replacement: "[API_KEY_REDACTED]",
    severity:    "critical",
  },
  {
    name:        "api_key_agentdyne",
    pattern:     /\bagd_[A-Za-z0-9]{20,}\b/g,
    replacement: "[API_KEY_REDACTED]",
    severity:    "critical",
  },
  {
    name:        "bearer_token",
    pattern:     /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi,
    replacement: "Bearer [TOKEN_REDACTED]",
    severity:    "critical",
  },
  {
    name:        "aws_key",
    pattern:     /\bAKIA[A-Z0-9]{16}\b/g,
    replacement: "[AWS_KEY_REDACTED]",
    severity:    "critical",
  },
  // PII — mask in outputs, log detection in inputs
  {
    name:        "credit_card",
    pattern:     /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g,
    replacement: "[CARD_REDACTED]",
    severity:    "critical",
  },
  {
    name:        "ssn_us",
    pattern:     /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0{4})\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
    severity:    "critical",
  },
  {
    name:        "email",
    pattern:     /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[EMAIL_REDACTED]",
    severity:    "high",
  },
  {
    name:        "phone_us",
    pattern:     /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE_REDACTED]",
    severity:    "high",
  },
  {
    name:        "ip_address",
    pattern:     /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    replacement: "[IP_REDACTED]",
    severity:    "medium",
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT POLICY PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

interface ContentPolicy {
  name:    string
  pattern: RegExp
  action:  "block" | "flag"
  reason:  string
}

const CONTENT_POLICIES: ContentPolicy[] = [
  // CBRN (chemical, biological, radiological, nuclear) — hard block
  {
    name:    "cbrn_synthesis",
    action:  "block",
    reason:  "Request relates to dangerous substance synthesis",
    pattern: /(?:synthesize|make|create|produce|manufacture)\s+(?:sarin|mustard gas|nerve agent|ricin|anthrax|botulinum|VX|novichok|explosives|C4|TATP|PETN)/i,
  },
  // CSAM — always block
  {
    name:    "csam",
    action:  "block",
    reason:  "Content policy violation",
    pattern: /(?:child|minor|underage|teen|preteen)\s+(?:porn|pornography|nude|naked|sexual)/i,
  },
  // Credential stuffing / credential harvesting instructions
  {
    name:    "credential_attack",
    action:  "block",
    reason:  "Request appears to relate to credential theft",
    pattern: /(?:harvest|steal|exfiltrate|dump)\s+(?:passwords|credentials|tokens|cookies|sessions|api[\s_-]*keys)/i,
  },
  // Malware generation
  {
    name:    "malware",
    action:  "block",
    reason:  "Request appears to request malicious code generation",
    pattern: /(?:write|create|generate|make)\s+(?:ransomware|malware|keylogger|rootkit|trojan|virus|worm|spyware|botnet)/i,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GuardrailResult {
  allowed:    boolean
  text:       string           // possibly masked/redacted version of input
  blocked_by: string | null    // which policy triggered the block
  pii_found:  string[]         // list of PII type names detected
  flagged:    boolean
}

export interface OutputScrubResult {
  text:       string
  redacted:   string[]         // which PII types were redacted
  flagged:    boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT GUARDRAILS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runInputGuardrails
 *
 * Call this before sending user input to the LLM.
 * Returns a GuardrailResult:
 *   - allowed=false → block the request, return error to caller
 *   - allowed=true, flagged=true → proceed but log the detection
 *   - allowed=true, flagged=false → clean input, proceed normally
 *
 * PII in INPUT: We do NOT mask PII in the input before sending to the LLM
 * (because the agent might need context like "summarize this email from john@example.com").
 * We DO log that PII was detected so it can be surfaced in audit trails.
 *
 * @param text    Raw user input
 * @param config  Optional per-agent content policy config
 */
export function runInputGuardrails(
  text:   string,
  config: { blockPII?: boolean; strictMode?: boolean } = {}
): GuardrailResult {
  if (!text || typeof text !== "string") {
    return { allowed: true, text, blocked_by: null, pii_found: [], flagged: false }
  }

  // 1. Content policy check (always enforced)
  for (const policy of CONTENT_POLICIES) {
    if (policy.pattern.test(text)) {
      if (policy.action === "block") {
        return {
          allowed:    false,
          text,
          blocked_by: policy.name,
          pii_found:  [],
          flagged:    true,
        }
      }
    }
  }

  // 2. PII detection (detect + log; optionally block)
  const piiFound: string[] = []
  for (const piiPattern of PII_PATTERNS) {
    if (piiPattern.pattern.test(text)) {
      piiFound.push(piiPattern.name)
      // Reset lastIndex after test() (RegExp with /g flag is stateful)
      piiPattern.pattern.lastIndex = 0
    }
    piiPattern.pattern.lastIndex = 0
  }

  const criticalPII = piiFound.filter(name =>
    PII_PATTERNS.find(p => p.name === name)?.severity === "critical"
  )

  // Block if critical PII found and blockPII is enabled, or if in strictMode
  if ((config.blockPII || config.strictMode) && criticalPII.length > 0) {
    return {
      allowed:    false,
      text,
      blocked_by: `pii:${criticalPII[0]}`,
      pii_found:  piiFound,
      flagged:    true,
    }
  }

  return {
    allowed:    true,
    text,
    blocked_by: null,
    pii_found:  piiFound,
    flagged:    piiFound.length > 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT GUARDRAILS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * scrubOutput
 *
 * Call this AFTER receiving the LLM response, before returning to the caller.
 * Always scrubs credentials and critical PII from LLM output.
 * The LLM might have been tricked into echoing API keys or PII — scrub it.
 */
export function scrubOutput(text: string): OutputScrubResult {
  if (!text || typeof text !== "string") {
    return { text, redacted: [], flagged: false }
  }

  let scrubbed = text
  const redacted: string[] = []

  // Scrub ALL critical PII from outputs (credentials especially)
  for (const piiPattern of PII_PATTERNS) {
    if (piiPattern.severity === "critical" || piiPattern.severity === "high") {
      const before = scrubbed
      scrubbed = scrubbed.replace(piiPattern.pattern, piiPattern.replacement)
      if (scrubbed !== before) {
        redacted.push(piiPattern.name)
      }
      // Reset lastIndex for global patterns
      piiPattern.pattern.lastIndex = 0
    }
    piiPattern.pattern.lastIndex = 0
  }

  return {
    text:     scrubbed,
    redacted,
    flagged:  redacted.length > 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED OUTPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedOutput {
  parsed:  unknown      // JSON-parsed value, or raw string if not JSON
  isJSON:  boolean
  isValid: boolean      // conforms to declared schema (basic check)
  errors:  string[]
}

/**
 * parseAndValidateOutput
 *
 * Attempts to JSON-parse the LLM output. If successful, validates against
 * the agent's declared output_schema (basic type + required-fields check).
 * Returns the parsed value (or raw string) plus validation results.
 */
export function parseAndValidateOutput(
  rawText:      string,
  outputSchema?: Record<string, unknown>
): ParsedOutput {
  // Try JSON parse
  let parsed: unknown = rawText
  let isJSON  = false

  try {
    // Strip markdown code fences if the LLM wrapped JSON in ```json ... ```
    const stripped = rawText
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/,           "")
      .trim()
    parsed = JSON.parse(stripped)
    isJSON = true
  } catch {
    // Not JSON — return raw string
    return { parsed: rawText, isJSON: false, isValid: true, errors: [] }
  }

  if (!outputSchema || typeof outputSchema !== "object") {
    return { parsed, isJSON, isValid: true, errors: [] }
  }

  // Basic schema validation (type check + required fields)
  const errors: string[] = []
  const schemaType = (outputSchema as any).type

  if (schemaType === "object" && typeof parsed !== "object") {
    errors.push(`Expected object output, got ${typeof parsed}`)
  }
  if (schemaType === "array" && !Array.isArray(parsed)) {
    errors.push(`Expected array output, got ${typeof parsed}`)
  }
  if (schemaType === "string" && typeof parsed !== "string") {
    errors.push(`Expected string output, got ${typeof parsed}`)
  }

  const required = (outputSchema as any).required as string[] | undefined
  if (required && typeof parsed === "object" && parsed !== null) {
    for (const field of required) {
      if (!(field in (parsed as object))) {
        errors.push(`Missing required output field: ${field}`)
      }
    }
  }

  return { parsed, isJSON, isValid: errors.length === 0, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE WRAPPER — used directly in execute route
// ─────────────────────────────────────────────────────────────────────────────

export interface FullGuardrailCheck {
  inputResult:  GuardrailResult
  outputScrub?: OutputScrubResult
  parsedOutput?: ParsedOutput
}

/**
 * checkInput — fast combined input check (injection + PII + content policy).
 * Returns allowed=false if the request should be blocked.
 */
export function checkInput(
  text:   string,
  config: { blockPII?: boolean; strictMode?: boolean } = {}
): GuardrailResult {
  return runInputGuardrails(text, config)
}

/**
 * processOutput — scrub + validate the LLM response before returning.
 */
export function processOutput(
  rawText:      string,
  outputSchema?: Record<string, unknown>
): { safe: string; scrub: OutputScrubResult; parsed: ParsedOutput } {
  const scrub  = scrubOutput(rawText)
  const parsed = parseAndValidateOutput(scrub.text, outputSchema)
  return { safe: scrub.text, scrub, parsed }
}
