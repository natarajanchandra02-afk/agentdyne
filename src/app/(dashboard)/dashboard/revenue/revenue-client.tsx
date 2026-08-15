"use client"

/**
 * Revenue — /dashboard/revenue
 * GPT spec: "Stripe Dashboard + App Store Connect"
 * Sections: overview cards · breakdown by source · top agents · trend chart
 *           · conversion funnel · payout center · AI suggestions
 */

import { useState } from "react"
import { motion } from "framer-motion"
import {
  DollarSign, TrendingUp, TrendingDown, Clock, Zap,
  Bot, Star, BarChart3, ArrowUpRight, ArrowDownRight,
  Wallet, CreditCard, ChevronRight, Lightbulb,
  AlertTriangle, Sparkles, Store, Layers, Network, Code2,
} from "lucide-react"
import { cn, formatCurrency, formatNumber } from "@/lib/utils"
import Link from "next/link"

/* ─── Demo data ────────────────────────────────────────────────────── */

const MONTHLY_TREND = [
  { month: "Jan", revenue: 120 },
  { month: "Feb", revenue: 185 },
  { month: "Mar", revenue: 210 },
  { month: "Apr", revenue: 178 },
  { month: "May", revenue: 312 },
  { month: "Jun", revenue: 438 },
]

const TOP_AGENTS = [
  { id: "a1", name: "SQL Query Builder",  revenue: 120, runs: 8921, conversion: 7.2, rating: 4.8, avgCost: 0.013, trend: "up"   },
  { id: "a2", name: "Code Reviewer",      revenue: 95,  runs: 6234, conversion: 6.1, rating: 4.7, avgCost: 0.015, trend: "up"   },
  { id: "a3", name: "Research Agent",     revenue: 80,  runs: 4892, conversion: 5.9, rating: 4.6, avgCost: 0.016, trend: "down" },
  { id: "a4", name: "Content Writer",     revenue: 63,  runs: 3210, conversion: 4.8, rating: 4.5, avgCost: 0.019, trend: "up"   },
  { id: "a5", name: "Data Analyst",       revenue: 42,  runs: 2140, conversion: 4.2, rating: 4.4, avgCost: 0.020, trend: "flat" },
]

const REVENUE_SOURCES = [
  { label: "Marketplace Agents", value: 320, icon: Store,   color: "#6366f1", pct: 73 },
  { label: "Pipelines",          value: 75,  icon: Layers,  color: "#22c55e", pct: 17 },
  { label: "Swarms",             value: 28,  icon: Network, color: "#f59e0b", pct: 6  },
  { label: "Embedded Agents",    value: 15,  icon: Code2,   color: "#0ea5e9", pct: 4  },
]

const AI_SUGGESTIONS = [
  {
    type: "warning",
    icon: AlertTriangle,
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
    title: "Research Agent revenue dropped 14%",
    action: "Add API example section → estimated +8% lift",
    cta: "Edit agent",
    href: "/my-agents",
  },
  {
    type: "opportunity",
    icon: Sparkles,
    color: "text-violet-600",
    bg: "bg-violet-50 border-violet-200",
    title: "SQL Builder ranking: #8 → improve to #5",
    action: "Improving rating 4.6 → 4.8 could earn +$120/month",
    cta: "View analytics",
    href: "/analytics",
  },
  {
    type: "info",
    icon: Lightbulb,
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
    title: "2 agents qualify for Featured placement",
    action: "Featured agents earn 3× more on average",
    cta: "Apply now",
    href: "/seller",
  },
]

const FORECAST = { low: 520, high: 640 }

/* ─── Mini bar chart ───────────────────────────────────────────────── */
function TrendChart({ data }: { data: typeof MONTHLY_TREND }) {
  const max = Math.max(...data.map(d => d.revenue))
  return (
    <div className="flex items-end gap-2 h-24">
      {data.map((d, i) => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5">
          <motion.div
            className="w-full rounded-t-lg bg-primary/20 hover:bg-primary/40 transition-colors relative group cursor-pointer"
            style={{ height: `${(d.revenue / max) * 100}%`, originY: 1 }}
            initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
            transition={{ delay: i * 0.06, duration: 0.4, ease: "easeOut" }}
          >
            {/* Tooltip */}
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] font-bold px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
              ${d.revenue}
            </div>
          </motion.div>
          <span className="text-[9px] text-zinc-400 font-medium">{d.month}</span>
        </div>
      ))}
    </div>
  )
}

/* ─── Overview card ────────────────────────────────────────────────── */
function OverviewCard({ icon: Icon, label, value, sub, delta, color, bg }: {
  icon: any; label: string; value: string; sub?: string
  delta?: { pct: number; dir: "up" | "down" }; color: string; bg: string
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3", bg)}>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <p className="text-2xl font-black text-zinc-900 tabular-nums">{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5 font-medium">{label}</p>
      {(sub || delta) && (
        <div className="mt-2 flex items-center gap-2">
          {delta && (
            <span className={cn(
              "flex items-center gap-0.5 text-[11px] font-bold",
              delta.dir === "up" ? "text-green-600" : "text-red-500"
            )}>
              {delta.dir === "up"
                ? <ArrowUpRight className="h-3 w-3" />
                : <ArrowDownRight className="h-3 w-3" />}
              {delta.pct}%
            </span>
          )}
          {sub && <span className="text-[11px] text-zinc-400">{sub}</span>}
        </div>
      )}
    </div>
  )
}

/* ─── Main ─────────────────────────────────────────────────────────── */
export default function RevenueClient() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d")

  const totalThisMonth = REVENUE_SOURCES.reduce((s, r) => s + r.value, 0)
  const totalLifetime  = 7245

  return (
    <div className="max-w-5xl mx-auto space-y-8">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-900">Revenue</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Your Shopify dashboard for AI creator earnings
          </p>
        </div>

        {/* Period tabs */}
        <div className="flex items-center bg-zinc-100 rounded-xl p-1 gap-0.5">
          {(["7d", "30d", "90d", "all"] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                period === p
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-700"
              )}>
              {p === "all" ? "All time" : p}
            </button>
          ))}
        </div>
      </div>

      {/* ── Overview cards ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <OverviewCard icon={DollarSign}  label="This Month"      value={`$${totalThisMonth}`}  delta={{ pct: 24, dir: "up"   }} color="text-green-600"  bg="bg-green-50"   />
        <OverviewCard icon={TrendingUp}  label="Pending Payout"  value="$89"                   sub="Clears in 7 days"           color="text-amber-600"  bg="bg-amber-50"   />
        <OverviewCard icon={Wallet}      label="Lifetime Earned" value={`$${totalLifetime.toLocaleString()}`} sub="Since launch" color="text-violet-600" bg="bg-violet-50"  />
        <OverviewCard icon={Zap}         label="Revenue Today"   value="$12.45"                delta={{ pct: 8,  dir: "up"   }} color="text-primary"    bg="bg-primary/8"  />
      </div>

      {/* ── Trend chart + Breakdown ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Trend */}
        <div className="lg:col-span-3 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Revenue Trend</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Monthly earnings over time</p>
            </div>
            <div className="flex items-center gap-1.5 bg-green-50 border border-green-100 rounded-full px-2.5 py-1">
              <TrendingUp className="h-3 w-3 text-green-600" />
              <span className="text-[11px] font-bold text-green-600">+40% MoM</span>
            </div>
          </div>
          <TrendChart data={MONTHLY_TREND} />

          {/* Forecast */}
          <div className="mt-5 pt-4 border-t border-zinc-50 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-zinc-400 font-medium">Revenue Forecast (next month)</p>
              <p className="text-sm font-black text-zinc-900 mt-0.5">
                ${FORECAST.low} – ${FORECAST.high}
              </p>
            </div>
            <span className="text-[10px] bg-blue-50 border border-blue-100 text-blue-600 font-bold px-2.5 py-1 rounded-full">
              AI Estimated
            </span>
          </div>
        </div>

        {/* Breakdown by source */}
        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-bold text-zinc-900 mb-4">Revenue by Source</h2>
          <div className="space-y-3.5">
            {REVENUE_SOURCES.map((src, i) => {
              const Icon = src.icon
              return (
                <div key={src.label}>
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${src.color}18` }}>
                      <Icon className="h-3.5 w-3.5" style={{ color: src.color }} />
                    </div>
                    <span className="text-xs font-semibold text-zinc-700 flex-1 truncate">{src.label}</span>
                    <span className="text-xs font-black text-zinc-900 tabular-nums">${src.value}</span>
                  </div>
                  {/* Bar */}
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: src.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${src.pct}%` }}
                      transition={{ delay: i * 0.08, duration: 0.5, ease: "easeOut" }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5 text-right">{src.pct}%</p>
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-50 flex justify-between">
            <span className="text-xs text-zinc-500 font-medium">Total this month</span>
            <span className="text-sm font-black text-zinc-900">${totalThisMonth}</span>
          </div>
        </div>
      </div>

      {/* ── Top Performing Agents ───────────────────────────── */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-5 py-4 border-b border-zinc-50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900">Top Performing Agents</h2>
          <Link href="/my-agents">
            <span className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
              Manage all <ChevronRight className="h-3 w-3" />
            </span>
          </Link>
        </div>

        <div className="divide-y divide-zinc-50">
          {/* Table header */}
          <div className="grid grid-cols-6 px-5 py-2.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            <span className="col-span-2">Agent</span>
            <span className="text-right">Revenue</span>
            <span className="text-right">Runs</span>
            <span className="text-right">Conv.</span>
            <span className="text-right">Rating</span>
          </div>

          {TOP_AGENTS.map((agent, i) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="grid grid-cols-6 px-5 py-3.5 items-center hover:bg-zinc-50/60 transition-colors"
            >
              {/* Name */}
              <div className="col-span-2 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                  <p className="text-[10px] text-zinc-400">${agent.avgCost.toFixed(3)}/run</p>
                </div>
              </div>

              {/* Revenue */}
              <div className="text-right">
                <p className="text-sm font-black text-zinc-900">${agent.revenue}</p>
                <div className={cn(
                  "flex items-center justify-end gap-0.5 text-[10px] font-bold",
                  agent.trend === "up" ? "text-green-600" : agent.trend === "down" ? "text-red-500" : "text-zinc-400"
                )}>
                  {agent.trend === "up" && <TrendingUp className="h-2.5 w-2.5" />}
                  {agent.trend === "down" && <TrendingDown className="h-2.5 w-2.5" />}
                  {agent.trend !== "flat" && (agent.trend === "up" ? "+12%" : "-14%")}
                </div>
              </div>

              {/* Runs */}
              <p className="text-right text-sm font-semibold text-zinc-700 tabular-nums">
                {agent.runs.toLocaleString()}
              </p>

              {/* Conversion */}
              <div className="text-right">
                <span className={cn(
                  "text-xs font-bold px-2 py-0.5 rounded-full",
                  agent.conversion >= 6 ? "bg-green-50 text-green-600" : "bg-zinc-50 text-zinc-500"
                )}>
                  {agent.conversion}%
                </span>
              </div>

              {/* Rating */}
              <div className="text-right flex items-center justify-end gap-1">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                <span className="text-sm font-bold text-zinc-900">{agent.rating}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Conversion funnel + Payout ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Conversion funnel */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-bold text-zinc-900 mb-4">Conversion Analytics</h2>
          <div className="space-y-3">
            {[
              { label: "Marketplace Views",  value: 12000, pct: 100, color: "bg-zinc-200" },
              { label: "Agent Runs",          value: 2100,  pct: 17.5, color: "bg-primary/30" },
              { label: "Installs",            value: 520,   pct: 4.3,  color: "bg-primary/60" },
              { label: "Revenue Generated",   value: "$438",pct: 3.6,  color: "bg-primary" },
            ].map((row, i) => (
              <div key={row.label}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium text-zinc-600">{row.label}</span>
                  <span className="font-black text-zinc-900 tabular-nums">
                    {typeof row.value === "number" ? row.value.toLocaleString() : row.value}
                  </span>
                </div>
                <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <motion.div
                    className={cn("h-full rounded-full", row.color)}
                    initial={{ width: 0 }}
                    animate={{ width: `${row.pct}%` }}
                    transition={{ delay: i * 0.08, duration: 0.5, ease: "easeOut" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payout center */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-bold text-zinc-900 mb-4">Payout Center</h2>

          {/* Balance */}
          <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-2xl p-5 text-white mb-4">
            <p className="text-xs text-zinc-400 font-medium mb-1">Current Balance</p>
            <p className="text-3xl font-black tabular-nums">$87.34</p>
            <p className="text-xs text-zinc-500 mt-1">Next payout: June 15, 2026</p>
            <button className="mt-4 w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-sm font-bold text-white transition-all flex items-center justify-center gap-2">
              <Wallet className="h-4 w-4" /> Withdraw Funds
            </button>
          </div>

          {/* Methods */}
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Payout Methods</p>
            {[
              { label: "Bank Transfer", connected: true  },
              { label: "Stripe",        connected: false },
              { label: "PayPal",        connected: false },
              { label: "Wise",          connected: false },
            ].map(m => (
              <div key={m.label} className="flex items-center justify-between py-2 border-b border-zinc-50 last:border-0">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-700">{m.label}</span>
                </div>
                {m.connected
                  ? <span className="text-[10px] font-bold bg-green-50 text-green-600 border border-green-100 px-2 py-0.5 rounded-full">Connected</span>
                  : <button className="text-[10px] font-bold text-primary hover:underline">Connect</button>
                }
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── AI Suggestions ──────────────────────────────────── */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-xl bg-primary/8 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-900">AgentDyne Intelligence</h2>
            <p className="text-[11px] text-zinc-400">Revenue optimisation suggestions</p>
          </div>
        </div>

        <div className="space-y-3">
          {AI_SUGGESTIONS.map((s, i) => {
            const Icon = s.icon
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className={cn("border rounded-2xl px-4 py-3.5 flex items-start gap-3", s.bg)}
              >
                <Icon className={cn("h-4 w-4 flex-shrink-0 mt-0.5", s.color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 mb-0.5">{s.title}</p>
                  <p className="text-xs text-zinc-500">{s.action}</p>
                </div>
                <Link href={s.href}>
                  <button className={cn(
                    "text-[11px] font-bold px-3 py-1.5 rounded-xl flex-shrink-0 flex items-center gap-1 transition-all",
                    "bg-white/70 hover:bg-white border border-zinc-100 text-zinc-700"
                  )}>
                    {s.cta} <ChevronRight className="h-3 w-3" />
                  </button>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
