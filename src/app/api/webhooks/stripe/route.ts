import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createAdminClient } from "@/lib/supabase/server"
import Stripe from "stripe"

const PLAN_QUOTAS: Record<string, { quota: number; plan: string }> = {
  starter:    { quota: 1000,  plan: "starter" },
  pro:        { quota: 10000, plan: "pro" },
  enterprise: { quota: -1,    plan: "enterprise" },
}

export async function POST(req: NextRequest) {
  const body      = await req.text()
  const signature = req.headers.get("stripe-signature")!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error("Webhook signature failed:", err.message)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const supabase = createAdminClient()

  try {
    switch (event.type) {

      // ── Subscription created / updated ──────────────────────────────
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub     = event.data.object as Stripe.Subscription
        const userId  = sub.metadata?.userId
        if (!userId) break

        // Determine plan from price ID
        const priceId = sub.items.data[0]?.price?.id
        let planKey   = "starter"
        for (const [key, val] of Object.entries(PLAN_QUOTAS)) {
          const envKey = `STRIPE_${key.toUpperCase()}_PRICE_ID`
          if (process.env[envKey] === priceId) { planKey = key; break }
        }

        const quota = PLAN_QUOTAS[planKey]?.quota ?? 1000

        await supabase.from("profiles").update({
          subscription_plan:   planKey,
          subscription_status: sub.status,
          subscription_id:     sub.id,
          monthly_execution_quota: quota,
          updated_at: new Date().toISOString(),
        }).eq("id", userId)

        break
      }

      // ── Subscription deleted (canceled) ─────────────────────────────
      case "customer.subscription.deleted": {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.userId
        if (!userId) break

        await supabase.from("profiles").update({
          subscription_plan:   "free",
          subscription_status: "canceled",
          subscription_id:     null,
          monthly_execution_quota: 100,
          updated_at: new Date().toISOString(),
        }).eq("id", userId)

        break
      }

      // ── Payment succeeded ────────────────────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice
        const userId  = (invoice.subscription_details?.metadata as any)?.userId
        if (!userId) break

        const amount = (invoice.amount_paid || 0) / 100
        const platformFee   = amount * 0.20
        const sellerAmount  = amount * 0.80

        // Reset monthly quota usage
        await supabase.from("profiles").update({
          executions_used_this_month: 0,
          quota_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          total_spent: supabase.rpc("increment_spent", { uid: userId, amount }),
        }).eq("id", userId)

        // Record transaction
        await supabase.from("transactions").insert({
          user_id:                  userId,
          stripe_payment_intent_id: typeof invoice.payment_intent === "string" ? invoice.payment_intent : invoice.payment_intent?.id,
          amount,
          platform_fee:  platformFee,
          seller_amount: sellerAmount,
          currency:      invoice.currency,
          type:          "subscription",
          status:        "succeeded",
          metadata:      { invoice_id: invoice.id },
        })

        break
      }

      // ── Payment failed ───────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const userId  = (invoice.subscription_details?.metadata as any)?.userId
        if (!userId) break

        await supabase.from("profiles").update({
          subscription_status: "past_due",
        }).eq("id", userId)

        // Send notification
        await supabase.from("notifications").insert({
          user_id: userId,
          title:   "Payment failed",
          body:    "Your subscription payment failed. Please update your payment method to avoid service interruption.",
          type:    "billing_failure",
          action_url: "/billing",
        })

        break
      }

      // ── Stripe Connect account updated (onboarding complete) ─────────
      case "account.updated": {
        const account = event.data.object as Stripe.Account
        if (account.details_submitted && account.charges_enabled) {
          await supabase.from("profiles").update({
            stripe_connect_onboarded: true,
            role: "seller",
            updated_at: new Date().toISOString(),
          }).eq("stripe_connect_account_id", account.id)
        }
        break
      }

      // ── Charge refunded ──────────────────────────────────────────────
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge
        await supabase.from("transactions").update({ status: "refunded" })
          .eq("stripe_charge_id", charge.id)
        break
      }

      default:
        break
    }
  } catch (err: any) {
    console.error("Webhook handler error:", err)
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
