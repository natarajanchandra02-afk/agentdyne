"use client"

import { useState } from "react"
import Link from "next/link"
import {
  CheckCircle, Loader2, CreditCard, Zap, TrendingUp,
  ExternalLink, AlertTriangle, Shield, Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate, cn } from "@/lib/utils"
import toast from "react-hot-toast"

interface Props { profile: any; transactions: any[] }

// Plans — ALIGNED with constants.ts + public pricing page
// Free: 50 lifetime executions (not monthly) — growth lever, tightly controlled
// Starter: $19/mo, 500/mo, $10 compute cap
// Pro: $79/mo, 5,000/mo, $50 compute cap
const PLANS = [
  {
    key:      "free",
    name:     "Free",
    price:    0,
    calls:    50,
    period:   "lifetime",
    unitHint: "50 total calls, no card needed",
    tagline:  "Explore the platform risk-free",
    features: [
      "50 lifetime executions total",
      "Platform-owned agents only",
      "Playground access",
      "No pipelines or API access",
      "Community support",
    ],
  },
  {
    key:      "starter",
    name:     "Starter",
    price:    19,
    calls:    500,
    period:   "month",
    unitHint: "~$0.038 / 100 runs · $10 compute cap",
    tagline:  "For builders & side projects",
    features: [
      "500 executions / month",
      "$10 monthly compute cap",
      "All agents + API access",
      "Pipelines (up to 5 steps)",
      "Marketplace publishing",
      "Email support · Cancel anytime",
    ],
  },
  {
    key:      "pro",
    name:     "Pro",
    price:    79,
    calls:    5_000,
    period:   "month",
    unitHint: "~$0.0158 / 100 runs · $50 compute cap",
    tagline:  "For production workloads",
    features: [
      "5,000 executions / month",
      "$50 monthly compute cap",
      "All agents + priority execution",
      "Full pipelines (unlimited steps)",
      "Advanced analytics + webhooks",
      "Priority support · Cancel anytime",
    ],
    popular:  true,
  },
  {
    key:      "enterprise",
    name:     "Enterprise",
    price:    null,
    calls:    -1,
    period:   "",
    unitHint: "Volume discounts available",
    tagline:  "For teams that need more control",
    features: [
      "Unlimited executions",
      "Custom compute cap",
      "Dedicated infrastructure",
      "Custom SLA & uptime guarantees",
      "SSO / SAML + private agents",
      "Volume discounts + custom contracts",
    ],
  },
]

export function BillingClient({ profile, transactions }: Props) {
  const [loading, setLoading] = useState<string | null>(null)

  const currentPlan = profile?.subscription_plan || "free"
  const isFreePlan   = currentPlan === "free"
  // Free plan tracks lifetime executions; paid plans track monthly
  const used   = isFreePlan
    ? (profile?.lifetime_executions_used || 0)
    : (profile?.executions_used_this_month || 0)
  const quota  = isFreePlan
    ? 50
    : (profile?.monthly_execution_quota || PLANS.find(p => p.key === currentPlan)?.calls || 500)
  const pct    = quota === -1 ? 0 : Math.min(Math.round((used / quota) * 100), 100)
  const isNearLimit = pct >= 80 && quota !== -1
  const periodLabel = isFreePlan ? "lifetime" : "this month"

  const handleUpgrade = async (planKey: string) => {
    if (planKey === "enterprise") { window.location.href = "/contact"; return }
    if (planKey === currentPlan) return
    setLoading(planKey)
    try {
      const res  = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error?.includes("price ID") || data.error?.includes("priceId")) {
          toast.error("Stripe price IDs not configured — set STRIPE_STARTER_PRICE_ID / STRIPE_PRO_PRICE_ID in env vars.", { duration: 8000 })
        } else {
          toast.error(data.error || "Checkout failed")
        }
        return
      }
      window.location.href = data.url
    } catch (err: any) {
      toast.error(err.message)
    } finally { setLoading(null) }
  }

  const handleManage = async () => {
    setLoading("portal")
    try {
      const res  = await fetch("/api/billing/portal", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch (err: any) {
      toast.error(err.message)
    } finally { setLoading(null) }
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Billing & Plans</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage your subscription and payment history.</p>
        </div>
        {currentPlan !== "free" && (
          <Button variant="outline" onClick={handleManage} disabled={loading === "portal"}
            className="rounded-xl border-zinc-200 text-sm font-semibold gap-2">
            {loading === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Manage Subscription
          </Button>
        )}
      </div>

      {/* Stripe setup banner — only shown for free/unconfigured */}
      {currentPlan === "free" && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-900">Payments via Stripe — setup required for paid plans</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Set <code className="bg-amber-100 px-1 rounded font-mono text-[10px]">STRIPE_STARTER_PRICE_ID</code> and{" "}
              <code className="bg-amber-100 px-1 rounded font-mono text-[10px]">STRIPE_PRO_PRICE_ID</code> to activate upgrades.
            </p>
            <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary font-semibold flex items-center gap-1 mt-1.5 hover:underline w-fit">
              Stripe dashboard <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {/* Usage / current plan card */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-6"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">You are on</p>
            <p className="text-2xl font-bold text-zinc-900 capitalize">{currentPlan} plan</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-400 mb-1">Usage {periodLabel}</p>
            <p className="text-base font-bold text-zinc-900 nums">
              {used.toLocaleString()} / {quota === -1 ? "∞" : quota.toLocaleString()} {isFreePlan ? "lifetime" : "calls"}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        {quota !== -1 && (
          <>
            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-400" : "bg-primary"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-zinc-400">{pct}% used{isFreePlan ? " · lifetime limit" : " · resets monthly"}</p>
              {isNearLimit && (
                <p className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {pct >= 100 ? "Quota reached — upgrade to continue" : `${100 - pct}% remaining — consider upgrading`}
                </p>
              )}
            </div>
          </>
        )}

        {/* Upgrade nudge when near limit */}
        {isNearLimit && currentPlan !== "enterprise" && (
          <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-zinc-600">
              Upgrade to <strong>Pro</strong> for 10,000 calls/month — 10× more capacity.
            </p>
            <Button onClick={() => handleUpgrade("pro")} disabled={loading === "pro"}
              className="rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold gap-2 flex-shrink-0">
              {loading === "pro" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Upgrade to Pro
            </Button>
          </div>
        )}
      </div>

      {/* Plans grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-900">Available Plans</h2>
          {/* Trust signals */}
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-green-500" /> Secure payments</span>
            <span className="flex items-center gap-1"><Lock className="h-3 w-3 text-blue-500" /> Cancel anytime</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {PLANS.map(plan => {
            const isCurrent = plan.key === currentPlan
            const isPopular = (plan as any).popular
            return (
              <div key={plan.key} className={cn(
                "relative rounded-2xl p-5 flex flex-col border transition-all",
                isPopular ? "border-zinc-900 bg-zinc-900 shadow-xl" : "border-zinc-100 bg-white"
              )}>
                {/* Badges */}
                {isPopular && !isCurrent && (
                  <div className="absolute -top-2.5 left-4">
                    <span className="bg-primary text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm">Most Popular</span>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-2.5 left-4">
                    <span className="bg-green-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm">Your plan</span>
                  </div>
                )}

                {/* Name + price */}
                <div className="mb-1">
                  <p className={cn("font-semibold text-base", isPopular ? "text-white" : "text-zinc-900")}>{plan.name}</p>
                  <p className={cn("text-xs mt-0.5", isPopular ? "text-zinc-400" : "text-zinc-400")}>{plan.tagline}</p>
                </div>
                <div className="mt-3 mb-1">
                  {plan.price === null
                    ? <span className={cn("text-3xl font-black", isPopular ? "text-white" : "text-zinc-900")}>Custom</span>
                    : <>
                        <span className={cn("text-3xl font-black", isPopular ? "text-white" : "text-zinc-900")}>${plan.price}</span>
                        <span className={cn("text-sm", isPopular ? "text-zinc-400" : "text-zinc-400")}>/mo</span>
                      </>}
                </div>
                <p className={cn("text-xs mb-4", isPopular ? "text-zinc-500" : "text-zinc-400")}>
                  {plan.calls === -1 ? "Unlimited executions" : `${plan.calls.toLocaleString()} executions${plan.period === "lifetime" ? " (lifetime total)" : "/mo"}`}
                  {" · "}{plan.unitHint}
                </p>

                {/* Features */}
                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className={cn("flex items-start gap-2 text-xs", isPopular ? "text-zinc-300" : "text-zinc-600")}>
                      <CheckCircle className="h-3.5 w-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  disabled={isCurrent || loading === plan.key}
                  onClick={() => handleUpgrade(plan.key)}
                  className={cn(
                    "w-full py-2 rounded-xl text-sm font-semibold transition-all",
                    isCurrent
                      ? "border border-zinc-200 text-zinc-400 cursor-default opacity-60"
                      : isPopular
                      ? "bg-white text-zinc-900 hover:bg-zinc-100"
                      : "bg-zinc-900 text-white hover:bg-zinc-700",
                    loading === plan.key && "opacity-70 cursor-wait"
                  )}
                >
                  {loading === plan.key
                    ? <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    : isCurrent  ? "Current Plan"
                    : plan.key === "enterprise" ? "Contact Sales"
                    : `Upgrade to ${plan.name} →`}
                </button>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-zinc-400 text-center mt-4 flex items-center justify-center gap-1.5">
          <Lock className="h-3 w-3" /> Payments secured by Stripe · Cancel anytime · No hidden fees
        </p>
      </div>

      {/* Payment history */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-6 py-4 border-b border-zinc-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-zinc-400" /> Payment History
          </h2>
          {currentPlan !== "free" && (
            <button onClick={handleManage} disabled={loading === "portal"}
              className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
              {loading === "portal" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Manage billing
            </button>
          )}
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-zinc-400">No transactions yet</p>
            <p className="text-xs text-zinc-300 mt-1">Upgrades and purchases will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-50">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between px-6 py-3.5">
                <div>
                  <p className="text-sm font-medium text-zinc-900 capitalize">{tx.type?.replace(/_/g, " ")}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{formatDate(tx.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-zinc-900 nums">{formatCurrency(tx.amount)}</p>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full",
                    tx.status === "succeeded" ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"
                  )}>
                    {tx.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
