/**
 * @module email
 * @path   src/lib/email.ts
 *
 * AgentDyne — Transactional Email via Resend
 * Sender: support@inteleion.com
 *
 * Setup:
 *   1. Add RESEND_API_KEY to Cloudflare Pages → Settings → Environment Variables
 *   2. Verify the domain "inteleion.com" in Resend dashboard
 *   3. DNS: add SPF, DKIM, DMARC records as shown in Resend → Domains
 *
 * All email functions are fire-and-forget safe:
 *   - Never throw (errors are logged + returned)
 *   - Edge-runtime safe (fetch() only)
 *   - Subject lines + bodies are sanitised (no user content in subjects)
 *
 * Email types supported:
 *   - Welcome (new user signup)
 *   - Agent approved / rejected (seller notifications)
 *   - Execution failure alert
 *   - Low credits warning
 *   - Password reset (Supabase handles this, but we customise the template)
 *   - Admin alert (critical platform events)
 *   - Review notification (new review on your agent)
 *   - Payout processed
 */

const RESEND_API_URL = "https://api.resend.com/emails"
const FROM_ADDRESS   = "AgentDyne <support@inteleion.com>"
const REPLY_TO       = "support@inteleion.com"
const BASE_URL       = process.env.NEXT_PUBLIC_APP_URL ?? "https://agentdyne.com"

// ─── Base HTML template ───────────────────────────────────────────────────────

function baseTemplate(content: string, preheader?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AgentDyne</title>
${preheader ? `<div style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden;">${preheader}&nbsp;&zwnj;</div>` : ""}
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
      <!-- Header -->
      <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #f3f4f6;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td><span style="font-size:20px;font-weight:800;color:#09090b;letter-spacing:-0.5px;">AgentDyne</span></td>
            <td align="right"><span style="font-size:11px;color:#a1a1aa;font-weight:500;">AI Agent Marketplace</span></td>
          </tr>
        </table>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:32px 40px;">
        ${content}
      </td></tr>
      <!-- Footer -->
      <tr><td style="padding:24px 40px;border-top:1px solid #f3f4f6;background:#fafafa;">
        <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">
          You received this email because you have an account at <a href="${BASE_URL}" style="color:#18181b;text-decoration:none;">agentdyne.com</a>.
          Questions? Reply to this email or contact <a href="mailto:support@inteleion.com" style="color:#18181b;text-decoration:none;">support@inteleion.com</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function btn(href: string, label: string, color = "#09090b"): string {
  return `<a href="${href}" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:0.1px;">${label}</a>`
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#09090b;letter-spacing:-0.4px;">${text}</h1>`
}

function p(text: string, muted = false): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${muted ? "#6b7280" : "#374151"};">${text}</p>`
}

function infoBox(content: string, color = "#f9fafb", border = "#e5e7eb"): string {
  return `<div style="background:${color};border:1px solid ${border};border-radius:10px;padding:16px 20px;margin:20px 0;">${content}</div>`
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailResult {
  ok:      boolean
  id?:     string
  error?:  string
}

interface SendParams {
  to:      string | string[]
  subject: string
  html:    string
  replyTo?: string
  tags?:    Array<{ name: string; value: string }>
}

// ─── Core send function ───────────────────────────────────────────────────────

async function sendEmail(params: SendParams): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn("[Email] RESEND_API_KEY not configured — email skipped")
    return { ok: false, error: "RESEND_API_KEY not configured" }
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:     FROM_ADDRESS,
        to:       Array.isArray(params.to) ? params.to : [params.to],
        subject:  params.subject,
        html:     params.html,
        reply_to: params.replyTo ?? REPLY_TO,
        tags:     params.tags ?? [],
      }),
      signal: AbortSignal.timeout(8_000),
    })

    const data = await res.json() as any
    if (!res.ok) {
      console.error("[Email] Resend API error:", data)
      return { ok: false, error: data.message ?? `HTTP ${res.status}` }
    }

    return { ok: true, id: data.id }
  } catch (err: any) {
    console.error("[Email] Send failed:", err.message)
    return { ok: false, error: err.message }
  }
}

// ─── Email templates ──────────────────────────────────────────────────────────

/**
 * Welcome email — sent when a new user signs up
 */
export async function sendWelcomeEmail(params: {
  to:       string
  name:     string
}): Promise<EmailResult> {
  const html = baseTemplate(`
    ${h1(`Welcome to AgentDyne, ${params.name || "there"}! 👋`)}
    ${p("You're now part of the world's first microagent marketplace. Here's what you can do:")}
    <ul style="margin:0 0 20px;padding-left:20px;color:#374151;font-size:15px;line-height:1.9;">
      <li><strong>Discover agents</strong> — browse hundreds of AI microagents built by the community</li>
      <li><strong>Run agents</strong> — execute any agent via the marketplace or API</li>
      <li><strong>Build agents</strong> — create your own and earn when others use them</li>
      <li><strong>Chain agents</strong> — compose multi-agent pipelines for complex workflows</li>
    </ul>
    ${infoBox(`<p style="margin:0;font-size:14px;color:#374151;">🎁 <strong>$2.00 in free credits</strong> added to your account. Start exploring!</p>`, "#f0fdf4", "#bbf7d0")}
    <div style="margin-top:24px;">${btn(`${BASE_URL}/marketplace`, "Explore Marketplace")}</div>
  `, "Welcome to AgentDyne — $2 free credits added to your account")

  return sendEmail({
    to:      params.to,
    subject: "Welcome to AgentDyne 🤖",
    html,
    tags:    [{ name: "type", value: "welcome" }],
  })
}

/**
 * Agent approved — sent to seller when admin approves their agent
 */
export async function sendAgentApprovedEmail(params: {
  to:         string
  sellerName: string
  agentName:  string
  agentId:    string
}): Promise<EmailResult> {
  const html = baseTemplate(`
    ${h1("Your agent is live! 🚀")}
    ${p(`Great news, ${params.sellerName || "there"}! Your agent <strong>"${params.agentName}"</strong> has been reviewed and approved by our team.`)}
    ${infoBox(`
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#16a34a;">✓ Agent Status: Active</p>
      <p style="margin:0;font-size:14px;color:#374151;"><strong>${params.agentName}</strong> is now discoverable in the marketplace.</p>
    `, "#f0fdf4", "#bbf7d0")}
    ${p("Buyers can now find and execute your agent. You'll receive payouts for every successful execution.")}
    <div style="margin-top:24px;display:flex;gap:12px;">
      ${btn(`${BASE_URL}/marketplace/${params.agentId}`, "View Live Agent")}
    </div>
  `, `Your agent "${params.agentName}" is now live on AgentDyne`)

  return sendEmail({
    to:      params.to,
    subject: `✅ "${params.agentName}" is now live on AgentDyne`,
    html,
    tags:    [{ name: "type", value: "agent_approved" }],
  })
}

/**
 * Agent rejected — sent to seller when admin rejects their submission
 */
export async function sendAgentRejectedEmail(params: {
  to:         string
  sellerName: string
  agentName:  string
  reason:     string
}): Promise<EmailResult> {
  const html = baseTemplate(`
    ${h1("Submission needs changes")}
    ${p(`Hi ${params.sellerName || "there"}, your submission <strong>"${params.agentName}"</strong> needs some adjustments before it can be published.`)}
    ${infoBox(`
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#dc2626;">Feedback from our review team:</p>
      <p style="margin:0;font-size:14px;color:#374151;">${params.reason}</p>
    `, "#fef2f2", "#fecaca")}
    ${p("Please update your agent in Builder Studio and resubmit for review. Our team typically reviews submissions within 24 hours.")}
    <div style="margin-top:24px;">${btn(`${BASE_URL}/seller`, "Go to My Agents", "#18181b")}</div>
  `, `Your agent "${params.agentName}" needs changes before publishing`)

  return sendEmail({
    to:      params.to,
    subject: `"${params.agentName}" needs changes before publishing`,
    html,
    tags:    [{ name: "type", value: "agent_rejected" }],
  })
}

/**
 * Low credits warning — sent when user's balance drops below threshold
 */
export async function sendLowCreditsEmail(params: {
  to:        string
  name:      string
  balance:   number
  threshold: number
}): Promise<EmailResult> {
  const html = baseTemplate(`
    ${h1("Your credits are running low ⚠️")}
    ${p(`Hi ${params.name || "there"}, your AgentDyne credit balance has dropped below $${params.threshold.toFixed(2)}.`)}
    ${infoBox(`
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Current balance</p>
      <p style="margin:0;font-size:24px;font-weight:800;color:#09090b;">$${params.balance.toFixed(4)}</p>
    `)}
    ${p("Top up your credits to keep your agents and pipelines running without interruption.", true)}
    <div style="margin-top:24px;">${btn(`${BASE_URL}/billing`, "Add Credits", "#16a34a")}</div>
  `, `Your AgentDyne balance is $${params.balance.toFixed(4)}`)

  return sendEmail({
    to:      params.to,
    subject: "⚠️ Low credit balance — top up to keep running",
    html,
    tags:    [{ name: "type", value: "low_credits" }],
  })
}

/**
 * New review notification — sent to agent seller when they receive a review
 */
export async function sendNewReviewEmail(params: {
  to:         string
  sellerName: string
  agentName:  string
  agentId:    string
  rating:     number
  reviewBody: string
}): Promise<EmailResult> {
  const stars = "★".repeat(params.rating) + "☆".repeat(5 - params.rating)
  const html = baseTemplate(`
    ${h1("New review on your agent ⭐")}
    ${p(`A buyer left a review on <strong>"${params.agentName}"</strong>:`)}
    ${infoBox(`
      <p style="margin:0 0 6px;font-size:18px;color:#f59e0b;">${stars}</p>
      <p style="margin:0;font-size:14px;color:#374151;font-style:italic;">"${params.reviewBody || "No written review"}"</p>
    `)}
    <div style="margin-top:24px;">${btn(`${BASE_URL}/marketplace/${params.agentId}`, "View Agent")}</div>
  `, `New ${params.rating}-star review on "${params.agentName}"`)

  return sendEmail({
    to:      params.to,
    subject: `New ${params.rating}★ review on "${params.agentName}"`,
    html,
    tags:    [{ name: "type", value: "new_review" }],
  })
}

/**
 * Payout processed — sent to seller when a payout is initiated
 */
export async function sendPayoutEmail(params: {
  to:         string
  sellerName: string
  amount:     number
  currency:   string
}): Promise<EmailResult> {
  const html = baseTemplate(`
    ${h1("Payout processed 💰")}
    ${p(`Hi ${params.sellerName || "there"}, your payout has been initiated.`)}
    ${infoBox(`
      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Amount</p>
      <p style="margin:0;font-size:28px;font-weight:800;color:#16a34a;">${params.currency.toUpperCase()} ${params.amount.toFixed(2)}</p>
    `, "#f0fdf4", "#bbf7d0")}
    ${p("Funds typically arrive in your bank account within 2–5 business days depending on your bank.", true)}
    <div style="margin-top:24px;">${btn(`${BASE_URL}/billing`, "View Earnings")}</div>
  `, `Your payout of $${params.amount.toFixed(2)} is on the way`)

  return sendEmail({
    to:      params.to,
    subject: `💰 Payout of ${params.currency.toUpperCase()} ${params.amount.toFixed(2)} processed`,
    html,
    tags:    [{ name: "type", value: "payout" }],
  })
}

/**
 * Pipeline execution failure — sent when a user's pipeline fails
 */
export async function sendPipelineFailureEmail(params: {
  to:           string
  name:         string
  pipelineName: string
  pipelineId:   string
  errorMessage: string
}): Promise<EmailResult> {
  const html = baseTemplate(`
    ${h1("Pipeline execution failed")}
    ${p(`Hi ${params.name || "there"}, your pipeline <strong>"${params.pipelineName}"</strong> encountered an error.`)}
    ${infoBox(`
      <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#dc2626;">Error</p>
      <p style="margin:0;font-size:13px;color:#374151;font-family:monospace;">${params.errorMessage.slice(0, 300)}</p>
    `, "#fef2f2", "#fecaca")}
    ${p("You can view the full execution trace and retry from your pipelines dashboard.", true)}
    <div style="margin-top:24px;">${btn(`${BASE_URL}/pipelines/${params.pipelineId}`, "View Pipeline")}</div>
  `, `Pipeline "${params.pipelineName}" failed`)

  return sendEmail({
    to:      params.to,
    subject: `Pipeline "${params.pipelineName}" failed`,
    html,
    tags:    [{ name: "type", value: "pipeline_failure" }],
  })
}

/**
 * Admin alert — critical platform events for admin team
 */
export async function sendAdminAlert(params: {
  subject: string
  body:    string
  data?:   Record<string, unknown>
}): Promise<EmailResult> {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL ?? "support@inteleion.com"
  const dataSection = params.data
    ? `<pre style="background:#f4f4f5;border-radius:8px;padding:16px;font-size:12px;overflow-x:auto;color:#374151;">${JSON.stringify(params.data, null, 2)}</pre>`
    : ""

  const html = baseTemplate(`
    ${h1(`⚠️ Admin Alert`)}
    ${p(params.body)}
    ${dataSection}
    <div style="margin-top:24px;">${btn(`${BASE_URL}/admin`, "Go to Admin Panel", "#dc2626")}</div>
  `, params.body.slice(0, 100))

  return sendEmail({
    to:      adminEmail,
    subject: `[AgentDyne Admin] ${params.subject}`,
    html,
    tags:    [{ name: "type", value: "admin_alert" }],
  })
}

/**
 * HITL (Human-in-the-Loop) approval request
 * Sent when a pipeline reaches an approval gate
 */
export async function sendHITLApprovalEmail(params: {
  to:          string
  name:        string
  pipelineId:  string
  executionId: string
  stepName:    string
  context:     string
  approvalToken: string
}): Promise<EmailResult> {
  const approveUrl = `${BASE_URL}/api/pipelines/approve?token=${params.approvalToken}&action=approve`
  const rejectUrl  = `${BASE_URL}/api/pipelines/approve?token=${params.approvalToken}&action=reject`

  const html = baseTemplate(`
    ${h1("Approval required 🔔")}
    ${p(`Hi ${params.name || "there"}, a pipeline is waiting for your approval at step <strong>"${params.stepName}"</strong>.`)}
    ${infoBox(`
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Context for this decision:</p>
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${params.context.slice(0, 500)}</p>
    `)}
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:24px;">
      <tr>
        <td style="padding-right:12px;">${btn(approveUrl, "✓ Approve", "#16a34a")}</td>
        <td>${btn(rejectUrl, "✗ Reject", "#dc2626")}</td>
      </tr>
    </table>
    ${p("This approval link expires in 48 hours. If you did not expect this email, contact support.", true)}
  `, `Pipeline approval required: "${params.stepName}"`)

  return sendEmail({
    to:      params.to,
    subject: `🔔 Approval required: "${params.stepName}"`,
    html,
    tags:    [{ name: "type", value: "hitl_approval" }],
  })
}
