"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  Users, Bot, DollarSign, AlertCircle, CheckCircle, XCircle,
  ShieldCheck, Zap, Shield, Eye, Ban, RefreshCw, Search,
  Star, ClipboardList, ExternalLink, ChevronDown, ChevronUp,
  Tag, Cpu, Hash, MessageSquare, Calendar, ArrowUpRight,
  TrendingUp, TrendingDown, Activity, BarChart3, Layers,
  CircleDot, Clock, Flame, Target, Brain, AlertTriangle,
  CheckSquare, SquareX, Timer, DollarSignIcon, Sparkles,
} from "lucide-react"
import { SlidingTabs }                               from "@/components/ui/sliding-tabs"
import { Input }                                     from "@/components/ui/input"
import { Textarea }                                  from "@/components/ui/textarea"
import { Avatar, AvatarFallback }                   from "@/components/ui/avatar"
import { DashboardSidebar }                          from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatRelativeTime, getInitials, cn } from "@/lib/utils"
import { createClient }                              from "@/lib/supabase/client"
import toast                                         from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  totalUsers: number; totalAgents: number; pendingAgents: number
  totalExecutions: number; totalRevenue: number; platformEarned: number
}

interface AgentReview {
  id: string; name: string; description: string; category: string; status: string
  pricing_model: string; price_per_call: number | null; subscription_price_monthly: number | null
  model_name: string; temperature: number; max_tokens: number; tags: string[]
  capability_tags: string[]; created_at: string; updated_at: string
  profiles: { full_name: string; email: string; is_verified?: boolean } | null
}

interface Economics {
  grossRevenue: number; platformFee: number; totalLLMCost: number
  grossMarginPct: number; avgCostPerExec: number; costSavedRouting: number
  totalTokensIn: number; totalTokensOut: number
  topExecutions: any[]; topSpenders: any[]; dailyRevenue: { date: string; revenue: number }[]
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
  flaggedAttempts: any[]; pendingReviews: AgentReview[]
  economics: Economics | null; routing: Routing | null; execHealth: ExecHealth | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:         "bg-green-50 text-green-600",
    success:        "bg-green-50 text-green-600",
    pending_review: "bg-amber-50 text-amber-600",
    queued:         "bg-amber-50 text-amber-600",
    running:        "bg-blue-50 text-blue-600",
    suspended:      "bg-red-50 text-red-600",
    failed:         "bg-red-50 text-red-600",
    timeout:        "bg-orange-50 text-orange-600",
    draft:          "bg-zinc-100 text-zinc-500",
  }
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", map[status] ?? "bg-zinc-100 text-zinc-500")}>
      {status?.replace(/_/g, " ")}
    </span>
  )
}

function MetricCard({ label, value, sub, icon: Icon, color, bg, trend }: {
  label: string; value: string; sub: string; icon: any; color: string; bg: string; trend?: "up" | "down" | null
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center mb-2.5`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="flex items-end gap-1">
        <p className="text-xl font-bold text-zinc-900 nums leading-none">{value}</p>
        {trend === "up"   && <TrendingUp   className="h-3.5 w-3.5 text-green-500 mb-0.5" />}
        {trend === "down" && <TrendingDown className="h-3.5 w-3.5 text-red-500 mb-0.5" />}
      </div>
      <p className="text-[11px] font-medium text-zinc-600 mt-0.5">{label}</p>
      <p className="text-[10px] text-zinc-400 mt-0.5">{sub}</p>
    </div>
  )
}

// Mini sparkline bar chart
function MiniBarChart({ data, color = "bg-primary" }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((v, i) => (
        <div key={i} className={cn("flex-1 rounded-sm opacity-70", color)} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
      ))}
    </div>
  )
}

// Donut ring for model %
function ModelRing({ pct, color }: { pct: number; color: string }) {
  const r = 16, circ = 2 * Math.PI * r
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="rotate-[-90deg]">
      <circle cx="20" cy="20" r={r} fill="none" stroke="#f4f4f5" strokeWidth="4" />
      <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
        strokeLinecap="round" />
    </svg>
  )
}

// ─── Review card ──────────────────────────────────────────────────────────────

function ReviewCard({ agent, onApprove, onReject }: {
  agent: AgentReview; onApprove: (id: string) => Promise<void>; onReject: (id: string, reason: string) => Promise<void>
}) {
  const [expanded,     setExpanded]     = useState(false)
  const [rejecting,    setRejecting]    = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [loadingAction, setLoadingAction] = useState<"approve" | "reject" | null>(null)

  const handleApprove = async () => { setLoadingAction("approve"); await onApprove(agent.id); setLoadingAction(null) }
  const handleReject  = async () => {
    if (!rejectReason.trim()) { toast.error("Please provide a rejection reason"); return }
    setLoadingAction("reject"); await onReject(agent.id, rejectReason); setLoadingAction(null)
  }

  return (
    <motion.div layout className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-zinc-900 text-sm">{agent.name}</h3>
              <StatusBadge status={agent.status} />
              <span className="text-[10px] text-zinc-400">{agent.category?.replace(/_/g, " ")}</span>
            </div>
            <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{agent.description}</p>
            {agent.profiles && (
              <p className="text-[11px] text-zinc-400 mt-1.5">
                By <strong>{agent.profiles.full_name || agent.profiles.email}</strong>
                {agent.profiles.is_verified && " ✓"} · {new Date(agent.created_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors">
              {expanded ? <><ChevronUp className="h-3.5 w-3.5" /> Less</> : <><ChevronDown className="h-3.5 w-3.5" /> Details</>}
            </button>
            <button onClick={handleApprove} disabled={loadingAction !== null}
              className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              <CheckCircle className="h-3.5 w-3.5" />
              {loadingAction === "approve" ? "Approving…" : "Approve"}
            </button>
            <button onClick={() => setRejecting(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors">
              <XCircle className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>

        <AnimatePresence>
          {rejecting && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="mt-3 space-y-2 overflow-hidden">
              <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
                placeholder="Rejection reason (shown to seller)…" className="rounded-xl border-zinc-200 text-sm resize-none" />
              <div className="flex gap-2">
                <button onClick={handleReject} disabled={loadingAction !== null}
                  className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  {loadingAction === "reject" ? "Rejecting…" : "Confirm Reject"}
                </button>
                <button onClick={() => setRejecting(false)} className="text-xs text-zinc-400 hover:text-zinc-700 px-3 py-1.5 rounded-lg">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-zinc-50 px-5 py-4 space-y-3 overflow-hidden bg-zinc-50/50">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Model",      value: agent.model_name?.replace("claude-", "Claude ") },
                { label: "Pricing",    value: agent.pricing_model?.replace(/_/g, " ") },
                { label: "Max tokens", value: String(agent.max_tokens) },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">{f.label}</p>
                  <p className="text-xs font-semibold text-zinc-700 capitalize">{f.value}</p>
                </div>
              ))}
            </div>
            {(agent.tags?.length > 0 || agent.capability_tags?.length > 0) && (
              <div>
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...(agent.tags ?? []), ...(agent.capability_tags ?? [])].map(tag => (
                    <span key={tag} className="text-[11px] font-medium px-2 py-0.5 bg-white border border-zinc-100 rounded-full text-zinc-600">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Description</p>
              <p className="text-xs text-zinc-600 leading-relaxed bg-white border border-zinc-100 rounded-xl px-4 py-3">{agent.description}</p>
            </div>
            {agent.profiles && (
              <div className="flex items-center gap-3 bg-white border border-zinc-100 rounded-xl px-4 py-3">
                <Avatar className="h-8 w-8"><AvatarFallback className="text-xs bg-primary/8 text-primary">{getInitials(agent.profiles.full_name || agent.profiles.email || "?")}</AvatarFallback></Avatar>
                <div>
                  <p className="text-xs font-semibold text-zinc-900">{agent.profiles.full_name || "Unknown seller"}</p>
                  <p className="text-[11px] text-zinc-400">{agent.profiles.email}</p>
                </div>
                {agent.profiles.is_verified && <CheckCircle className="h-4 w-4 text-green-500 ml-auto" />}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Economics Panel ──────────────────────────────────────────────────────────

function EconomicsPanel({ econ }: { econ: Economics | null }) {
  if (!econ) return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-12 text-center text-zinc-400 text-sm">
      Economics data unavailable — check API route configuration
    </div>
  )

  const chartMax = Math.max(...econ.dailyRevenue.map(d => d.revenue), 1)

  return (
    <div className="space-y-5">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Gross Revenue",    value: formatCurrency(econ.grossRevenue),     sub: "all time",                      icon: DollarSign,    color: "text-green-600",  bg: "bg-green-50" },
          { label: "Total LLM Cost",   value: formatCurrency(econ.totalLLMCost),     sub: "compute spend",                  icon: Cpu,           color: "text-orange-600", bg: "bg-orange-50" },
          { label: "Gross Margin",     value: `${econ.grossMarginPct.toFixed(1)}%`,  sub: econ.grossMarginPct >= 60 ? "healthy ✓" : "watch closely",  icon: TrendingUp,    color: econ.grossMarginPct >= 60 ? "text-green-600" : "text-red-600", bg: econ.grossMarginPct >= 60 ? "bg-green-50" : "bg-red-50" },
          { label: "Cost Saved (Routing)", value: formatCurrency(econ.costSavedRouting), sub: "via smart routing",           icon: Sparkles,     color: "text-violet-600", bg: "bg-violet-50" },
        ].map(m => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue vs Cost chart */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-zinc-900">Daily Revenue — 30d</p>
              <p className="text-xs text-zinc-400">Gross transaction volume</p>
            </div>
            <BarChart3 className="h-4 w-4 text-zinc-300" />
          </div>
          {econ.dailyRevenue.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-xs text-zinc-400">No revenue data yet</div>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {econ.dailyRevenue.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="w-full bg-primary rounded-sm transition-all group-hover:opacity-80"
                    style={{ height: `${Math.max(4, (d.revenue / chartMax) * 80)}px` }} />
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-zinc-400">30 days ago</span>
            <span className="text-[10px] text-zinc-400">Today</span>
          </div>
        </div>

        {/* Economics breakdown */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <p className="text-sm font-semibold text-zinc-900">P&L Breakdown</p>
          {[
            { label: "Gross Revenue",     value: formatCurrency(econ.grossRevenue),           bar: 100,                                              color: "bg-green-400" },
            { label: "Platform Fee (20%)",value: formatCurrency(econ.platformFee),            bar: econ.grossRevenue ? (econ.platformFee / econ.grossRevenue) * 100 : 0, color: "bg-blue-400" },
            { label: "LLM Compute Cost",  value: `-${formatCurrency(econ.totalLLMCost)}`,    bar: econ.grossRevenue ? (econ.totalLLMCost / econ.grossRevenue) * 100 : 0,  color: "bg-orange-400" },
          ].map(row => (
            <div key={row.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-600">{row.label}</span>
                <span className="font-semibold text-zinc-900 nums">{row.value}</span>
              </div>
              <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", row.color)} style={{ width: `${Math.min(100, row.bar)}%` }} />
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-zinc-50">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Avg cost / execution</span>
              <span className="font-semibold text-zinc-900 nums">${(econ.avgCostPerExec * 1000).toFixed(4)}/k</span>
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-zinc-500">Total tokens processed</span>
              <span className="font-semibold text-zinc-900 nums">{formatNumber(econ.totalTokensIn + econ.totalTokensOut)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top expensive executions */}
      {econ.topExecutions.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-3 border-b border-zinc-50 flex items-center gap-2">
            <Flame className="h-3.5 w-3.5 text-orange-500" />
            <p className="text-sm font-semibold text-zinc-900">Top Cost Executions</p>
          </div>
          <div className="divide-y divide-zinc-50">
            {econ.topExecutions.slice(0, 8).map(e => (
              <div key={e.id} className="px-5 py-3 flex items-center gap-4">
                <code className="text-[10px] text-zinc-400 font-mono flex-shrink-0">{e.id.slice(0, 8)}…</code>
                <span className="text-xs text-zinc-600 flex-1 truncate">{e.agent}</span>
                <span className="text-[11px] text-zinc-400">{e.model?.replace("claude-", "")}</span>
                <StatusBadge status={e.status} />
                <span className="text-xs font-semibold text-orange-600 nums">{formatCurrency(Number(e.cost))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top spenders */}
      {econ.topSpenders.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-3 border-b border-zinc-50 flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-primary" />
            <p className="text-sm font-semibold text-zinc-900">Top Spending Users</p>
          </div>
          <div className="divide-y divide-zinc-50">
            {econ.topSpenders.slice(0, 6).map(u => (
              <div key={u.id} className="px-5 py-3 flex items-center gap-4">
                <Avatar className="h-7 w-7 flex-shrink-0"><AvatarFallback className="text-[10px] bg-primary/8 text-primary">{getInitials(u.name || u.email || "U")}</AvatarFallback></Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-900 truncate">{u.name || "—"}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{u.email}</p>
                </div>
                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.plan !== "free" ? "bg-primary/8 text-primary" : "bg-zinc-100 text-zinc-500")}>{u.plan}</span>
                <div className="text-right">
                  <p className="text-xs font-semibold text-zinc-900 nums">{formatCurrency(u.spent)}</p>
                  <p className="text-[10px] text-zinc-400">spent</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Execution Health Panel ────────────────────────────────────────────────────

function ExecutionHealthPanel({ health }: { health: ExecHealth | null }) {
  if (!health) return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-12 text-center text-zinc-400 text-sm">
      Execution data unavailable
    </div>
  )

  const STATUS_COLORS: Record<string, string> = {
    success: "text-green-600", failed: "text-red-600",
    timeout: "text-orange-600", queued: "text-amber-600", running: "text-blue-600",
  }
  const STATUS_DOT: Record<string, string> = {
    success: "bg-green-400", failed: "bg-red-400",
    timeout: "bg-orange-400", queued: "bg-amber-400", running: "bg-blue-400",
  }

  return (
    <div className="space-y-5">
      {/* 24h health summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Success Rate 24h"  value={`${health.successRate24h}%`}         sub={`${health.success24h} successful`} icon={CheckCircle}   color={health.successRate24h >= 95 ? "text-green-600" : "text-red-600"} bg={health.successRate24h >= 95 ? "bg-green-50" : "bg-red-50"} />
        <MetricCard label="Total 24h"          value={formatNumber(health.total24h)}       sub={`${health.running24h} running now`}  icon={Activity}      color="text-blue-600"   bg="bg-blue-50" />
        <MetricCard label="Failures 24h"       value={formatNumber(health.failed24h + health.timeout24h)} sub={`${health.timeout24h} timeouts`} icon={AlertTriangle} color="text-red-600"    bg="bg-red-50" />
        <MetricCard label="Avg Latency"        value={`${health.avgLatency24h}ms`}         sub="24h average"                         icon={Timer}         color="text-amber-600"  bg="bg-amber-50" />
      </div>

      {/* 1h snapshot */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <p className="text-sm font-semibold text-zinc-900">Last Hour Snapshot</p>
          <span className="text-[10px] text-zinc-400 ml-auto">Live</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-zinc-900 nums">{health.total1h}</p>
            <p className="text-xs text-zinc-400 mt-0.5">executions</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600 nums">{health.success1h}</p>
            <p className="text-xs text-zinc-400 mt-0.5">succeeded</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-500 nums">{health.failed1h}</p>
            <p className="text-xs text-zinc-400 mt-0.5">failed</p>
          </div>
        </div>
        <div className="mt-4 h-2 bg-zinc-100 rounded-full overflow-hidden">
          {health.total1h > 0 && (
            <div className="h-full flex">
              <div className="bg-green-400 h-full" style={{ width: `${(health.success1h / health.total1h) * 100}%` }} />
              <div className="bg-red-400 h-full"   style={{ width: `${(health.failed1h  / health.total1h) * 100}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* Live execution feed */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-5 py-3 border-b border-zinc-50 flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-blue-500" />
          <p className="text-sm font-semibold text-zinc-900">Live Execution Feed</p>
          <span className="text-[10px] text-zinc-400 ml-auto">last 50</span>
        </div>
        <div className="grid grid-cols-12 gap-2 px-5 py-2 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          <div className="col-span-2">ID</div>
          <div className="col-span-2">Agent</div>
          <div className="col-span-2">Model</div>
          <div className="col-span-2">User</div>
          <div className="col-span-1">Latency</div>
          <div className="col-span-1">Cost</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1">When</div>
        </div>
        <div className="divide-y divide-zinc-50 max-h-80 overflow-y-auto">
          {health.feed.length === 0 ? (
            <div className="text-center py-10 text-sm text-zinc-400">No executions yet</div>
          ) : health.feed.map(e => (
            <div key={e.id} className="grid grid-cols-12 gap-2 px-5 py-2.5 items-center hover:bg-zinc-50/50 text-xs">
              <div className="col-span-2">
                <code className="text-[10px] text-zinc-400 font-mono">{e.id.slice(0, 8)}</code>
              </div>
              <div className="col-span-2 truncate text-zinc-700">{e.agent}</div>
              <div className="col-span-2">
                <span className="text-[10px] text-zinc-500">{e.model?.replace("claude-", "") ?? "—"}</span>
              </div>
              <div className="col-span-2 truncate text-zinc-400 text-[11px]">{e.user}</div>
              <div className="col-span-1 text-zinc-500 nums">{e.latency ? `${e.latency}ms` : "—"}</div>
              <div className="col-span-1 text-zinc-600 font-medium nums">{e.cost ? `$${Number(e.cost).toFixed(5)}` : "—"}</div>
              <div className="col-span-1"><StatusBadge status={e.status} /></div>
              <div className="col-span-1 text-zinc-400 text-[10px]">{formatRelativeTime(e.created_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Routing Intelligence Panel ────────────────────────────────────────────────

const MODEL_COLORS: Record<string, string> = {
  haiku:  "#6366f1",
  sonnet: "#8b5cf6",
  opus:   "#ec4899",
}

function getModelColor(model: string) {
  const m = model?.toLowerCase() ?? ""
  if (m.includes("haiku"))  return MODEL_COLORS.haiku
  if (m.includes("sonnet")) return MODEL_COLORS.sonnet
  if (m.includes("opus"))   return MODEL_COLORS.opus
  return "#94a3b8"
}

function RoutingPanel({ routing }: { routing: Routing | null }) {
  if (!routing) return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-12 text-center text-zinc-400 text-sm">
      Routing data unavailable — executions may not have selected_model populated yet
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <MetricCard label="Routed Executions" value={formatNumber(routing.totalRoutedExecutions)} sub="with model selection" icon={Brain}       color="text-violet-600" bg="bg-violet-50" />
        <MetricCard label="Avg Cost Saved"     value={`${routing.avgSavedPct.toFixed(1)}%`}       sub="vs baseline model"    icon={TrendingDown} color="text-green-600"  bg="bg-green-50" />
        <MetricCard label="Total Compute Cost" value={formatCurrency(routing.totalCostAll)}        sub="all routed executions" icon={Cpu}         color="text-orange-600" bg="bg-orange-50" />
      </div>

      {/* Model breakdown */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2 mb-5">
          <Brain className="h-4 w-4 text-violet-500" />
          <p className="text-sm font-semibold text-zinc-900">Model Routing Breakdown</p>
        </div>
        {routing.modelBreakdown.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-8">No routing data yet — models will appear once executions run</p>
        ) : (
          <div className="space-y-4">
            {routing.modelBreakdown.map(m => {
              const color = getModelColor(m.model)
              return (
                <div key={m.model} className="flex items-center gap-4">
                  <div className="relative flex-shrink-0">
                    <ModelRing pct={m.pct} color={color} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[8px] font-bold text-zinc-700">{m.pct}%</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-zinc-900 capitalize">{m.model?.replace("claude-", "Claude ")}</p>
                      <span className="text-[10px] text-zinc-400">{formatNumber(m.count)} runs</span>
                    </div>
                    <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${m.pct}%`, backgroundColor: color }} />
                    </div>
                    <div className="flex gap-4 mt-1.5 text-[10px] text-zinc-400">
                      <span>Avg cost: ${m.avgCost.toFixed(5)}</span>
                      <span>Avg latency: {m.avgLatency}ms</span>
                      <span>Success: {m.successRate}%</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Routing reasons */}
      {routing.routingReasons.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-4 w-4 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-900">Escalation Reasons</p>
            <p className="text-xs text-zinc-400 ml-auto">Why did routing upgrade the model?</p>
          </div>
          <div className="space-y-2">
            {routing.routingReasons.slice(0, 8).map(r => {
              const maxCount = routing.routingReasons[0]?.count || 1
              return (
                <div key={r.reason} className="flex items-center gap-3">
                  <p className="text-xs text-zinc-600 w-40 truncate capitalize">{r.reason?.replace(/_/g, " ") || "unknown"}</p>
                  <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-400 rounded-full" style={{ width: `${(r.count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-zinc-400 w-8 text-right">{r.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminClient({
  stats, recentAgents: initAgents, recentUsers: initUsers,
  flaggedAttempts, pendingReviews: initPendingReviews,
  economics, routing, execHealth,
}: Props) {
  const [agents,         setAgents]         = useState(initAgents)
  const [users,          setUsers]          = useState(initUsers)
  const [pendingReviews, setPendingReviews] = useState<AgentReview[]>(initPendingReviews)
  const [agentSearch,    setAgentSearch]    = useState("")
  const [userSearch,     setUserSearch]     = useState("")
  const [agentFilter,    setAgentFilter]    = useState<"all" | "pending_review" | "active" | "suspended">("all")
  const supabase = createClient()

  const approveReview = useCallback(async (id: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "approve" }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error || "Failed to approve"); return }
    setPendingReviews(prev => prev.filter(a => a.id !== id))
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "active" } : a))
    toast.success("Agent approved and is now live ✓")
  }, [])

  const rejectReview = useCallback(async (id: string, reason: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "reject", reason }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error || "Failed to reject"); return }
    setPendingReviews(prev => prev.filter(a => a.id !== id))
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "draft" } : a))
    toast.success("Agent rejected — seller notified")
  }, [])

  const approveAgent = async (id: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "approve" }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "active" } : a))
    toast.success("Agent approved ✓")
  }

  const rejectAgent = async (id: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "suspend", reason: "Admin moderation" }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "suspended" } : a))
    toast.success("Agent suspended")
  }

  const banUser = async (id: string, isBanned: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_banned: !isBanned }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setUsers(prev => prev.map(u => u.id === id ? { ...u, is_banned: !isBanned } : u))
    toast.success(isBanned ? "User unbanned" : "User banned")
  }

  const filteredAgents = agents.filter(a => {
    const matchSearch = !agentSearch || a.name.toLowerCase().includes(agentSearch.toLowerCase())
    const matchFilter = agentFilter === "all" || a.status === agentFilter
    return matchSearch && matchFilter
  })
  const filteredUsers = users.filter(u => !userSearch || u.email?.toLowerCase().includes(userSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(userSearch.toLowerCase()))

  const pendingCount    = pendingReviews.length
  const agentTabPending = agents.filter(a => a.status === "pending_review").length

  const [activeAdminTab, setActiveAdminTab] = useState(pendingCount > 0 ? "reviews" : "economics")

  const METRICS = [
    { label: "Total Users",      value: formatNumber(stats.totalUsers),      icon: Users,        color: "text-primary",    bg: "bg-primary/8",  sub: "registered" },
    { label: "Total Agents",     value: formatNumber(stats.totalAgents),     icon: Bot,          color: "text-violet-600", bg: "bg-violet-50",  sub: `${agentTabPending} pending` },
    { label: "Total Executions", value: formatNumber(stats.totalExecutions), icon: Zap,          color: "text-amber-600",  bg: "bg-amber-50",   sub: "all time" },
    { label: "Gross Revenue",    value: formatCurrency(stats.totalRevenue),  icon: DollarSign,   color: "text-green-600",  bg: "bg-green-50",   sub: `${formatCurrency(stats.platformEarned)} platform` },
    { label: "Pending Review",   value: formatNumber(pendingCount),          icon: ClipboardList,color: "text-orange-600", bg: "bg-orange-50",  sub: "needs action" },
    { label: "Security Flags",   value: formatNumber(flaggedAttempts.length),icon: Shield,       color: "text-red-600",    bg: "bg-red-50",     sub: "injection attempts" },
  ]

  const tabVariants = {
    enter:  { opacity: 0, y: 8  },
    center: { opacity: 1, y: 0,  transition: { duration: 0.20, ease: [0.25, 0.46, 0.45, 0.94] as const } },
    exit:   { opacity: 0, y: -5, transition: { duration: 0.14, ease: [0.55, 0.06, 0.68, 0.19] as const } },
  }

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Admin Control Center</h1>
                <p className="text-zinc-500 text-sm">Platform operations · Economic intelligence · Runtime health</p>
              </div>
            </div>
            {pendingCount > 0 && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-700">{pendingCount} submission{pendingCount > 1 ? "s" : ""} waiting for review</span>
              </div>
            )}
          </div>

          {/* Platform KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {METRICS.map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className={`w-8 h-8 rounded-xl ${m.bg} flex items-center justify-center mb-2.5`}><m.icon className={`h-4 w-4 ${m.color}`} /></div>
                  <p className="text-xl font-bold text-zinc-900 nums leading-none mb-0.5">{m.value}</p>
                  <p className="text-[11px] font-medium text-zinc-600">{m.label}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{m.sub}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Main tabs */}
          <div>
            <SlidingTabs
              variant="card"
              bg="bg-zinc-50 border border-zinc-100"
              tabs={[
                { id: "economics",  label: "Economics",          icon: TrendingUp },
                { id: "executions", label: "Execution Health",   icon: Activity },
                { id: "routing",    label: "Routing Intel",      icon: Brain },
                { id: "reviews",    label: "Review Queue",       icon: ClipboardList, badge: pendingCount > 0 ? String(pendingCount) : undefined },
                { id: "agents",     label: "All Agents",         icon: Bot,           badge: agentTabPending > 0 ? String(agentTabPending) : undefined },
                { id: "users",      label: "Users",              icon: Users },
                { id: "security",   label: "Security",           icon: Shield,        badge: flaggedAttempts.length > 0 ? String(flaggedAttempts.length) : undefined, danger: flaggedAttempts.length > 0 },
              ]}
              active={activeAdminTab}
              onChange={setActiveAdminTab}
              className="mb-5"
            />

            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={activeAdminTab} variants={tabVariants} initial="enter" animate="center" exit="exit">

                {/* ── Economics ── */}
                {activeAdminTab === "economics" && <EconomicsPanel econ={economics} />}

                {/* ── Execution Health ── */}
                {activeAdminTab === "executions" && <ExecutionHealthPanel health={execHealth} />}

                {/* ── Routing Intelligence ── */}
                {activeAdminTab === "routing" && <RoutingPanel routing={routing} />}

                {/* ── Review Queue ── */}
                {activeAdminTab === "reviews" && (
                  <div className="space-y-4">
                    {pendingCount === 0 ? (
                      <div className="bg-white border border-zinc-100 rounded-2xl flex flex-col items-center justify-center py-16 text-center" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                        <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mb-3"><CheckCircle className="h-6 w-6 text-green-500" /></div>
                        <h3 className="font-semibold text-zinc-900 text-sm mb-1">All caught up!</h3>
                        <p className="text-xs text-zinc-400 max-w-xs">No agent submissions waiting for review.</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          <span><strong>{pendingCount}</strong> agent{pendingCount > 1 ? "s" : ""} submitted. Rejected agents return to <em>draft</em>.</span>
                        </div>
                        <div className="space-y-3">{pendingReviews.map(a => <ReviewCard key={a.id} agent={a} onApprove={approveReview} onReject={rejectReview} />)}</div>
                      </>
                    )}
                  </div>
                )}

                {/* ── All Agents ── */}
                {activeAdminTab === "agents" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                        <Input value={agentSearch} onChange={e => setAgentSearch(e.target.value)} placeholder="Search agents…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
                      </div>
                      <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1">
                        {(["all","pending_review","active","suspended"] as const).map(f => (
                          <button key={f} onClick={() => setAgentFilter(f)} className={cn("px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize", agentFilter === f ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>{f.replace(/_/g, " ")}</button>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        <div className="col-span-4">Agent</div><div className="col-span-2">Category</div><div className="col-span-2">Seller</div><div className="col-span-1">Status</div><div className="col-span-1">Date</div><div className="col-span-2 text-right">Actions</div>
                      </div>
                      <div className="divide-y divide-zinc-50">
                        {filteredAgents.length === 0 ? <div className="text-center py-10 text-sm text-zinc-400">No agents match</div>
                        : filteredAgents.map(agent => (
                          <div key={agent.id} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors">
                            <div className="col-span-4 min-w-0"><p className="font-medium text-sm text-zinc-900 truncate">{agent.name}</p><p className="text-xs text-zinc-400 truncate mt-0.5">{agent.description}</p></div>
                            <div className="col-span-2"><span className="text-xs text-zinc-500 capitalize">{agent.category?.replace(/_/g, " ")}</span></div>
                            <div className="col-span-2 min-w-0"><p className="text-xs text-zinc-600 truncate">{agent.profiles?.full_name || "—"}</p><p className="text-[11px] text-zinc-400 truncate">{agent.profiles?.email || ""}</p></div>
                            <div className="col-span-1"><StatusBadge status={agent.status} /></div>
                            <div className="col-span-1"><span className="text-xs text-zinc-400">{formatRelativeTime(agent.created_at)}</span></div>
                            <div className="col-span-2 flex items-center justify-end gap-1.5">
                              <Link href={`/marketplace/${agent.id}`} target="_blank"><button className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"><Eye className="h-3.5 w-3.5" /></button></Link>
                              {agent.status === "pending_review" && <>
                                <button onClick={() => approveAgent(agent.id)} className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 hover:bg-green-100 px-2.5 py-1 rounded-lg"><CheckCircle className="h-3 w-3" /> Approve</button>
                                <button onClick={() => rejectAgent(agent.id)}  className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-2.5 py-1 rounded-lg"><XCircle className="h-3 w-3" /> Reject</button>
                              </>}
                              {agent.status === "active"    && <button onClick={() => rejectAgent(agent.id)}  className="text-xs text-zinc-400 hover:text-red-500 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors">Suspend</button>}
                              {agent.status === "suspended" && <button onClick={() => approveAgent(agent.id)} className="text-xs text-zinc-400 hover:text-green-600 hover:bg-green-50 px-2.5 py-1 rounded-lg transition-colors">Restore</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Users ── */}
                {activeAdminTab === "users" && (
                  <div className="space-y-4">
                    <div className="relative max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                      <Input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search users…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
                    </div>
                    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        <div className="col-span-4">User</div><div className="col-span-2">Plan</div><div className="col-span-2">Role</div><div className="col-span-2">Earned</div><div className="col-span-1">Joined</div><div className="col-span-1 text-right">Action</div>
                      </div>
                      <div className="divide-y divide-zinc-50">
                        {filteredUsers.length === 0 ? <div className="text-center py-10 text-sm text-zinc-400">No users found</div>
                        : filteredUsers.map(u => (
                          <div key={u.id} className={cn("grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors", u.is_banned && "opacity-50")}>
                            <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                              <Avatar className="h-7 w-7 flex-shrink-0"><AvatarFallback className="text-[10px] bg-primary/8 text-primary">{getInitials(u.full_name || u.email || "U")}</AvatarFallback></Avatar>
                              <div className="min-w-0"><p className="text-sm font-medium text-zinc-900 truncate">{u.full_name || "—"}</p><p className="text-xs text-zinc-400 truncate">{u.email}</p></div>
                            </div>
                            <div className="col-span-2"><span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.subscription_plan !== "free" ? "bg-primary/8 text-primary" : "bg-zinc-100 text-zinc-500")}>{u.subscription_plan}</span></div>
                            <div className="col-span-2">
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.role === "admin" ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500")}>{u.role}</span>
                              {u.is_banned && <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">banned</span>}
                            </div>
                            <div className="col-span-2"><p className="text-xs text-zinc-600 nums">{formatCurrency(u.total_earned || 0)}</p><p className="text-[11px] text-zinc-400">earned</p></div>
                            <div className="col-span-1"><p className="text-xs text-zinc-400">{formatRelativeTime(u.created_at)}</p></div>
                            <div className="col-span-1 flex justify-end">
                              <button onClick={() => banUser(u.id, u.is_banned)} className={cn("p-1.5 rounded-lg transition-colors", u.is_banned ? "text-green-500 hover:bg-green-50" : "text-zinc-400 hover:text-red-500 hover:bg-red-50")} title={u.is_banned ? "Unban" : "Ban"}>
                                {u.is_banned ? <RefreshCw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Security ── */}
                {activeAdminTab === "security" && (
                  <div className="space-y-4">
                    <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                      <Shield className="h-4 w-4 flex-shrink-0" />
                      Injection attempts logged here. <strong className="mx-1">Blocked</strong> = rejected immediately. <strong className="mx-1">Flagged</strong> = logged for review.
                    </div>
                    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                        <div className="col-span-2">Action</div><div className="col-span-3">Pattern</div><div className="col-span-4">Input preview</div><div className="col-span-2">User</div><div className="col-span-1">Time</div>
                      </div>
                      <div className="divide-y divide-zinc-50">
                        {flaggedAttempts.length === 0 ? (
                          <div className="text-center py-10 text-sm text-zinc-400 flex flex-col items-center gap-2"><Shield className="h-6 w-6 text-green-400" />No flagged attempts — platform is clean ✓</div>
                        ) : flaggedAttempts.map((a: any) => (
                          <div key={a.id} className="grid grid-cols-12 gap-3 px-5 py-3 items-center">
                            <div className="col-span-2"><span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", a.action === "blocked" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600")}>{a.action}</span></div>
                            <div className="col-span-3"><code className="text-[11px] bg-zinc-50 px-1.5 py-0.5 rounded text-zinc-600 font-mono">{a.pattern}</code></div>
                            <div className="col-span-4"><p className="text-xs text-zinc-500 line-clamp-1 font-mono">{a.input}</p></div>
                            <div className="col-span-2"><p className="text-xs text-zinc-400 truncate font-mono">{a.user_id?.slice(0, 8)}…</p></div>
                            <div className="col-span-1"><p className="text-xs text-zinc-400">{formatRelativeTime(a.created_at)}</p></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

              </motion.div>
            </AnimatePresence>
          </div>

          {/* Admin setup reminder */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Admin Setup</p>
            <p className="text-xs text-zinc-500 mb-2">To grant admin access, run in Supabase SQL Editor:</p>
            <code className="block text-[11px] font-mono bg-white border border-zinc-200 rounded-xl px-4 py-3 text-zinc-700 leading-relaxed">
              UPDATE public.profiles SET role = &apos;admin&apos; WHERE email = &apos;your@email.com&apos;;
            </code>
          </div>

        </div>
      </main>
    </div>
  )
}
