"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts"
import {
  Users, Bot, DollarSign, AlertCircle, CheckCircle, XCircle,
  ShieldCheck, Zap, Shield, Eye, Ban, RefreshCw, Search,
  ClipboardList, ChevronDown, ChevronUp, Tag, MessageSquare,
  TrendingUp, TrendingDown, Activity, BarChart3, Layers,
  Clock, Flame, Target, Brain, AlertTriangle, Timer,
  Sparkles, Cpu, Star, Package, Server, Inbox,
  SkipForward, WifiOff, CreditCard, Gauge,
} from "lucide-react"
import { SlidingTabs }               from "@/components/ui/sliding-tabs"
import { Input }                     from "@/components/ui/input"
import { Textarea }                  from "@/components/ui/textarea"
import { Avatar, AvatarFallback }    from "@/components/ui/avatar"
import { DashboardSidebar }          from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatRelativeTime, getInitials, cn } from "@/lib/utils"
import { createClient }              from "@/lib/supabase/client"
import toast                         from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  totalUsers: number; totalAgents: number; pendingAgents: number
  totalExecutions: number; totalRevenue: number; platformEarned: number
}
interface Credits {
  consumedToday: number; consumedThisHour: number; refundedToday: number
  failedToday: number; topBurnUsers: any[]; topBurnAgents: any[]
  hourlyBurn: { hour: number; cost: number }[]; alerts: { type: string; message: string; severity: string }[]
}
interface QueueData {
  queuedCount: number; runningCount: number; failedCount: number
  avgQueueWaitMs: number; avgLatencyMs: number; throughputPerMin: number
  queuedJobs: any[]; runningJobs: any[]; deadLetter: any[]
}
interface Marketplace {
  totalAgents: number; totalRevenue30d: number; totalExecs30d: number; avgRating: number
  topByExecs: any[]; topByRevenue: any[]; topByRating: any[]; worstByFail: any[]
  categoryDistribution: { name: string; count: number; executions: number; revenue: number }[]
}
interface Economics {
  grossRevenue: number; platformFee: number; totalLLMCost: number
  grossMarginPct: number; avgCostPerExec: number; costSavedRouting: number
  totalTokensIn: number; totalTokensOut: number
  topExecutions: any[]; topSpenders: any[]
  dailyRevenue: { date: string; revenue: number }[]
}
interface Routing {
  totalRoutedExecutions: number; avgSavedPct: number; totalCostAll: number
  modelBreakdown: { model: string; count: number; pct: number; avgCost: number; avgLatency: number; successRate: number; totalCost: number }[]
  routingReasons: { reason: string; count: number }[]
}
interface ExecHealth {
  total24h: number; success24h: number; failed24h: number; timeout24h: number
  queued24h: number; running24h: number; successRate24h: number
  avgLatency24h: number; totalCost24h: number
  total1h: number; success1h: number; failed1h: number
  feed: { id: string; status: string; cost: number; latency: number; model: string; agent: string; user: string; created_at: string }[]
}
interface Props {
  stats: Stats; recentAgents: any[]; recentUsers: any[]
  flaggedAttempts: any[]; pendingReviews: any[]
  economics: Economics | null; routing: Routing | null; execHealth: ExecHealth | null
  credits: Credits | null; queue: QueueData | null; marketplace: Marketplace | null
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const CHART_COLORS = {
  primary:  "#6366f1",
  green:    "#22c55e",
  red:      "#ef4444",
  amber:    "#f59e0b",
  blue:     "#3b82f6",
  violet:   "#8b5cf6",
  pink:     "#ec4899",
  orange:   "#f97316",
  teal:     "#14b8a6",
  gray:     "#94a3b8",
}
const PIE_PALETTE = ["#6366f1","#8b5cf6","#ec4899","#f97316","#14b8a6","#f59e0b","#22c55e","#3b82f6"]

const fade = {
  enter:  { opacity: 0, y: 10 },
  center: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.25,0.46,0.45,0.94] as const } },
  exit:   { opacity: 0, y: -6, transition: { duration: 0.14 } },
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function Pill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:"bg-emerald-50 text-emerald-600",success:"bg-emerald-50 text-emerald-600",
    pending_review:"bg-amber-50 text-amber-600",queued:"bg-amber-50 text-amber-600",
    running:"bg-blue-50 text-blue-600",suspended:"bg-red-50 text-red-600",
    failed:"bg-red-50 text-red-600",timeout:"bg-orange-50 text-orange-600",
    draft:"bg-zinc-100 text-zinc-500",blocked:"bg-red-50 text-red-600",flagged:"bg-amber-50 text-amber-600",
  }
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", map[status] ?? "bg-zinc-100 text-zinc-500")}>
      {status?.replace(/_/g," ")}
    </span>
  )
}

function KpiCard({
  label, value, sub, icon: Icon, color="text-zinc-600", bg="bg-zinc-50",
  trend, alert,
}: {
  label: string; value: string; sub: string; icon: any
  color?: string; bg?: string; trend?: "up"|"down"|null; alert?: boolean
}) {
  return (
    <div className={cn(
      "bg-white rounded-2xl p-4 border transition-all",
      alert ? "border-red-200 shadow-[0_0_0_3px_rgba(239,68,68,0.08)]" : "border-zinc-100",
    )} style={{ boxShadow: alert ? undefined : "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center mb-2.5`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="flex items-end gap-1.5 mb-0.5">
        <p className="text-xl font-bold text-zinc-900 tabular-nums leading-none">{value}</p>
        {trend === "up"   && <TrendingUp   className="h-3.5 w-3.5 text-emerald-500 mb-0.5" />}
        {trend === "down" && <TrendingDown className="h-3.5 w-3.5 text-red-500 mb-0.5" />}
      </div>
      <p className="text-[11px] font-semibold text-zinc-600">{label}</p>
      <p className="text-[10px] text-zinc-400 mt-0.5 leading-snug">{sub}</p>
    </div>
  )
}

function SectionCard({ title, sub, icon: Icon, children, className }: {
  title: string; sub?: string; icon?: any; children: React.ReactNode; className?: string
}) {
  return (
    <div className={cn("bg-white border border-zinc-100 rounded-2xl overflow-hidden", className)}
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-zinc-50">
        {Icon && <Icon className="h-3.5 w-3.5 text-zinc-400" />}
        <div>
          <p className="text-sm font-semibold text-zinc-900 leading-none">{title}</p>
          {sub && <p className="text-[11px] text-zinc-400 mt-0.5">{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label, prefix = "$" }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-zinc-100 rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="font-semibold text-zinc-900">
          {prefix}{typeof p.value === "number" ? p.value.toFixed(4) : p.value}
        </p>
      ))}
    </div>
  )
}

// ─── Command Center (home cockpit) ────────────────────────────────────────────

function CommandCenter({ stats, execHealth, credits, queue, pendingCount, flaggedCount }: {
  stats: Stats; execHealth: ExecHealth | null; credits: Credits | null
  queue: QueueData | null; pendingCount: number; flaggedCount: number
}) {
  const sr    = execHealth?.successRate24h ?? 100
  const burn  = credits?.consumedToday ?? 0
  const queueD= queue?.queuedCount ?? 0
  const running = queue?.runningCount ?? 0
  const failed  = execHealth?.failed24h ?? 0

  const heroCards = [
    { label: "Platform Revenue",   value: formatCurrency(stats.totalRevenue),      sub: `${formatCurrency(stats.platformEarned)} earned`, icon: DollarSign,     color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Success Rate 24h",   value: `${sr}%`,                                sub: `${formatNumber(execHealth?.success24h??0)} success`, icon: CheckCircle, color: sr>=95?"text-emerald-600":"text-red-600", bg: sr>=95?"bg-emerald-50":"bg-red-50", alert: sr<90 },
    { label: "Credit Burn Today",  value: `$${burn.toFixed(4)}`,                   sub: `$${(credits?.consumedThisHour??0).toFixed(4)} last hour`, icon: Flame,  color: "text-orange-600", bg: "bg-orange-50", alert: burn>20 },
    { label: "Queue Depth",        value: String(queueD),                           sub: `${running} running`, icon: Server,                                         color: queueD>10?"text-red-600":"text-blue-600", bg: queueD>10?"bg-red-50":"bg-blue-50", alert: queueD>20 },
    { label: "Failures 24h",       value: String(failed),                           sub: `${execHealth?.timeout24h??0} timeouts`, icon: AlertTriangle,              color: failed>10?"text-red-600":"text-zinc-600", bg: failed>10?"bg-red-50":"bg-zinc-50", alert: failed>10 },
    { label: "Pending Reviews",    value: String(pendingCount),                     sub: `${flaggedCount} security flags`, icon: ClipboardList,                      color: pendingCount>0?"text-amber-600":"text-zinc-400", bg: pendingCount>0?"bg-amber-50":"bg-zinc-50", alert: pendingCount>5 },
  ]

  const hourlyData = credits?.hourlyBurn ?? Array.from({length:24},(_,i)=>({hour:i,cost:0}))
  const feedData   = execHealth?.feed?.slice(0,20) ?? []

  return (
    <div className="space-y-5">
      {/* Alerts */}
      {(credits?.alerts?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {credits!.alerts.map((a,i) => (
            <div key={i} className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border",
              a.severity==="critical" ? "bg-red-50 border-red-100 text-red-700" : "bg-amber-50 border-amber-100 text-amber-700"
            )}>
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Hero KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {heroCards.map((c,i) => (
          <motion.div key={c.label} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}>
            <KpiCard {...c} />
          </motion.div>
        ))}
      </div>

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hourly burn area chart */}
        <SectionCard title="Credit Burn — Last 24h" sub="hourly compute cost" icon={Flame}>
          <div className="px-2 pt-4 pb-2">
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={hourlyData} margin={{top:0,right:16,bottom:0,left:0}}>
                <defs>
                  <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.orange} stopOpacity={0.25}/>
                    <stop offset="100%" stopColor={CHART_COLORS.orange} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f4f4f5" strokeDasharray="2 4" vertical={false}/>
                <XAxis dataKey="hour" tick={{fontSize:9,fill:"#a1a1aa"}} tickLine={false} axisLine={false}
                  tickFormatter={h=>`${h}h`} interval={3}/>
                <YAxis tick={{fontSize:9,fill:"#a1a1aa"}} tickLine={false} axisLine={false}
                  tickFormatter={v=>`$${v.toFixed(2)}`} width={44}/>
                <Tooltip content={<CustomTooltip prefix="$"/>}/>
                <Area type="monotone" dataKey="cost" stroke={CHART_COLORS.orange} strokeWidth={1.5}
                  fill="url(#burnGrad)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Live execution feed */}
        <SectionCard title="Live Execution Feed" sub="last 20" icon={Activity}>
          <div className="max-h-52 overflow-y-auto divide-y divide-zinc-50">
            {feedData.length === 0
              ? <p className="text-center py-8 text-xs text-zinc-400">No executions yet</p>
              : feedData.map(e => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", {
                    "bg-emerald-400": e.status==="success",
                    "bg-red-400":     e.status==="failed",
                    "bg-amber-400":   e.status==="queued",
                    "bg-blue-400":    e.status==="running",
                    "bg-orange-400":  e.status==="timeout",
                  }[e.status] ?? "bg-zinc-300")} />
                  <span className="text-[11px] text-zinc-600 flex-1 truncate">{e.agent}</span>
                  <span className="text-[10px] text-zinc-400">{e.model?.replace("claude-","")}</span>
                  {e.cost ? <span className="text-[10px] font-semibold text-orange-600 tabular-nums">${Number(e.cost).toFixed(5)}</span> : null}
                  <span className="text-[10px] text-zinc-400">{formatRelativeTime(e.created_at)}</span>
                </div>
              ))}
          </div>
        </SectionCard>
      </div>

      {/* Bottom row: queue + top users */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Queue snapshot */}
        <SectionCard title="Queue Status" icon={Server}>
          <div className="px-5 py-4 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-bold text-amber-600 tabular-nums">{queue?.queuedCount??0}</p><p className="text-[10px] text-zinc-400 mt-1">queued</p></div>
            <div><p className="text-2xl font-bold text-blue-600 tabular-nums">{queue?.runningCount??0}</p><p className="text-[10px] text-zinc-400 mt-1">running</p></div>
            <div><p className="text-2xl font-bold text-red-500 tabular-nums">{queue?.failedCount??0}</p><p className="text-[10px] text-zinc-400 mt-1">failed/hr</p></div>
          </div>
          <div className="border-t border-zinc-50 px-5 py-3 flex justify-between text-xs">
            <span className="text-zinc-400">Avg wait</span>
            <span className="font-semibold text-zinc-700">{queue?.avgQueueWaitMs ? `${(queue.avgQueueWaitMs/1000).toFixed(1)}s` : "—"}</span>
          </div>
          <div className="border-t border-zinc-50 px-5 py-3 flex justify-between text-xs">
            <span className="text-zinc-400">Throughput</span>
            <span className="font-semibold text-zinc-700">{queue?.throughputPerMin ?? "—"}/min</span>
          </div>
        </SectionCard>

        {/* Top burn users today */}
        <div className="lg:col-span-2">
          <SectionCard title="Top Credit Burners Today" icon={Flame}>
            <div className="divide-y divide-zinc-50">
              {(credits?.topBurnUsers ?? []).slice(0,5).map(u => (
                <div key={u.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Avatar className="h-6 w-6 flex-shrink-0">
                    <AvatarFallback className="text-[9px] bg-primary/8 text-primary">{getInitials(u.name||u.email||"U")}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-900 truncate">{u.name||"—"}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{u.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-orange-600 tabular-nums">${u.cost.toFixed(4)}</p>
                    <p className="text-[10px] text-zinc-400">{u.count} execs</p>
                  </div>
                </div>
              ))}
              {(credits?.topBurnUsers?.length ?? 0) === 0 &&
                <p className="text-center py-6 text-xs text-zinc-400">No executions today</p>}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

// ─── Credit Monitor ───────────────────────────────────────────────────────────

function CreditMonitor({ credits }: { credits: Credits | null }) {
  if (!credits) return <EmptyPanel title="Credit Monitor" msg="Credits API unavailable" />
  const maxBurn = Math.max(...credits.hourlyBurn.map(h=>h.cost), 0.0001)

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Consumed Today"      value={`$${credits.consumedToday.toFixed(4)}`}     sub="since midnight UTC"       icon={Flame}       color="text-orange-600" bg="bg-orange-50" />
        <KpiCard label="Consumed This Hour"  value={`$${credits.consumedThisHour.toFixed(4)}`}  sub="rolling 60 min"           icon={Clock}       color="text-amber-600"  bg="bg-amber-50"  alert={credits.consumedThisHour>10} />
        <KpiCard label="Refunded Today"      value={`$${credits.refundedToday.toFixed(4)}`}     sub="from failed executions"   icon={CreditCard}  color="text-blue-600"   bg="bg-blue-50" />
        <KpiCard label="Failed Today"        value={String(credits.failedToday)}                 sub="executions failed"        icon={XCircle}     color={credits.failedToday>50?"text-red-600":"text-zinc-600"} bg={credits.failedToday>50?"bg-red-50":"bg-zinc-50"} />
      </div>

      {/* Alerts */}
      {credits.alerts.length > 0 && (
        <div className="space-y-2">
          {credits.alerts.map((a,i) => (
            <div key={i} className={cn("flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border",
              a.severity==="critical"?"bg-red-50 border-red-100 text-red-700":"bg-amber-50 border-amber-100 text-amber-700")}>
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Hourly chart */}
      <SectionCard title="Hourly Burn — Last 24h" icon={BarChart3}>
        <div className="px-4 pt-5 pb-3">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={credits.hourlyBurn} margin={{top:0,right:8,bottom:0,left:0}}>
              <CartesianGrid stroke="#f4f4f5" strokeDasharray="2 4" vertical={false}/>
              <XAxis dataKey="hour" tick={{fontSize:9,fill:"#a1a1aa"}} tickLine={false} axisLine={false}
                tickFormatter={h=>`${h}h`} interval={2}/>
              <YAxis tick={{fontSize:9,fill:"#a1a1aa"}} tickLine={false} axisLine={false}
                tickFormatter={v=>`$${v.toFixed(3)}`} width={48}/>
              <Tooltip content={<CustomTooltip prefix="$"/>}/>
              <Bar dataKey="cost" radius={[3,3,0,0]}>
                {credits.hourlyBurn.map((h,i) => (
                  <Cell key={i} fill={h.cost >= maxBurn*0.8 ? CHART_COLORS.red : h.cost >= maxBurn*0.5 ? CHART_COLORS.amber : CHART_COLORS.orange} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Top Burn Users" sub="today" icon={Target}>
          <div className="divide-y divide-zinc-50">
            {credits.topBurnUsers.slice(0,8).map(u => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar className="h-7 w-7 flex-shrink-0">
                  <AvatarFallback className="text-[10px] bg-primary/8 text-primary">{getInitials(u.name||u.email||"U")}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-900 truncate">{u.name||"—"}</p>
                  <p className="text-[10px] text-zinc-400 truncate">{u.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-orange-600 tabular-nums">${u.cost.toFixed(4)}</p>
                  <p className="text-[10px] text-zinc-400">{u.count} runs</p>
                </div>
              </div>
            ))}
            {credits.topBurnUsers.length===0 && <p className="text-center py-8 text-xs text-zinc-400">No data</p>}
          </div>
        </SectionCard>

        <SectionCard title="Top Burn Agents" sub="today" icon={Bot}>
          <div className="divide-y divide-zinc-50">
            {credits.topBurnAgents.slice(0,8).map(a => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-3.5 w-3.5 text-violet-500"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-900 truncate">{a.name}</p>
                  <p className="text-[10px] text-zinc-400">{a.count} runs · avg ${a.avgCost?.toFixed(5)}</p>
                </div>
                <p className="text-xs font-bold text-orange-600 tabular-nums">${a.cost.toFixed(4)}</p>
              </div>
            ))}
            {credits.topBurnAgents.length===0 && <p className="text-center py-8 text-xs text-zinc-400">No data</p>}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

// ─── Queue Dashboard ──────────────────────────────────────────────────────────

function QueueDashboard({ queue }: { queue: QueueData | null }) {
  if (!queue) return <EmptyPanel title="Queue Dashboard" msg="Queue API unavailable" />
  const healthPct = queue.queuedCount > 0
    ? Math.max(0, 100 - Math.min(100, queue.queuedCount * 5)) : 100

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Queued"          value={String(queue.queuedCount)}             sub="waiting to run"     icon={Inbox}        color={queue.queuedCount>20?"text-red-600":"text-amber-600"} bg={queue.queuedCount>20?"bg-red-50":"bg-amber-50"} alert={queue.queuedCount>20}/>
        <KpiCard label="Running"         value={String(queue.runningCount)}            sub="in-flight now"      icon={Activity}     color="text-blue-600"   bg="bg-blue-50"/>
        <KpiCard label="Failed / hr"     value={String(queue.failedCount)}             sub="last 60 min"        icon={XCircle}      color={queue.failedCount>5?"text-red-600":"text-zinc-600"} bg={queue.failedCount>5?"bg-red-50":"bg-zinc-50"} alert={queue.failedCount>5}/>
        <KpiCard label="Avg Queue Wait"  value={queue.avgQueueWaitMs?`${(queue.avgQueueWaitMs/1000).toFixed(1)}s`:"—"} sub="time in queue" icon={Clock} color="text-violet-600" bg="bg-violet-50"/>
        <KpiCard label="Avg Latency"     value={queue.avgLatencyMs?`${queue.avgLatencyMs}ms`:"—"}              sub="completed runs"  icon={Timer}        color="text-teal-600"   bg="bg-teal-50"/>
        <KpiCard label="Throughput"      value={`${queue.throughputPerMin}/min`}       sub="last 60 min"        icon={Gauge}        color="text-emerald-600" bg="bg-emerald-50"/>
      </div>

      {/* Health indicator */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-zinc-900">Queue Health</p>
          <span className={cn("text-sm font-bold", healthPct>=80?"text-emerald-600":healthPct>=50?"text-amber-600":"text-red-600")}>
            {healthPct>=80?"Healthy ✓":healthPct>=50?"Moderate":"Overloaded ⚠"}
          </span>
        </div>
        <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${healthPct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={cn("h-full rounded-full", healthPct>=80?"bg-emerald-400":healthPct>=50?"bg-amber-400":"bg-red-400")}
          />
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-zinc-400">
          <span>Overloaded</span><span>Healthy</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Queued jobs */}
        <SectionCard title="Queued Jobs" icon={Inbox}>
          <div className="max-h-60 overflow-y-auto divide-y divide-zinc-50">
            {queue.queuedJobs.length===0
              ? <p className="text-center py-8 text-xs text-zinc-400">Queue empty ✓</p>
              : queue.queuedJobs.map(j => (
                <div key={j.id} className="px-5 py-2.5">
                  <p className="text-xs font-medium text-zinc-800 truncate">{j.agent}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    <code className="font-mono">{j.id.slice(0,8)}</code> · waiting {Math.round(j.waitMs/1000)}s
                  </p>
                </div>
              ))}
          </div>
        </SectionCard>

        {/* Running jobs */}
        <SectionCard title="Running Jobs" icon={Activity}>
          <div className="max-h-60 overflow-y-auto divide-y divide-zinc-50">
            {queue.runningJobs.length===0
              ? <p className="text-center py-8 text-xs text-zinc-400">Nothing running</p>
              : queue.runningJobs.map(j => (
                <div key={j.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-800 truncate">{j.agent}</p>
                    <p className="text-[10px] text-zinc-400">{Math.round(j.runningMs/1000)}s elapsed</p>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>

        {/* Dead letter queue */}
        <SectionCard title="Dead Letter Queue" sub="last hour failures" icon={SkipForward}>
          <div className="max-h-60 overflow-y-auto divide-y divide-zinc-50">
            {queue.deadLetter.length===0
              ? <p className="text-center py-8 text-xs text-zinc-400">No failures ✓</p>
              : queue.deadLetter.map(j => (
                <div key={j.id} className="px-5 py-2.5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Pill status={j.status}/>
                    <p className="text-xs font-medium text-zinc-800 truncate">{j.agent}</p>
                  </div>
                  {j.error && <p className="text-[10px] text-red-500 font-mono truncate">{j.error}</p>}
                  <p className="text-[10px] text-zinc-400 mt-0.5">{formatRelativeTime(j.created_at)}</p>
                </div>
              ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

// ─── Marketplace Intelligence ─────────────────────────────────────────────────

function MarketplacePanel({ mkt }: { mkt: Marketplace | null }) {
  if (!mkt) return <EmptyPanel title="Marketplace Intelligence" msg="Marketplace API unavailable" />
  const [view, setView] = useState<"execs"|"revenue"|"rating"|"failures">("execs")
  const topMap = { execs: mkt.topByExecs, revenue: mkt.topByRevenue, rating: mkt.topByRating, failures: mkt.worstByFail }
  const agents = topMap[view] ?? []
  const maxVal = Math.max(...agents.map(a => view==="execs"?a.executions:view==="revenue"?a.revenue:view==="rating"?a.rating:a.failRate), 1)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Active Agents"    value={String(mkt.totalAgents)}               sub="on marketplace"  icon={Bot}       color="text-violet-600" bg="bg-violet-50"/>
        <KpiCard label="Revenue 30d"      value={formatCurrency(mkt.totalRevenue30d)}   sub="gross volume"    icon={DollarSign} color="text-emerald-600" bg="bg-emerald-50"/>
        <KpiCard label="Executions 30d"   value={formatNumber(mkt.totalExecs30d)}       sub="all agents"      icon={Zap}        color="text-amber-600"  bg="bg-amber-50"/>
        <KpiCard label="Avg Rating"       value={mkt.avgRating>0?`${mkt.avgRating}★`:"—"} sub="across agents" icon={Star}      color="text-yellow-600" bg="bg-yellow-50"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category distribution pie */}
        <SectionCard title="Category Distribution" sub="by executions (30d)" icon={Package}>
          {mkt.categoryDistribution.length===0
            ? <p className="text-center py-12 text-xs text-zinc-400">No data</p>
            : (
              <div className="flex items-center gap-4 px-5 py-4">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={mkt.categoryDistribution} dataKey="executions" cx="50%" cy="50%"
                      innerRadius={40} outerRadius={70} paddingAngle={2} strokeWidth={0}>
                      {mkt.categoryDistribution.map((_,i) => <Cell key={i} fill={PIE_PALETTE[i%PIE_PALETTE.length]}/>)}
                    </Pie>
                    <Tooltip formatter={(v:any)=>[formatNumber(v),"executions"]}
                      contentStyle={{borderRadius:10,border:"1px solid #f4f4f5",fontSize:11}}/>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {mkt.categoryDistribution.slice(0,6).map((c,i) => (
                    <div key={c.name} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:PIE_PALETTE[i%PIE_PALETTE.length]}}/>
                      <p className="text-[11px] text-zinc-600 flex-1 capitalize truncate">{c.name}</p>
                      <p className="text-[11px] font-semibold text-zinc-800 tabular-nums">{formatNumber(c.executions)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </SectionCard>

        {/* Top agents leaderboard */}
        <SectionCard title="Agent Leaderboard" icon={Star}>
          {/* Toggle */}
          <div className="flex items-center gap-1 px-5 pt-3 pb-0">
            {(["execs","revenue","rating","failures"] as const).map(v => (
              <button key={v} onClick={()=>setView(v)}
                className={cn("px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all capitalize",
                  view===v?"bg-zinc-900 text-white":"text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100")}>
                {v==="execs"?"Volume":v==="revenue"?"Revenue":v==="rating"?"Rating":"Failures"}
              </button>
            ))}
          </div>
          <div className="divide-y divide-zinc-50 mt-2">
            {agents.slice(0,6).map((a,i) => {
              const rawVal = view==="execs"?a.executions:view==="revenue"?a.revenue:view==="rating"?a.rating:a.failRate
              const displayVal = view==="revenue"?formatCurrency(rawVal):view==="rating"?`${rawVal}★`:view==="failures"?`${rawVal}% fail`:formatNumber(rawVal)
              return (
                <div key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="text-[11px] font-bold text-zinc-300 w-4 tabular-nums">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-900 truncate">{a.name}</p>
                    <div className="h-1 bg-zinc-100 rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width:`${Math.min(100,(rawVal/maxVal)*100)}%`,
                        background: view==="failures"?CHART_COLORS.red:view==="rating"?CHART_COLORS.amber:CHART_COLORS.primary,
                      }}/>
                    </div>
                  </div>
                  <p className={cn("text-xs font-bold tabular-nums",
                    view==="failures"?"text-red-600":view==="rating"?"text-amber-600":"text-zinc-900")}>{displayVal}</p>
                </div>
              )
            })}
            {agents.length===0 && <p className="text-center py-8 text-xs text-zinc-400">No data yet</p>}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

// ─── Economics Panel ──────────────────────────────────────────────────────────

function EconomicsPanel({ econ }: { econ: Economics | null }) {
  if (!econ) return <EmptyPanel title="Economics" msg="Economics API unavailable" />

  const revenueData = econ.dailyRevenue.map((d,i) => ({
    date: `D-${econ.dailyRevenue.length-1-i}`,
    revenue: d.revenue,
  }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Gross Revenue"    value={formatCurrency(econ.grossRevenue)}        sub="all time"               icon={DollarSign}   color="text-emerald-600" bg="bg-emerald-50"/>
        <KpiCard label="Total LLM Cost"   value={formatCurrency(econ.totalLLMCost)}        sub="compute spend"          icon={Cpu}           color="text-orange-600"  bg="bg-orange-50"/>
        <KpiCard label="Gross Margin"     value={`${econ.grossMarginPct.toFixed(1)}%`}     sub={econ.grossMarginPct>=60?"healthy ✓":"watch closely"} icon={TrendingUp} color={econ.grossMarginPct>=60?"text-emerald-600":"text-red-600"} bg={econ.grossMarginPct>=60?"bg-emerald-50":"bg-red-50"}/>
        <KpiCard label="Routing Savings"  value={formatCurrency(econ.costSavedRouting)}   sub="via smart routing"      icon={Sparkles}      color="text-violet-600"  bg="bg-violet-50"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue area chart */}
        <SectionCard title="Daily Revenue — 30d" sub="gross transaction volume" icon={TrendingUp}>
          <div className="px-2 pt-5 pb-3">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={revenueData} margin={{top:0,right:16,bottom:0,left:0}}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.2}/>
                    <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f4f4f5" strokeDasharray="2 4" vertical={false}/>
                <XAxis dataKey="date" tick={{fontSize:9,fill:"#a1a1aa"}} tickLine={false} axisLine={false} interval={4}/>
                <YAxis tick={{fontSize:9,fill:"#a1a1aa"}} tickLine={false} axisLine={false}
                  tickFormatter={v=>`$${v}`} width={40}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Area type="monotone" dataKey="revenue" stroke={CHART_COLORS.primary} strokeWidth={2}
                  fill="url(#revGrad)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* P&L breakdown */}
        <SectionCard title="P&L Breakdown" icon={BarChart3}>
          <div className="px-5 py-4 space-y-4">
            {[
              {label:"Gross Revenue",    val:econ.grossRevenue,  bar:100,               color:"bg-emerald-400"},
              {label:"Platform Fee 20%", val:econ.platformFee,   bar:econ.grossRevenue?(econ.platformFee/econ.grossRevenue)*100:0, color:"bg-blue-400"},
              {label:"LLM Compute Cost", val:-econ.totalLLMCost, bar:econ.grossRevenue?(econ.totalLLMCost/econ.grossRevenue)*100:0, color:"bg-orange-400"},
            ].map(row => (
              <div key={row.label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-zinc-500">{row.label}</span>
                  <span className={cn("font-semibold tabular-nums", row.val<0?"text-red-600":"text-zinc-900")}>{formatCurrency(Math.abs(row.val))}</span>
                </div>
                <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full",row.color)} style={{width:`${Math.min(100,row.bar)}%`}}/>
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-zinc-50 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Avg cost / execution</span>
                <span className="font-semibold tabular-nums">${(econ.avgCostPerExec*1000).toFixed(4)}/k</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Total tokens processed</span>
                <span className="font-semibold tabular-nums">{formatNumber(econ.totalTokensIn+econ.totalTokensOut)}</span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Top spenders */}
      {econ.topSpenders.length > 0 && (
        <SectionCard title="Top Spending Users" icon={Target}>
          <div className="divide-y divide-zinc-50">
            {econ.topSpenders.slice(0,8).map(u => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar className="h-7 w-7 flex-shrink-0">
                  <AvatarFallback className="text-[10px] bg-primary/8 text-primary">{getInitials(u.name||u.email||"U")}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-900 truncate">{u.name||"—"}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{u.email}</p>
                </div>
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.plan!=="free"?"bg-primary/8 text-primary":"bg-zinc-100 text-zinc-500")}>{u.plan}</span>
                <div className="text-right">
                  <p className="text-xs font-bold text-zinc-900 tabular-nums">{formatCurrency(u.spent)}</p>
                  <p className="text-[10px] text-zinc-400">lifetime</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ─── Execution Health ─────────────────────────────────────────────────────────

function ExecHealthPanel({ health }: { health: ExecHealth | null }) {
  if (!health) return <EmptyPanel title="Execution Health" msg="Execution Health API unavailable" />
  const sr = health.successRate24h

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Success Rate 24h" value={`${sr}%`}                               sub={`${health.success24h} succeeded`}    icon={CheckCircle} color={sr>=95?"text-emerald-600":"text-red-600"} bg={sr>=95?"bg-emerald-50":"bg-red-50"}/>
        <KpiCard label="Total 24h"        value={formatNumber(health.total24h)}           sub={`${health.running24h} running`}      icon={Activity}    color="text-blue-600"   bg="bg-blue-50"/>
        <KpiCard label="Failures 24h"     value={String(health.failed24h+health.timeout24h)} sub={`${health.timeout24h} timeouts`}  icon={AlertTriangle} color={health.failed24h>10?"text-red-600":"text-zinc-600"} bg={health.failed24h>10?"bg-red-50":"bg-zinc-50"}/>
        <KpiCard label="Avg Latency"      value={`${health.avgLatency24h}ms`}             sub="24h average"                         icon={Timer}       color="text-amber-600"  bg="bg-amber-50"/>
      </div>

      {/* Success rate bar */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>
            <p className="text-sm font-semibold text-zinc-900">Last Hour Snapshot</p>
          </div>
          <span className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-100 px-2 py-1 rounded-lg">Live</span>
        </div>
        <div className="grid grid-cols-3 gap-6 mb-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-zinc-900 tabular-nums">{health.total1h}</p>
            <p className="text-[11px] text-zinc-400 mt-1">executions</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600 tabular-nums">{health.success1h}</p>
            <p className="text-[11px] text-zinc-400 mt-1">succeeded</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500 tabular-nums">{health.failed1h}</p>
            <p className="text-[11px] text-zinc-400 mt-1">failed</p>
          </div>
        </div>
        {health.total1h > 0 && (
          <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden">
            <div className="h-full flex">
              <div className="bg-emerald-400 h-full rounded-l-full" style={{width:`${(health.success1h/health.total1h)*100}%`}}/>
              <div className="bg-red-400 h-full" style={{width:`${(health.failed1h/health.total1h)*100}%`}}/>
              <div className="bg-zinc-300 h-full rounded-r-full flex-1"/>
            </div>
          </div>
        )}
      </div>

      {/* Feed */}
      <SectionCard title="Live Execution Feed" sub="last 50" icon={Activity}>
        <div className="grid grid-cols-12 gap-2 px-5 py-2 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          <div className="col-span-2">ID</div><div className="col-span-2">Agent</div>
          <div className="col-span-2">Model</div><div className="col-span-2">User</div>
          <div className="col-span-1">ms</div><div className="col-span-1">Cost</div>
          <div className="col-span-1">Status</div><div className="col-span-1">When</div>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-zinc-50">
          {health.feed.length===0
            ? <p className="text-center py-10 text-sm text-zinc-400">No executions yet</p>
            : health.feed.map(e => (
              <div key={e.id} className="grid grid-cols-12 gap-2 px-5 py-2.5 items-center hover:bg-zinc-50/60 text-xs">
                <div className="col-span-2"><code className="text-[10px] text-zinc-400 font-mono">{e.id.slice(0,8)}</code></div>
                <div className="col-span-2 truncate text-zinc-700">{e.agent}</div>
                <div className="col-span-2 text-[10px] text-zinc-500">{e.model?.replace("claude-","")}</div>
                <div className="col-span-2 truncate text-zinc-400 text-[10px]">{e.user}</div>
                <div className="col-span-1 text-zinc-500 tabular-nums">{e.latency||"—"}</div>
                <div className="col-span-1 text-zinc-600 font-medium tabular-nums">{e.cost?`$${Number(e.cost).toFixed(5)}`:"—"}</div>
                <div className="col-span-1"><Pill status={e.status}/></div>
                <div className="col-span-1 text-zinc-400 text-[10px]">{formatRelativeTime(e.created_at)}</div>
              </div>
            ))}
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Routing Intelligence ─────────────────────────────────────────────────────

const MODEL_COLORS: Record<string,string> = {
  haiku:"#6366f1", sonnet:"#8b5cf6", opus:"#ec4899"
}
function modelColor(m:string){
  const l=m?.toLowerCase()??""
  if(l.includes("haiku"))  return MODEL_COLORS.haiku
  if(l.includes("sonnet")) return MODEL_COLORS.sonnet
  if(l.includes("opus"))   return MODEL_COLORS.opus
  return "#94a3b8"
}

function RoutingPanel({ routing }: { routing: Routing | null }) {
  if (!routing) return <EmptyPanel title="Routing Intelligence" msg="Routing API unavailable" />

  const barData = routing.modelBreakdown.map(m=>({
    name: m.model.replace("claude-","").split("-")[0],
    usage: m.pct,
    cost: +(m.totalCost.toFixed(4)),
    success: m.successRate,
  }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label="Routed Executions" value={formatNumber(routing.totalRoutedExecutions)} sub="with model selection" icon={Brain}       color="text-violet-600" bg="bg-violet-50"/>
        <KpiCard label="Avg Cost Saved"    value={`${routing.avgSavedPct.toFixed(1)}%`}       sub="vs baseline model"    icon={TrendingDown} color="text-emerald-600" bg="bg-emerald-50"/>
        <KpiCard label="Total Compute"     value={formatCurrency(routing.totalCostAll)}        sub="all routed runs"       icon={Cpu}          color="text-orange-600" bg="bg-orange-50"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model usage bar */}
        <SectionCard title="Model Distribution" sub="by execution share" icon={Brain}>
          {routing.modelBreakdown.length===0
            ? <p className="text-center py-12 text-xs text-zinc-400">No routing data yet</p>
            : <div className="px-4 pt-5 pb-3">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={barData} layout="vertical" margin={{top:0,right:8,bottom:0,left:0}}>
                  <CartesianGrid stroke="#f4f4f5" strokeDasharray="2 4" horizontal={false}/>
                  <XAxis type="number" tick={{fontSize:9,fill:"#a1a1aa"}} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`}/>
                  <YAxis type="category" dataKey="name" tick={{fontSize:10,fill:"#52525b"}} tickLine={false} axisLine={false} width={50}/>
                  <Tooltip formatter={(v:any,n:string)=>[`${v}${n==="usage"?"%":""}`]}
                    contentStyle={{borderRadius:10,border:"1px solid #f4f4f5",fontSize:11}}/>
                  <Bar dataKey="usage" radius={[0,4,4,0]}>
                    {barData.map((d,i)=><Cell key={i} fill={PIE_PALETTE[i%PIE_PALETTE.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>}
        </SectionCard>

        {/* Model detail table */}
        <SectionCard title="Model Performance" icon={Layers}>
          <div className="divide-y divide-zinc-50">
            {routing.modelBreakdown.slice(0,5).map(m=>(
              <div key={m.model} className="px-5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{background:modelColor(m.model)}}/>
                    <p className="text-xs font-semibold text-zinc-900">{m.model.replace("claude-","Claude ")}</p>
                  </div>
                  <span className="text-[10px] text-zinc-400">{formatNumber(m.count)} runs · {m.pct}%</span>
                </div>
                <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full rounded-full" style={{width:`${m.pct}%`,background:modelColor(m.model)}}/>
                </div>
                <div className="flex gap-4 text-[10px] text-zinc-400">
                  <span>Avg ${m.avgCost.toFixed(5)}</span>
                  <span>{m.avgLatency}ms</span>
                  <span className={m.successRate>=95?"text-emerald-600":"text-amber-600"}>{m.successRate}% success</span>
                </div>
              </div>
            ))}
            {routing.modelBreakdown.length===0 && <p className="text-center py-8 text-xs text-zinc-400">No data yet</p>}
          </div>
        </SectionCard>
      </div>

      {/* Escalation reasons */}
      {routing.routingReasons.length > 0 && (
        <SectionCard title="Escalation Reasons" sub="why did routing upgrade the model?" icon={Layers}>
          <div className="px-5 py-4 space-y-3">
            {routing.routingReasons.slice(0,8).map(r=>{
              const max = routing.routingReasons[0]?.count||1
              return (
                <div key={r.reason} className="flex items-center gap-3">
                  <p className="text-xs text-zinc-600 w-44 truncate capitalize">{r.reason?.replace(/_/g," ")||"unknown"}</p>
                  <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-400 rounded-full" style={{width:`${(r.count/max)*100}%`}}/>
                  </div>
                  <span className="text-[11px] text-zinc-400 w-6 text-right tabular-nums">{r.count}</span>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ─── Security / Abuse ─────────────────────────────────────────────────────────

function SecurityPanel({ flaggedAttempts }: { flaggedAttempts: any[] }) {
  const blocked = flaggedAttempts.filter(a=>a.action==="blocked").length
  const flagged = flaggedAttempts.filter(a=>a.action==="flagged").length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Flags"    value={String(flaggedAttempts.length)} sub="all time logged"    icon={Shield}      color="text-red-600"    bg="bg-red-50"    alert={flaggedAttempts.length>10}/>
        <KpiCard label="Blocked"        value={String(blocked)}                sub="rejected immediately" icon={Ban}        color="text-red-600"    bg="bg-red-50"/>
        <KpiCard label="Flagged"        value={String(flagged)}                sub="logged for review"  icon={AlertTriangle} color="text-amber-600" bg="bg-amber-50"/>
        <KpiCard label="Clean"          value={flaggedAttempts.length===0?"✓":"?"}  sub={flaggedAttempts.length===0?"no injection attempts":"review needed"} icon={ShieldCheck} color={flaggedAttempts.length===0?"text-emerald-600":"text-amber-600"} bg={flaggedAttempts.length===0?"bg-emerald-50":"bg-amber-50"}/>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-amber-700">
        <Shield className="h-4 w-4 flex-shrink-0"/>
        <span>Injection attempts are logged here. <strong>Blocked</strong> = rejected by ThoughtGate. <strong>Flagged</strong> = passed but logged.</span>
      </div>

      <SectionCard title="Injection Attempts" sub="all logged attempts" icon={Shield}>
        <div className="grid grid-cols-12 gap-2 px-5 py-2 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          <div className="col-span-1">Action</div><div className="col-span-2">Pattern</div>
          <div className="col-span-1">Score</div><div className="col-span-5">Input preview</div>
          <div className="col-span-2">User</div><div className="col-span-1">Time</div>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-zinc-50">
          {flaggedAttempts.length===0
            ? <div className="text-center py-12 flex flex-col items-center gap-2">
                <Shield className="h-7 w-7 text-emerald-400"/>
                <p className="text-sm text-zinc-400">No injection attempts — platform is clean ✓</p>
              </div>
            : flaggedAttempts.map((a:any) => (
              <div key={a.id} className="grid grid-cols-12 gap-2 px-5 py-3 items-start">
                <div className="col-span-1"><Pill status={a.action}/></div>
                <div className="col-span-2"><code className="text-[11px] bg-zinc-50 px-1.5 py-0.5 rounded text-zinc-600 font-mono">{a.pattern}</code></div>
                <div className="col-span-1"><span className={cn("text-[11px] font-bold", a.score>=0.8?"text-red-600":"text-amber-600")}>{a.score?.toFixed(2)??"—"}</span></div>
                <div className="col-span-5"><p className="text-xs text-zinc-500 line-clamp-2 font-mono">{a.input}</p></div>
                <div className="col-span-2"><p className="text-[11px] text-zinc-400 font-mono">{a.user_id?.slice(0,8)}…</p></div>
                <div className="col-span-1"><p className="text-[11px] text-zinc-400">{formatRelativeTime(a.created_at)}</p></div>
              </div>
            ))}
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

function ReviewCard({ agent, onApprove, onReject }: {
  agent: any; onApprove: (id:string)=>Promise<void>; onReject: (id:string,reason:string)=>Promise<void>
}) {
  const [expanded, setExpanded]         = useState(false)
  const [rejecting, setRejecting]       = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [loading, setLoading]           = useState<"approve"|"reject"|null>(null)
  const doApprove = async()=>{ setLoading("approve"); await onApprove(agent.id); setLoading(null) }
  const doReject  = async()=>{
    if(!rejectReason.trim()){toast.error("Provide a rejection reason");return}
    setLoading("reject"); await onReject(agent.id,rejectReason); setLoading(null)
  }
  return (
    <motion.div layout className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div className="px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-zinc-900 text-sm">{agent.name}</h3>
              <Pill status={agent.status}/>
              <span className="text-[10px] text-zinc-400">{agent.category?.replace(/_/g," ")}</span>
            </div>
            <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{agent.description}</p>
            {agent.profiles && (
              <p className="text-[11px] text-zinc-400 mt-1.5">
                By <strong>{agent.profiles.full_name||agent.profiles.email}</strong>
                {agent.profiles.is_verified&&" ✓"} · {new Date(agent.created_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={()=>setExpanded(v=>!v)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors">
              {expanded?<><ChevronUp className="h-3.5 w-3.5"/>Less</>:<><ChevronDown className="h-3.5 w-3.5"/>Details</>}
            </button>
            <button onClick={doApprove} disabled={loading!==null}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              <CheckCircle className="h-3.5 w-3.5"/>
              {loading==="approve"?"Approving…":"Approve"}
            </button>
            <button onClick={()=>setRejecting(v=>!v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors">
              <XCircle className="h-3.5 w-3.5"/>Reject
            </button>
          </div>
        </div>
        <AnimatePresence>
          {rejecting && (
            <motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} className="mt-3 space-y-2 overflow-hidden">
              <Textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)} rows={2}
                placeholder="Rejection reason (shown to seller)…" className="rounded-xl border-zinc-200 text-sm resize-none"/>
              <div className="flex gap-2">
                <button onClick={doReject} disabled={loading!==null}
                  className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {loading==="reject"?"Rejecting…":"Confirm Reject"}
                </button>
                <button onClick={()=>setRejecting(false)} className="text-xs text-zinc-400 hover:text-zinc-700 px-3 py-1.5 rounded-lg">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}}
            className="border-t border-zinc-50 px-5 py-4 space-y-3 bg-zinc-50/50 overflow-hidden">
            <div className="grid grid-cols-3 gap-3">
              {[{l:"Model",v:agent.model_name?.replace("claude-","Claude ")},{l:"Pricing",v:agent.pricing_model?.replace(/_/g," ")},{l:"Max tokens",v:String(agent.max_tokens)}].map(f=>(
                <div key={f.l}>
                  <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">{f.l}</p>
                  <p className="text-xs font-semibold text-zinc-700 capitalize">{f.v}</p>
                </div>
              ))}
            </div>
            {([...(agent.tags??[]),...(agent.capability_tags??[])]).length>0 && (
              <div>
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"><Tag className="h-3 w-3"/>Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...(agent.tags??[]),...(agent.capability_tags??[])].map((t:string)=>(
                    <span key={t} className="text-[11px] font-medium px-2 py-0.5 bg-white border border-zinc-100 rounded-full text-zinc-600">{t}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"><MessageSquare className="h-3 w-3"/>Description</p>
              <p className="text-xs text-zinc-600 leading-relaxed bg-white border border-zinc-100 rounded-xl px-4 py-3">{agent.description}</p>
            </div>
            {agent.profiles && (
              <div className="flex items-center gap-3 bg-white border border-zinc-100 rounded-xl px-4 py-3">
                <Avatar className="h-8 w-8"><AvatarFallback className="text-xs bg-primary/8 text-primary">{getInitials(agent.profiles.full_name||agent.profiles.email||"?")}</AvatarFallback></Avatar>
                <div>
                  <p className="text-xs font-semibold text-zinc-900">{agent.profiles.full_name||"Unknown seller"}</p>
                  <p className="text-[11px] text-zinc-400">{agent.profiles.email}</p>
                </div>
                {agent.profiles.is_verified && <CheckCircle className="h-4 w-4 text-emerald-500 ml-auto"/>}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function EmptyPanel({ title, msg }: { title: string; msg: string }) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-16 text-center" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <WifiOff className="h-8 w-8 text-zinc-300 mx-auto mb-3"/>
      <p className="text-sm font-semibold text-zinc-500">{title}</p>
      <p className="text-xs text-zinc-400 mt-1">{msg}</p>
    </div>
  )
}

// ─── Main AdminClient ─────────────────────────────────────────────────────────

export function AdminClient({
  stats, recentAgents: initAgents, recentUsers: initUsers,
  flaggedAttempts, pendingReviews: initPending,
  economics, routing, execHealth, credits, queue, marketplace,
}: Props) {
  const [agents,  setAgents]  = useState(initAgents)
  const [users,   setUsers]   = useState(initUsers)
  const [pending, setPending] = useState<any[]>(initPending)
  const [agentSearch, setAgentSearch] = useState("")
  const [userSearch,  setUserSearch]  = useState("")
  const [agentFilter, setAgentFilter] = useState<"all"|"pending_review"|"active"|"suspended">("all")
  const supabase = createClient()

  const pendingCount = pending.length
  const flaggedCount = flaggedAttempts.length

  const approveReview = useCallback(async(id:string)=>{
    const r=await fetch("/api/admin/agents",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:id,action:"approve"})})
    const j=await r.json()
    if(!r.ok){toast.error(j.error||"Failed to approve");return}
    setPending(p=>p.filter(a=>a.id!==id))
    setAgents(a=>a.map(x=>x.id===id?{...x,status:"active"}:x))
    toast.success("Agent approved ✓")
  },[])

  const rejectReview = useCallback(async(id:string,reason:string)=>{
    const r=await fetch("/api/admin/agents",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:id,action:"reject",reason})})
    const j=await r.json()
    if(!r.ok){toast.error(j.error||"Failed to reject");return}
    setPending(p=>p.filter(a=>a.id!==id))
    setAgents(a=>a.map(x=>x.id===id?{...x,status:"draft"}:x))
    toast.success("Agent rejected — seller notified")
  },[])

  const approveAgent = async(id:string)=>{
    const r=await fetch("/api/admin/agents",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:id,action:"approve"})})
    const j=await r.json()
    if(!r.ok){toast.error(j.error);return}
    setAgents(a=>a.map(x=>x.id===id?{...x,status:"active"}:x))
    toast.success("Agent approved ✓")
  }

  const suspendAgent = async(id:string)=>{
    const r=await fetch("/api/admin/agents",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:id,action:"suspend",reason:"Admin moderation"})})
    const j=await r.json()
    if(!r.ok){toast.error(j.error);return}
    setAgents(a=>a.map(x=>x.id===id?{...x,status:"suspended"}:x))
    toast.success("Agent suspended")
  }

  const banUser = async(id:string,isBanned:boolean)=>{
    const {error}=await supabase.from("profiles").update({is_banned:!isBanned}).eq("id",id)
    if(error){toast.error(error.message);return}
    setUsers(u=>u.map(x=>x.id===id?{...x,is_banned:!isBanned}:x))
    toast.success(isBanned?"User unbanned":"User banned")
  }

  const filteredAgents = agents.filter(a=>{
    const s=!agentSearch||a.name?.toLowerCase().includes(agentSearch.toLowerCase())
    const f=agentFilter==="all"||a.status===agentFilter
    return s&&f
  })
  const filteredUsers = users.filter(u=>
    !userSearch||u.email?.toLowerCase().includes(userSearch.toLowerCase())||u.full_name?.toLowerCase().includes(userSearch.toLowerCase())
  )

  const defaultTab = pendingCount > 0 ? "reviews" : "cockpit"
  const [activeTab, setActiveTab] = useState(defaultTab)

  const tabs = [
    { id:"cockpit",    label:"Command Center",      icon:Gauge },
    { id:"economics",  label:"Economics",           icon:TrendingUp },
    { id:"executions", label:"Exec Health",         icon:Activity },
    { id:"routing",    label:"Routing Intel",       icon:Brain },
    { id:"credits",    label:"Credit Monitor",      icon:Flame },
    { id:"queue",      label:"Queue",               icon:Server },
    { id:"marketplace",label:"Marketplace",         icon:Package },
    { id:"security",   label:"Security",            icon:Shield,       badge:flaggedCount>0?String(flaggedCount):undefined, danger:flaggedCount>0 },
    { id:"reviews",    label:"Reviews",             icon:ClipboardList,badge:pendingCount>0?String(pendingCount):undefined },
    { id:"agents",     label:"Agents",              icon:Bot },
    { id:"users",      label:"Users",               icon:Users },
  ]

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar/>
      <main className="flex-1 overflow-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-20 bg-white border-b border-zinc-100" style={{boxShadow:"0 1px 0 rgba(0,0,0,0.04)"}}>
          <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-zinc-900 flex items-center justify-center">
                <ShieldCheck className="h-4.5 w-4.5 text-white h-[18px] w-[18px]"/>
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-zinc-900">AgentDyne Control Center</h1>
                <p className="text-[11px] text-zinc-400 leading-none mt-0.5">Platform operations · Economics · Runtime health</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {pendingCount > 0 && (
                <button onClick={()=>setActiveTab("reviews")}
                  className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 transition-colors">
                  <AlertCircle className="h-3.5 w-3.5"/>
                  {pendingCount} pending review
                </button>
              )}
              {flaggedCount > 0 && (
                <button onClick={()=>setActiveTab("security")}
                  className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-100 transition-colors">
                  <Shield className="h-3.5 w-3.5"/>
                  {flaggedCount} security flags
                </button>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                Live
              </div>
            </div>
          </div>

          {/* Tab bar — scrollable */}
          <div className="max-w-screen-2xl mx-auto px-6 pb-0 overflow-x-auto">
            <div className="flex gap-0.5 border-b-0">
              {tabs.map(t=>(
                <button key={t.id} onClick={()=>setActiveTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all relative",
                    activeTab===t.id
                      ? "border-zinc-900 text-zinc-900"
                      : (t as any).danger
                        ? "border-transparent text-red-500 hover:text-red-600"
                        : "border-transparent text-zinc-500 hover:text-zinc-900"
                  )}>
                  <t.icon className="h-3.5 w-3.5"/>
                  {t.label}
                  {t.badge && (
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                      (t as any).danger?"bg-red-100 text-red-600":"bg-amber-100 text-amber-700")}>
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-screen-2xl mx-auto px-6 py-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeTab} variants={fade} initial="enter" animate="center" exit="exit">

              {activeTab==="cockpit" && (
                <CommandCenter stats={stats} execHealth={execHealth} credits={credits}
                  queue={queue} pendingCount={pendingCount} flaggedCount={flaggedCount}/>
              )}
              {activeTab==="economics"   && <EconomicsPanel econ={economics}/>}
              {activeTab==="executions"  && <ExecHealthPanel health={execHealth}/>}
              {activeTab==="routing"     && <RoutingPanel routing={routing}/>}
              {activeTab==="credits"     && <CreditMonitor credits={credits}/>}
              {activeTab==="queue"       && <QueueDashboard queue={queue}/>}
              {activeTab==="marketplace" && <MarketplacePanel mkt={marketplace}/>}
              {activeTab==="security"    && <SecurityPanel flaggedAttempts={flaggedAttempts}/>}

              {activeTab==="reviews" && (
                <div className="space-y-4">
                  {pendingCount===0
                    ? <div className="bg-white border border-zinc-100 rounded-2xl flex flex-col items-center justify-center py-16 text-center" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mb-3"><CheckCircle className="h-6 w-6 text-emerald-500"/></div>
                        <h3 className="font-semibold text-zinc-900 text-sm mb-1">All caught up!</h3>
                        <p className="text-xs text-zinc-400">No agent submissions waiting for review.</p>
                      </div>
                    : <>
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
                          <AlertCircle className="h-4 w-4 flex-shrink-0"/>
                          <span><strong>{pendingCount}</strong> agent{pendingCount>1?"s":""} submitted. Rejected agents return to <em>draft</em>.</span>
                        </div>
                        <div className="space-y-3">
                          {pending.map(a=><ReviewCard key={a.id} agent={a} onApprove={approveReview} onReject={rejectReview}/>)}
                        </div>
                      </>}
                </div>
              )}

              {activeTab==="agents" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400"/>
                      <Input value={agentSearch} onChange={e=>setAgentSearch(e.target.value)} placeholder="Search agents…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm"/>
                    </div>
                    <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1">
                      {(["all","pending_review","active","suspended"] as const).map(f=>(
                        <button key={f} onClick={()=>setAgentFilter(f)}
                          className={cn("px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize",
                            agentFilter===f?"bg-white shadow-sm text-zinc-900":"text-zinc-500 hover:text-zinc-900")}>
                          {f.replace(/_/g," ")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                    <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      <div className="col-span-4">Agent</div><div className="col-span-2">Category</div>
                      <div className="col-span-2">Seller</div><div className="col-span-1">Status</div>
                      <div className="col-span-1">Date</div><div className="col-span-2 text-right">Actions</div>
                    </div>
                    <div className="divide-y divide-zinc-50">
                      {filteredAgents.length===0
                        ? <p className="text-center py-10 text-sm text-zinc-400">No agents match</p>
                        : filteredAgents.map(a=>(
                          <div key={a.id} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors">
                            <div className="col-span-4 min-w-0">
                              <p className="font-medium text-sm text-zinc-900 truncate">{a.name}</p>
                              <p className="text-xs text-zinc-400 truncate mt-0.5">{a.description}</p>
                            </div>
                            <div className="col-span-2"><span className="text-xs text-zinc-500 capitalize">{a.category?.replace(/_/g," ")}</span></div>
                            <div className="col-span-2 min-w-0">
                              <p className="text-xs text-zinc-600 truncate">{a.profiles?.full_name||"—"}</p>
                              <p className="text-[11px] text-zinc-400 truncate">{a.profiles?.email||""}</p>
                            </div>
                            <div className="col-span-1"><Pill status={a.status}/></div>
                            <div className="col-span-1"><span className="text-xs text-zinc-400">{formatRelativeTime(a.created_at)}</span></div>
                            <div className="col-span-2 flex items-center justify-end gap-1.5">
                              <Link href={`/marketplace/${a.id}`} target="_blank">
                                <button className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"><Eye className="h-3.5 w-3.5"/></button>
                              </Link>
                              {a.status==="pending_review" && <>
                                <button onClick={()=>approveAgent(a.id)} className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 px-2.5 py-1 rounded-lg flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3"/>Approve
                                </button>
                                <button onClick={()=>suspendAgent(a.id)} className="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-2.5 py-1 rounded-lg flex items-center gap-1">
                                  <XCircle className="h-3 w-3"/>Reject
                                </button>
                              </>}
                              {a.status==="active"    && <button onClick={()=>suspendAgent(a.id)} className="text-xs text-zinc-400 hover:text-red-500 hover:bg-red-50 px-2.5 py-1 rounded-lg">Suspend</button>}
                              {a.status==="suspended" && <button onClick={()=>approveAgent(a.id)} className="text-xs text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 px-2.5 py-1 rounded-lg">Restore</button>}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab==="users" && (
                <div className="space-y-4">
                  <div className="relative max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400"/>
                    <Input value={userSearch} onChange={e=>setUserSearch(e.target.value)} placeholder="Search users…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm"/>
                  </div>
                  <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                    <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      <div className="col-span-4">User</div><div className="col-span-2">Plan</div>
                      <div className="col-span-2">Role</div><div className="col-span-2">Earned</div>
                      <div className="col-span-1">Joined</div><div className="col-span-1 text-right">Action</div>
                    </div>
                    <div className="divide-y divide-zinc-50">
                      {filteredUsers.length===0
                        ? <p className="text-center py-10 text-sm text-zinc-400">No users found</p>
                        : filteredUsers.map(u=>(
                          <div key={u.id} className={cn("grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors", u.is_banned&&"opacity-50")}>
                            <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                              <Avatar className="h-7 w-7 flex-shrink-0">
                                <AvatarFallback className="text-[10px] bg-primary/8 text-primary">{getInitials(u.full_name||u.email||"U")}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-zinc-900 truncate">{u.full_name||"—"}</p>
                                <p className="text-xs text-zinc-400 truncate">{u.email}</p>
                              </div>
                            </div>
                            <div className="col-span-2">
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.subscription_plan!=="free"?"bg-primary/8 text-primary":"bg-zinc-100 text-zinc-500")}>{u.subscription_plan}</span>
                            </div>
                            <div className="col-span-2">
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.role==="admin"?"bg-red-50 text-red-600":"bg-zinc-100 text-zinc-500")}>{u.role}</span>
                              {u.is_banned && <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">banned</span>}
                            </div>
                            <div className="col-span-2">
                              <p className="text-xs text-zinc-600 tabular-nums">{formatCurrency(u.total_earned||0)}</p>
                              <p className="text-[11px] text-zinc-400">earned</p>
                            </div>
                            <div className="col-span-1"><p className="text-xs text-zinc-400">{formatRelativeTime(u.created_at)}</p></div>
                            <div className="col-span-1 flex justify-end">
                              <button onClick={()=>banUser(u.id,u.is_banned)}
                                className={cn("p-1.5 rounded-lg transition-colors", u.is_banned?"text-emerald-500 hover:bg-emerald-50":"text-zinc-400 hover:text-red-500 hover:bg-red-50")}
                                title={u.is_banned?"Unban":"Ban"}>
                                {u.is_banned?<RefreshCw className="h-3.5 w-3.5"/>:<Ban className="h-3.5 w-3.5"/>}
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-100 px-6 py-4 max-w-screen-2xl mx-auto">
          <details className="group">
            <summary className="text-[11px] text-zinc-400 cursor-pointer hover:text-zinc-600 flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3"/>
              Admin setup · how to grant access
            </summary>
            <div className="mt-2 pl-4">
              <p className="text-xs text-zinc-400 mb-1.5">Run in Supabase SQL Editor:</p>
              <code className="block text-[11px] font-mono bg-zinc-50 border border-zinc-100 rounded-lg px-4 py-2.5 text-zinc-600">
                UPDATE public.profiles SET role = &apos;admin&apos; WHERE email = &apos;your@email.com&apos;;
              </code>
            </div>
          </details>
        </div>
      </main>
    </div>
  )
}
