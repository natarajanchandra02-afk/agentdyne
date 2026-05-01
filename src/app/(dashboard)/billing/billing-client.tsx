"use client"

import { useState } from "react"
import Link from "next/link"
import {
  CheckCircle, Loader2, CreditCard, Zap, TrendingUp,
  ExternalLink, AlertTriangle, Shield, Lock, RefreshCw,
  DollarSign, Info, ChevronRight,
} from "lucide-react"
import { Button }                from "@/components/ui/button"
import { formatCurrency, formatDate, cn } from "@/lib/utils"
import toast from "react-hot-toast"

interface Props { profile: any; transactions: any[] }

// ── Plan definitions ──────────────────────────────────────────────────────────
// unitCost: actual per-execution cost (plan price ÷ included executions)
// MUST match constants.ts PLAN_QUOTAS + PLAN_COMPUTE_CAPS
const PLANS = [
  {
    key:       "free",
    name:      "Free",
    price:     0,
    calls:     50,
    period:    "lifetime",
    unitCost:  null,          // platform absorbs cost
    computeCap: null,
    tagline:   "Explore the platform risk-free",
    features: [
      "50 lifetime executions total",
      "Platform-owned agents only",
      "Playground access",
      "No pipelines or API access",
      "Community support",
    ],
  },
  {
    key:       "starter",
    name:      "Starter",
    price:     19,
    calls:     500,
    period:    "month",
    unitCost:  0.038,         // $19 ÷ 500 = $0.038 per execution
    computeCap: 10,
    tagline:   "For builders & side projects",
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
    key:       "pro",
    name:      "Pro",
    price:     79,
    calls:     5_000,
    period:    "month",
    unitCost:  0.0158,        // $79 ÷ 5,000 = $0.0158 per execution
    computeCap: 50,
    tagline:   "For production workloads",
    features: [
      "5,000 executions / month",
      "$50 monthly compute cap",
      "All agents + priority execution",
      "Full pipelines (unlimited steps)",
      "Advanced analytics + webhooks",
      "Priority support · Cancel anytime",
    ],
    popular: true,
  },
  {
    key:       "enterprise",
    name:      "Enterprise",
    price:     null,
    calls:     -1,
    period:    "",
    unitCost:  null,
    computeCap: null,
    tagline:   "For teams that need more control",
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

// ── Compute budget gauge ──────────────────────────────────────────────────────
function ComputeGauge({
  spent, cap, label,
}: { spent: number; cap: number; label: string }) {
  const pct    = Math.min(Math.round((spent / cap) * 100), 100)
  const color  = pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-primary"
  const remain = Math.max(0, cap - spent)

  return (
    <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-700">{label}</span>
        <span className="text-xs text-zinc-500 nums">
          ${spent.toFixed(3)} <span className="text-zinc-400">/ ${cap.toFixed(2)}</span>
        </span>
      </div>
      <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-zinc-400">{pct}% used</span>
        <span className={cn("text-[11px] font-semibold", pct >= 90 ? "text-red-500" : "text-zinc-500")}>
          ${remain.toFixed(3)} remaining
        </span>
      </div>
      {pct >= 100 && (
        <div className="mt-2 flex items-start gap-1.5 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-600 leading-snug">
            Compute cap reached — executions are blocked until next billing cycle or you upgrade.
          </p>
        </div>
      )}
      {pct >= 80 && pct < 100 && (
        <div className="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-700 leading-snug">
            Approaching compute cap. Executions will stop when cap is reached.
          </p>
        </div>
      )}
    </div>
  )
}

export function BillingClient({ profile, transactions }: Props) {
  const [loading, setLoading] = useState<string | null>(null)

  const currentPlan = profile?.subscription_plan || "free"
  const isFreePlan  = currentPlan === "free"
  const isPaidPlan  = !isFreePlan && currentPlan !== "enterprise"

  // Quota tracking
  const used  = isFreePlan
    ? (profile?.lifetime_executions_used || 0)
    : (profile?.executions_used_this_month || 0)
  const quota = isFreePlan ? 50 : (profile?.monthly_execution_quota || PLANS.find(p => p.key === currentPlan)?.calls || 500)
  const pct   = quota === -1 ? 0 : Math.min(Math.round((used / quota) * 100), 100)
  const isNearLimit = pct >= 80 && quota !== -1

  // Compute budget
  const currentPlanDef = PLANS.find(p => p.key === currentPlan)
  const computeCap     = profile?.compute_cap_usd ?? currentPlanDef?.computeCap ?? null
  const monthlySpent   = Number(profile?.monthly_spent_usd ?? 0)

  const handleUpgrade = async (planKey: string) => {
    if (planKey === "enterprise") { window.location.href = "/contact"; return }
    if (planKey === currentPlan)  return
    setLoading(planKey)
    try {
      const res  = await fetch("/api/billing/checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ plan: planKey }),
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
    <div className="space-y-8 max-w-4xl">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Billing & Plans</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage your subscription and monitor compute usage.</p>
        </div>
        {!isFreePlan && (
          <Button variant="outline" onClick={handleManage} disabled={loading === "portal"}
            className="rounded-xl border-zinc-200 text-sm font-semibold gap-2">
            {loading === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Manage Subscription
          </Button>
        )}
      </div>

      {/* ── Stripe setup banner ─────────────────────────────────────────────── */}
      {isFreePlan && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-900">Payments via Stripe — configure before going live</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Set{" "}
              <code className="bg-amber-100 px-1 rounded font-mono text-[10px]">STRIPE_STARTER_PRICE_ID</code> and{" "}
              <code className="bg-amber-100 px-1 rounded font-mono text-[10px]">STRIPE_PRO_PRICE_ID</code> in your environment to activate upgrades.
            </p>
            <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary font-semibold flex items-center gap-1 mt-1.5 hover:underline w-fit">
              Open Stripe dashboard <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {/* ── Current plan + usage ─────────────────────────────────────────────── */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

        {/* Plan header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Current plan</p>
            <p className="text-2xl font-bold text-zinc-900 capitalize">{currentPlan}</p>
            {isPaidPlan && currentPlanDef?.unitCost && (
              <p className="text-xs text-zinc-400 mt-1">
                <span className="nums font-semibold text-zinc-600">${currentPlanDef.unitCost.toFixed(4)}</span>
                {" "}plan cost per execution
                <span className="ml-1.5 text-zinc-300">·</span>
                <span className="ml-1.5 text-[11px]">actual AI cost varies by model</span>
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-400 mb-1">{isFreePlan ? "Lifetime usage" : "Usage this month"}</p>
            <p className="text-base font-bold text-zinc-900 nums">
              {used.toLocaleString()} / {quota === -1 ? "∞" : quota.toLocaleString()}
              <span className="text-xs font-normal text-zinc-400 ml-1">calls</span>
            </p>
          </div>
        </div>

        {/* Execution quota bar */}
        {quota !== -1 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-zinc-600">
                {isFreePlan ? "Lifetime execution quota" : "Monthly execution quota"}
              </span>
              <span className="text-xs text-zinc-400">{pct}% used</span>
            </div>
            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500",
                  pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-400" : "bg-primary")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px] text-zinc-400">
                {isFreePlan
                  ? `${Math.max(0, quota - used)} lifetime executions remaining`
                  : `Resets on your next billing date`}
              </p>
              {pct >= 100 && (
                <p className="text-[11px] font-bold text-red-500 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Quota reached
                </p>
              )}
              {pct >= 80 && pct < 100 && (
                <p className="text-[11px] font-semibold text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {100 - pct}% remaining
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Compute budget gauge (the REAL cost control) ─────────────────── */}
        {computeCap && (
          <ComputeGauge
            spent={monthlySpent}
            cap={computeCap}
            label={isFreePlan ? "Lifetime compute budget" : "Monthly compute budget (hard cap)"}
          />
        )}

        {/* Overage explanation */}
        <div className="flex items-start gap-2.5 bg-zinc-50 border border-zinc-100 rounded-xl px-3.5 py-3">
          <Info className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] text-zinc-500 leading-relaxed space-y-1">
            <p>
              <strong className="text-zinc-700">Quota reached?</strong>{" "}
              Executions are blocked immediately with a clear error. No surprise charges — ever.
              Credits reserved for failed executions are <strong className="text-zinc-700">automatically refunded</strong> to your balance.
            </p>
            <p>
              <strong className="text-zinc-700">Compute cap reached?</strong>{" "}
              All executions stop until your next billing cycle. Upgrade anytime to increase your cap.
            </p>
          </div>
        </div>

        {/* Upgrade nudge when near limit */}
        {isNearLimit && currentPlan !== "enterprise" && currentPlan !== "pro" && (
          <div className="pt-4 border-t border-zinc-100 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-zinc-900">Running low on quota</p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Upgrade to <strong>Pro</strong> — 5,000 calls/month at $0.016/call.
              </p>
            </div>
            <Button onClick={() => handleUpgrade("pro")} disabled={loading === "pro"}
              className="rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold gap-2 flex-shrink-0">
              {loading === "pro" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Upgrade to Pro
            </Button>
          </div>
        )}
      </div>

      {/* ── Plans grid ──────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-900">Available Plans</h2>
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-green-500" /> Stripe-secured</span>
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
                <p className={cn("font-semibold text-base", isPopular ? "text-white" : "text-zinc-900")}>{plan.name}</p>
                <p className={cn("text-xs mt-0.5 mb-3", isPopular ? "text-zinc-400" : "text-zinc-400")}>{plan.tagline}</p>

                <div className="mb-1">
                  {plan.price === null
                    ? <span className={cn("text-3xl font-black", isPopular ? "text-white" : "text-zinc-900")}>Custom</span>
                    : <>
                        <span className={cn("text-3xl font-black nums", isPopular ? "text-white" : "text-zinc-900")}>${plan.price}</span>
                        <span className={cn("text-sm", isPopular ? "text-zinc-400" : "text-zinc-400")}>/mo</span>
                      </>}
                </div>

                {/* ── Clear per-execution cost — fixes 100× misleading framing ── */}
                <div className={cn("text-xs mb-1 font-medium", isPopular ? "text-zinc-300" : "text-zinc-600")}>
                  {plan.calls === -1
                    ? "Unlimited executions"
                    : plan.period === "lifetime"
                    ? `${plan.calls} lifetime executions`
                    : `${plan.calls.toLocaleString()} executions/mo`}
                </div>
                {plan.unitCost !== null && plan.unitCost !== undefined ? (
                  <p className={cn("text-[11px] mb-1 nums", isPopular ? "text-zinc-500" : "text-zinc-400")}>
                    = <strong className={isPopular ? "text-zinc-300" : "text-zinc-600"}>${plan.unitCost.toFixed(4)}</strong> per execution (plan fee only)
                  </p>
                ) : null}
                {plan.computeCap && (
                  <p className={cn("text-[11px] mb-4 flex items-center gap-1", isPopular ? "text-zinc-500" : "text-zinc-400")}>
                    <Shield className="h-3 w-3" />
                    ${plan.computeCap} hard compute cap/mo
                  </p>
                )}
                {!plan.computeCap && !plan.unitCost && (
                  <p className={cn("text-[11px] mb-4", isPopular ? "text-zinc-500" : "text-zinc-400")}>
                    Platform absorbs AI cost
                  </p>
                )}

                {/* Features */}
                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className={cn("flex items-start gap-2 text-xs", isPopular ? "text-zinc-300" : "text-zinc-600")}>
                      <CheckCircle className="h-3.5 w-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  disabled={isCurrent || loading === plan.key}
                  onClick={() => handleUpgrade(plan.key)}
                  className={cn(
                    "w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5",
                    isCurrent
                      ? "border border-zinc-200 text-zinc-400 cursor-default opacity-60"
                      : isPopular
                      ? "bg-white text-zinc-900 hover:bg-zinc-100"
                      : "bg-zinc-900 text-white hover:bg-zinc-700",
                    loading === plan.key && "opacity-70 cursor-wait"
                  )}>
                  {loading === plan.key
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : isCurrent        ? "Current Plan"
                    : plan.key === "enterprise" ? "Contact Sales"
                    : <>Upgrade to {plan.name} <ChevronRight className="h-3.5 w-3.5" /></>}
                </button>
              </div>
            )
          })}
        </div>

        {/* Pricing transparency note */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" /> Plan fee ≠ AI cost. Actual AI spend depends on model + token volume.
          </span>
          <span className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Failed executions are automatically refunded to your balance.
          </span>
          <span className="flex items-center gap-1">
            <Lock className="h-3 w-3" /> Payments secured by Stripe · No hidden fees
          </span>
        </div>
      </div>

      {/* ── Payment history ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-6 py-4 border-b border-zinc-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-zinc-400" /> Payment History
          </h2>
          {!isFreePlan && (
            <button onClick={handleManage} disabled={loading === "portal"}
              className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
              {loading === "portal" && <Loader2 className="h-3 w-3 animate-spin" />}
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
                    tx.status === "succeeded" ? "bg-green-50 text-green-600" :
                    tx.status === "refunded"  ? "bg-blue-50 text-blue-600"   : "bg-amber-50 text-amber-600"
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
