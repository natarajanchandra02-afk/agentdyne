export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/credits       — get current balance + transaction history
 * POST /api/credits      — create a Stripe checkout to top up credits
 */

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const page  = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20"))

    const [
      { data: credits },
      { data: txns, count },
    ] = await Promise.all([
      supabase.from("credits").select("*").eq("user_id", user.id).single(),
      supabase.from("credit_transactions")
        .select("*", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range((page - 1) * limit, page * limit - 1),
    ])

    const total = count ?? 0

    return NextResponse.json({
      balance:          credits?.balance_usd    ?? 0,
      hard_limit:       credits?.hard_limit_usd ?? 5,
      alert_threshold:  credits?.alert_threshold ?? 1,
      total_purchased:  credits?.total_purchased ?? 0,
      total_spent:      credits?.total_spent     ?? 0,
      low_balance:      (credits?.balance_usd ?? 0) < (credits?.alert_threshold ?? 1),
      transactions: txns ?? [],
      pagination: {
        total, page, limit,
        pages:   Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

const CREDIT_PACKAGES = [
  { id: "credits_5",   label: "$5 credits",   amount_usd: 5,   credits_usd: 5   },
  { id: "credits_20",  label: "$20 credits",  amount_usd: 20,  credits_usd: 22  }, // +10% bonus
  { id: "credits_50",  label: "$50 credits",  amount_usd: 50,  credits_usd: 57  }, // +14% bonus
  { id: "credits_100", label: "$100 credits", amount_usd: 100, credits_usd: 120 }, // +20% bonus
]

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { package_id } = await req.json()

    const pkg = CREDIT_PACKAGES.find(p => p.id === package_id)
    if (!pkg) {
      return NextResponse.json({
        error: "Invalid package. Choose one of: " + CREDIT_PACKAGES.map(p => p.id).join(", "),
        packages: CREDIT_PACKAGES,
      }, { status: 400 })
    }

    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single()

    let customerId = profile?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: { userId: user.id },
      })
      customerId = customer.id
      await supabase.from("profiles")
        .update({ stripe_customer_id: customerId }).eq("id", user.id)
    }

    // One-time payment (not subscription)
    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      line_items: [{
        quantity:    1,
        price_data: {
          currency:     "usd",
          unit_amount:  pkg.amount_usd * 100,
          product_data: {
            name:        pkg.label,
            description: `Add $${pkg.credits_usd.toFixed(2)} credits to your AgentDyne wallet`,
          },
        },
      }],
      mode:        "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?credits_success=1&package=${pkg.id}`,
      cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/billing?credits_canceled=1`,
      metadata: {
        userId:      user.id,
        type:        "credits_topup",
        package_id:  pkg.id,
        credits_usd: String(pkg.credits_usd),
      },
    })

    return NextResponse.json({ url: session.url, package: pkg })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
