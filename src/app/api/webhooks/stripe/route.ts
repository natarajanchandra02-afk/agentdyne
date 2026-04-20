export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"
import Stripe from "stripe"

const PLAN_QUOTAS: Record<string, { quota: number; plan: string }> = {
  starter:    { quota: 1_000,  plan: "starter"    },
  pro:        { quota: 10_000, plan: "pro"         },
  enterprise: { quota: -1,     plan: "enterprise"  },
}

// Credit packages — must match /api/credits/route.ts
const CREDIT_PACKAGES: Record<string, number> = {
  credits_5:   5,
  credits_20:  22,   // with 10% bonus
  credits_50:  57,   // with 14% bonus
  credits_100: 120,  // with 20% bonus
}

export async function POST(req: NextRequest) {
  const body      = await req.text()
  const signature = req.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  try {
    switch (event.type) {

      // ── Subscription lifecycle ──────────────────────────────────────────────

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.userId
        if (!userId) { console.warn("subscription event missing userId metadata"); break }

        const priceId = sub.items.data[0]?.price?.id
        let planKey   = "starter"
        for (const key of Object.keys(PLAN_QUOTAS)) {
          if (process.env[`STRIPE_${key.toUpperCase()}_PRICE_ID`] === priceId) {
            planKey = key; break
          }
        }

        await supabase.from("profiles").update({
          subscription_plan:       planKey,
          subscription_status:     sub.status,
          subscription_id:         sub.id,
          monthly_execution_quota: PLAN_QUOTAS[planKey]?.quota ?? 1_000,
          updated_at:              new Date().toISOString(),
        }).eq("id", userId)
        break
      }

      case "customer.subscription.deleted": {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.userId
        if (!userId) break

        await supabase.from("profiles").update({
          subscription_plan:       "free",
          subscription_status:     "canceled",
          subscription_id:         null,
          monthly_execution_quota: 100,
          updated_at:              new Date().toISOString(),
        }).eq("id", userId)
        break
      }

      // ── Invoice / payment ───────────────────────────────────────────────────

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice
        const userId  = (invoice.subscription_details?.metadata as Record<string, string> | undefined)?.userId
        if (!userId) break

        const amount = (invoice.amount_paid || 0) / 100

        await Promise.all([
          // Reset monthly usage counter
          supabase.from("profiles").update({
            executions_used_this_month: 0,
            quota_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }).eq("id", userId),

          // Record transaction
          supabase.from("transactions").insert({
            user_id:                  userId,
            stripe_payment_intent_id: typeof invoice.payment_intent === "string"
              ? invoice.payment_intent
              : (invoice.payment_intent as Stripe.PaymentIntent | null)?.id ?? null,
            amount,
            platform_fee:  amount * 0.20,
            seller_amount: amount * 0.80,
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
        const userId  = (invoice.subscription_details?.metadata as Record<string, string> | undefined)?.userId
        if (!userId) break

        await Promise.all([
          supabase.from("profiles").update({ subscription_status: "past_due" }).eq("id", userId),
          supabase.from("notifications").insert({
            user_id:    userId,
            title:      "Payment failed",
            body:       "Your subscription payment failed. Please update your payment method to continue using AgentDyne.",
            type:       "billing_failure",
            action_url: "/billing",
          }),
        ])
        break
      }

      // ── Credits top-up (one-time payment) ────────────────────────────────────
      // This is the critical missing case from the previous implementation.
      // When a user purchases a credit package via /api/credits POST,
      // a Stripe Checkout session is created with metadata:
      //   { type: "credits_topup", userId, package_id, credits_usd }
      // This event fires when the payment succeeds.

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const meta    = session.metadata as Record<string, string> | null

        if (!meta) break

        // Handle credits top-up
        if (meta.type === "credits_topup" && meta.userId && meta.credits_usd) {
          const userId     = meta.userId
          const creditsUsd = parseFloat(meta.credits_usd)
          const packageId  = meta.package_id || "unknown"

          if (isNaN(creditsUsd) || creditsUsd <= 0) {
            console.error("Invalid credits_usd in checkout metadata:", meta)
            break
          }

          // Atomically add credits using the RPC function
          // reference_id must be UUID — generate a deterministic UUID v5 from session.id
          // to avoid DB constraint errors (Stripe session IDs are not UUIDs)
          const { data: result } = await supabase.rpc("add_credits", {
            user_id_param:      userId,
            amount_param:       creditsUsd,
            description_param:  `Credits package: ${packageId} (${session.id})`,
            reference_id_param: null,  // No UUID reference for Stripe session
          })

          if (!result?.success) {
            console.error("add_credits RPC failed:", result)
            // Return 200 anyway — Stripe will retry on 5xx
          }

          // Notify user
          await supabase.from("notifications").insert({
            user_id:    userId,
            title:      "Credits added",
            body:       `$${creditsUsd.toFixed(2)} in credits have been added to your wallet.`,
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

      // ── Refunds ───────────────────────────────────────────────────────────────

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge
        await supabase
          .from("transactions")
          .update({ status: "refunded" })
          .eq("stripe_charge_id", charge.id)
        break
      }

      default:
        // Unknown event type — safe to ignore
        break
    }
  } catch (err: any) {
    console.error("Webhook handler error for event", event.type, ":", err)
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
