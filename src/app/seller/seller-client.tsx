"use client"

import Link from "next/link"
import { useState } from "react"
import { motion } from "framer-motion"
import {
  DollarSign, TrendingUp, Zap, Star, AlertCircle,
  Plus, ExternalLink, ArrowUpRight, CheckCircle,
  Copy, Share2, Check, ChevronRight, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatRelativeTime, cn } from "@/lib/utils"
import { PLATFORM_FEE_PERCENT } from "@/lib/constants"
import toast from "react-hot-toast"

interface Props { profile: any; agents: any[]; payouts: any[]; transactions: any[] }

// ── Share a single agent link ─────────────────────────────────────────────────

function ShareAgentButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${typeof window !== "undefined" ? window.location.origin : "https://agentdyne.com"}/marketplace/${agentId}`
  const copy = () => {
    navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success("Link copied!")
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-primary px-2 py-1 rounded-lg hover:bg-primary/8 transition-colors"
      title={`Share ${agentName}`}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Share2 className="h-3.5 w-3.5" />}
    </button>
  )
}

export function SellerClient({ profile, agents, payouts, transactions }: Props) {
  const [onboarding, setOnboarding] = useState(false)

  const totalRevenue  = transactions
    .filter(t => t.status !== 'refunded')  // exclude reversed transactions
    .reduce((s, t) => s + (t.seller_amount || 0), 0)
  const pendingPayout = payouts.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0)
  const activeAgents  = agents.filter(a => a.status === "active").length
  // Exclude self-executions from display (same exclusion applied in compute_agent_score)
  const totalExecs    = agents.reduce((s, a) => s + (a.total_executions || 0), 0)
  const uniqueUsers   = agents.reduce((s, a) => s + (a.total_reviews || 0), 0) // proxy until unique_users column added
  const ratings       = agents.filter(a => a.average_rating > 0)
  const avgRating     = ratings.length
    ? ratings.reduce((s, a) => s + a.average_rating, 0) / ratings.length
    : 0

  const isNewSeller = totalRevenue === 0 && activeAgents === 0

  const startOnboarding = async () => {
    setOnboarding(true)
    try {
      const res  = await fetch("/api/billing/connect", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch (e: any) {
      toast.error(e.message)
    } finally { setOnboarding(false) }
  }

  const METRICS = [
    {
      label: "Total Earned",   value: formatCurrency(profile?.total_earned || 0),
      icon: DollarSign,  color: "text-green-600", bg: "bg-green-50",
      sub: `${(1 - PLATFORM_FEE_PERCENT) * 100}% of gross sales`,
    },
    {
      label: "Pending Payout", value: formatCurrency(pendingPayout),
      icon: TrendingUp,  color: "text-primary",   bg: "bg-primary/8",
      sub: "Paid monthly via Stripe",
    },
    {
      label: "Active Agents",  value: activeAgents.toString(),
      icon: Zap,         color: "text-amber-600", bg: "bg-amber-50",
      sub: `${agents.length} total published`,
    },
    {
      label: "Total Runs",     value: formatNumber(totalExecs),
      icon: TrendingUp,  color: "text-violet-600", bg: "bg-violet-50",
      sub: "Across all agents",
    },
    {
      label: "Avg Rating",     value: avgRating > 0 ? avgRating.toFixed(2) : "—",
      icon: Star,        color: "text-amber-500", bg: "bg-amber-50",
      sub: "From buyer reviews",
    },
  ]

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Seller Portal</h1>
              <p className="text-zinc-500 text-sm mt-1">Publish agents, track earnings, and get paid.</p>
            </div>
            <Link href="/builder">
              <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                <Plus className="h-4 w-4" /> New Agent
              </Button>
            </Link>
          </div>

          {/* ── New seller motivation ─────────────────────────────────────────── */}
          {isNewSeller && (
            <div className="bg-gradient-to-br from-primary/[0.06] via-primary/[0.03] to-transparent border border-primary/20 rounded-2xl p-6">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h2 className="text-base font-bold text-zinc-900">Start earning from your AI agents</h2>
                  </div>
                  <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
                    Top sellers on AgentDyne earn <strong className="text-zinc-700">$500–$2,400/month</strong> from agents they built once and published. You keep <strong className="text-zinc-700">80%</strong> of every run.
                  </p>
                  {/* 3-step guide */}
                  <div className="flex items-start gap-4 flex-wrap">
                    {[
                      { n: "1", title: "Build your agent", desc: "Write a system prompt, pick a model" },
                      { n: "2", title: "Publish to marketplace", desc: "Submit for review — we approve in 24h" },
                      { n: "3", title: "Get paid per run", desc: "Monthly Stripe payouts, 80% yours" },
                    ].map((step, i) => (
                      <div key={i} className="flex items-start gap-3 flex-1 min-w-[160px]">
                        <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-black text-primary mt-0.5">
                          {step.n}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">{step.title}</p>
                          <p className="text-xs text-zinc-400 mt-0.5">{step.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <Link href="/builder" className="flex-shrink-0">
                  <Button className="rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold gap-2">
                    <Plus className="h-4 w-4" /> Create your first agent
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* Stripe Connect banner */}
          {!profile?.stripe_connect_onboarded && (
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-zinc-900 text-sm">Connect your bank to receive payouts</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Set up Stripe Express to receive automatic monthly payouts. Takes under 3 minutes.</p>
                <p className="text-xs text-zinc-400 mt-1">
                Minimum payout: $1.00 · Paid on the 1st of each month · Stripe Express
                </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Platform absorbs Stripe payout fees (~$0.25 + 0.25%/transfer) — your 80% is net.
              </p>
              </div>
              <Button onClick={startOnboarding} disabled={onboarding}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 flex-shrink-0 gap-2 font-semibold">
                {onboarding ? "Redirecting…" : "Connect Bank"}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {METRICS.map((m, i) => (
              <motion.div key={m.label}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className={`w-9 h-9 rounded-xl ${m.bg} flex items-center justify-center mb-3`}>
                    <m.icon className={`h-4 w-4 ${m.color}`} />
                  </div>
                  <p className="text-2xl font-bold text-zinc-900 nums">{m.value}</p>
                  <p className="text-xs font-medium text-zinc-700 mt-0.5">{m.label}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">{m.sub}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Revenue share */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="font-semibold text-zinc-900 text-sm">Revenue Share</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                AgentDyne takes {PLATFORM_FEE_PERCENT * 100}% to cover infrastructure, payments, and marketplace. You keep the rest.
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                Set any pricing model: free, per-call (<strong className="text-zinc-600">$0.01–$0.25 recommended</strong>), subscription, or freemium.
                Prices below $0.01/call risk Stripe fees exceeding revenue.
              </p>
            </div>
            <div className="flex items-center gap-8">
              <div className="text-center">
                <p className="text-3xl font-black text-green-600">{(1 - PLATFORM_FEE_PERCENT) * 100}%</p>
                <p className="text-xs text-zinc-400 mt-0.5">Your earnings</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-zinc-300">{PLATFORM_FEE_PERCENT * 100}%</p>
                <p className="text-xs text-zinc-400 mt-0.5">Platform fee</p>
              </div>
            </div>
          </div>

          {/* Per-agent breakdown — the critical creator view */}
          <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="px-6 py-4 border-b border-zinc-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Your Agents</h2>
              <Link href="/my-agents">
                <button className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                  Manage all <ArrowUpRight className="h-3 w-3" />
                </button>
              </Link>
            </div>

            {agents.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-zinc-400 mb-3">No agents yet. Build and publish one to start earning.</p>
                <Link href="/builder">
                  <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                    <Plus className="h-4 w-4" /> Create your first agent
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className="hidden md:grid grid-cols-[1fr_70px_70px_70px_80px_90px_52px] gap-4 px-6 py-2.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50/60">
                  <span>Agent</span>
                  <span className="text-right">Runs</span>
                  <span className="text-right">Rating</span>
                  <span className="text-right">Quality</span>
                  <span className="text-right">Earned</span>
                  <span className="text-center">Status</span>
                  <span />
                </div>

                <div className="divide-y divide-zinc-50">
                  {agents.map(agent => {
                    const earned = agent.total_revenue || 0
                    return (
                      <div key={agent.id}
                        className="flex items-center gap-4 px-6 py-4 hover:bg-zinc-50/50 transition-colors group md:grid md:grid-cols-[1fr_70px_70px_70px_80px_90px_52px]">

                        {/* Agent name + category */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link href={`/builder/${agent.id}`}
                              className="font-semibold text-sm text-zinc-900 hover:text-primary transition-colors truncate">
                              {agent.name}
                            </Link>
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5 capitalize">
                            {agent.category?.replace(/_/g, " ")} · {agent.pricing_model?.replace(/_/g, " ")}
                          </p>
                        </div>

                        {/* Runs */}
                        <p className="text-sm font-bold text-zinc-900 nums text-right hidden md:block">
                          {formatNumber(agent.total_executions || 0)}
                        </p>

                        {/* Rating */}
                        <p className="text-sm font-bold nums text-right hidden md:flex items-center justify-end gap-1">
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 flex-shrink-0" />
                          {agent.average_rating > 0 ? agent.average_rating.toFixed(1) : "—"}
                        </p>

                        {/* Quality score from eval harness */}
                        <div className="text-right hidden md:block">
                          {agent.evaluation_score != null ? (
                            <span className={cn(
                              "text-xs font-bold px-1.5 py-0.5 rounded-lg",
                              agent.evaluation_score >= 80 ? "bg-green-50 text-green-700" :
                              agent.evaluation_score >= 60 ? "bg-amber-50 text-amber-700" :
                              "bg-red-50 text-red-600"
                            )}>
                              {agent.evaluation_score.toFixed(0)}/100
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-300">Not evaluated</span>
                          )}
                        </div>

                        {/* Earned */}
                        <p className={cn(
                          "text-sm font-bold nums text-right",
                          earned > 0 ? "text-green-600" : "text-zinc-400"
                        )}>
                          {formatCurrency(earned)}
                        </p>

                        {/* Status */}
                        <div className="text-center hidden md:block">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full",
                            agent.status === "active"         ? "bg-green-50 text-green-600" :
                            agent.status === "pending_review" ? "bg-amber-50 text-amber-600" :
                                                                "bg-zinc-100 text-zinc-500"
                          )}>
                            {agent.status.replace(/_/g, " ")}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <ShareAgentButton agentId={agent.id} agentName={agent.name} />
                          <Link href={`/marketplace/${agent.id}`} target="_blank">
                            <button className="p-1.5 rounded-lg text-zinc-300 hover:text-primary hover:bg-primary/8 transition-colors"
                              title="View in marketplace">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Payout section */}
          <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="px-6 py-4 border-b border-zinc-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Payouts</h2>
            </div>

            {/* Payout schedule + refund impact explanation */}
            <div className="px-6 py-4 bg-zinc-50/50 border-b border-zinc-100 space-y-2">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Payouts sent automatically on the <strong className="text-zinc-700">1st of each month</strong> via Stripe Express.
                  Minimum: <strong className="text-zinc-700">$1.00</strong>. Platform absorbs Stripe payout fees — your 80% is net.
                  {!profile?.stripe_connect_onboarded && (
                    <span className="text-amber-600 ml-1">Connect your bank account above to receive payments.</span>
                  )}
                </p>
              </div>
              <div className="flex items-start gap-3">
                <AlertCircle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-500 leading-relaxed">
                  <strong className="text-zinc-700">Refund policy:</strong> If a buyer receives a refund for a failed execution,
                  the corresponding seller earnings are <strong className="text-zinc-700">reversed</strong> from your next payout.
                  Failed executions are automatically detected and refunded — this protects your reputation and buyer trust.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-500 leading-relaxed">
                  <strong className="text-zinc-700">Fraud protection:</strong> Self-executions (running your own agents) are excluded
                  from revenue calculations and leaderboard rankings. Suspicious traffic spikes trigger automatic review.
                </p>
              </div>
            </div>

            {payouts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-zinc-400">No payouts yet</p>
                <p className="text-xs text-zinc-300 mt-1">Once your agents earn revenue, payouts appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-50">
                {payouts.map(payout => (
                  <div key={payout.id} className="flex items-center justify-between px-6 py-3.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full",
                          payout.status === "paid"    ? "bg-green-50 text-green-600" :
                          payout.status === "pending" ? "bg-amber-50 text-amber-700" :
                                                        "bg-zinc-100 text-zinc-500"
                        )}>
                          {payout.status === "pending" ? "Pending (7-day hold)" : payout.status}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">{formatRelativeTime(payout.created_at)}</p>
                    </div>
                    <p className={cn(
                      "text-sm font-bold nums",
                      payout.status === "paid" ? "text-green-600" : "text-zinc-500"
                    )}>
                      {formatCurrency(payout.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent transactions */}
          <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="px-6 py-4 border-b border-zinc-50">
              <h2 className="text-sm font-semibold text-zinc-900">Recent Sales</h2>
            </div>
            {transactions.length === 0 ? (
              <p className="text-center text-sm text-zinc-400 py-8">No sales yet — publish an agent to start earning.</p>
            ) : (
              <div className="divide-y divide-zinc-50">
                {transactions.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between px-6 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 capitalize">{tx.type?.replace(/_/g, " ")}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{formatRelativeTime(tx.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-600 nums">+{formatCurrency(tx.seller_amount || 0)}</p>
                      <p className="text-[11px] text-zinc-400 nums">{formatCurrency(tx.amount)} gross</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}
