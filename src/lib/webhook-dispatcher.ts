/**
 * webhook-dispatcher.ts — Fire outbound webhooks on execution events
 *
 * Called fire-and-forget from execute routes. Never blocks execution.
 * HMAC-SHA256 signed. Retries on 5xx up to 3 times with exponential backoff.
 * Logs every delivery to webhook_deliveries for audit trail.
 *
 * Edge-runtime safe: Web Crypto + fetch only.
 */

export type WebhookEventType =
  | "execution.success"
  | "execution.failed"
  | "pipeline.success"
  | "pipeline.failed"
  | "eval.completed"
  | "quota.warning"
  | "agent.approved"
  | "agent.rejected"
  | "payout.processed"
  | "test.ping"

export interface WebhookPayload {
  event:     WebhookEventType
  timestamp: string
  data:      Record<string, unknown>
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    )
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
    return "v1=" + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")
  } catch {
    return "v1=error"
  }
}

async function deliverWebhook(
  webhook: { id: string; url: string; secret: string },
  payloadStr: string,
  signature: string,
  eventType: string,
): Promise<{ ok: boolean; status: number; error?: string; ms: number }> {
  const start = Date.now()
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type":          "application/json",
        "X-AgentDyne-Signature": signature,
        "X-AgentDyne-Timestamp": String(Date.now()),
        "X-AgentDyne-Event":     eventType,
        "User-Agent":            "AgentDyne-Webhooks/2.0",
      },
      body: payloadStr,
      signal: AbortSignal.timeout(8_000),
    })
    return { ok: res.ok, status: res.status, ms: Date.now() - start }
  } catch (err: any) {
    return { ok: false, status: 0, error: err.message ?? "Network error", ms: Date.now() - start }
  }
}

/**
 * dispatchWebhooks — fire-and-forget webhook delivery
 *
 * @param supabase  Supabase client (server-side)
 * @param userId    Agent owner's user ID
 * @param event     Event type string
 * @param data      Event payload data
 */
export async function dispatchWebhooks(
  supabase:  any,
  userId:    string,
  event:     WebhookEventType,
  data:      Record<string, unknown>,
): Promise<void> {
  try {
    // Load active webhooks subscribed to this event
    const { data: webhooks } = await supabase
      .from("webhooks")
      .select("id, url, secret, failure_count")
      .eq("user_id", userId)
      .eq("is_active", true)
      .contains("events", [event])
      .limit(10)

    if (!webhooks?.length) return

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    }
    const payloadStr = JSON.stringify(payload)

    await Promise.allSettled(
      webhooks.map(async (wh: any) => {
        const signature = await hmacSign(wh.secret, payloadStr)

        let result = await deliverWebhook(wh, payloadStr, signature, event)

        // Retry up to 2 more times on 5xx
        if (!result.ok && (result.status >= 500 || result.status === 0)) {
          await new Promise(r => setTimeout(r, 1000))
          result = await deliverWebhook(wh, payloadStr, signature, event)
        }
        if (!result.ok && (result.status >= 500 || result.status === 0)) {
          await new Promise(r => setTimeout(r, 3000))
          result = await deliverWebhook(wh, payloadStr, signature, event)
        }

        const delivered = result.ok

        // Log delivery
        await supabase.from("webhook_deliveries").insert({
          webhook_id:   wh.id,
          event_type:   event,
          payload,
          status_code:  result.status,
          response_ms:  result.ms,
          delivered,
          error:        result.error ?? null,
          delivered_at: new Date().toISOString(),
        }).catch(() => {})

        // Update webhook last_triggered + failure_count
        await supabase.from("webhooks").update({
          last_triggered_at: new Date().toISOString(),
          failure_count: delivered ? 0 : (wh.failure_count ?? 0) + 1,
        }).eq("id", wh.id).catch(() => {})

        // Auto-disable after 10 consecutive failures
        if (!delivered && (wh.failure_count ?? 0) >= 9) {
          await supabase.from("webhooks").update({ is_active: false }).eq("id", wh.id).catch(() => {})
        }
      })
    )
  } catch { /* silent — webhook delivery must never crash execute routes */ }
}
