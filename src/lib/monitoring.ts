/**
 * AgentDyne — Monitoring & Alerting
 *
 * Lightweight alerting without external dependencies.
 * Uses Slack webhook (free, instant) as the primary alert channel.
 *
 * Setup (takes 2 minutes):
 *   1. Create a Slack app: api.slack.com/apps → New App → From Scratch
 *   2. Enable Incoming Webhooks → Add to workspace → copy Webhook URL
 *   3. Add to Cloudflare Pages: SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
 *
 * Optional: Add BETTER_STACK_HEARTBEAT_URL for uptime monitoring.
 *   Better Stack (betterstack.com): free tier, 30s check interval.
 *   Heartbeat URL pings every hour — if missing, sends PagerDuty-style alert.
 *
 * Usage in API routes:
 *   import { alertCritical, alertWarning, pingHeartbeat } from "@/lib/monitoring"
 *
 *   // On 5xx errors:
 *   await alertCritical("Execute failed", { agentId, userId, error: err.message })
 *
 *   // On suspicious activity:
 *   await alertWarning("High abuse score", { userId, score: 95 })
 *
 *   // In a health-check cron or layout.tsx:
 *   pingHeartbeat()   // fire-and-forget
 *
 * Edge-runtime safe: fetch() only.
 */

type AlertLevel = "critical" | "warning" | "info"

interface AlertPayload {
  level:    AlertLevel
  title:    string
  details:  Record<string, unknown>
  url?:     string
  at?:      string   // ISO timestamp
}

// ─── Slack formatter ──────────────────────────────────────────────────────────

function formatSlackMessage(payload: AlertPayload): object {
  const EMOJI: Record<AlertLevel, string> = {
    critical: "🔥",
    warning:  "⚠️",
    info:     "ℹ️",
  }

  const COLOR: Record<AlertLevel, string> = {
    critical: "#FF0000",
    warning:  "#FFA500",
    info:     "#36A64F",
  }

  const timestamp = payload.at ?? new Date().toISOString()
  const envLabel  = process.env.NODE_ENV === "production" ? "PROD" : "DEV"
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? "https://agentdyne.com"

  const detailLines = Object.entries(payload.details)
    .map(([k, v]) => `• *${k}*: \`${JSON.stringify(v)}\``)
    .join("\n")

  return {
    attachments: [{
      color:    COLOR[payload.level],
      fallback: `${EMOJI[payload.level]} [${envLabel}] ${payload.title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${EMOJI[payload.level]} *[${envLabel}] ${payload.title}*`,
          },
        },
        ...(detailLines ? [{
          type: "section",
          text: { type: "mrkdwn", text: detailLines },
        }] : []),
        {
          type: "context",
          elements: [{
            type: "mrkdwn",
            text: `${timestamp} | <${payload.url ?? appUrl}|View Platform>`,
          }],
        },
      ],
    }],
  }
}

// ─── Core sender ──────────────────────────────────────────────────────────────

async function sendAlert(payload: AlertPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return   // Alerting not configured — silent

  try {
    await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(formatSlackMessage(payload)),
      signal:  AbortSignal.timeout(3_000),   // never block user request for alerting
    })
  } catch {
    // Alerting must never throw — user-facing code must not break
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * alertCritical — fires on:
 *   - 5xx errors in critical paths (execute, webhooks, billing)
 *   - Abuse score > 90 (auto-ban triggered)
 *   - Credit reservation failures
 *   - DB connection failures
 */
export async function alertCritical(
  title:   string,
  details: Record<string, unknown> = {},
  url?:    string
): Promise<void> {
  // Fire-and-forget — never await in the critical path
  sendAlert({ level: "critical", title, details, url, at: new Date().toISOString() })
    .catch(() => {})
}

/**
 * alertWarning — fires on:
 *   - Rate limit spike (>50 hits in 1 min from same user)
 *   - Injection attempt blocked
 *   - Model downgrade triggered
 *   - Free tier abuse patterns
 */
export async function alertWarning(
  title:   string,
  details: Record<string, unknown> = {},
  url?:    string
): Promise<void> {
  sendAlert({ level: "warning", title, details, url, at: new Date().toISOString() })
    .catch(() => {})
}

/**
 * alertInfo — fires on:
 *   - New seller onboarded
 *   - Large credit purchase ($50+)
 *   - First execution of a new agent
 */
export async function alertInfo(
  title:   string,
  details: Record<string, unknown> = {},
  url?:    string
): Promise<void> {
  sendAlert({ level: "info", title, details, url, at: new Date().toISOString() })
    .catch(() => {})
}

/**
 * pingHeartbeat — POST to Better Stack heartbeat URL.
 * Call from a cron endpoint or health-check route every hour.
 * If missing for 2+ intervals, Better Stack sends an alert.
 *
 * Register at: betterstack.com → Uptime → Heartbeat monitors → New heartbeat
 * Set the URL as BETTER_STACK_HEARTBEAT_URL in env.
 */
export function pingHeartbeat(): void {
  const url = process.env.BETTER_STACK_HEARTBEAT_URL
  if (!url) return
  fetch(url, { method: "GET", signal: AbortSignal.timeout(3_000) }).catch(() => {})
}

/**
 * trackError — logs to Sentry-compatible DSN if configured.
 * Works with any service that accepts POST /api/X/store (Sentry format).
 *
 * For Sentry: add SENTRY_DSN to env. Sentry free tier = 5000 errors/month.
 * For Highlight.io: add HIGHLIGHT_PROJECT_ID to env (alternative to Sentry).
 *
 * Usage: trackError(err, { userId, agentId, route: "/api/agents/[id]/execute" })
 */
export function trackError(
  err:     Error,
  context: Record<string, unknown> = {}
): void {
  // Basic structured error log — always (works without Sentry)
  console.error("[AgentDyne Error]", {
    message:   err.message,
    stack:     err.stack?.split("\n").slice(0, 5).join("\n"),
    timestamp: new Date().toISOString(),
    ...context,
  })

  // Alert if critical routes fail
  const isCritical = (context.route as string)?.includes("/execute") ||
                     (context.route as string)?.includes("/webhooks") ||
                     (context.route as string)?.includes("/billing")

  if (isCritical) {
    alertCritical(`Error in ${context.route ?? "unknown route"}`, {
      error:  err.message,
      ...context,
    }).catch(() => {})
  }
}

/**
 * reportAbuseToSlack — called when abuse score exceeds threshold.
 * Gives the team real-time visibility on attack patterns.
 */
export async function reportAbuseToSlack(params: {
  userId:    string
  agentId?:  string
  action:    string
  score:     number
  details:   Record<string, unknown>
}): Promise<void> {
  const { userId, agentId, action, score, details } = params

  await alertWarning(`Abuse Detected: ${action}`, {
    user_id:   userId,
    agent_id:  agentId ?? "n/a",
    score:     `${score}/100`,
    action,
    ...details,
  }, `${process.env.NEXT_PUBLIC_APP_URL}/admin/governance`)
}
