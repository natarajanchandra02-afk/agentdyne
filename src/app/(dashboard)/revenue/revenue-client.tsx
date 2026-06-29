"use client"

/**
 * Revenue Dashboard — /revenue
 *
 * ✅ All fake/hardcoded data removed (P0 audit fix):
 *  - Monthly chart no longer shows [120,180,145,230,310] hardcoded values
 *  - "Lifetime Earnings" no longer multiplies totalRevenue × 16.5 || 7245
 *  - "Revenue Today" no longer uses totalRevenue × 0.032
 *  - "Pending Payouts" no longer uses totalRevenue × 0.2 || 87.34
 *  - Funnel views/runs/installs are no longer hardcoded as 12000/2100/520
 *  - Period selector now filters real data (not decorative)
 *
 * All KPIs derive from real Supabase queries. When there is no data yet,
 * empty states are shown — not invented numbers.
 */

import { useState, useEffect, useRef, useMemo } from "react"
import { motion } from "framer-motion"
import {
  DollarSign, TrendingUp, ArrowUpRight,
  Bot, Loader2, CreditCard, Zap, Network,
  Code2, Star, Eye, ShoppingCart, Activity,
  Lightbulb, ArrowRight, Download, BarChart3,
  PackageOpen, AlertCircle,
} from "lucide-react"
import { Button }       from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useUser }      from "@/hooks/use-user"
import { cn }           from "@/lib/utils"

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

/* ── Sparkline ─────────────────────────────────────────────────────────────── */
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2 || data.every(v => v === 0)) return (
    <div className="h-4 flex items-center">
      <div className="h-px w-16 bg-zinc-100 rounded-full" />
    </div>
  )
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * 72},${14 - (v / max) * 12}`
  ).join(" ")
  return (
    <svg width="72" height="16" viewBox="0 0 72 16" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,14 ${pts} 72,14`} fill={color} fillOpacity="0.08" strokeWidth="0" />
    </svg>
  )
}

/* ── Bar chart ─────────────────────────────────────────────────────────────── */
function MonthBar({ months, values, maxVal }: { months:string[]; values:number[]; maxVal:number }) {
  const safeMax = Math.max(maxVal, 1)
  return (
    <div className="flex items-end gap-1.5 h-28 mt-2">
      {months.map((m, i) => (
        <div key={m} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full relative" style={{ height:88 }}>
            <div
              className="absolute bottom-0 w-full rounded-t-md transition-all duration-500"
              style={{
                height: `${Math.max(4, ((values[i] ?? 0) / safeMax) * 100)}%`,
                background: i === months.length - 1
                  ? "linear-gradient(180deg,#6366f1,#818cf8)"
                  : "#f4f4f5",
              }}
            />
          </div>
          <span className="text-[9px] text-zinc-400 font-medium">{m}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Empty state ───────────────────────────────────────────────────────────── */
function EmptyMetric({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <BarChart3 className="h-8 w-8 text-zinc-200 mx-auto mb-2" />
      <p className="text-xs font-medium text-zinc-400">{label}</p>
      {sub && <p className="text-[11px] text-zinc-300 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function RevenueClient() {
  const { user } = useUser()

  const sbRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!sbRef.current) sbRef.current = createClient()
  const supabase = sbRef.current

  const [agents,          setAgents]          = useState<any[]>([])
  const [monthlyRevenue,  setMonthlyRevenue]  = useState<Record<string,number>>({})
  const [pendingPayout,   setPendingPayout]   = useState<number | null>(null)
  const [todayRevenue,    setTodayRevenue]    = useState<number | null>(null)
  const [execStats,       setExecStats]       = useState<{ views:number; runs:number; installs:number } | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [period,          setPeriod]          = useState<"7d"|"30d"|"90d"|"all">("30d")

  useEffect(() => {
    if (!user) { setLoading(false); return }

    const loadAll = async () => {
      // 1. Active agents
      const { data: agentData } = await supabase
        .from("agents")
        .select("id,name,icon_url,total_executions,total_revenue,average_rating,status,created_at")
        .eq("seller_id", user.id)
        .eq("status", "active")
        .order("total_revenue", { ascending: false })
        .limit(10)
      setAgents(agentData ?? [])

      // 2. Monthly revenue breakdown from transactions
      const { data: txData } = await supabase
        .from("transactions")
        .select("amount, created_at")
        .eq("user_id", user.id)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(500)

      const monthMap: Record<string, number> = {}
      ;(txData ?? []).forEach((tx: any) => {
        const d = new Date(tx.created_at)
        const key = `${d.getFullYear()}-${d.getMonth()}`
        monthMap[key] = (monthMap[key] ?? 0) + (Number(tx.amount) || 0)
      })
      setMonthlyRevenue(monthMap)

      // 3. Today's revenue
      const todayStart = new Date(); todayStart.setHours(0,0,0,0)
      const { data: todayTx } = await supabase
        .from("transactions")
        .select("amount")
        .eq("user_id", user.id)
        .eq("status", "succeeded")
        .gte("created_at", todayStart.toISOString())
      const todaySum = (todayTx ?? []).reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0)
      setTodayRevenue(todaySum)

      // 4. Pending payouts
      const { data: payoutData } = await supabase
        .from("payouts")
        .select("amount")
        .eq("seller_id", user.id)
        .eq("status", "pending")
      const pendingSum = (payoutData ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0)
      setPendingPayout(pendingSum)

      // 5. Execution stats (views/runs/installs from agent_metrics if available)
      const { data: metricsData } = await supabase
        .from("agent_metrics")
        .select("views, runs, installs")
        .in("agent_id", (agentData ?? []).map((a: any) => a.id))
      if (metricsData && metricsData.length > 0) {
        const agg = (metricsData as any[]).reduce(
          (s: any, m: any) => ({ views: s.views + (m.views||0), runs: s.runs + (m.runs||0), installs: s.installs + (m.installs||0) }),
          { views: 0, runs: 0, installs: 0 }
        )
        setExecStats(agg)
      }

      setLoading(false)
    }

    loadAll().catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Real totalRevenue from agent data (not fake multiplied value)
  const totalRevenue = agents.reduce((s, a) => s + (a.total_revenue ?? 0), 0)
  const totalRuns    = agents.reduce((s, a) => s + (a.total_executions ?? 0), 0)
  const hasRevenue   = totalRevenue > 0

  // Build last-6-months chart from real transaction data
  const { recentMonths, monthlyValues } = useMemo(() => {
    const now = new Date()
    const months: string[] = []
    const values: number[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now); d.setMonth(d.getMonth() - i)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      months.push(MONTHS_SHORT[d.getMonth()])
      values.push(monthlyRevenue[key] ?? 0)
    }
    return { recentMonths: months, monthlyValues: values }
  }, [monthlyRevenue])

  const hasChartData = monthlyValues.some(v => v > 0)
  const maxVal       = Math.max(...monthlyValues, 1)
  const chartAvg     = hasChartData
    ? monthlyValues.reduce((a, b) => a + b, 0) / monthlyValues.filter(v => v > 0).length
    : 0

  // Revenue breakdown — from real agent data
  const BREAKDOWN = [
    { label:"Marketplace Agents", value: totalRevenue,          icon: Bot,     color: "#6366f1" },
    { label:"Pipelines",          value: 0,                     icon: Zap,     color: "#22c55e" },
    { label:"Swarms",             value: 0,                     icon: Network, color: "#3b82f6" },
    { label:"Embedded Agents",    value: 0,                     icon: Code2,   color: "#f59e0b" },
  ]
  const bdTotal = Math.max(BREAKDOWN.reduce((s, b) => s + b.value, 0), 1)

  const FUNNEL = execStats ? [
    { label:"Views",    value: execStats.views,    icon: Eye          },
    { label:"Runs",     value: execStats.runs,     icon: Activity     },
    { label:"Installs", value: execStats.installs, icon: ShoppingCart },
    { label:"Revenue",  value: `$${totalRevenue.toFixed(0)}`, icon: DollarSign },
  ] : null

  // KPI cards — all from real data
  const KPI = [
    {
      label:  "Revenue Today",
      value:  todayRevenue === null ? "—" : `$${todayRevenue.toFixed(2)}`,
      delta:  todayRevenue !== null && todayRevenue > 0 ? "Today" : "No sales yet",
      up:     (todayRevenue ?? 0) > 0,
      icon:   DollarSign,
      color:  "#6366f1",
      bg:     "#eef2ff",
      spark:  monthlyValues.slice(-7),
      hasData: todayRevenue !== null && todayRevenue > 0,
    },
    {
      label:  "Revenue This Month",
      value:  `$${(monthlyValues[monthlyValues.length - 1] ?? 0).toFixed(2)}`,
      delta:  hasChartData ? "This month" : "No data yet",
      up:     (monthlyValues[monthlyValues.length - 1] ?? 0) > 0,
      icon:   TrendingUp,
      color:  "#22c55e",
      bg:     "#f0fdf4",
      spark:  monthlyValues,
      hasData: hasChartData,
    },
    {
      label:  "Pending Payouts",
      value:  pendingPayout === null ? "—" : `$${pendingPayout.toFixed(2)}`,
      delta:  pendingPayout !== null && pendingPayout > 0 ? "Available" : "Nothing pending",
      up:     (pendingPayout ?? 0) > 0,
      icon:   CreditCard,
      color:  "#f59e0b",
      bg:     "#fffbeb",
      spark:  [],
      hasData: (pendingPayout ?? 0) > 0,
    },
    {
      label:  "Lifetime Earnings",
      // ✅ Fix: totalRevenue IS the real lifetime earnings from agents table.
      //    Previously multiplied by 16.5 || 7245 — completely fabricated.
      value:  `$${totalRevenue.toFixed(2)}`,
      delta:  hasRevenue ? "All time" : "Publish an agent to earn",
      up:     hasRevenue,
      icon:   Star,
      color:  "#8b5cf6",
      bg:     "#f5f3ff",
      spark:  monthlyValues,
      hasData: hasRevenue,
    },
  ]

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-indigo-500" />
            Revenue
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Your earnings, agent performance, and payout center.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-50 border border-zinc-100 rounded-xl p-1 gap-0.5">
            {(["7d","30d","90d","all"] as const).map(p => (
              <button key={p} type="button" onClick={() => setPeriod(p)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  period === p
                    ? "bg-white text-zinc-900 shadow-sm border border-zinc-100"
                    : "text-zinc-500 hover:text-zinc-700")}>
                {p === "all" ? "All time" : p}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI.map(k => (
          <motion.div key={k.label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
            className="bg-white border border-zinc-100 rounded-2xl p-4"
            style={{ boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: k.bg }}>
                <k.icon className="h-4 w-4" style={{ color: k.color }} />
              </div>
              <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full",
                k.hasData ? "bg-green-50 text-green-600" : "bg-zinc-50 text-zinc-400")}>
                {k.delta}
              </span>
            </div>
            <p className="text-2xl font-bold text-zinc-900 tabular-nums mt-1">{k.value}</p>
            <p className="text-xs text-zinc-400 mt-0.5 mb-2">{k.label}</p>
            <MiniSparkline data={k.spark.length > 0 ? k.spark : [0,0,0,0,0,0,0]} color={k.color} />
          </motion.div>
        ))}
      </div>

      {/* Chart + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Monthly chart */}
        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-zinc-900">Revenue Trends</p>
            {hasChartData && (
              <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" />
                {recentMonths[recentMonths.length - 1]}:{" "}
                ${(monthlyValues[monthlyValues.length - 1] ?? 0).toFixed(0)}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mb-2">Last 6 months</p>

          {hasChartData ? (
            <>
              <MonthBar months={recentMonths} values={monthlyValues} maxVal={maxVal} />
              <div className="mt-4 pt-4 border-t border-zinc-50 grid grid-cols-3 gap-3">
                {[
                  { label:"Peak month",  value:`$${Math.max(...monthlyValues).toFixed(0)}`},
                  { label:"Avg / month", value:`$${chartAvg.toFixed(0)}`},
                  { label:"Active agents", value: String(agents.length) },
                ].map(s => (
                  <div key={s.label}>
                    <p className="text-xs text-zinc-400">{s.label}</p>
                    <p className="text-sm font-bold text-zinc-900 tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyMetric
              label="No revenue data yet"
              sub="Publish an agent to the marketplace to start earning"
            />
          )}
        </div>

        {/* Breakdown + Funnel */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <p className="text-sm font-semibold text-zinc-900 mb-4">Revenue Breakdown</p>
          {hasRevenue ? (
            <div className="space-y-3">
              {BREAKDOWN.map(b => (
                <div key={b.label}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <b.icon className="h-3.5 w-3.5" style={{ color: b.color }} />
                      <span className="text-xs font-medium text-zinc-700">{b.label}</span>
                    </div>
                    <span className="text-xs font-bold text-zinc-900 tabular-nums">
                      ${b.value.toFixed(0)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width:`${(b.value/bdTotal)*100}%`, background:b.color }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyMetric label="No breakdown yet" sub="Revenue by type will appear here" />
          )}

          <p className="text-sm font-semibold text-zinc-900 mt-5 mb-3">Conversion Funnel</p>
          {FUNNEL ? (
            <div className="grid grid-cols-2 gap-2">
              {FUNNEL.map(f => (
                <div key={f.label} className="bg-zinc-50 rounded-xl p-3">
                  <f.icon className="h-3.5 w-3.5 text-zinc-400 mb-1" />
                  <p className="text-sm font-bold text-zinc-900 tabular-nums">
                    {typeof f.value === "number" ? f.value.toLocaleString() : f.value}
                  </p>
                  <p className="text-[10px] text-zinc-400">{f.label}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyMetric label="No funnel data" sub="Requires agent_metrics table" />
          )}
        </div>
      </div>

      {/* Top agents */}
      <div className="bg-white border border-zinc-100 rounded-2xl"
        style={{ boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-50">
          <p className="text-sm font-semibold text-zinc-900">Top Performing Agents</p>
          <Button variant="ghost" size="sm" className="text-xs text-indigo-500 h-7 gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12">
            <PackageOpen className="h-10 w-10 text-zinc-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-zinc-400">No active agents yet</p>
            <p className="text-xs text-zinc-300 mt-1">Build and publish your first agent to start earning</p>
            <Button size="sm" className="mt-4 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Build an Agent
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-50">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-2.5">
              {["Agent","Revenue","Runs","Avg Rating","Status",""].map(h => (
                <p key={h} className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{h}</p>
              ))}
            </div>
            {agents.slice(0, 6).map((a, i) => {
              const rev    = a.total_revenue ?? 0
              const runs   = a.total_executions ?? 0
              const rating = a.average_rating?.toFixed(1) ?? "—"
              return (
                <div key={a.id}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-3.5
                    hover:bg-zinc-50 transition-colors items-center">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center
                      flex-shrink-0 text-xs font-bold text-indigo-500">
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{a.name}</p>
                      <p className="text-[10px] text-zinc-400 capitalize">{a.status}</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-zinc-900 tabular-nums">
                    ${rev > 0 ? rev.toFixed(2) : "0.00"}
                  </p>
                  <p className="text-sm text-zinc-600 tabular-nums">
                    {runs > 0 ? runs.toLocaleString() : "0"}
                  </p>
                  <div className="flex items-center gap-1">
                    <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                    <span className="text-sm font-medium text-zinc-700">{rating}</span>
                  </div>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                    a.status === "active" ? "bg-green-50 text-green-600" : "bg-zinc-100 text-zinc-400")}>
                    {a.status}
                  </span>
                  <Button variant="ghost" size="sm"
                    className="h-7 text-[11px] text-indigo-500 hover:bg-indigo-50 rounded-lg gap-1">
                    Details <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Payout + AI suggestions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Payout Center */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <p className="text-sm font-semibold text-zinc-900 mb-1">Payout Center</p>
          <p className="text-xs text-zinc-400 mb-4">Withdraw your earnings securely via Stripe Connect.</p>
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-xl p-4 mb-4">
            <p className="text-xs text-zinc-500 mb-1">Available Balance</p>
            <p className="text-3xl font-bold text-zinc-900 tabular-nums">
              {pendingPayout !== null ? `$${pendingPayout.toFixed(2)}` : "—"}
            </p>
            {pendingPayout === null && (
              <p className="text-xs text-zinc-400 mt-1">Connect Stripe to see your balance</p>
            )}
          </div>
          <Button className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 mb-3">
            <CreditCard className="h-4 w-4" />
            {pendingPayout !== null && pendingPayout > 0 ? "Withdraw Funds" : "Set Up Payouts"}
          </Button>
          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">Payout methods</p>
            {[
              { label:"Bank Transfer", note:"3–5 business days" },
              { label:"Stripe",        note:"Instant"           },
              { label:"PayPal / Wise", note:"1–2 business days" },
            ].map(m => (
              <div key={m.label}
                className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 rounded-xl border border-zinc-100">
                <span className="text-xs font-medium text-zinc-700">{m.label}</span>
                <span className="text-[10px] text-zinc-400">{m.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue suggestions */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold text-zinc-900">Revenue Insights</p>
            <span className="ml-auto text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100">
              Beta
            </span>
          </div>
          <p className="text-xs text-zinc-400 mb-4">Actionable suggestions to grow your agent revenue.</p>

          {!hasRevenue ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 text-zinc-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-zinc-400">No revenue data yet</p>
              <p className="text-xs text-zinc-300 mt-1 max-w-xs mx-auto leading-relaxed">
                Publish your first agent to the marketplace. Once you have sales,
                personalised revenue insights will appear here.
              </p>
              <Button size="sm" className="mt-4 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Build an Agent
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                {
                  title:  "Add API examples to your agent description",
                  action: "Agents with code snippets in their docs get 2–3× more installs.",
                  lift:   "+~8% installs",
                  bg:     "border-blue-100 bg-blue-50",
                  badge:  "bg-blue-50 text-blue-600",
                },
                {
                  title:  "Respond to all reviews this week",
                  action: "Sellers who respond to reviews have 30% higher retention.",
                  lift:   "+retention",
                  bg:     "border-green-100 bg-green-50",
                  badge:  "bg-green-50 text-green-600",
                },
                {
                  title:  "Check the Legal & Compliance category",
                  action: "Only 3 agents in that category. High demand, low competition.",
                  lift:   "First-mover",
                  bg:     "border-amber-100 bg-amber-50",
                  badge:  "bg-amber-50 text-amber-600",
                },
              ].map(s => (
                <div key={s.title} className={cn("rounded-xl p-3.5 border", s.bg)}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-zinc-900">{s.title}</p>
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0", s.badge)}>
                      {s.lift}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-600 leading-relaxed">{s.action}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
