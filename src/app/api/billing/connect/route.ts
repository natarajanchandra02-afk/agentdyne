export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id, email")
      .eq("id", user.id)
      .single()

    let accountId = profile?.stripe_connect_account_id
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email!,
        capabilities: { transfers: { requested: true } },
        metadata: { userId: user.id },
      })
      accountId = account.id
      await supabase.from("profiles")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", user.id)
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
