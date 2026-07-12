"use client"

/**
 * Governance & Audit panel \u2014 admin-facing "who ran what, why, and what
 * did it cost" view. This is the UI layer for execution_traces, which
 * existed with a well-designed schema (selected_model, routing_reason,
 * depth_assessment) but had zero write path until routeModel() was wired
 * into the pipeline execute route this session.
 *
 * This is deliberately built and wired into admin-client.tsx in the same
 * pass, not left for later \u2014 that "designed but never connected" gap is
 * what this whole audit kept finding elsewhere in the codebase.
 */

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ShieldCheck, CheckCircle2, XCircle, Clock, DollarSign,
  ChevronDown, RefreshCw,
} from "lucide-react"
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils"

interface Trace {
  id: string; executionId: string; agentId: string; agentName: string
  userId: string; userName: string; model: string; selectedModel: string | null
  routingReason: string | null; depthAssessment: any
  totalMs: number; tokensIn: number; tokensOut: number; costUsd: number
  status: string; errorMessage: string | null; temperature: number | null
  systemPrompt: string | null; userMessage: string | null; assistantReply: string | null
  createdAt: string
}

function KpiMini({ label, value, icon: Icon, color, bg }: { label: string; value: string; icon: any; color: string; bg: string }) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center mb-2", bg)}>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <p className="text-xl font-bold text-zinc-900 tabular-nums">{value}</p>
      <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
    </div>
  )
}

const STATUS_FILTERS = [
  { id: "",       label: "All" },
  { id: "success", label: "Success" },
  { id: "failed",  label: "Failed" },
]

export function GovernancePanel() {
  const [traces,   setTraces]   = useState<Trace[]>([])
  const [stats,    setStats]    = useState<{ totalTracked: number; successRate: number; totalCostUsd: number; avgLatencyMs: number } | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set("status", statusFilter)
      const res  = await fetch(`/api/admin/governance?${params}`)
      const data = await res.json()
      setTraces(data.traces ?? [])
      setStats(data.stats ?? null)
    } catch {
      setTraces([]); setStats(null)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Governance & Audit Trail
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Every execution: which model ran, why it was chosen, cost, and full replay data.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 transition-colors">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini label="Traces Tracked" value={stats ? String(stats.totalTracked) : "\u2014"} icon={ShieldCheck} color="text-primary" bg="bg-primary/8" />
        <KpiMini label="Success Rate"   value={stats ? `${stats.successRate}%` : "\u2014"}    icon={CheckCircle2} color="text-green-600" bg="bg-green-50" />
        <KpiMini label="Total Cost Tracked" value={stats ? formatCurrency(stats.totalCostUsd) : "\u2014"} icon={DollarSign} color="text-amber-600" bg="bg-amber-50" />
        <KpiMini label="Avg Latency"    value={stats ? `${stats.avgLatencyMs}ms` : "\u2014"}   icon={Clock} color="text-blue-600" bg="bg-blue-50" />
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1 w-fit">
        {STATUS_FILTERS.map(f => (
          <button key={f.id} onClick={() => setStatusFilter(f.id)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              statusFilter === f.id ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Trace list */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-zinc-200 border-t-primary rounded-full animate-spin" />
          </div>
        ) : traces.length === 0 ? (
          <div className="text-center py-16">
            <ShieldCheck className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-zinc-500">No execution traces yet</p>
            <p className="text-xs text-zinc-400 mt-1">
              This populates automatically as pipeline executions run. Empty is honest here \u2014
              not a fallback with fabricated numbers.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-50">
            <div className="grid grid-cols-[1fr_1fr_1fr_90px_80px_70px_32px] gap-3 px-5 py-2.5 bg-zinc-50/50">
              {["Agent / User", "Model Routing", "Reason", "Latency", "Cost", "Status", ""].map(h => (
                <p key={h} className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{h}</p>
              ))}
            </div>
            {traces.map(t => {
              const isExpanded = expandedId === t.id
              return (
                <div key={t.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    className="w-full grid grid-cols-[1fr_1fr_1fr_90px_80px_70px_32px] gap-3 px-5 py-3 hover:bg-zinc-50 transition-colors items-center text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-zinc-900 truncate">{t.agentName}</p>
                      <p className="text-[10px] text-zinc-400 truncate">{t.userName} \u00b7 {formatRelativeTime(t.createdAt)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-700 truncate">
                        {t.model}{t.selectedModel && t.selectedModel !== t.model ? ` \u2192 ${t.selectedModel}` : ""}
                      </p>
                      <p className="text-[10px] text-zinc-400">{t.tokensIn ?? 0}in / {t.tokensOut ?? 0}out tok</p>
                    </div>
                    <p className="text-[11px] text-zinc-500 truncate" title={t.routingReason ?? undefined}>
                      {t.routingReason ?? "\u2014"}
                    </p>
                    <p className="text-xs text-zinc-600 tabular-nums">{t.totalMs ?? 0}ms</p>
                    <p className="text-xs text-zinc-600 tabular-nums">{formatCurrency(t.costUsd ?? 0)}</p>
                    <span className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full w-fit",
                      t.status === "success" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                    )}>
                      {t.status === "success" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                      {t.status}
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-zinc-300 transition-transform", isExpanded && "rotate-180")} />
                  </button>

                  {/* Replay expansion \u2014 the actual "can I trust and verify this"
                      surface an enterprise buyer is checking for */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }} className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 bg-zinc-50/50 space-y-3">
                          {t.errorMessage && (
                            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                              <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide mb-0.5">Error</p>
                              <p className="text-xs text-red-700">{t.errorMessage}</p>
                            </div>
                          )}
                          {t.depthAssessment && (
                            <div className="bg-white border border-zinc-100 rounded-xl px-3 py-2">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1">Complexity Assessment</p>
                              <pre className="text-[11px] text-zinc-600 whitespace-pre-wrap font-mono">
                                {JSON.stringify(t.depthAssessment, null, 2)}
                              </pre>
                            </div>
                          )}
                          {t.systemPrompt && (
                            <div className="bg-white border border-zinc-100 rounded-xl px-3 py-2">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1">System Prompt</p>
                              <p className="text-xs text-zinc-600 whitespace-pre-wrap max-h-32 overflow-y-auto">{t.systemPrompt}</p>
                            </div>
                          )}
                          {t.userMessage && (
                            <div className="bg-white border border-zinc-100 rounded-xl px-3 py-2">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1">Input</p>
                              <p className="text-xs text-zinc-600 whitespace-pre-wrap max-h-32 overflow-y-auto">{t.userMessage}</p>
                            </div>
                          )}
                          {t.assistantReply && (
                            <div className="bg-white border border-zinc-100 rounded-xl px-3 py-2">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide mb-1">Output (Replay)</p>
                              <p className="text-xs text-zinc-600 whitespace-pre-wrap max-h-32 overflow-y-auto">{t.assistantReply}</p>
                            </div>
                          )}
                          <p className="text-[10px] text-zinc-400 font-mono">
                            execution_id: {t.executionId} \u00b7 temp: {t.temperature ?? "\u2014"}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
