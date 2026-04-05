"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { DollarSign, TrendingUp, Zap, Star, CheckCircle, AlertCircle, Plus, ExternalLink, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatDate, formatRelativeTime } from "@/lib/utils"
import { PLATFORM_FEE_PERCENT } from "@/lib/stripe"
import toast from "react-hot-toast"

interface Props { profile: any; agents: any[]; payouts: any[]; transactions: any[] }

export function SellerClient({ profile, agents, payouts, transactions }: Props) {
  const [onboarding, setOnboarding] = useState(false)

  const totalRevenue    = transactions.reduce((s, t) => s + (t.seller_amount || 0), 0)
  const pendingPayout   = payouts.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0)
  const activeAgents    = agents.filter(a => a.status === "active").length
  const totalExecs      = agents.reduce((s, a) => s + (a.total_executions || 0), 0)
  const avgRating       = agents.filter(a => a.average_rating > 0).reduce((s, a) => s + a.average_rating, 0) / (agents.filter(a => a.average_rating > 0).length || 1)

  const startOnboarding = async () => {
    setOnboarding(true)
    try {
      const res = await fetch("/api/billing/connect", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch (e: any) {
      toast.error(e.message)
    } finally { setOnboarding(false) }
  }

  const METRICS = [
    { label: "Total Earned",   value: formatCurrency(profile?.total_earned || 0), icon: DollarSign,  color: "text-green-500",  bg: "bg-green-500/10",  sub: `${(1 - PLATFORM_FEE_PERCENT) * 100}% of gross` },
    { label: "Pending Payout", value: formatCurrency(pendingPayout),               icon: TrendingUp,  color: "text-primary",    bg: "bg-primary/10",    sub: "Next payout in ~5 days" },
    { label: "Active Agents",  value: activeAgents.toString(),                      icon: Zap,         color: "text-yellow-500", bg: "bg-yellow-500/10", sub: `${agents.length} total` },
    { label: "Total Runs",     value: formatNumber(totalExecs),                     icon: TrendingUp,  color: "text-blue-500",   bg: "bg-blue-500/10",   sub: "Last 30 days" },
    { label: "Avg Rating",     value: avgRating > 0 ? avgRating.toFixed(2) : "—",  icon: Star,        color: "text-yellow-400", bg: "bg-yellow-400/10", sub: "Across all agents" },
  ]

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

          {/* Header */}
          <div className="page-header flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Seller Portal</h1>
              <p className="text-muted-foreground text-sm mt-1">Publish agents, track earnings, and get paid.</p>
            </div>
            <Link href="/builder">
              <Button variant="brand" className="gap-2">
                <Plus className="h-4 w-4" /> New Agent
              </Button>
            </Link>
          </div>

          {/* Stripe Connect banner */}
          {!profile?.stripe_connect_onboarded && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-primary/30 bg-primary/5 p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Connect your bank to receive payouts</h3>
                <p className="text-sm text-muted-foreground mt-1">Set up Stripe Express to receive automatic monthly payouts. Takes under 3 minutes.</p>
              </div>
              <Button variant="brand" onClick={startOnboarding} disabled={onboarding} className="flex-shrink-0">
                {onboarding ? "Redirecting…" : "Connect Bank"} <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </motion.div>
          )}

          {/* Revenue metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {METRICS.map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                <Card className="metric-card">
                  <div className={`w-9 h-9 rounded-xl ${m.bg} flex items-center justify-center mb-3`}>
                    <m.icon className={`h-4 w-4 ${m.color}`} />
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{m.value}</p>
                  <p className="text-xs font-medium text-foreground mt-0.5">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{m.sub}</p>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Pricing info */}
          <Card className="border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="font-semibold text-foreground">Revenue Share</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">AgentDyne takes a {PLATFORM_FEE_PERCENT * 100}% platform fee. You keep {(1 - PLATFORM_FEE_PERCENT) * 100}% of every sale.</p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-3xl font-black text-foreground">{(1 - PLATFORM_FEE_PERCENT) * 100}%</p>
                    <p className="text-xs text-muted-foreground">Your cut</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-black text-muted-foreground">{PLATFORM_FEE_PERCENT * 100}%</p>
                    <p className="text-xs text-muted-foreground">Platform fee</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Agents table */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Your Agents</CardTitle>
                  <CardDescription>{agents.length} agents published</CardDescription>
                </div>
                <Link href="/my-agents">
                  <Button variant="ghost" size="sm" className="gap-1 text-primary text-xs">
                    Manage all <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {agents.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground text-sm">No agents yet.</p>
                  <Link href="/builder"><Button variant="brand" size="sm" className="mt-3">Create Your First Agent</Button></Link>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {agents.slice(0, 8).map((agent) => (
                    <div key={agent.id} className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/builder/${agent.id}`} className="font-medium text-sm text-foreground hover:text-primary transition-colors truncate">{agent.name}</Link>
                          <Badge variant={agent.status === "active" ? "success" : agent.status === "pending_review" ? "warning" : "secondary"} className="text-[10px] flex-shrink-0">
                            {agent.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">{agent.category?.replace("_", " ")} • {agent.pricing_model?.replace("_", " ")}</p>
                      </div>
                      <div className="flex items-center gap-6 text-xs text-muted-foreground flex-shrink-0">
                        <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
                        <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{agent.average_rating?.toFixed(1) || "—"}</span>
                        <span className="font-semibold text-foreground tabular-nums">{formatCurrency(agent.total_revenue || 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent transactions */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">No transactions yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {transactions.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between px-6 py-3.5">
                      <div>
                        <p className="text-sm font-medium text-foreground capitalize">{tx.type.replace("_", " ")}</p>
                        <p className="text-xs text-muted-foreground">{formatRelativeTime(tx.created_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-green-500 tabular-nums">+{formatCurrency(tx.seller_amount || 0)}</p>
                        <p className="text-[11px] text-muted-foreground">{formatCurrency(tx.amount)} gross</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  )
}
