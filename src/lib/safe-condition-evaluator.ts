/**
 * AgentDyne — Safe Condition Evaluator
 *
 * Replaces the unsafe `new Function()` approach in the pipeline DAG branch
 * evaluator. Uses a whitelist-only expression parser — no eval, no Function
 * constructor, no dynamic code execution.
 *
 * Supported condition syntax (JSON-logic style field access + comparisons):
 *
 *   output.status == "success"
 *   output.score > 0.8
 *   output.count >= 10
 *   output.type != "error"
 *   output.result.length > 0
 *   state.retry_count < 3
 *   output.text contains "approved"
 *   output.text startsWith "ERROR"
 *   output.value between 10 50
 *   output.items exists
 *   output.error empty
 *
 * The evaluator is:
 *   1. Pure: no side effects, no I/O
 *   2. Deterministic: same input always gives same output
 *   3. Sandboxed: only reads fields from `output` and `state`
 *   4. Failure-safe: any parse error → returns true (node runs)
 *
 * Security: replaces the dangerous `new Function(condition)(output, state)`
 * approach which allowed arbitrary code injection via condition strings.
 */

export type EvalContext = {
  output: unknown
  state:  Record<string, unknown>
}

/**
 * evaluateSafeCondition
 *
 * @param condition  Condition string (see supported syntax above)
 * @param output     Output from the upstream node
 * @param state      Shared pipeline state object
 * @param mode       "open"  = return true on parse error (filter nodes — always run)
 *                   "closed" = return false on parse error (branch nodes — skip on error)
 */
export function evaluateSafeCondition(
  condition: string | undefined,
  output:    unknown,
  state:     Record<string, unknown> = {},
  mode:      "open" | "closed" = "open"
): boolean {
  // Empty condition → always run
  if (!condition || condition.trim().length === 0) return true

  try {
    const cond = condition.trim()
    const ctx: EvalContext = { output, state }
    return parseAndEval(cond, ctx)
  } catch {
    // Parse error: fail-open for filters (node runs), fail-closed for branches (node skipped)
    return mode === "open"
  }
}

// ─── Field path resolver ──────────────────────────────────────────────────────
// Resolves "output.foo.bar[0].baz" against the context.

function resolvePath(path: string, ctx: EvalContext): unknown {
  const parts = path.split(/[.\[\]]+/).filter(Boolean)
  if (parts.length === 0) return undefined

  const root = parts[0]
  if (root !== "output" && root !== "state") {
    // Unknown root — return undefined (safe)
    return undefined
  }

  let val: unknown = root === "output" ? ctx.output : ctx.state
  for (let i = 1; i < parts.length; i++) {
    if (val === null || val === undefined) return undefined
    const key = parts[i]!
    if (typeof val === "object") {
      val = (val as Record<string, unknown>)[key]
    } else if (Array.isArray(val)) {
      const idx = parseInt(key)
      val = isNaN(idx) ? undefined : (val as unknown[])[idx]
    } else {
      return undefined
    }
  }
  return val
}

// ─── Value parser ─────────────────────────────────────────────────────────────
// Parses a literal value token: string, number, boolean, null.

function parseLiteral(token: string): unknown {
  if (token === "true")  return true
  if (token === "false") return false
  if (token === "null")  return null

  // Quoted string — "hello" or 'hello'
  if ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1)
  }

  // Number
  const n = Number(token)
  if (!isNaN(n) && token.trim() !== "") return n

  return token  // fallback: treat as string
}

// ─── Expression evaluator ─────────────────────────────────────────────────────

function parseAndEval(expr: string, ctx: EvalContext): boolean {
  // Trim and handle compound conditions (AND / OR at top level)
  const trimmed = expr.trim()

  // AND (&&)
  const andParts = splitTopLevel(trimmed, "&&")
  if (andParts.length > 1) {
    return andParts.every(part => parseAndEval(part.trim(), ctx))
  }

  // OR (||)
  const orParts = splitTopLevel(trimmed, "||")
  if (orParts.length > 1) {
    return orParts.some(part => parseAndEval(part.trim(), ctx))
  }

  // NOT
  if (trimmed.startsWith("!") && !trimmed.startsWith("!=")) {
    return !parseAndEval(trimmed.slice(1).trim(), ctx)
  }

  // Parse individual comparison
  return evalComparison(trimmed, ctx)
}

function evalComparison(expr: string, ctx: EvalContext): boolean {
  // Supported operators (ordered by length to avoid ambiguity)
  const ops = [
    { op: ">=",         fn: (a: unknown, b: unknown) => toNum(a) >= toNum(b) },
    { op: "<=",         fn: (a: unknown, b: unknown) => toNum(a) <= toNum(b) },
    { op: "!=",         fn: (a: unknown, b: unknown) => !looseEq(a, b) },
    { op: "==",         fn: (a: unknown, b: unknown) => looseEq(a, b) },
    { op: ">",          fn: (a: unknown, b: unknown) => toNum(a) > toNum(b) },
    { op: "<",          fn: (a: unknown, b: unknown) => toNum(a) < toNum(b) },
    { op: " contains ", fn: (a: unknown, b: unknown) => String(a).includes(String(b)) },
    { op: " startsWith ",fn: (a: unknown, b: unknown) => String(a).startsWith(String(b)) },
    { op: " endsWith ", fn: (a: unknown, b: unknown) => String(a).endsWith(String(b)) },
    { op: " between ",  fn: (a: unknown, b: unknown) => {
        // "between" takes TWO arguments: "output.x between 10 50"
        // b is the raw right-hand side "10 50" → split into [10, 50]
        const parts = String(b).trim().split(/\s+/)
        if (parts.length !== 2) return false
        const lo = Number(parts[0]), hi = Number(parts[1])
        const n  = toNum(a)
        return n >= lo && n <= hi
      },
    },
  ]

  // Check for unary operators
  const existsMatch = expr.match(/^(\S+)\s+exists$/)
  if (existsMatch) {
    const val = resolvePath(existsMatch[1]!, ctx)
    return val !== undefined && val !== null
  }

  const emptyMatch = expr.match(/^(\S+)\s+empty$/)
  if (emptyMatch) {
    const val = resolvePath(emptyMatch[1]!, ctx)
    if (val === undefined || val === null) return true
    if (typeof val === "string")  return val.length === 0
    if (Array.isArray(val))       return val.length === 0
    if (typeof val === "object")  return Object.keys(val as object).length === 0
    return false
  }

  const notEmptyMatch = expr.match(/^(\S+)\s+notEmpty$/)
  if (notEmptyMatch) {
    const val = resolvePath(notEmptyMatch[1]!, ctx)
    if (val === undefined || val === null) return false
    if (typeof val === "string")  return val.length > 0
    if (Array.isArray(val))       return val.length > 0
    if (typeof val === "object")  return Object.keys(val as object).length > 0
    return true
  }

  // Find operator
  for (const { op, fn } of ops) {
    const idx = expr.indexOf(op)
    if (idx === -1) continue

    const lhs = expr.slice(0, idx).trim()
    const rhs = expr.slice(idx + op.length).trim()

    const leftVal  = lhs.startsWith("output.") || lhs.startsWith("state.")
      ? resolvePath(lhs, ctx)
      : parseLiteral(lhs)

    const rightVal = rhs.startsWith("output.") || rhs.startsWith("state.")
      ? resolvePath(rhs, ctx)
      : parseLiteral(rhs)

    return fn(leftVal, rightVal)
  }

  // No operator found — treat as truthy check on field
  if (expr.startsWith("output.") || expr.startsWith("state.")) {
    const val = resolvePath(expr, ctx)
    return isTruthy(val)
  }

  // Bare boolean literals
  if (expr === "true")  return true
  if (expr === "false") return false

  // Unknown expression — fail-open
  return true
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTruthy(val: unknown): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === "boolean") return val
  if (typeof val === "number")  return val !== 0
  if (typeof val === "string")  return val.length > 0
  if (Array.isArray(val))       return val.length > 0
  return true
}

function looseEq(a: unknown, b: unknown): boolean {
  // Type-coercing equality (intentional for condition DSL)
  if (a === b) return true
  if (String(a) === String(b)) return true
  if (typeof b === "number" && Number(a) === b) return true
  return false
}

function toNum(v: unknown): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

/**
 * splitTopLevel
 * Splits a string on a separator only at the top level (not inside quotes).
 * Handles: "output.a == \"hello&&world\""  correctly.
 */
function splitTopLevel(expr: string, sep: string): string[] {
  const parts: string[] = []
  let current = ""
  let inStr    = false
  let strChar  = ""

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!

    if (inStr) {
      current += ch
      if (ch === strChar && expr[i - 1] !== "\\") inStr = false
    } else if (ch === '"' || ch === "'") {
      inStr   = true
      strChar = ch
      current += ch
    } else if (expr.slice(i, i + sep.length) === sep) {
      parts.push(current)
      current = ""
      i += sep.length - 1
    } else {
      current += ch
    }
  }

  if (current) parts.push(current)
  return parts
}
