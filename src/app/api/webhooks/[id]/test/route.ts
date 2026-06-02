export const runtime = "edge"

/**
 * POST /api/webhooks/[id]/test — Send a test ping to the webhook URL
 * Builds a signed test payload, delivers it, returns delivery status.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: webhook } = await supabase
    .from("webhooks").select("id, url, secret, is_active").eq("id", id).eq("user_id", user.id).single()

  if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 })

  const testPayload = JSON.stringify({
    event: "test.ping",
    timestamp: new Date().toISOString(),
    data: {
      message: "This is a test delivery from AgentDyne",
      webhookId: id,
      userId: user.id,
    },
  })

  const signature = await hmacSign(webhook.secret, testPayload)
  const ts = Date.now()

  let deliveryStatus = 0
  let deliveryError: string | null = null

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type":          "application/json",
        "X-AgentDyne-Signature": `v1=${signature}`,
        "X-AgentDyne-Timestamp": String(ts),
        "X-AgentDyne-Event":     "test.ping",
        "User-Agent":            "AgentDyne-Webhooks/1.0",
      },
      body: testPayload,
      signal: AbortSignal.timeout(10_000),
    })
    deliveryStatus = res.status
  } catch (err: any) {
    deliveryError = err.message ?? "Delivery failed"
  }

  // Update last_triggered_at and failure_count
  await supabase.from("webhooks").update({
    last_triggered_at: new Date().toISOString(),
    failure_count: deliveryStatus >= 200 && deliveryStatus < 300
      ? 0
      : (webhook as any).failure_count + 1,
  }).eq("id", id)

  if (deliveryError) {
    return NextResponse.json({ error: deliveryError, delivered: false }, { status: 502 })
  }

  return NextResponse.json({
    delivered: deliveryStatus >= 200 && deliveryStatus < 300,
    status: deliveryStatus,
    payload: JSON.parse(testPayload),
  })
}
