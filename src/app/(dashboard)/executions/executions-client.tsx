"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CheckCircle, XCircle, Clock, Loader2, Search,
  Zap, ChevronRight, Bot, BarChart3, X, ExternalLink,
  Play, Sparkles, Eye, AlertCircle, DollarSign, Cpu,
  RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { formatNumber, formatRelativeTime, cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Execution {
  id:            string
  agent_id:      string | null
  status:        "success" | "failed" | "running" | "queued" | "timeout"
  latency_ms:    number | null
  cost_usd:      number | null
  cost:          number | null
  tokens_input:  number | null
  tokens_output: number | null
  error_message: string | null
  created_at:    string
  agents: {
    id:       string
    name:     string
    category: string
    icon_url: string | null
  } | null
}

interface Props {
  executions:      Execution[]
  totalExecutions: number
  profile:         any
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  success: { icon: CheckCircle, color: "text-green-600",  bg: "bg-green-50",   border: "border-green-100", label: "Success" },
  failed:  { icon: XCircle,     color: "text-red-500",    bg: "bg-red-50",     border: "border-red-100",   label: "Failed"  },
  timeout: { icon: XCircle,     color: "text-orange-500", bg: "bg-orange-50",  border: "border-orange-100",label: "Timeout" },
  running: { icon: Loader2,     color: "text-blue-500",   bg: "bg-blue-50",    border: "border-blue-100",  label: "Running" },
  queued:  { icon: Clock,       color: "text-zinc-400",   bg: "bg-zinc-50",    border: "border-zinc-100",  label: "Queued"  },
} as const

const FILTER_OPTIONS = [
  { key: "all",     label: "All"     },
  { key: "success", label: "Success" },
  { key: "failed",  label: "Failed"  },
  { key: "timeout", label: "Timeout" },
]

const PAGE_SIZE = 50

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: Execution["status"] }) {
  const cfg  = STATUS_CONFIG[status] ?? STATUS_CONFIG.queued
  const Icon = cfg.icon
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full",
      cfg.bg, cfg.color
    )}>
      <Icon className={cn("h-3 w-3 flex-shrink-0", status === "running" && "animate-spin")} />
      {cfg.label}
    </span>
  )
}

// ─── Execution detail row ─────────────────────────────────────────────────────

function ExecutionRow({ exec, index }: { exec: Execution; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const cost = exec.cost_usd ?? exec.cost ?? 0

  return (
    <>
      {/* Main row */}
      <div
        className="grid grid-cols-1 sm:grid-cols-[1fr_130px_90px_90px_90px_36px] gap-2 sm:gap-4 px-5 py-3.5 hover:bg-zinc-50/60 transition-colors cursor-pointer items-center"
        onClick={() => setExpanded(v => !v)}
        style={{ animationDelay: `${Math.min(index * 12, 250)}ms` }}>

        {/* Agent */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 truncate">
              {exec.agents?.name ?? "Deleted Agent"}
            </p>
            <p className="text-[11px] text-zinc-400 font-mono truncate hidden sm:block">
              {exec.id.slice(0, 8)}…
            </p>
          </div>
        </div>

        <div><StatusPill status={exec.status} /></div>

        <p className="text-sm text-zinc-600 font-medium hidden sm:block nums">
          {exec.latency_ms ? `${formatNumber(exec.latency_ms)}ms` : "—"}
        </p>

        <p className="text-sm text-zinc-600 font-medium hidden sm:block nums">
          {cost > 0 ? `$${cost.toFixed(5)}` : "Free"}
        </p>

        <p className="text-xs text-zinc-400 hidden sm:block">
          {formatRelativeTime(exec.created_at)}
        </p>

        <div className="hidden sm:flex items-center justify-center text-zinc-300">
          {expanded
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {/* Expanded detail — I/O, token, trace link, agent link */}
      {expanded && (
        <div className="px-5 pb-4 pt-0 border-t border-zinc-50 bg-zinc-50/40">
          <div className="py-3 grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
            {[
              { label: "Execution ID",  value: exec.id,                            mono: true, truncate: true },
              { label: "Tokens In",     value: exec.tokens_input  ? formatNumber(exec.tokens_input)  : "—" },
              { label: "Tokens Out",    value: exec.tokens_output ? formatNumber(exec.tokens_output) : "—" },
              { label: "Exact Cost",    value: cost > 0 ? `$${cost.toFixed(6)}` : "Free" },
            ].map(r => (
              <div key={r.label}>
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">{r.label}</p>
                <p className={cn(
                  "text-sm text-zinc-700",
                  r.mono && "font-mono text-xs",
                  r.truncate && "truncate"
                )}>
                  {r.value}
                </p>
              </div>
            ))}
          </div>

          {/* Failed: show error message first, then hint */}
          {(exec.status === "failed" || exec.status === "timeout") && (
            <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-3">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {exec.error_message
                  ? exec.error_message.slice(0, 300)
                  : exec.status === "timeout"
                    ? "Execution timed out — the agent took too long to respond."
                    : "Execution failed — check the full trace for details."}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-zinc-100">
            <Link href={`/executions/${exec.id}`}
              className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
              onClick={e => e.stopPropagation()}>
              <Eye className="h-3.5 w-3.5" /> View full trace
            </Link>
            {exec.agents && (
              <Link href={`/marketplace/${exec.agents.id}`} target="_blank"
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-primary font-semibold hover:underline"
                onClick={e => e.stopPropagation()}>
                <ExternalLink className="h-3 w-3" /> View agent
              </Link>
            )}
            {exec.agents && (
              <Link href={`/marketplace/${exec.agents.id}`}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-primary font-semibold hover:underline ml-auto"
                onClick={e => e.stopPropagation()}>
                <RefreshCw className="h-3 w-3" /> Run again
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Main client ──────────────────────────────────────────────────────────────

export function ExecutionsClient({ executions: allExecs, totalExecutions, profile }: Props) {
  const router = useRouter()
  const [search,  setSearch]  = useState("")
  const [filter,  setFilter]  = useState("all")
  const [page,    setPage]    = useState(1)

  const filtered = useMemo(() => {
    return allExecs.filter(ex => {
      const matchFilter = filter === "all" || ex.status === filter
      const agentName   = ex.agents?.name?.toLowerCase() ?? ""
      const matchSearch = !search || agentName.includes(search.toLowerCase()) || ex.id.includes(search)
      return matchFilter && matchSearch
    })
  }, [allExecs, filter, search])

  const paginated = filtered.slice(0, page * PAGE_SIZE)
  const hasMore   = paginated.length < filtered.length

  // Stats from all executions
  const stats = useMemo(() => {
    const success    = allExecs.filter(e => e.status === "success").length
    const failed     = allExecs.filter(e => e.status === "failed" || e.status === "timeout").length
    const withLat    = allExecs.filter(e => e.latency_ms)
    const avgLatency = withLat.length
      ? Math.round(withLat.reduce((s, e) => s + (e.latency_ms ?? 0), 0) / withLat.length)
      : 0
    const totalCost  = allExecs.reduce((s, e) => s + (e.cost_usd ?? e.cost ?? 0), 0)
    const successRate = allExecs.length > 0 ? Math.round((success / allExecs.length) * 100) : 0
    return { success, failed, avgLatency, totalCost, successRate }
  }, [allExecs])

  const STATS = [
    { label: "Total",        value: formatNumber(totalExecutions), color: "text-zinc-900",  bg: "bg-zinc-50"   },
    { label: "Successful",   value: formatNumber(stats.success),   color: "text-green-700", bg: "bg-green-50"  },
    { label: "Failed",       value: formatNumber(stats.failed),    color: "text-red-600",   bg: "bg-red-50"    },
    { label: "Success Rate", value: `${stats.successRate}%`,       color: "text-blue-600",  bg: "bg-blue-50"   },
    { label: "Avg Latency",  value: `${formatNumber(stats.avgLatency)}ms`, color: "text-amber-700", bg: "bg-amber-50" },
    { label: "Total Cost",   value: `$${stats.totalCost.toFixed(4)}`, color: "text-primary", bg: "bg-primary/8" },
  ]

  const isEmpty = allExecs.length === 0

  return (
    <div className="space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Execution History</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {isEmpty
              ? "Every API call you make across all agents will appear here."
              : `${formatNumber(totalExecutions)} total execution${totalExecutions !== 1 ? "s" : ""} across all agents.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Primary CTA — Run an agent */}
          <Link href="/marketplace">
            <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
              <Play className="h-4 w-4" /> Run an Agent
            </Button>
          </Link>
          <Link href="/pipelines">
            <Button variant="outline" className="rounded-xl border-zinc-200 gap-2 font-semibold">
              <Cpu className="h-4 w-4" /> Run Pipeline
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {isEmpty && (
        <div className="bg-white border border-zinc-100 rounded-2xl py-20 text-center"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="w-16 h-16 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="h-8 w-8 text-zinc-300" />
          </div>
          <h3 className="font-bold text-zinc-900 mb-2 text-lg">No executions yet</h3>
          <p className="text-sm text-zinc-400 mb-8 max-w-sm mx-auto leading-relaxed">
            Execute an agent or run a pipeline to see results, costs, latency, and token counts here.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/marketplace">
              <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                <Play className="h-4 w-4" /> Try a marketplace agent
              </Button>
            </Link>
            <Link href="/compose">
              <Button variant="outline" className="rounded-xl border-zinc-200 gap-2 font-semibold">
                <Sparkles className="h-4 w-4" /> Compose a workflow
              </Button>
            </Link>
            <Link href="/pipelines">
              <Button variant="outline" className="rounded-xl border-zinc-200 gap-2 font-semibold">
                <Cpu className="h-4 w-4" /> Run a pipeline
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ── Stats strip ───────────────────────────────────────────────────── */}
      {!isEmpty && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STATS.map(s => (
            <div key={s.label}
              className="bg-white border border-zinc-100 rounded-2xl px-4 py-3.5"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <p className={cn("text-xl font-black nums", s.color)}>{s.value}</p>
              <p className="text-xs text-zinc-400 font-medium mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      {!isEmpty && (
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1">
            {FILTER_OPTIONS.map(f => (
              <button key={f.key} onClick={() => { setFilter(f.key); setPage(1) }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  filter === f.key ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900"
                )}>
                {f.label}
                {f.key !== "all" && (
                  <span className="ml-1.5 text-[10px] text-zinc-400 nums">
                    {allExecs.filter(e => e.status === f.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search by agent or ID…"
              className="pl-9 h-9 rounded-xl border-zinc-200 text-sm"
            />
            {search && (
              <button onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <p className="text-xs text-zinc-400 self-center">
            {filtered.length !== allExecs.length
              ? <><span className="font-semibold text-zinc-700 nums">{filtered.length}</span> filtered</>
              : <><span className="font-semibold text-zinc-700 nums">{allExecs.length}</span> total</>}
          </p>
        </div>
      )}

      {/* ── Execution list ─────────────────────────────────────────────────── */}
      {!isEmpty && (
        paginated.length === 0 ? (
          <div className="bg-white border border-zinc-100 rounded-2xl py-14 text-center">
            <p className="font-semibold text-zinc-700 mb-1">No matching executions</p>
            <p className="text-sm text-zinc-400">Try different filters or clear your search.</p>
          </div>
        ) : (
          <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[1fr_130px_90px_90px_90px_36px] gap-4 px-5 py-3 bg-zinc-50 border-b border-zinc-100 text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">
              <span>Agent</span>
              <span>Status</span>
              <span>Latency</span>
              <span>Cost</span>
              <span>Time</span>
              <span />
            </div>

            <div className="divide-y divide-zinc-50">
              {paginated.map((exec, i) => (
                <ExecutionRow key={exec.id} exec={exec} index={i} />
              ))}
            </div>

            {hasMore && (
              <div className="px-5 py-4 border-t border-zinc-50 text-center">
                <button onClick={() => setPage(p => p + 1)}
                  className="text-sm font-semibold text-primary hover:underline flex items-center gap-1.5 mx-auto">
                  Load more
                  <span className="text-zinc-400 font-normal">
                    ({filtered.length - paginated.length} remaining)
                  </span>
                </button>
              </div>
            )}
          </div>
        )
      )}

      {/* ── Quota usage bar ───────────────────────────────────────────────── */}
      {profile && !isEmpty && (
        <div className="bg-white border border-zinc-100 rounded-2xl px-5 py-4"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-zinc-700">Monthly quota</p>
            <p className="text-xs text-zinc-500 nums">
              {formatNumber(profile.executions_used_this_month ?? 0)} / {formatNumber(profile.monthly_execution_quota ?? 100)} calls
            </p>
          </div>
          <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", 
                ((profile.executions_used_this_month ?? 0) / (profile.monthly_execution_quota ?? 100)) > 0.9
                  ? "bg-red-400"
                  : "bg-primary"
              )}
              style={{ width: `${Math.min(((profile.executions_used_this_month ?? 0) / (profile.monthly_execution_quota ?? 100)) * 100, 100)}%` }}
            />
          </div>
          {profile.subscription_plan === "free" && (
            <p className="text-[11px] text-zinc-400 mt-2">
              On the Free plan.{" "}
              <Link href="/billing" className="text-primary font-semibold hover:underline">Upgrade for more →</Link>
            </p>
          )}
        </div>
      )}

      {/* ── Webhook callout ───────────────────────────────────────────────── */}
      {!isEmpty && (
        <div className="bg-zinc-50 border border-zinc-100 rounded-2xl px-5 py-4 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900">Want execution webhooks?</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Receive real-time HTTP POST notifications for every execution event.
            </p>
          </div>
          <Link href="/docs#webhooks">
            <button className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 flex-shrink-0">
              Read docs <ChevronRight className="h-3 w-3" />
            </button>
          </Link>
        </div>
      )}
    </div>
  )
}
