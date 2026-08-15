"use client"

/**
 * fleet-client.tsx — Fleet Command UI
 *
 * Three things a single-agent view can never show at once:
 *   1. Summary strip   — fleet-wide totals at a glance
 *   2. Needs Attention  — the triage list: stale, unscored, low-grade agents
 *   3. Full fleet table — everything, sortable by what's actually costing you
 *
 * Design language matches the rest of the dashboard exactly: rounded-2xl
 * white cards, zinc-100 borders, primary accent — no new visual system
 * introduced, this should feel like it's always been part of the product.
 */

import { useMemo, useState, useCallback } from "react"
import Link from "next/link"
import {
  Radar, TrendingUp, DollarSign, Zap, AlertTriangle, Clock,
  ArrowUpRight, Network, Share2, CheckCircle2, Cpu, Download, X, Check, Eye,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SUPPORTED_MODELS, MODEL_LABELS } from "@/lib/constants"
import { FleetAgentDrawer } from "./fleet-agent-drawer"
import type { FleetAgent } from "./page"

const STALE_DAYS = 90

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

function modelDeprecated(agent: FleetAgent): boolean {
  return agent.status === "active" && !!agent.model_name && !(SUPPORTED_MODELS as readonly string[]).includes(agent.model_name)
}

/**
 * Bulk action: CSV export. Deliberately the only bulk action shipped this
 * pass — archiving/pausing agents needs a real status-mutation endpoint
 * that doesn't exist yet (the only PATCH routes found update capability_tags
 * or builder-form fields, never `status`; that transition is gated by
 * eval-harness logic not fully mapped in this session). Guessing at a
 * shortcut around agent status risks corrupting the eval-gate flow, so it's
 * not built rather than built wrong. Export is pure client-side, zero
 * mutation risk, and genuinely useful on its own (spreadsheet/board-deck use).
 */
function exportAgentsToCsv(agents: FleetAgent[]) {
  const headers = ["Name", "Status", "Model", "Category", "Executions", "Cost (30d USD)", "Revenue (USD)", "Quality Score", "Last Updated"]
  const escapeCsv = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const rows = agents.map(a => [
    a.name,
    a.status,
    a.model_name ?? "",
    a.category ?? "",
    String(a.total_executions),
    (a.cost_30d ?? 0).toFixed(4),
    (a.total_revenue ?? 0).toFixed(2),
    a.composite_score !== null ? String(a.composite_score) : "",
    new Date(a.updated_at).toISOString().slice(0, 10),
  ].map(escapeCsv).join(","))
  const csv = [headers.join(","), ...rows].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement("a")
  a.href = url
  a.download = `agentdyne-fleet-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function gradeFromScore(score: number | null): { label: string; color: string; bg: string } {
  if (score === null) return { label: "—", color: "text-zinc-400", bg: "bg-zinc-50" }
  if (score >= 90) return { label: "S", color: "text-violet-600", bg: "bg-violet-50" }
  if (score >= 80) return { label: "A", color: "text-green-600",  bg: "bg-green-50"  }
  if (score >= 70) return { label: "B", color: "text-blue-600",   bg: "bg-blue-50"   }
  if (score >= 60) return { label: "C", color: "text-amber-600",  bg: "bg-amber-50"  }
  if (score >= 40) return { label: "D", color: "text-orange-600", bg: "bg-orange-50" }
  return { label: "F", color: "text-red-600", bg: "bg-red-50" }
}

function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: any; label: string; value: string; sub?: string; accent: string
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center gap-2.5 mb-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", accent)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-zinc-900">{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1">{sub}</p>}
    </div>
  )
}

type AttentionReason = "stale" | "unscored" | "low_grade" | "rejected" | "deprecated_model"

function attentionReasons(agent: FleetAgent): AttentionReason[] {
  const reasons: AttentionReason[] = []
  if (agent.status === "active" && daysAgo(agent.updated_at) > STALE_DAYS) reasons.push("stale")
  if (agent.status === "active" && agent.total_executions >= 10 && agent.composite_score === null) reasons.push("unscored")
  if (agent.composite_score !== null && agent.composite_score < 60) reasons.push("low_grade")
  // Only `rejected` is a real problem worth surfacing here. `draft` and
  // `pending_review` are normal, expected, non-urgent states — flagging
  // every unfinished agent as "needs attention" would make this list noisy
  // and train users to ignore it, which defeats the point of a triage view.
  if (agent.status === "rejected") reasons.push("rejected")
  // Grounded in SUPPORTED_MODELS (constants.ts) — the exact same list
  // /api/agents/[id]/save validates new model_name values against server-side.
  // An agent whose model_name isn't in that list was saved under an older
  // supported-models set and is running on something the platform no longer
  // actively routes to — not necessarily broken, but worth a look.
  if (agent.status === "active" && modelDeprecated(agent)) {
    reasons.push("deprecated_model")
  }
  return reasons
}

const REASON_COPY: Record<AttentionReason, { label: string; tone: string }> = {
  stale:            { label: "No updates in 90+ days",            tone: "text-amber-600 bg-amber-50 border-amber-200" },
  unscored:         { label: "Eligible for scoring, not yet run", tone: "text-blue-600 bg-blue-50 border-blue-200" },
  low_grade:        { label: "Quality score below 60",             tone: "text-red-600 bg-red-50 border-red-200" },
  rejected:         { label: "Rejected — needs revision",          tone: "text-red-600 bg-red-50 border-red-200" },
  deprecated_model: { label: "Using an unsupported model",         tone: "text-orange-600 bg-orange-50 border-orange-200" },
}

export function FleetClient({ agents }: { agents: FleetAgent[] }) {
  const [sortKey, setSortKey] = useState<"updated" | "cost" | "revenue" | "executions" | "score">("updated")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null)

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const totals = useMemo(() => {
    const live = agents.filter(a => a.status === "active")
    return {
      count:        agents.length,
      liveCount:    live.length,
      totalRevenue: agents.reduce((sum, a) => sum + (a.total_revenue ?? 0), 0),
      totalCost30d: agents.reduce((sum, a) => sum + (a.cost_30d ?? 0), 0),
      totalExecs:   agents.reduce((sum, a) => sum + (a.total_executions ?? 0), 0),
      avgScore: (() => {
        const scored = agents.filter(a => a.composite_score !== null)
        if (scored.length === 0) return null
        return Math.round(scored.reduce((s, a) => s + (a.composite_score ?? 0), 0) / scored.length)
      })(),
      protocolExposed: agents.filter(a => a.mcp_enabled || a.a2a_enabled).length,
    }
  }, [agents])

  const needsAttention = useMemo(
    () => agents
      .map(a => ({ agent: a, reasons: attentionReasons(a) }))
      .filter(x => x.reasons.length > 0)
      .sort((a, b) => b.reasons.length - a.reasons.length),
    [agents],
  )

  const sorted = useMemo(() => {
    const copy = [...agents]
    switch (sortKey) {
      case "cost":        return copy.sort((a, b) => (b.cost_30d ?? 0) - (a.cost_30d ?? 0))
      case "revenue":    return copy.sort((a, b) => (b.total_revenue ?? 0) - (a.total_revenue ?? 0))
      case "executions":  return copy.sort((a, b) => (b.total_executions ?? 0) - (a.total_executions ?? 0))
      case "score":      return copy.sort((a, b) => (b.composite_score ?? -1) - (a.composite_score ?? -1))
      default:           return copy.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    }
  }, [agents, sortKey])

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center">
        <div className="w-14 h-14 rounded-2xl bg-zinc-50 flex items-center justify-center">
          <Radar className="h-7 w-7 text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-900">No agents in your fleet yet</p>
        <p className="text-xs text-zinc-400 max-w-xs">
          Fleet Command tracks every agent you own in one view once you've built at least one.
        </p>
        <Link href="/builder" className="text-xs text-primary hover:underline font-semibold mt-1">
          Build your first agent →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900">Fleet Command</h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">New</span>
          </div>
          <p className="text-sm text-zinc-400 mt-0.5">Every agent you own, one view — cost, quality, and what needs attention.</p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard icon={Zap}         label="Agents"       value={String(totals.count)}   sub={`${totals.liveCount} live`}             accent="bg-indigo-50 text-indigo-600" />
        <StatCard icon={DollarSign}  label="Revenue"      value={"$" + totals.totalRevenue.toFixed(2)}                                    accent="bg-green-50 text-green-600" />
        <StatCard icon={DollarSign}  label="Cost (30d)"   value={"$" + totals.totalCost30d.toFixed(4)} sub="Actual execution cost"        accent="bg-red-50 text-red-500" />
        <StatCard icon={TrendingUp}  label="Executions"   value={totals.totalExecs.toLocaleString()}                                       accent="bg-blue-50 text-blue-600" />
        <StatCard icon={CheckCircle2} label="Avg Quality" value={totals.avgScore !== null ? String(totals.avgScore) : "—"} sub={totals.avgScore === null ? "Not enough data yet" : gradeFromScore(totals.avgScore).label} accent="bg-violet-50 text-violet-600" />
        <StatCard icon={Network}     label="Protocol-exposed" value={String(totals.protocolExposed)} sub="MCP / A2A enabled"                accent="bg-amber-50 text-amber-600" />
      </div>

      {/* Needs Attention */}
      {needsAttention.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center gap-2 px-5 py-4 border-b border-zinc-50">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <p className="font-bold text-zinc-900 text-sm">Needs Attention</p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
              {needsAttention.length}
            </span>
          </div>
          <div className="divide-y divide-zinc-50">
            {needsAttention.slice(0, 8).map(({ agent, reasons }) => (
              <Link
                key={agent.id}
                href={`/builder/${agent.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-zinc-50/60 transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {reasons.map(r => (
                      <span key={r} className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border", REASON_COPY[r].tone)}>
                        {REASON_COPY[r].label}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-zinc-300 group-hover:text-primary transition-colors flex-shrink-0 ml-3" />
              </Link>
            ))}
          </div>
          {needsAttention.length > 8 && (
            <div className="px-5 py-2.5 text-[11px] text-zinc-400 border-t border-zinc-50">
              +{needsAttention.length - 8} more
            </div>
          )}
        </div>
      )}

      {/* Full fleet table */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-50">
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-3">
              <p className="font-bold text-zinc-900 text-sm">{selectedIds.size} selected</p>
              <button
                onClick={() => exportAgentsToCsv(agents.filter(a => selectedIds.has(a.id)))}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded-lg transition-colors"
              >
                <Download className="h-3 w-3" /> Export CSV
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-700 px-1.5 py-1 rounded-lg transition-colors"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="font-bold text-zinc-900 text-sm">All Agents</p>
              <button
                onClick={() => exportAgentsToCsv(agents)}
                className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-primary transition-colors"
                title="Export entire fleet as CSV"
              >
                <Download className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-1 bg-zinc-50 rounded-lg p-0.5">
            {([
              ["updated", "Recent"], ["cost", "Cost"], ["revenue", "Revenue"], ["executions", "Volume"], ["score", "Quality"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                  sortKey === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-zinc-50">
          {sorted.map(agent => {
            const grade = gradeFromScore(agent.composite_score)
            const stale = agent.status === "active" && daysAgo(agent.updated_at) > STALE_DAYS
            const isSelected = selectedIds.has(agent.id)
            return (
              <div
                key={agent.id}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-zinc-50/60 transition-colors group"
              >
                <button
                  onClick={(e) => { e.preventDefault(); toggleSelect(agent.id) }}
                  className={cn(
                    "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors",
                    isSelected ? "bg-primary border-primary" : "border-zinc-200 hover:border-zinc-400"
                  )}
                  aria-label={isSelected ? `Deselect ${agent.name}` : `Select ${agent.name}`}
                >
                  {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                </button>

                <Link href={`/builder/${agent.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm", grade.bg, grade.color)}>
                  {grade.label}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                    {agent.status !== "active" && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 flex-shrink-0">
                        {agent.status}
                      </span>
                    )}
                    {(agent.mcp_enabled || agent.a2a_enabled) && (
                      <span title="Protocol-exposed (MCP/A2A)" className="flex-shrink-0">
                        <Share2 className="h-3 w-3 text-indigo-400" />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Cpu className="h-3 w-3 text-zinc-300 flex-shrink-0" />
                    <p className={cn("text-xs truncate", modelDeprecated(agent) ? "text-orange-500 font-medium" : "text-zinc-400")}>
                      {agent.model_name ? (MODEL_LABELS[agent.model_name] ?? agent.model_name) : "—"}
                    </p>
                    <span className="text-xs text-zinc-300">·</span>
                    <p className="text-xs text-zinc-400 truncate">{agent.category ?? "uncategorized"}</p>
                  </div>
                </div>

                <div className="hidden sm:flex items-center gap-6 flex-shrink-0 text-right">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">{agent.total_executions.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-400">executions</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-500">${(agent.cost_30d ?? 0).toFixed(4)}</p>
                    <p className="text-[10px] text-zinc-400">cost (30d)</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">${(agent.total_revenue ?? 0).toFixed(2)}</p>
                    <p className="text-[10px] text-zinc-400">revenue</p>
                  </div>
                  <div className="w-24">
                    <p className={cn("text-xs font-medium flex items-center justify-end gap-1", stale ? "text-amber-600" : "text-zinc-400")}>
                      {stale && <Clock className="h-3 w-3" />}
                      {daysAgo(agent.updated_at)}d ago
                    </p>
                  </div>
                </div>

                <ArrowUpRight className="h-4 w-4 text-zinc-300 group-hover:text-primary transition-colors flex-shrink-0" />
                </Link>

                <button
                  onClick={() => setDrawerAgentId(agent.id)}
                  className="p-1.5 rounded-lg text-zinc-300 hover:text-primary hover:bg-primary/5 transition-colors flex-shrink-0"
                  aria-label={`Quick view ${agent.name}`}
                  title="Quick view"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {drawerAgentId && (() => {
        const drawerAgent = agents.find(a => a.id === drawerAgentId)
        return drawerAgent ? (
          <FleetAgentDrawer agent={drawerAgent} onClose={() => setDrawerAgentId(null)} />
        ) : null
      })()}
    </div>
  )
}
