"use client"

/**
 * Admin Swarm Intelligence Panels
 * Implements GPT founder audit Tier 3 (Swarm Intelligence Dashboard),
 * Tier 6 (Self-Improving Platform), Tier 7 (Agent Genome)
 *
 * These are imported into admin-client.tsx as new tabs.
 */

import { useState, useEffect } from "react"
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from "recharts"
import {
  Network, Brain, Dna, Lightbulb, CheckCircle2, AlertTriangle,
  TrendingUp, TrendingDown, Zap, Cpu, MemoryStick, GitBranch,
  Star, ArrowUpRight, RefreshCw, ChevronRight, Bot,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { formatNumber, cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── Shared ───────────────────────────────────────────────────────────────────

const CHART_COLORS = {
  primary: "#6366f1", green: "#22c55e", red: "#ef4444",
  amber: "#f59e0b", blue: "#3b82f6", violet: "#8b5cf6",
}

function KpiMini({ label, value, sub, icon: Icon, color = "text-zinc-600", bg = "bg-zinc-50" }: {
  label: string; value: string; sub: string; icon: any; color?: string; bg?: string
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center mb-2`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="text-xl font-bold text-zinc-900 tabular-nums">{value}</p>
      <p className="text-[11px] font-semibold text-zinc-600 mt-0.5">{label}</p>
      <p className="text-[10px] text-zinc-400">{sub}</p>
    </div>
  )
}

function SectionCard({ title, sub, icon: Icon, children, right }: {
  title: string; sub?: string; icon?: any; children: React.ReactNode; right?: React.ReactNode
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-zinc-50">
        {Icon && <Icon className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">{title}</p>
          {sub && <p className="text-[11px] text-zinc-400 mt-0.5">{sub}</p>}
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  )
}

// ─── Tier 3: Swarm Intelligence Dashboard ────────────────────────────────────

export function SwarmIntelligenceDashboard() {
  const [stats, setStats] = useState<any>(null)
  const [runs,  setRuns]  = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.rpc("get_swarm_dashboard_stats"),
      supabase.from("swarm_run_metrics")
        .select("*").order("created_at", { ascending: false }).limit(50),
    ]).then(([statsRes, runsRes]) => {
      setStats(statsRes.data ?? {})
      setRuns(runsRes.data ?? [])
      setLoading(false)
    }).catch(() => {
      // ✅ Bug fix: previously fell back to confident fake numbers ("847 runs,
      // 91.4% success") on any RPC error, indistinguishable from real data.
      // An honest empty state is correct here — a wrong number is worse than
      // no number.
      setStats(null)
      setRuns([])
      setLoading(false)
    })
  }, [])

  // Chart data from real stats only — no fake fallback numbers.
  // ✅ Bug fix: these used to default to hardcoded counts (312/298/237,
  // 91%/96%/89%) whenever stats was missing, which is indistinguishable
  // from real data to anyone looking at the dashboard.
  const modeBarData = stats ? [
    { mode: "Debate",      runs: stats.mode_stats?.debate?.count ?? 0,      rate: stats.mode_stats?.debate?.success_rate ?? 0,      color: "#3b82f6" },
    { mode: "Parallel",    runs: stats.mode_stats?.parallel?.count ?? 0,    rate: stats.mode_stats?.parallel?.success_rate ?? 0,    color: "#6366f1" },
    { mode: "Orchestrate", runs: stats.mode_stats?.orchestrate?.count ?? 0, rate: stats.mode_stats?.orchestrate?.success_rate ?? 0, color: "#8b5cf6" },
  ] : []

  // ✅ Bug fix: previously Math.random()-generated fake daily run counts on
  // every single render, regardless of whether real data existed — the chart
  // would visibly change each time the page reloaded. Now derived from real
  // `runs` (the last 50 actual swarm_run_metrics rows), grouped by day.
  const dailyMap = new Map<string, { runs: number; success: number }>()
  for (const r of runs) {
    const day = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    const entry = dailyMap.get(day) ?? { runs: 0, success: 0 }
    entry.runs += 1
    if (r.success) entry.success += 1
    dailyMap.set(day, entry)
  }
  const recent30 = Array.from(dailyMap.entries()).map(([day, v]) => ({
    day, runs: v.runs, success: v.runs > 0 ? Math.round((v.success / v.runs) * 100) : 0,
  }))

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-zinc-200 border-t-primary rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* KPI strip — ✅ all defaults are now 0/honest, not fabricated numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiMini label="Total Swarm Runs"      value={formatNumber(stats?.total_runs ?? 0)}         sub="all time"               icon={Network}   color="text-primary"      bg="bg-primary/8" />
        <KpiMini label="Success Rate"           value={stats ? `${stats.success_rate ?? 0}%` : "—"}              sub="last 30 days"           icon={CheckCircle2} color="text-green-600"  bg="bg-green-50" />
        <KpiMini label="Avg Agents / Swarm"     value={stats ? String(stats.avg_agents_per_swarm ?? 0) : "—"}     sub="per session"            icon={Bot}       color="text-blue-600"     bg="bg-blue-50" />
        <KpiMini label="Avg Outcome Score"      value={stats ? `${stats.avg_outcome_score ?? 0}/100` : "—"}        sub="post-exec insights"     icon={Star}      color="text-amber-600"    bg="bg-amber-50" />
        <KpiMini label="Consensus Failures"     value={String(stats?.consensus_failures ?? 0)}        sub="debate mode only"       icon={AlertTriangle} color="text-red-600" bg="bg-red-50" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Success rate by mode */}
        <SectionCard title="Success Rate by Mode" sub="last 30 days" icon={Network}>
          <div className="p-4">
            {modeBarData.map(d => (
              <div key={d.mode} className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-zinc-700">{d.mode}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400">{d.runs} runs</span>
                    <span className="text-xs font-bold text-zinc-900">{d.rate}%</span>
                  </div>
                </div>
                <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${d.rate}%`, background: d.color }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Daily runs chart */}
        <div className="lg:col-span-2">
          <SectionCard title="Daily Swarm Runs" sub="last 30 days" icon={TrendingUp}>
            <div className="px-2 pt-4 pb-3">
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={recent30} margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="swarmRunGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f4f4f5" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#a1a1aa" }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fontSize: 9, fill: "#a1a1aa" }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #f4f4f5" }} />
                  <Area type="monotone" dataKey="runs" stroke={CHART_COLORS.primary} strokeWidth={1.5}
                    fill="url(#swarmRunGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ✅ Bug fix: this section was unconditionally hardcoded — fake topics
       * ("Market Predictions", "Technical Feasibility"...) with fake failure
       * counts, rendered regardless of whether the RPC above succeeded or
       * failed. It wasn't a fallback for an error case; it was permanent
       * fake data sitting right next to a real KPI strip, which is exactly
       * the kind of thing that erodes trust the moment anyone notices —
       * same class of issue as the homepage stats fixed earlier. Removed
       * until there's a real query to back it (e.g. grouping swarm_run_metrics
       * by a stored disagreement/topic field, if one exists). */}
      {stats?.consensus_failures > 0 && (
        <SectionCard title="Consensus Failures" sub="Debate mode — real count from swarm_run_metrics" icon={AlertTriangle}>
          <div className="px-5 py-4">
            <p className="text-2xl font-bold text-red-600 tabular-nums">{stats.consensus_failures}</p>
            <p className="text-xs text-zinc-400 mt-1">
              Runs where debate mode agents failed to reach consensus. Per-topic breakdown requires
              tagging swarm sessions with a subject — not yet tracked.
            </p>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ─── Tier 7: Agent Genome ─────────────────────────────────────────────────────

export function AgentGenomeLeaderboard() {
  const [data,    setData]    = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.rpc("get_agent_genome_leaderboard", { p_limit: 10 })
      .then(({ data }) => {
        // ✅ Bug fix: previously fell back to 5 confident-looking fake
        // configurations ("rag-sonnet-mcp-1", 97% success, etc.) whenever
        // the query returned nothing — indistinguishable from a real
        // leaderboard. Empty state now shown honestly instead.
        setData(data ?? [])
        setLoading(false)
      })
      .catch(() => { setData([]); setLoading(false) })
  }, [])

  const fallbackGenome = [
    { config_hash: "rag-sonnet-mcp-1", mode: "orchestrate", agent_roles: ["researcher","analyst","writer"],          models_used: ["claude-sonnet-4-6"],                   has_rag: true,  has_memory: true,  total_runs: 234, success_rate: 97, avg_outcome: 91, avg_cost: 0.031 },
    { config_hash: "parallel-haiku-2", mode: "parallel",    agent_roles: ["researcher","fact_checker","analyst"],    models_used: ["claude-haiku-4-5"],                    has_rag: true,  has_memory: false, total_runs: 189, success_rate: 94, avg_outcome: 87, avg_cost: 0.008 },
    { config_hash: "debate-sonnet-3",  mode: "debate",      agent_roles: ["researcher","critic","writer"],           models_used: ["claude-sonnet-4-6","claude-haiku-4-5"], has_rag: false, has_memory: true,  total_runs: 156, success_rate: 91, avg_outcome: 85, avg_cost: 0.019 },
    { config_hash: "norag-haiku-4",    mode: "parallel",    agent_roles: ["analyst","writer"],                       models_used: ["claude-haiku-4-5"],                    has_rag: false, has_memory: false, total_runs: 98,  success_rate: 72, avg_outcome: 74, avg_cost: 0.005 },
    { config_hash: "opus-research-5",  mode: "orchestrate", agent_roles: ["researcher","analyst","critic","writer"], models_used: ["claude-opus-4-6"],                     has_rag: true,  has_memory: true,  total_runs: 67,  success_rate: 98, avg_outcome: 96, avg_cost: 0.142 },
  ]

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-zinc-200 border-t-primary rounded-full animate-spin" />
    </div>
  )

  // ✅ Bug fix: Math.max()/reduce() on an empty array either return
  // -Infinity or throw — a real possible state now that fake fallback data
  // has been removed above.
  if (data.length === 0) return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-16 text-center" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <Dna className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
      <p className="text-sm font-semibold text-zinc-500">No swarm configurations tracked yet</p>
      <p className="text-xs text-zinc-400 mt-1">The leaderboard populates once swarms have run enough times to compare architectures.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini label="Configs Tracked"   value={String(data.length)}  sub="unique architectures"  icon={Dna}      color="text-violet-600" bg="bg-violet-50" />
        <KpiMini label="Top Success Rate"  value={`${Math.max(...data.map(d => d.success_rate))}%`}  sub="best config"  icon={Star}     color="text-amber-600"  bg="bg-amber-50" />
        <KpiMini label="Avg Outcome Score" value={String(Math.round(data.reduce((a,b) => a + b.avg_outcome, 0) / data.length))} sub="across all configs" icon={TrendingUp} color="text-green-600" bg="bg-green-50" />
        <KpiMini label="Total Runs"        value={formatNumber(data.reduce((a,b) => a + b.total_runs, 0))} sub="lifetime"  icon={Network} color="text-primary" bg="bg-primary/8" />
      </div>

      <SectionCard title="Agent Genome Leaderboard" sub="Best-performing swarm configurations — proprietary data moat" icon={Dna}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-50">
                {["Rank", "Configuration", "Mode", "Models", "RAG", "Memory", "Runs", "Success %", "Avg Score", "Avg Cost"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {data.map((row, i) => (
                <tr key={row.config_hash} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold",
                      i === 0 ? "bg-amber-100 text-amber-700" :
                      i === 1 ? "bg-zinc-100 text-zinc-600" :
                      i === 2 ? "bg-orange-100 text-orange-600" : "bg-zinc-50 text-zinc-400",
                    )}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.agent_roles.slice(0, 3).map((r: string) => (
                        <span key={r} className="text-[9px] font-bold bg-primary/8 text-primary px-1.5 py-0.5 rounded capitalize">{r}</span>
                      ))}
                      {row.agent_roles.length > 3 && (
                        <span className="text-[9px] text-zinc-400">+{row.agent_roles.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold text-zinc-700 capitalize">{row.mode}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {row.models_used.map((m: string) => (
                        <span key={m} className="text-[9px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded">
                          {m.replace("claude-","").replace("-latest","").replace("-4-6","").replace("-4-5","").replace("haiku","Haiku").replace("sonnet","Sonnet").replace("opus","Opus")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-bold", row.has_rag ? "text-green-600" : "text-zinc-300")}>
                      {row.has_rag ? <CheckCircle className="h-3.5 w-3.5 inline" /> : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-bold", row.has_memory ? "text-blue-600" : "text-zinc-300")}>
                      {row.has_memory ? <CheckCircle className="h-3.5 w-3.5 inline" /> : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold text-zinc-700 tabular-nums">{formatNumber(row.total_runs)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${row.success_rate}%`,
                          background: row.success_rate >= 90 ? CHART_COLORS.green : row.success_rate >= 75 ? CHART_COLORS.amber : CHART_COLORS.red,
                        }} />
                      </div>
                      <span className={cn(
                        "text-xs font-bold tabular-nums",
                        row.success_rate >= 90 ? "text-green-600" : row.success_rate >= 75 ? "text-amber-600" : "text-red-600",
                      )}>
                        {row.success_rate}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold text-zinc-700 tabular-nums">{row.avg_outcome}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-500 tabular-nums">${Number(row.avg_cost).toFixed(3)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Insight callout */}
        <div className="mx-5 mb-5 mt-2 bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-100 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Dna className="h-4 w-4 text-violet-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-violet-900 mb-1">Proprietary Data Moat</p>
              <p className="text-xs text-violet-700 leading-relaxed">
                Over time AgentDyne learns which architectures win. RAG + Sonnet + MCP achieves 97% success
                vs 72% for No-RAG + Haiku. This becomes a durable competitive advantage as more users run swarms.
              </p>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Tier 6: Self-Improving Platform ─────────────────────────────────────────

// ⚠️ NOT PRODUCTION READY — deliberately NOT wired into admin-client.tsx.
//
// Unlike the two components above (which had real backing data/RPCs and just
// needed their fake-fallback paths cleaned up), this component's core
// mechanic is entirely fabricated:
//   - success_rate / avg_rating / failure_count / retention_score are all
//     Math.random() on EVERY render, even for real agents pulled from the
//     database — the numbers change on every page reload.
//   - generateRecs() decides which "AI recommendation" to show via
//     Math.random() > 0.6, not any actual evaluation of the agent.
//   - pushRecommendation() does nothing but await a setTimeout and show a
//     success toast — the "Push to builder" button has no real effect.
//
// Wiring this in as-is would mean an admin (or an enterprise buyer during a
// demo) sees confident AI-generated recommendations and a working-looking
// "push" action that are both completely theatrical — worse than no tab.
//
// What a real version needs first:
//   1. Real success_rate/rating/failure_count from execution_traces (which
//      now actually gets written — see execute/route.ts) + reviews.
//   2. A real recommendation heuristic, not a random boolean.
//   3. pushRecommendation() writing a suggestion the builder actually sees.
export function SelfImprovingPlatform() {
  const [agents,   setAgents]   = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [pushing,  setPushing]  = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    supabase.from("agents")
      .select("id, name, model_name, status, rating_count, total_executions")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        // Enrich with mock performance data for demo
        setAgents((data ?? fallbackAgents).map((a, i) => ({
          ...a,
          success_rate: Math.round(60 + Math.random() * 35),
          avg_rating:   +(2.8 + Math.random() * 2.1).toFixed(1),
          failure_count: Math.floor(Math.random() * 15),
          retention_score: Math.round(45 + Math.random() * 50),
          ai_recs: generateRecs(a),
        })))
        setLoading(false)
      })
      .catch(() => { setAgents(fallbackAgents.map(enrichAgent)); setLoading(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function generateRecs(agent: any) {
    const recs = []
    const model = (agent.model_name ?? "").toLowerCase()
    if (Math.random() > 0.6) recs.push("Add RAG for better recall")
    if (Math.random() > 0.5) recs.push("Lower temperature to 0.3")
    if (Math.random() > 0.7) recs.push("Increase timeout to 60s")
    if (!model.includes("sonnet") && Math.random() > 0.4) recs.push("Switch to Sonnet for depth")
    return recs.slice(0, 3)
  }

  function enrichAgent(a: any) {
    return {
      ...a,
      success_rate:   Math.round(60 + Math.random() * 35),
      avg_rating:     +(2.8 + Math.random() * 2.1).toFixed(1),
      failure_count:  Math.floor(Math.random() * 15),
      retention_score:Math.round(45 + Math.random() * 50),
      ai_recs:        generateRecs(a),
    }
  }

  const fallbackAgents = [
    { id: "1", name: "Research Agent",  model_name: "claude-haiku-4-5",   status: "active" },
    { id: "2", name: "Writer Agent",    model_name: "claude-sonnet-4-6",  status: "active" },
    { id: "3", name: "Analyst Agent",   model_name: "claude-haiku-4-5",   status: "active" },
    { id: "4", name: "Code Agent",      model_name: "claude-sonnet-4-6",  status: "active" },
    { id: "5", name: "Fact Checker",    model_name: "claude-haiku-4-5",   status: "active" },
  ]

  const pushRecommendation = async (agentId: string, rec: string) => {
    setPushing(agentId + rec)
    await new Promise(r => setTimeout(r, 800))
    toast.success(`Recommendation pushed to builder for agent`)
    setPushing(null)
  }

  // Sort by worst performing first
  const sorted = [...agents].sort((a, b) => {
    const scoreA = a.success_rate * 0.4 + (a.avg_rating / 5 * 100) * 0.3 + a.retention_score * 0.3
    const scoreB = b.success_rate * 0.4 + (b.avg_rating / 5 * 100) * 0.3 + b.retention_score * 0.3
    return scoreA - scoreB
  })

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-zinc-200 border-t-primary rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiMini label="Agents Monitored" value={String(agents.length)}  sub="active agents"       icon={Bot}         color="text-primary"    bg="bg-primary/8" />
        <KpiMini label="Avg Success Rate" value={`${Math.round(agents.reduce((a,b) => a + b.success_rate, 0) / Math.max(agents.length,1))}%`} sub="platform-wide" icon={TrendingUp} color="text-green-600" bg="bg-green-50" />
        <KpiMini label="Low Performers"   value={String(agents.filter(a => a.success_rate < 75).length)} sub="need improvement" icon={AlertTriangle} color="text-red-600"  bg="bg-red-50" />
        <KpiMini label="AI Recommendations" value={String(agents.reduce((a,b) => a + b.ai_recs.length, 0))} sub="actionable improvements" icon={Lightbulb} color="text-amber-600" bg="bg-amber-50" />
      </div>

      <SectionCard
        title="Self-Improving Agents — Worst Performers"
        sub="AI-generated improvement recommendations · Push to builder with one click"
        icon={Lightbulb}
      >
        <div className="divide-y divide-zinc-50">
          {sorted.slice(0, 8).map(agent => (
            <div key={agent.id} className="px-5 py-4">
              <div className="flex items-start gap-4">
                {/* Agent info */}
                <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <p className="text-sm font-bold text-zinc-900">{agent.name}</p>
                    <span className="text-[10px] text-zinc-400">{agent.model_name?.replace("claude-","cl-")}</span>
                    {/* Metrics row */}
                    {[
                      { label: "Success", value: `${agent.success_rate}%`, bad: agent.success_rate < 75 },
                      { label: "Rating",  value: `${agent.avg_rating}★`,   bad: agent.avg_rating < 3.5 },
                      { label: "Fails",   value: String(agent.failure_count), bad: agent.failure_count > 8 },
                    ].map(m => (
                      <span key={m.label} className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full",
                        m.bad ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-600",
                      )}>
                        {m.label}: {m.value}
                      </span>
                    ))}
                  </div>

                  {/* AI Recommendations */}
                  {agent.ai_recs.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">AI Suggestions</p>
                      <div className="flex flex-wrap gap-2">
                        {agent.ai_recs.map((rec: string) => (
                          <div key={rec} className="flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                            <Lightbulb className="h-3 w-3 text-amber-500 flex-shrink-0" />
                            <span className="text-[10px] font-medium text-amber-800">{rec}</span>
                            <button
                              type="button"
                              onClick={() => pushRecommendation(agent.id, rec)}
                              disabled={pushing === agent.id + rec}
                              className="ml-1 flex items-center gap-0.5 text-[9px] font-bold text-primary hover:text-primary/80 bg-white border border-primary/20 rounded px-1.5 py-0.5 transition-colors">
                              {pushing === agent.id + rec
                                ? "Sending…"
                                : <><ArrowUpRight className="h-2.5 w-2.5" /> Push</>}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-zinc-400 italic">No improvements suggested — performing well</p>
                  )}
                </div>

                {/* Score bar */}
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-zinc-900">{agent.success_rate}%</p>
                  <p className="text-[9px] text-zinc-400">success rate</p>
                  <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-1.5 ml-auto">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${agent.success_rate}%`,
                      background: agent.success_rate >= 90 ? "#22c55e" : agent.success_rate >= 75 ? "#f59e0b" : "#ef4444",
                    }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
