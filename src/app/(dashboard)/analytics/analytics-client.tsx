"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts"
import {
  Zap, CheckCircle, XCircle, Clock, TrendingUp, Activity,
  DollarSign, ArrowUp, ArrowDown, Minus, Sparkles, Play,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatNumber, cn } from "@/lib/utils"
import { format, parseISO, subDays } from "date-fns"

const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#22c55e", "#f59e0b"]

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Window = "7d" | "30d" | "90d"

const WINDOW_DAYS: Record<Window, number> = { "7d": 7, "30d": 30, "90d": 90 }

function trendArrow(pct: number | null) {
  if (pct === null) return { icon: Minus, color: "text-zinc-400", label: "—" }
  if (pct > 0)  return { icon: ArrowUp,   color: "text-green-500", label: `+${pct.toFixed(0)}%` }
  if (pct < 0)  return { icon: ArrowDown, color: "text-red-500",   label: `${pct.toFixed(0)}%` }
  return { icon: Minus, color: "text-zinc-400", label: "0%" }
}

function calcTrend(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return ((curr - prev) / prev) * 100
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-3 shadow-lg text-xs">
      <p className="font-semibold text-zinc-900 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-zinc-500 capitalize">{p.dataKey}:</span>
          <span className="font-bold text-zinc-900">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Insight strip ────────────────────────────────────────────────────────────

function InsightStrip({ executions, window }: { executions: any[]; window: Window }) {
  const insights: Array<{ icon: React.ReactNode; color: string; bg: string; msg: string }> = []

  if (executions.length === 0) return null

  const failed = executions.filter(e => e.status === "failed")
  const successRate = executions.length
    ? (executions.filter(e => e.status === "success").length / executions.length) * 100
    : 0

  if (successRate < 80 && executions.length > 5) {
    insights.push({
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      color: "text-red-700", bg: "bg-red-50 border-red-100",
      msg: `Success rate is ${successRate.toFixed(0)}% — investigate recent failures in Executions`,
    })
  }

  // Most-used agent
  const agentCount: Record<string, { name: string; count: number }> = {}
  for (const e of executions) {
    if (!e.agents?.name) continue
    const k = e.agents.name
    agentCount[k] = agentCount[k] ?? { name: k, count: 0 }
    agentCount[k].count++
  }
  const top = Object.values(agentCount).sort((a, b) => b.count - a.count)[0]
  if (top && top.count > 2) {
    insights.push({
      icon: <Zap className="h-3.5 w-3.5" />,
      color: "text-primary", bg: "bg-primary/[0.04] border-primary/20",
      msg: `"${top.name}" is your most-used agent (${top.count} runs)`,
    })
  }

  if (insights.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {insights.map((ins, i) => (
        <div key={i} className={cn("flex items-start gap-2.5 px-4 py-3 rounded-xl border text-xs font-medium", ins.bg, ins.color)}>
          {ins.icon}
          <span>{ins.msg}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function AnalyticsClient({
  executions: allExecs,
  agentAnalytics,
}: {
  executions: any[]
  agentAnalytics: any[]
}) {
  const [window, setWindow] = useState<Window>("30d")

  // Filter by selected window
  const executions = useMemo(() => {
    const cutoff = subDays(new Date(), WINDOW_DAYS[window])
    return allExecs.filter(e => new Date(e.created_at) >= cutoff)
  }, [allExecs, window])

  // Previous period for trend calculation
  const prevExecs = useMemo(() => {
    const days = WINDOW_DAYS[window]
    const start = subDays(new Date(), days * 2)
    const end   = subDays(new Date(), days)
    return allExecs.filter(e => {
      const d = new Date(e.created_at)
      return d >= start && d < end
    })
  }, [allExecs, window])

  const stats = useMemo(() => {
    const total   = executions.length
    const success = executions.filter(e => e.status === "success").length
    const failed  = executions.filter(e => e.status === "failed").length
    const withLat = executions.filter(e => e.latency_ms)
    const avgLat  = withLat.length
      ? Math.round(withLat.reduce((s, e) => s + e.latency_ms, 0) / withLat.length)
      : 0
    const totalTok = executions.reduce((s, e) => s + (e.tokens_input || 0) + (e.tokens_output || 0), 0)
    const totalCost = executions.reduce((s, e) => s + (e.cost_usd || 0), 0)
    const days = new Set(executions.map(e => e.created_at.slice(0, 10))).size

    // Prev period
    const prevTotal   = prevExecs.length
    const prevSuccess = prevExecs.filter(e => e.status === "success").length
    const prevSuccessRate = prevTotal ? (prevSuccess / prevTotal) * 100 : 0
    const currSuccessRate = total ? (success / total) * 100 : 0

    return {
      total, success, failed, avgLat, totalTok, totalCost, days,
      successRate: total ? Math.round(currSuccessRate) : 0,
      trends: {
        total:   calcTrend(total, prevTotal),
        success: calcTrend(currSuccessRate, prevSuccessRate),
        cost:    calcTrend(totalCost, prevExecs.reduce((s, e) => s + (e.cost_usd || 0), 0)),
      },
    }
  }, [executions, prevExecs])

  const dailyData = useMemo(() => {
    const map: Record<string, { date: string; success: number; failed: number; cost: number; label: string }> = {}
    executions.forEach(e => {
      const day = e.created_at.slice(0, 10)
      if (!map[day]) map[day] = { date: day, success: 0, failed: 0, cost: 0, label: format(parseISO(day), "MMM d") }
      if (e.status === "success") map[day].success++
      if (e.status === "failed")  map[day].failed++
      map[day].cost += (e.cost_usd || 0)
    })
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
  }, [executions])

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {}
    executions.forEach(e => { const cat = e.agents?.category || "other"; map[cat] = (map[cat] || 0) + 1 })
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [executions])

  // Per-agent breakdown
  const agentBreakdown = useMemo(() => {
    const map: Record<string, { name: string; runs: number; success: number; cost: number; id: string }> = {}
    executions.forEach(e => {
      if (!e.agents?.id) return
      const k = e.agents.id
      map[k] = map[k] ?? { name: e.agents.name, id: k, runs: 0, success: 0, cost: 0 }
      map[k].runs++
      if (e.status === "success") map[k].success++
      map[k].cost += (e.cost_usd || 0)
    })
    return Object.values(map).sort((a, b) => b.runs - a.runs).slice(0, 5)
  }, [executions])

  // ── Empty state ────────────────────────────────────────────────────────────
  if (allExecs.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Analytics</h1>
          <p className="text-zinc-500 text-sm mt-1">Run agents and pipelines to start seeing performance data.</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-2xl p-12 text-center"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="w-14 h-14 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900 mb-2">No executions yet</h2>
          <p className="text-sm text-zinc-400 max-w-sm mx-auto mb-2">
            Once you run agents or pipelines, this page will show performance, cost, and success trends.
          </p>
          <ul className="text-xs text-zinc-400 mb-6 space-y-1">
            {["Execution success rate & trends", "Cost per agent & total spend", "Latency analysis", "Usage by category"].map(i => (
              <li key={i} className="flex items-center justify-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-green-400" /> {i}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/marketplace">
              <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                <Play className="h-4 w-4" /> Run your first agent
              </Button>
            </Link>
            <Link href="/pipelines">
              <Button variant="outline" className="rounded-xl border-zinc-200 gap-2 font-semibold">
                <Sparkles className="h-4 w-4" /> Try AI Composer
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const STATS = [
    {
      label: "Total Executions", value: formatNumber(stats.total),
      icon: Zap, color: "text-primary", bg: "bg-primary/8",
      trend: stats.trends.total,
    },
    {
      label: "Success Rate", value: `${stats.successRate}%`,
      icon: CheckCircle, color: "text-green-600", bg: "bg-green-50",
      trend: stats.trends.success,
    },
    {
      label: "Failed", value: formatNumber(stats.failed),
      icon: XCircle, color: "text-red-500", bg: "bg-red-50",
      trend: null,
    },
    {
      label: "Avg Latency", value: `${formatNumber(stats.avgLat)}ms`,
      icon: Clock, color: "text-amber-600", bg: "bg-amber-50",
      trend: null,
    },
    {
      label: "Total Cost", value: stats.totalCost < 0.01 ? `$${stats.totalCost.toFixed(5)}` : `$${stats.totalCost.toFixed(3)}`,
      icon: DollarSign, color: "text-violet-600", bg: "bg-violet-50",
      trend: stats.trends.cost,
    },
    {
      label: "Active Days", value: formatNumber(stats.days),
      icon: TrendingUp, color: "text-cyan-600", bg: "bg-cyan-50",
      trend: null,
    },
  ]

  return (
    <div className="space-y-6">

      {/* Header + time window */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Analytics</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {executions.length} executions in the last {WINDOW_DAYS[window]} days
          </p>
        </div>
        <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1">
          {(["7d", "30d", "90d"] as Window[]).map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                window === w ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900"
              )}>
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Insight strip */}
      <InsightStrip executions={executions} window={window} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {STATS.map(s => {
          const tr = trendArrow(s.trend ?? null)
          const TrIcon = tr.icon
          return (
            <div key={s.label} className="bg-white border border-zinc-100 rounded-2xl p-5"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <p className="text-2xl font-bold text-zinc-900 nums">{s.value}</p>
              <p className="text-xs font-medium text-zinc-600 mt-0.5">{s.label}</p>
              {s.trend !== null && (
                <p className={cn("text-[11px] font-semibold mt-1 flex items-center gap-1", tr.color)}>
                  <TrIcon className="h-3 w-3" /> {tr.label} vs prev
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Daily area chart */}
        <div className="xl:col-span-2 bg-white border border-zinc-100 rounded-2xl p-6"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Daily Executions</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Success vs failures</p>
            </div>
          </div>
          {dailyData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-zinc-400 text-sm">No data in this window</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="gSucc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gFail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="success" stroke="#22c55e" fill="url(#gSucc)" strokeWidth={2} />
                <Area type="monotone" dataKey="failed"  stroke="#ef4444" fill="url(#gFail)"  strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Category donut */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-6"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-zinc-900">By Agent Category</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Top categories used</p>
          </div>
          {categoryData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-zinc-400 text-sm">No data yet</div>
          ) : (
            <>
              <div className="space-y-2.5 mb-5">
                {categoryData.map((cat, i) => (
                  <div key={cat.name} className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-xs text-zinc-500 flex-1 capitalize">{cat.name.replace(/_/g, " ")}</span>
                    <span className="text-xs font-bold text-zinc-700 nums">{cat.value}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={35} outerRadius={50} paddingAngle={3} dataKey="value">
                    {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={0} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [v, "executions"]} />
                </PieChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>

      {/* Per-agent breakdown */}
      {agentBreakdown.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="px-6 py-4 border-b border-zinc-50 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Top Agents</h2>
              <p className="text-xs text-zinc-400 mt-0.5">By execution volume</p>
            </div>
          </div>
          <div className="divide-y divide-zinc-50">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_80px_80px_90px] gap-4 px-6 py-2.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-50/60">
              <span>Agent</span>
              <span className="text-right">Runs</span>
              <span className="text-right">Success</span>
              <span className="text-right">Cost</span>
            </div>
            {agentBreakdown.map(ag => {
              const successPct = ag.runs > 0 ? Math.round((ag.success / ag.runs) * 100) : 0
              return (
                <div key={ag.id} className="grid grid-cols-[1fr_80px_80px_90px] gap-4 px-6 py-3.5 items-center hover:bg-zinc-50/50 transition-colors">
                  <Link href={`/marketplace/${ag.id}`} className="text-sm font-medium text-zinc-900 hover:text-primary transition-colors truncate">
                    {ag.name}
                  </Link>
                  <p className="text-sm font-bold text-zinc-900 nums text-right">{formatNumber(ag.runs)}</p>
                  <p className={cn(
                    "text-sm font-bold nums text-right",
                    successPct >= 90 ? "text-green-600" : successPct >= 70 ? "text-amber-600" : "text-red-500"
                  )}>
                    {successPct}%
                  </p>
                  <p className="text-sm text-zinc-500 nums text-right font-mono">
                    {ag.cost < 0.001 ? `$${ag.cost.toFixed(5)}` : `$${ag.cost.toFixed(3)}`}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Seller revenue chart — only for sellers with agents */}
      {agentAnalytics.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-6"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-zinc-900">Agent Revenue</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Revenue from your published agents</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={agentAnalytics} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="revenue" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
