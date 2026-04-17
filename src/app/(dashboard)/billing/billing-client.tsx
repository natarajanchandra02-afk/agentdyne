"use client"

import { useState } from "react"
import { CheckCircle, Loader2, CreditCard, Zap, TrendingUp, ExternalLink, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"
import Link from "next/link"
import toast from "react-hot-toast"

interface Props { profile: any; transactions: any[] }

const PLANS = [
  {
    key: "free", name: "Free", price: 0, calls: 100,
    features: ["100 calls/month", "Free agents only", "Community support"],
  },
  {
    key: "starter", name: "Starter", price: 19, calls: 1000,
    features: ["1,000 calls/month", "All free agents", "Email support", "API access"],
  },
  {
    key: "pro", name: "Pro", price: 79, calls: 10000,
    features: ["10,000 calls/month", "All agents", "Priority execution", "Advanced analytics", "Priority support"],
    popular: true,
  },
  {
    key: "enterprise", name: "Enterprise", price: null, calls: -1,
    features: ["Unlimited calls", "Custom SLA", "Dedicated infra", "SSO/SAML", "Custom contracts"],
  },
]

export function BillingClient({ profile, transactions }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const currentPlan = profile?.subscription_plan || "free"
  const used  = profile?.executions_used_this_month || 0
  const quota = profile?.monthly_execution_quota || 100
  const pct   = Math.min(Math.round((used / quota) * 100), 100)

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
        // Surface helpful messages for common errors
        if (data.error?.includes("price ID") || data.error?.includes("priceId")) {
          toast.error(
            "Stripe price IDs are not configured. Set STRIPE_STARTER_PRICE_ID and STRIPE_PRO_PRICE_ID in your env vars.",
            { duration: 8000 }
          )
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

  // Check if Stripe is configured by probing env (client-side approximation)
  // The real check happens server-side; here we just show a banner if checkout fails
  const stripeNotConfigured = false // will be revealed by error message

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
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

      {/* Stripe setup banner — shown when env vars are missing */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-zinc-900">Stripe setup required to enable paid plans</p>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            Payments are powered by Stripe. To activate Starter and Pro upgrades you need to:
          </p>
          <ol className="text-xs text-zinc-500 mt-2 space-y-1 list-decimal list-inside">
            <li>Create products + recurring prices in your <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener noreferrer" className="text-primary underline">Stripe dashboard</a></li>
            <li>Copy the <strong>Price IDs</strong> (e.g. <code className="bg-amber-100 px-1 rounded font-mono">price_xxx</code>)</li>
            <li>Add to env vars: <code className="bg-amber-100 px-1 rounded font-mono">STRIPE_STARTER_PRICE_ID</code> and <code className="bg-amber-100 px-1 rounded font-mono">STRIPE_PRO_PRICE_ID</code></li>
            <li>Redeploy — upgrades will work immediately</li>
          </ol>
          <a href="https://docs.stripe.com/products-prices/how-products-and-prices-work" target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary font-semibold flex items-center gap-1 mt-2 hover:underline">
            Stripe pricing docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Current plan summary */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-6" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Current Plan</p>
            <p className="text-2xl font-bold text-zinc-900 capitalize">{currentPlan}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-400 mb-1">Usage this month</p>
            <p className="text-sm font-bold text-zinc-900 nums">
              {used.toLocaleString()} / {quota === -1 ? "∞" : quota.toLocaleString()} calls
            </p>
          </div>
        </div>
        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-400" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-zinc-400 mt-2">{pct}% used · resets monthly</p>
      </div>

      {/* Plans grid */}
      <div>
        <h2 className="text-base font-semibold text-zinc-900 mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.key === currentPlan
            const isPopular = (plan as any).popular
            return (
              <div key={plan.key} className={cn(
                "relative rounded-2xl p-5 flex flex-col border transition-all",
                isPopular ? "border-zinc-900 bg-zinc-900 shadow-lg" : "border-zinc-100 bg-white"
              )}>
                {isPopular && (
                  <div className="absolute -top-2.5 left-4">
                    <span className="bg-primary text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm">
                      Most Popular
                    </span>
                  </div>
                )}
                {isCurrent && !isPopular && (
                  <div className="absolute -top-2.5 left-4">
                    <span className="bg-green-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm">
                      Your plan
                    </span>
                  </div>
                )}
                <div className="mb-4">
                  <p className={cn("font-semibold text-base", isPopular ? "text-white" : "text-zinc-900")}>{plan.name}</p>
                  <div className="mt-2">
                    {plan.price === null
                      ? <span className={cn("text-3xl font-black", isPopular ? "text-white" : "text-zinc-900")}>Custom</span>
                      : <>
                          <span className={cn("text-3xl font-black", isPopular ? "text-white" : "text-zinc-900")}>${plan.price}</span>
                          <span className={cn("text-sm", isPopular ? "text-zinc-400" : "text-zinc-400")}>/mo</span>
                        </>
                    }
                  </div>
                  <p className={cn("text-xs mt-1", isPopular ? "text-zinc-400" : "text-zinc-400")}>
                    <Zap className="h-3 w-3 inline mr-0.5" />
                    {plan.calls === -1 ? "Unlimited" : plan.calls.toLocaleString()} calls/mo
                  </p>
                </div>
                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className={cn("flex items-center gap-2 text-xs", isPopular ? "text-zinc-300" : "text-zinc-600")}>
                      <CheckCircle className="h-3.5 w-3.5 text-green-400 flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
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
                    : isCurrent ? "Current Plan"
                    : plan.key === "enterprise" ? "Contact Sales"
                    : `Upgrade to ${plan.name}`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Transaction history */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-6 py-4 border-b border-zinc-50">
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-zinc-400" /> Payment History
          </h2>
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-zinc-400">No transactions yet</p>
            <p className="text-xs text-zinc-300 mt-1">Upgrades and agent purchases will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-50">
            {transactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between px-6 py-3.5">
                <div>
                  <p className="text-sm font-medium text-zinc-900 capitalize">{tx.type?.replace("_", " ")}</p>
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
