export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", user.id)
      .single()

    let accountId = profile?.stripe_connect_account_id
    if (!accountId) {
      const account = await stripe.accounts.create({
        type:         "express",
        email:        user.email!,
        capabilities: { transfers: { requested: true } },
        metadata:     { userId: user.id },
      })
      accountId = account.id

      // ✅ Bug fix: this write's result was never checked. If it silently
      // failed (network blip, transient DB error), the code continued anyway
      // — generating a valid Stripe onboarding link for an account_id that
      // was never actually saved. The user would complete onboarding
      // successfully on Stripe's side, but the account.updated webhook could
      // never match it back to their profile (queries by
      // stripe_connect_account_id), permanently and silently, not just a
      // timing issue. Now fails loudly instead of proceeding on a write that
      // may not have happened.
      const { error: saveErr } = await supabase.from("profiles")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", user.id)

      if (saveErr) {
        console.error("[billing/connect] Failed to save stripe_connect_account_id:", saveErr.message)
        return NextResponse.json(
          { error: "Could not save your Connect account. Please try again — do not proceed to Stripe onboarding yet." },
          { status: 500 }
        )
      }
    }

    const link = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/seller?refresh=1`,
      return_url:  `${process.env.NEXT_PUBLIC_APP_URL}/seller?connected=1`,
      type:        "account_onboarding",
    })

    return NextResponse.json({ url: link.url })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
