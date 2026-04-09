"use client"

import Link from "next/link"
import { useState } from "react"
import { motion } from "framer-motion"
import { DollarSign, TrendingUp, Zap, Star, AlertCircle, Plus, ExternalLink, ArrowUpRight, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatRelativeTime } from "@/lib/utils"
import { PLATFORM_FEE_PERCENT } from "@/lib/stripe"
import toast from "react-hot-toast"

interface Props { profile: any; agents: any[]; payouts: any[]; transactions: any[] }

export function SellerClient({ profile, agents, payouts, transactions }: Props) {
  const [onboarding, setOnboarding] = useState(false)

  const totalRevenue  = transactions.reduce((s, t) => s + (t.seller_amount || 0), 0)
  const pendingPayout = payouts.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0)
  const activeAgents  = agents.filter(a => a.status === "active").length
  const totalExecs    = agents.reduce((s, a) => s + (a.total_executions || 0), 0)
  const ratings       = agents.filter(a => a.average_rating > 0)
  const avgRating     = ratings.length ? (ratings.reduce((s, a) => s + a.average_rating, 0) / ratings.length) : 0

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
    { label: "Total Earned",   value: formatCurrency(profile?.total_earned || 0), icon: DollarSign,  color: "text-green-600", bg: "bg-green-50", sub: `${(1 - PLATFORM_FEE_PERCENT) * 100}% of gross` },
    { label: "Pending Payout", value: formatCurrency(pendingPayout),               icon: TrendingUp,  color: "text-primary",   bg: "bg-primary/8", sub: "Next payout in ~5 days" },
    { label: "Active Agents",  value: activeAgents.toString(),                     icon: Zap,         color: "text-amber-600", bg: "bg-amber-50",  sub: `${agents.length} total` },
    { label: "Total Runs",     value: formatNumber(totalExecs),                    icon: TrendingUp,  color: "text-violet-600",bg: "bg-violet-50", sub: "All time" },
    { label: "Avg Rating",     value: avgRating > 0 ? avgRating.toFixed(2) : "—", icon: Star,        color: "text-amber-500", bg: "bg-amber-50",  sub: "Across all agents" },
  ]

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-start justify-between">
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

          {/* Stripe Connect banner */}
          {!profile?.stripe_connect_onboarded && (
            <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-zinc-900 text-sm">Connect your bank to receive payouts</h3>
                <p className="text-xs text-zinc-500 mt-1">Set up Stripe Express to get automatic monthly payouts. Takes under 3 minutes.</p>
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
              <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
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

          {/* Revenue share info */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="font-semibold text-zinc-900 text-sm">Revenue Share</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                AgentDyne takes {PLATFORM_FEE_PERCENT * 100}%. You keep {(1 - PLATFORM_FEE_PERCENT) * 100}% of every sale.
              </p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="text-2xl font-black text-zinc-900">{(1 - PLATFORM_FEE_PERCENT) * 100}%</p>
                <p className="text-xs text-zinc-400">Your cut</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-zinc-400">{PLATFORM_FEE_PERCENT * 100}%</p>
                <p className="text-xs text-zinc-400">Platform fee</p>
              </div>
            </div>
          </div>

          {/* Agents table */}
          <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
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
                <p className="text-sm text-zinc-400 mb-3">No agents yet.</p>
                <Link href="/builder"><Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700">Create First Agent</Button></Link>
              </div>
            ) : (
              <div className="divide-y divide-zinc-50">
                {agents.slice(0, 8).map(agent => (
                  <div key={agent.id} className="flex items-center gap-4 px-6 py-4 hover:bg-zinc-50/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link href={`/builder/${agent.id}`} className="font-medium text-sm text-zinc-900 hover:text-primary transition-colors truncate">
                          {agent.name}
                        </Link>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          agent.status === "active" ? "bg-green-50 text-green-600" :
                          agent.status === "pending_review" ? "bg-amber-50 text-amber-600" :
                          "bg-zinc-100 text-zinc-500"}`}>
                          {agent.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5 capitalize">{agent.category?.replace("_", " ")} · {agent.pricing_model?.replace("_", " ")}</p>
                    </div>
                    <div className="flex items-center gap-5 text-xs text-zinc-400 flex-shrink-0">
                      <span className="flex items-center gap-1 nums"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
                      <span className="flex items-center gap-1 nums"><Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{agent.average_rating?.toFixed(1) || "—"}</span>
                      <span className="font-bold text-zinc-900 nums min-w-[60px] text-right">{formatCurrency(agent.total_revenue || 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent transactions */}
          <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="px-6 py-4 border-b border-zinc-50">
              <h2 className="text-sm font-semibold text-zinc-900">Recent Transactions</h2>
            </div>
            {transactions.length === 0 ? (
              <p className="text-center text-sm text-zinc-400 py-8">No transactions yet.</p>
            ) : (
              <div className="divide-y divide-zinc-50">
                {transactions.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between px-6 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 capitalize">{tx.type?.replace("_", " ")}</p>
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
