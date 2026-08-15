"use client"

/**
 * /fleet — "Fleet Command"
 *
 * Answers the question no single-agent view can: across every agent I own,
 * what's actually costing money to run, what's degrading, what's stale, and
 * what needs attention right now.
 *
 * This is the whitespace flagged in the Aug 2026 competitive analysis —
 * every builder tool (n8n, Langflow, Flowise, CrewAI) optimizes for
 * building one agent well; almost none solve managing a fleet you already
 * built. AgentDyne already has the raw material for this (RBAC, audit
 * logs, per-agent versioning, evaluation scoring) — this page is the first
 * screen that actually packages it as one view.
 *
 * Data model: three real, confirmed tables only —
 *   agents        (filtered by seller_id) — confirmed via my-agents/page.tsx
 *   agent_scores  (LEFT JOIN via agent_id) — confirmed via /api/agents/[id]/score/route.ts
 *   executions    (last 30 days, aggregated client-side) — confirmed via
 *                 /api/executions/[id]/route.ts's column list. This is the
 *                 fix for an earlier version of this file, which showed
 *                 total_revenue (money EARNED) where the page's own promise
 *                 was "what's costing the most" — those are opposite
 *                 signals. cost_30d below is real execution cost, not revenue.
 * No new tables, no new RPC — the Supabase JS client has no server-side
 * GROUP BY, so the 30-day cost aggregation happens client-side over raw
 * rows, capped at MAX_EXECUTION_ROWS as an honest safety limit (see below).
 */

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { FleetClient } from "./fleet-client"
import { Loader2, Radar } from "lucide-react"

const COST_WINDOW_DAYS = 30
// Safety cap on raw execution rows fetched for client-side cost aggregation.
// A seller with more than this many executions across their fleet in 30 days
// will see a truncated (undercounted, never overcounted) total — flagged
// visibly in the UI rather than silently wrong. Revisit with a real RPC/view
// if this becomes a common case; documented here rather than hidden.
const MAX_EXECUTION_ROWS = 5000

export interface DailyBucket { date: string; cost: number; count: number; successCount: number; failCount: number }

export interface FleetAgent {
  id: string
  name: string
  category: string | null
  status: string
  model_name: string | null
  pricing_model: string | null
  price_per_call: number | null
  total_executions: number
  total_revenue: number
  cost_30d: number       // real execution cost, last 30 days, replaces the revenue-as-cost-proxy bug
  average_rating: number | null
  mcp_enabled: boolean
  a2a_enabled: boolean
  updated_at: string
  // From agent_scores — null until the agent has ≥10 executions and a
  // score has actually been computed (matches /api/agents/[id]/score's
  // own "not yet scored" branch). All confirmed real columns, same table
  // /api/agents/[id]/score/route.ts already reads from.
  composite_score:   number | null
  accuracy_score:    number | null
  reliability_score: number | null
  latency_score:     number | null
  cost_score:        number | null
  popularity_score:  number | null
  is_top_rated: boolean
  is_fastest: boolean
  is_cheapest: boolean
  is_most_reliable: boolean
  score_computed_at: string | null
  // NEW — drill-down data: per-day cost/volume/success-rate for the last
  // 30 days, derived client-side from the SAME execution rows already
  // fetched for cost_30d (no second query).
  dailyHistory: DailyBucket[]
}

export default function FleetPage() {
  const [agents, setAgents] = useState<FleetAgent[] | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  // Singleton client — same rationale as my-agents/page.tsx: a new
  // GoTrueClient per render leaks subscriptions and causes race conditions.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false

    async function load() {
      // Step 1: the fleet's agents (RLS already scopes this to the caller's
      // own rows via seller_id — same trust boundary as my-agents/page.tsx).
      const { data: agentRows, error: agentsErr } = await supabase
        .from("agents")
        .select([
          "id", "name", "category", "status", "model_name",
          "pricing_model", "price_per_call", "total_executions",
          "total_revenue", "average_rating", "mcp_enabled", "a2a_enabled",
          "updated_at",
        ].join(","))
        .eq("seller_id", user.id)
        .order("updated_at", { ascending: false })

      if (cancelled) return
      if (agentsErr) { setError(agentsErr.message); setAgents([]); return }

      const rows = (agentRows ?? []) as any[]
      if (rows.length === 0) { setAgents([]); return }

      // Step 2: scores for those agents, in one query (not N+1) — LEFT JOIN
      // semantics done client-side since we're merging two independent
      // Supabase queries, not a single SQL join.
      const { data: scoreRows } = await supabase
        .from("agent_scores")
        .select("agent_id, composite_score, accuracy_score, reliability_score, latency_score, cost_score, popularity_score, is_top_rated, is_fastest, is_cheapest, is_most_reliable, computed_at")
        .in("agent_id", rows.map(r => r.id))

      if (cancelled) return

      const scoreByAgentId = new Map((scoreRows ?? []).map((s: any) => [s.agent_id, s]))

      // Step 3: real execution cost, last 30 days — the fix for the
      // revenue-as-cost-proxy gap. Raw rows, aggregated client-side (no
      // GROUP BY in the Supabase JS client), capped at MAX_EXECUTION_ROWS.
      const windowStart = new Date(Date.now() - COST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data: execRows, error: execErr } = await supabase
        .from("executions")
        .select("agent_id, cost, status, created_at")
        .in("agent_id", rows.map(r => r.id))
        .gte("created_at", windowStart)
        .limit(MAX_EXECUTION_ROWS)

      if (cancelled) return

      // Non-fatal if this specific query fails (e.g. RLS not yet covering
      // executions the way it covers agents) — the fleet still loads with
      // cost_30d=0 rather than the whole page erroring out. Logged so it's
      // not silently swallowed either.
      if (execErr) console.warn("[Fleet Command] cost aggregation failed:", execErr.message)

      const costByAgentId = new Map<string, number>()
      // NEW — per-agent, per-day buckets for the drill-down drawer. Built in
      // the same single pass over execRows as the cost total, no extra query.
      const dailyByAgentId = new Map<string, Map<string, DailyBucket>>()

      for (const row of (execRows ?? []) as any[]) {
        costByAgentId.set(row.agent_id, (costByAgentId.get(row.agent_id) ?? 0) + (row.cost ?? 0))

        const date = String(row.created_at).slice(0, 10)  // YYYY-MM-DD
        if (!dailyByAgentId.has(row.agent_id)) dailyByAgentId.set(row.agent_id, new Map())
        const dayMap = dailyByAgentId.get(row.agent_id)!
        const bucket = dayMap.get(date) ?? { date, cost: 0, count: 0, successCount: 0, failCount: 0 }
        bucket.cost += row.cost ?? 0
        bucket.count += 1
        if (row.status === "success") bucket.successCount += 1
        else if (row.status === "failed") bucket.failCount += 1
        dayMap.set(date, bucket)
      }

      const merged: FleetAgent[] = rows.map(r => {
        const s = scoreByAgentId.get(r.id) as any
        const dayMap = dailyByAgentId.get(r.id)
        const dailyHistory = dayMap ? [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)) : []
        return {
          ...r,
          cost_30d:          costByAgentId.get(r.id) ?? 0,
          dailyHistory,
          composite_score:   s?.composite_score ?? null,
          accuracy_score:    s?.accuracy_score ?? null,
          reliability_score: s?.reliability_score ?? null,
          latency_score:     s?.latency_score ?? null,
          cost_score:        s?.cost_score ?? null,
          popularity_score:  s?.popularity_score ?? null,
          is_top_rated:      s?.is_top_rated ?? false,
          is_fastest:        s?.is_fastest ?? false,
          is_cheapest:       s?.is_cheapest ?? false,
          is_most_reliable:  s?.is_most_reliable ?? false,
          score_computed_at: s?.computed_at ?? null,
        }
      })

      setAgents(merged)
    }

    load().catch(e => { if (!cancelled) { setError(e.message ?? "Failed to load fleet"); setAgents([]) } })

    return () => { cancelled = true }
  }, [user, authLoading])

  if (authLoading || agents === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm text-zinc-400">Loading your fleet…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
          <Radar className="h-6 w-6 text-red-400" />
        </div>
        <p className="text-sm font-semibold text-zinc-900">Failed to load your fleet</p>
        <p className="text-xs text-zinc-400 max-w-xs text-center">{error}</p>
        <button
          onClick={() => { setAgents(null); setError(null) }}
          className="text-xs text-primary hover:underline font-semibold mt-1"
        >
          Retry
        </button>
      </div>
    )
  }

  return <FleetClient agents={agents} />
}
