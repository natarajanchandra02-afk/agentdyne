"use client"

/**
 * fleet-agent-drawer.tsx — Fleet Command drill-down
 *
 * Opens as a slide-over when a row's "quick view" is clicked — lets a
 * seller see cost/quality detail for one agent WITHOUT leaving Fleet
 * Command (the row's name still links to the full /builder editor for
 * actual editing; this is read-only detail, purpose-built for triage).
 *
 * All data was already fetched by page.tsx as part of the same three
 * queries the rest of Fleet Command uses (agents / agent_scores /
 * executions) — this component adds zero new network requests.
 */

import { useMemo } from "react"
import Link from "next/link"
import { X, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { MODEL_LABELS } from "@/lib/constants"
import type { FleetAgent } from "./page"

const SUB_SCORES: Array<{ key: keyof FleetAgent; label: string }> = [
  { key: "accuracy_score",    label: "Accuracy"    },
  { key: "reliability_score", label: "Reliability" },
  { key: "latency_score",     label: "Latency"     },
  { key: "cost_score",        label: "Cost"        },
  { key: "popularity_score",  label: "Popularity"  },
]

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-500 font-medium">{label}</span>
        <span className="text-zinc-900 font-semibold">{value !== null ? Math.round(value) : "—"}</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", value === null ? "bg-transparent" : value >= 70 ? "bg-green-400" : value >= 40 ? "bg-amber-400" : "bg-red-400")}
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  )
}

export function FleetAgentDrawer({ agent, onClose }: { agent: FleetAgent; onClose: () => void }) {
  const maxDailyCost = useMemo(
    () => Math.max(0.0001, ...agent.dailyHistory.map(d => d.cost)),
    [agent.dailyHistory],
  )

  const trend = useMemo(() => {
    if (agent.dailyHistory.length < 4) return null
    const mid = Math.floor(agent.dailyHistory.length / 2)
    const firstHalf  = agent.dailyHistory.slice(0, mid).reduce((s, d) => s + d.cost, 0)
    const secondHalf = agent.dailyHistory.slice(mid).reduce((s, d) => s + d.cost, 0)
    if (firstHalf === 0 && secondHalf === 0) return "flat" as const
    if (secondHalf > firstHalf * 1.15) return "up" as const
    if (secondHalf < firstHalf * 0.85) return "down" as const
    return "flat" as const
  }, [agent.dailyHistory])

  const totalRuns    = agent.dailyHistory.reduce((s, d) => s + d.count, 0)
  const totalSuccess = agent.dailyHistory.reduce((s, d) => s + d.successCount, 0)
  const successRate  = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[380px] bg-white border-l border-zinc-100 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-900 truncate">{agent.name}</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {agent.model_name ? (MODEL_LABELS[agent.model_name] ?? agent.model_name) : "No model set"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Cost trend, last 30 days */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Daily cost — 30 days</p>
              {trend && (
                <span className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold",
                  trend === "up" ? "text-red-500" : trend === "down" ? "text-green-500" : "text-zinc-400"
                )}>
                  {trend === "up" && <TrendingUp className="h-3 w-3" />}
                  {trend === "down" && <TrendingDown className="h-3 w-3" />}
                  {trend === "flat" && <Minus className="h-3 w-3" />}
                  {trend === "up" ? "Rising" : trend === "down" ? "Falling" : "Steady"}
                </span>
              )}
            </div>
            {agent.dailyHistory.length === 0 ? (
              <p className="text-xs text-zinc-400 py-6 text-center bg-zinc-50 rounded-xl">No executions in the last 30 days</p>
            ) : (
              <div className="flex items-end gap-0.5 h-16 bg-zinc-50 rounded-xl p-2">
                {agent.dailyHistory.map(d => (
                  <div
                    key={d.date}
                    title={`${d.date}: $${d.cost.toFixed(4)} · ${d.count} run${d.count === 1 ? "" : "s"}`}
                    className="flex-1 bg-primary/60 hover:bg-primary rounded-sm transition-colors min-h-[2px]"
                    style={{ height: `${Math.max(4, (d.cost / maxDailyCost) * 100)}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Run stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-zinc-900">{totalRuns}</p>
              <p className="text-[10px] text-zinc-400">runs (30d)</p>
            </div>
            <div className="bg-zinc-50 rounded-xl p-3 text-center">
              <p className={cn("text-lg font-bold", successRate === null ? "text-zinc-300" : successRate >= 90 ? "text-green-600" : successRate >= 70 ? "text-amber-600" : "text-red-600")}>
                {successRate !== null ? `${successRate}%` : "—"}
              </p>
              <p className="text-[10px] text-zinc-400">success rate</p>
            </div>
            <div className="bg-zinc-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-zinc-900">${(agent.cost_30d ?? 0).toFixed(4)}</p>
              <p className="text-[10px] text-zinc-400">total cost</p>
            </div>
          </div>

          {/* Quality sub-scores */}
          <div>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Quality breakdown</p>
            {agent.composite_score === null ? (
              <p className="text-xs text-zinc-400 py-3 text-center bg-zinc-50 rounded-xl">
                Not enough executions yet to compute a score
              </p>
            ) : (
              <div className="space-y-2.5">
                {SUB_SCORES.map(({ key, label }) => (
                  <ScoreBar key={key} label={label} value={agent[key] as number | null} />
                ))}
              </div>
            )}
            {(agent.is_top_rated || agent.is_fastest || agent.is_cheapest || agent.is_most_reliable) && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {agent.is_top_rated     && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200">Top rated</span>}
                {agent.is_fastest       && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">Fastest</span>}
                {agent.is_cheapest      && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">Cheapest</span>}
                {agent.is_most_reliable && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">Most reliable</span>}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-100 flex-shrink-0">
          <Link
            href={`/builder/${agent.id}`}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl py-2.5 transition-colors"
          >
            Open in Builder <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </>
  )
}
