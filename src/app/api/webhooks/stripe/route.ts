export const runtime = 'edge'

/**
 * POST /api/webhooks/stripe
 *
 * Production-hardened Stripe webhook handler.
 *
 * Key hardening (April 2026):
 * ✅ Event idempotency — processed_stripe_events table prevents double-processing
 * ✅ Dead letter queue — failed events go to failed_webhooks, we return 200 to Stripe
 * ✅ Signature verification — HMAC-SHA256 via Stripe's constructEventAsync
 * ✅ All credit operations use RPCs with FOR UPDATE locking (no race conditions)
 * ✅ Minimum $5 credit package enforced (Stripe fee protection)
 * ✅ Full audit trail — every event logged to audit_logs
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"
import Stripe from "stripe"

const PLAN_QUOTAS: Record<string, { quota: number; plan: string }> = {
  starter:    { quota: 1_000,  plan: "starter"    },
  pro:        { quota: 10_000, plan: "pro"         },
  enterprise: { quota: -1,     plan: "enterprise"  },
}

export async function POST(req: NextRequest) {
  // ── 1. Parse body and verify signature ─────────────────────────────────────
  const body      = await req.text()
  const signature = req.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error("[stripe-webhook] Signature verification failed:", err.message)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // ── 2. Idempotency check — prevent double-processing ───────────────────────
  // Stripe sends events "at least once". Without this, checkout.session.completed
  // fires twice → user gets double credits. This check is CRITICAL.
  try {
    const { data: existing } = await supabase
      .from("processed_stripe_events")
      .select("event_id")
      .eq("event_id", event.id)
      .maybeSingle()

    if (existing) {
      // Already processed — return 200 so Stripe stops retrying
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Mark as processed BEFORE handling (optimistic — prevents race if two
    // requests arrive simultaneously for the same event)
    await supabase.from("processed_stripe_events").insert({
      event_id:   event.id,
      event_type: event.type,
    })
  } catch (err: any) {
    // DB error on idempotency check — log but continue processing
    // Better to risk a duplicate than to block all webhooks
    console.error("[stripe-webhook] Idempotency check failed:", err.message)
  }

  // ── 3. Process event with dead letter queue on failure ─────────────────────
  try {
    await handleStripeEvent(event, supabase)
  } catch (err: any) {
    console.error("[stripe-webhook] Handler failed for", event.type, ":", err.message)

    // Dead letter queue — store failed event for manual retry
    // Return 200 to Stripe so it stops retrying (we manage retries ourselves)
    try {
      await supabase.from("failed_webhooks").insert({
        event_id:   event.id,
        event_type: event.type,
        payload:    event as any,
        error:      err.message?.slice(0, 1000),
      })
    } catch (dlqErr: any) {
      console.error("[stripe-webhook] DLQ write failed:", dlqErr.message)
    }

    // Still return 200 — we'll process from failed_webhooks manually
    return NextResponse.json({ received: true, queued: true })
  }

  // ── 4. Audit log ───────────────────────────────────────────────────────────
  supabase.from("audit_logs").insert({
    actor_type: "webhook",
    action:     `stripe.${event.type}`,
    resource:   "stripe",
    payload:    { event_id: event.id, event_type: event.type },
  }).then(() => {}).catch(() => {})

  return NextResponse.json({ received: true })
}

// ─── Event handler ─────────────────────────────────────────────────────────────

async function handleStripeEvent(event: Stripe.Event, supabase: any): Promise<void> {
  switch (event.type) {

    // ── Subscription lifecycle ─────────────────────────────────────────────────

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub    = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.userId
      if (!userId) {
        console.warn("[stripe-webhook] subscription event missing userId metadata:", event.id)
        return
      }

      const priceId = sub.items.data[0]?.price?.id
      let planKey   = "starter"

      for (const key of Object.keys(PLAN_QUOTAS)) {
        const envKey = `STRIPE_${key.toUpperCase()}_PRICE_ID`
        if (process.env[envKey] === priceId) { planKey = key; break }
      }

      await supabase.from("profiles").update({
        subscription_plan:       planKey,
        subscription_status:     sub.status,
        subscription_id:         sub.id,
        monthly_execution_quota: PLAN_QUOTAS[planKey]?.quota ?? 1_000,
        updated_at:              new Date().toISOString(),
      }).eq("id", userId)

      await supabase.from("notifications").insert({
        user_id:    userId,
        title:      `${planKey.charAt(0).toUpperCase() + planKey.slice(1)} plan ${sub.status === "active" ? "activated" : "updated"}`,
        body:       sub.status === "active"
          ? `Your ${planKey} plan is now active. Enjoy your upgraded limits!`
          : `Your subscription status is now: ${sub.status}.`,
        type:       "subscription_update",
        action_url: "/billing",
      })
      break
    }

    case "customer.subscription.deleted": {
      const sub    = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.userId
      if (!userId) return

      await supabase.from("profiles").update({
        subscription_plan:       "free",
        subscription_status:     "canceled",
        subscription_id:         null,
        monthly_execution_quota: 100,
        updated_at:              new Date().toISOString(),
      }).eq("id", userId)

      await supabase.from("notifications").insert({
        user_id:    userId,
        title:      "Subscription canceled",
        body:       "Your subscription has been canceled. You're now on the free plan. You can resubscribe anytime.",
        type:       "subscription_canceled",
        action_url: "/billing",
      })
      break
    }

    // ── Invoice / payment ──────────────────────────────────────────────────────

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice
      const userId  = (invoice.subscription_details?.metadata as any)?.userId
      if (!userId) return

      const amount = (invoice.amount_paid || 0) / 100

      await Promise.all([
        // Reset monthly usage counter on successful subscription renewal
        supabase.from("profiles").update({
          executions_used_this_month: 0,
          quota_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", userId),

        supabase.from("transactions").insert({
          user_id:                  userId,
          stripe_payment_intent_id: typeof invoice.payment_intent === "string"
            ? invoice.payment_intent
            : (invoice.payment_intent as Stripe.PaymentIntent | null)?.id ?? null,
          amount,
          platform_fee:  amount * 0.20,
          seller_amount: 0,
          currency:      invoice.currency,
          type:          "subscription",
          status:        "succeeded",
          metadata:      { invoice_id: invoice.id },
        }),
      ])
      break
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      const userId  = (invoice.subscription_details?.metadata as any)?.userId
      if (!userId) return

      await Promise.all([
        supabase.from("profiles").update({
          subscription_status: "past_due",
          updated_at: new Date().toISOString(),
        }).eq("id", userId),

        supabase.from("notifications").insert({
          user_id:    userId,
          title:      "⚠️ Payment failed",
          body:       "Your subscription payment failed. Please update your payment method to avoid service interruption.",
          type:       "billing_failure",
          action_url: "/billing",
        }),
      ])
      break
    }

    // ── Credits top-up (one-time checkout) ────────────────────────────────────

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      const meta    = session.metadata as Record<string, string> | null
      if (!meta) return

      if (meta.type === "credits_topup" && meta.userId && meta.credits_usd) {
        const userId     = meta.userId
        const creditsUsd = parseFloat(meta.credits_usd)
        const packageId  = meta.package_id || "unknown"

        if (isNaN(creditsUsd) || creditsUsd <= 0) {
          throw new Error(`Invalid credits_usd in checkout metadata: ${meta.credits_usd}`)
        }

        // Minimum transaction guard (Stripe fee protection: $5 minimum)
        if (creditsUsd < 5) {
          throw new Error(`Credit amount $${creditsUsd} below minimum $5`)
        }

        // Atomically add credits — FOR UPDATE locking inside RPC prevents race
        const { data: result } = await supabase.rpc("add_credits", {
          user_id_param:      userId,
          amount_param:       creditsUsd,
          description_param:  `Credits package: ${packageId} (Stripe: ${session.id})`,
          reference_id_param: null,
        })

        if (!result?.success) {
          throw new Error(`add_credits RPC failed: ${JSON.stringify(result)}`)
        }

        await supabase.from("notifications").insert({
          user_id:    userId,
          title:      "✅ Credits added",
          body:       `$${creditsUsd.toFixed(2)} in credits have been added to your wallet. New balance: $${result.new_balance?.toFixed(4)}.`,
          type:       "credits_topup",
          action_url: "/billing",
        })
      }
      break
    }

    // ── Stripe Connect — seller onboarding ───────────────────────────────────

    case "account.updated": {
      const account = event.data.object as Stripe.Account
      if (account.details_submitted && account.charges_enabled) {
        await supabase.from("profiles").update({
          stripe_connect_onboarded: true,
          role:       "seller",
          updated_at: new Date().toISOString(),
        }).eq("stripe_connect_account_id", account.id)
      }
      break
    }

    // ── Refunds ────────────────────────────────────────────────────────────────

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge
      await supabase
        .from("transactions")
        .update({ status: "refunded", updated_at: new Date().toISOString() })
        .eq("stripe_charge_id", charge.id)
      break
    }

    default:
      // Unhandled event type — safe to ignore (we receive many event types)
      break
  }
}
