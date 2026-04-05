"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { Zap, CheckCircle, XCircle, Clock, TrendingUp, Activity } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatNumber, formatDate } from "@/lib/utils"
import { format, parseISO, startOfDay } from "date-fns"

const COLORS = ["hsl(243,75%,65%)", "hsl(262,83%,58%)", "hsl(199,89%,48%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)"]

export function AnalyticsClient({ executions, agentAnalytics }: { executions: any[]; agentAnalytics: any[] }) {

  const stats = useMemo(() => {
    const total     = executions.length
    const success   = executions.filter(e => e.status === "success").length
    const failed    = executions.filter(e => e.status === "failed").length
    const avgLatency = executions.filter(e => e.latency_ms).reduce((s, e) => s + e.latency_ms, 0) / (executions.filter(e => e.latency_ms).length || 1)
    const totalTokens = executions.reduce((s, e) => s + (e.tokens_input || 0) + (e.tokens_output || 0), 0)
    return { total, success, failed, avgLatency: Math.round(avgLatency), successRate: total ? Math.round((success / total) * 100) : 0, totalTokens }
  }, [executions])

  // Daily execution chart
  const dailyData = useMemo(() => {
    const map: Record<string, { date: string; executions: number; success: number; failed: number }> = {}
    executions.forEach(e => {
      const day = e.created_at.slice(0, 10)
      if (!map[day]) map[day] = { date: day, executions: 0, success: 0, failed: 0 }
      map[day].executions++
      if (e.status === "success") map[day].success++
      if (e.status === "failed")  map[day].failed++
    })
    return Object.values(map).map(d => ({ ...d, label: format(parseISO(d.date), "MMM d") }))
  }, [executions])

  // Category breakdown
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {}
    executions.forEach(e => {
      const cat = e.agents?.category || "other"
      map[cat] = (map[cat] || 0) + 1
    })
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5)
  }, [executions])

  const STAT_CARDS = [
    { label: "Total Executions", value: formatNumber(stats.total),        icon: Zap,         color: "text-primary",     bg: "bg-primary/10" },
    { label: "Success Rate",     value: `${stats.successRate}%`,           icon: CheckCircle, color: "text-green-500",   bg: "bg-green-500/10" },
    { label: "Failed",           value: formatNumber(stats.failed),        icon: XCircle,     color: "text-destructive", bg: "bg-destructive/10" },
    { label: "Avg Latency",      value: `${formatNumber(stats.avgLatency)}ms`, icon: Clock,  color: "text-yellow-500",  bg: "bg-yellow-500/10" },
    { label: "Tokens Used",      value: formatNumber(stats.totalTokens),   icon: Activity,    color: "text-purple-500",  bg: "bg-purple-500/10" },
    { label: "Active Days",      value: formatNumber(dailyData.length),    icon: TrendingUp,  color: "text-blue-500",    bg: "bg-blue-500/10" },
  ]

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-popover border border-border rounded-xl p-3 shadow-xl text-xs">
        <p className="font-semibold text-foreground mb-2">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
            {p.dataKey}: <span className="font-semibold ml-1">{p.value}</span>
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Your execution stats for the last 30 days.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {STAT_CARDS.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="metric-card">
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Daily executions — takes 2 cols */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Daily Executions</CardTitle>
            <CardDescription>Success vs failures over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {dailyData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="success" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142,71%,45%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(142,71%,45%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(0,84%,60%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(0,84%,60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="success" stroke="hsl(142,71%,45%)" fill="url(#success)" strokeWidth={2} name="success" />
                  <Area type="monotone" dataKey="failed"  stroke="hsl(0,84%,60%)"   fill="url(#failed)"  strokeWidth={2} name="failed" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Category breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Category</CardTitle>
            <CardDescription>Top agent categories used</CardDescription>
          </CardHeader>
          <CardContent>
            {categoryData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <div className="space-y-3">
                {categoryData.map((cat, i) => (
                  <div key={cat.name} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-sm text-muted-foreground flex-1 capitalize">{cat.name.replace("_", " ")}</span>
                    <Badge variant="secondary" className="tabular-nums">{cat.value}</Badge>
                  </div>
                ))}
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={categoryData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={3} dataKey="value">
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={0} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [v, "executions"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Seller analytics */}
      {agentAnalytics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Revenue</CardTitle>
            <CardDescription>Revenue from your published agents (last 30 days)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={agentAnalytics} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} name="revenue" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
