"use client"

import { useMemo } from "react"
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { Zap, CheckCircle, XCircle, Clock, TrendingUp, Activity } from "lucide-react"
import { formatNumber } from "@/lib/utils"
import { format, parseISO } from "date-fns"

const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#22c55e", "#f59e0b"]

function StatCard({ label, value, icon: Icon, color, bg }: any) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-zinc-900 nums">{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5 font-medium">{label}</p>
    </div>
  )
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

export function AnalyticsClient({ executions, agentAnalytics }: { executions: any[]; agentAnalytics: any[] }) {
  const stats = useMemo(() => {
    const total      = executions.length
    const success    = executions.filter(e => e.status === "success").length
    const failed     = executions.filter(e => e.status === "failed").length
    const withLatency = executions.filter(e => e.latency_ms)
    const avgLatency  = withLatency.length ? Math.round(withLatency.reduce((s, e) => s + e.latency_ms, 0) / withLatency.length) : 0
    const totalTokens = executions.reduce((s, e) => s + (e.tokens_input || 0) + (e.tokens_output || 0), 0)
    return { total, success, failed, avgLatency, successRate: total ? Math.round((success / total) * 100) : 0, totalTokens }
  }, [executions])

  const dailyData = useMemo(() => {
    const map: Record<string, { date: string; success: number; failed: number; label: string }> = {}
    executions.forEach(e => {
      const day = e.created_at.slice(0, 10)
      if (!map[day]) map[day] = { date: day, success: 0, failed: 0, label: format(parseISO(day), "MMM d") }
      if (e.status === "success") map[day].success++
      if (e.status === "failed")  map[day].failed++
    })
    return Object.values(map)
  }, [executions])

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {}
    executions.forEach(e => { const cat = e.agents?.category || "other"; map[cat] = (map[cat] || 0) + 1 })
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5)
  }, [executions])

  const STATS = [
    { label: "Total Executions", value: formatNumber(stats.total),        icon: Zap,         color: "text-primary",    bg: "bg-primary/8" },
    { label: "Success Rate",     value: `${stats.successRate}%`,           icon: CheckCircle, color: "text-green-600",  bg: "bg-green-50" },
    { label: "Failed",           value: formatNumber(stats.failed),        icon: XCircle,     color: "text-red-500",    bg: "bg-red-50" },
    { label: "Avg Latency",      value: `${formatNumber(stats.avgLatency)}ms`, icon: Clock,  color: "text-amber-600",  bg: "bg-amber-50" },
    { label: "Tokens Used",      value: formatNumber(stats.totalTokens),   icon: Activity,    color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Active Days",      value: formatNumber(dailyData.length),    icon: TrendingUp,  color: "text-cyan-600",   bg: "bg-cyan-50" },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Analytics</h1>
        <p className="text-zinc-500 text-sm mt-1">Your execution stats for the last 30 days.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {STATS.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Daily area chart */}
        <div className="xl:col-span-2 bg-white border border-zinc-100 rounded-2xl p-6" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-zinc-900">Daily Executions</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Success vs failures over 30 days</p>
          </div>
          {dailyData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-zinc-400 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="success" stroke="#22c55e" fill="url(#gSuccess)" strokeWidth={2} />
                <Area type="monotone" dataKey="failed"  stroke="#ef4444" fill="url(#gFailed)"  strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Category breakdown */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-6" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-zinc-900">By Category</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Top categories used</p>
          </div>
          {categoryData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-zinc-400 text-sm">No data yet</div>
          ) : (
            <>
              <div className="space-y-2.5 mb-5">
                {categoryData.map((cat, i) => (
                  <div key={cat.name} className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-xs text-zinc-500 flex-1 capitalize">{cat.name.replace("_", " ")}</span>
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

      {/* Seller revenue chart */}
      {agentAnalytics.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-6" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
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
