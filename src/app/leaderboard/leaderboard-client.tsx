"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Navbar }       from "@/components/layout/navbar"
import { Footer }       from "@/components/layout/footer"
import { CategoryIcon } from "@/components/ui/category-icon"
import {
  Trophy, Zap, DollarSign, Shield, Star, ArrowRight,
  ChevronDown, BarChart3, BadgeCheck, TrendingUp, TrendingDown,
  Minus, AlertTriangle, Info, Filter,
} from "lucide-react"
import { formatNumber, cn } from "@/lib/utils"

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "all","productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]

const BADGE_FILTERS = [
  { key: "all",           label: "All",            icon: BarChart3  },
  { key: "verified",      label: "Verified",       icon: BadgeCheck },
  { key: "top_rated",     label: "Top Rated",      icon: Trophy     },
  { key: "fastest",       label: "Fastest",        icon: Zap        },
  { key: "cheapest",      label: "Cheapest",       icon: DollarSign },
  { key: "most_reliable", label: "Most Reliable",  icon: Shield     },
]

// Scoring dimensions — matches compute_agent_score in DB exactly
const SCORE_DIMS = [
  { key: "accuracy_score",    label: "Quality Score", weight: "30%", color: "bg-green-500",  tip: "Based on eval harness (hidden + live tests)" },
  { key: "reliability_score", label: "Reliability",   weight: "25%", color: "bg-blue-500",   tip: "Success rate over last 30 days"              },
  { key: "latency_score",     label: "Speed",         weight: "20%", color: "bg-violet-500", tip: "Normalised p50 response time"                },
  { key: "cost_score",        label: "Cost",          weight: "15%", color: "bg-amber-500",  tip: "Cost efficiency vs category median"          },
  { key: "popularity_score",  label: "Adoption",      weight: "10%", color: "bg-zinc-400",   tip: "Execution volume, recency-weighted"          },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBar({ score, color = "bg-primary" }: { score: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-500 w-8 text-right tabular-nums">{(score ?? 0).toFixed(0)}</span>
    </div>
  )
}

function GradeBadge({ score }: { score: number }) {
  const s     = score ?? 0
  const grade = s >= 90 ? "S" : s >= 80 ? "A" : s >= 70 ? "B" : s >= 60 ? "C" : "D"
  const color = { S: "bg-violet-100 text-violet-700 border-violet-200", A: "bg-green-100 text-green-700 border-green-200", B: "bg-blue-100 text-blue-700 border-blue-200", C: "bg-amber-100 text-amber-700 border-amber-200", D: "bg-zinc-100 text-zinc-600 border-zinc-200" }[grade]!
  return <span className={cn("text-sm font-black px-2 py-0.5 rounded-lg border", color)}>{grade}</span>
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xl leading-none">🥇</span>
  if (rank === 2) return <span className="text-xl leading-none">🥈</span>
  if (rank === 3) return <span className="text-xl leading-none">🥉</span>
  return <span className="text-sm font-bold text-zinc-400 w-6 text-center tabular-nums">#{rank}</span>
}

function ConfidencePill({ confidence }: { confidence: number }) {
  const c = confidence ?? 0
  const label = c >= 80 ? "High confidence" : c >= 50 ? "Medium confidence" : "Low confidence"
  const color = c >= 80 ? "bg-green-50 text-green-600" : c >= 50 ? "bg-amber-50 text-amber-600" : "bg-zinc-50 text-zinc-500"
  return (
    <span title={`Based on ${c.toFixed(0)}% of ideal execution volume`}
      className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", color)}>
      {label}
    </span>
  )
}

function LatencyPill({ label, color }: { label: string; color: string }) {
  const cls = color === "green" ? "bg-green-50 text-green-700" : color === "amber" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"
  return <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", cls)}>{label}</span>
}

function BadgeChip({ badge }: { badge: { key: string; label: string } }) {
  const styles: Record<string, string> = {
    verified:      "bg-blue-50 text-blue-700 border-blue-100",
    top_rated:     "bg-violet-50 text-violet-700 border-violet-100",
    most_reliable: "bg-green-50 text-green-700 border-green-100",
    fastest:       "bg-sky-50 text-sky-700 border-sky-100",
    cheapest:      "bg-emerald-50 text-emerald-700 border-emerald-100",
  }
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
      styles[badge.key] ?? "bg-zinc-50 text-zinc-600 border-zinc-100"
    )}>
      {badge.key === "verified" && <BadgeCheck className="h-2.5 w-2.5" />}
      {badge.label}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LeaderboardClient() {
  const [agents,   setAgents]   = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [category, setCategory] = useState("all")
  const [badge,    setBadge]    = useState("all")
  const [pricing,  setPricing]  = useState("all")   // "all" | "free" | "paid"
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tooltip,  setTooltip]  = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ limit: "50" })
    if (category !== "all") p.set("category", category)
    if (badge    !== "all") p.set("badge",    badge)
    if (pricing  !== "all") p.set("pricing",  pricing)

    fetch(`/api/leaderboard?${p}`)
      .then(r => r.json())
      .then(d => { setAgents(d.data ?? []); setExpanded(null) })
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }, [category, badge, pricing])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <div className="bg-zinc-50 border-b border-zinc-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
                <Trophy className="h-5 w-5 text-primary" />
              </div>
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Data-driven Rankings</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-zinc-900 mb-2">
              Agent Leaderboard
            </h1>
            <p className="text-zinc-500 max-w-xl text-sm sm:text-base mb-5">
              Data-driven rankings based on verified execution data. Minimum 100 runs to qualify. Updated every 24h.
            </p>

            {/* Scoring formula chips — matches DB compute_agent_score exactly */}
            <div className="flex flex-wrap gap-2">
              {SCORE_DIMS.map(d => (
                <button key={d.key}
                  title={d.tip}
                  onMouseEnter={() => setTooltip(d.key)}
                  onMouseLeave={() => setTooltip(null)}
                  className="relative group">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full cursor-help transition-all",
                    {
                      "bg-green-50  text-green-700":  d.key === "accuracy_score",
                      "bg-blue-50   text-blue-700":   d.key === "reliability_score",
                      "bg-violet-50 text-violet-700": d.key === "latency_score",
                      "bg-amber-50  text-amber-700":  d.key === "cost_score",
                      "bg-zinc-100  text-zinc-600":   d.key === "popularity_score",
                    }
                  )}>
                    {d.label} {d.weight}
                    <Info className="h-3 w-3 opacity-50" />
                  </span>
                  {tooltip === d.key && (
                    <div className="absolute left-0 top-8 z-20 bg-zinc-900 text-white text-xs rounded-xl px-3 py-2 w-52 shadow-lg">
                      {d.tip}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Anti-gaming note */}
            <p className="text-[11px] text-zinc-400 mt-3 flex items-center gap-1.5">
              <Shield className="h-3 w-3" />
              Self-executions excluded · Cheapest badge requires Quality ≥ 60 · Recency-weighted adoption
            </p>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

          {/* ── Filters ─────────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 mb-6 sm:mb-8">
            {/* Row 1: badge filters */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1">
              {BADGE_FILTERS.map(b => (
                <button key={b.key} onClick={() => setBadge(b.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all flex-shrink-0",
                    badge === b.key
                      ? "bg-zinc-900 border-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400 bg-white"
                  )}>
                  <b.icon className="h-3 w-3" />
                  {b.label}
                </button>
              ))}
            </div>

            {/* Row 2: category + pricing selects */}
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-zinc-200 text-xs font-semibold text-zinc-700 bg-white cursor-pointer focus:outline-none focus:border-zinc-400">
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>
                    {c === "all" ? "All Categories" : c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                  </option>
                ))}
              </select>
              {/* Pricing filter (free vs paid) */}
              <select value={pricing} onChange={e => setPricing(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-zinc-200 text-xs font-semibold text-zinc-700 bg-white cursor-pointer focus:outline-none focus:border-zinc-400">
                <option value="all">Free + Paid</option>
                <option value="free">Free only</option>
                <option value="paid">Paid only</option>
              </select>
            </div>
          </div>

          {/* ── Agent list ──────────────────────────────────────────────────── */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-20 bg-zinc-50 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center py-20 text-zinc-400">
              <Trophy className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="font-semibold text-zinc-600">No ranked agents in this filter.</p>
              <p className="text-sm mt-1">Agents need 100+ executions to earn a quality score.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((agent, i) => {
                const rank   = agent.global_rank ?? i + 1
                const isOpen = expanded === agent.id
                const score  = Number(agent.composite_score ?? 0)
                const pricingModel = agent.pricing_model ?? "free"
                const isPaid = pricingModel !== "free"

                return (
                  <div key={agent.id}
                    className={cn(
                      "bg-white border rounded-2xl overflow-hidden transition-all duration-200",
                      rank <= 3 ? "border-zinc-200" : "border-zinc-100",
                    )}
                    style={{ boxShadow: rank <= 3 ? "0 2px 12px rgba(0,0,0,0.07)" : "0 1px 3px rgba(0,0,0,0.04)" }}>

                    {/* ── Main row ── */}
                    <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4">
                      {/* Rank */}
                      <div className="w-8 flex-shrink-0 flex items-center justify-center">
                        <RankBadge rank={rank} />
                      </div>

                      {/* Icon */}
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                        <CategoryIcon category={agent.category} colored className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>

                      {/* Name + badges */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Link href={`/marketplace/${agent.id}`}
                            className="font-bold text-zinc-900 hover:text-primary transition-colors text-sm truncate">
                            {agent.name}
                          </Link>
                          <GradeBadge score={score} />
                          {/* Max 2 badges, from enriched API response */}
                          {(agent.badges ?? []).map((b: any) => (
                            <span key={b.key} className="hidden sm:inline">
                              <BadgeChip badge={b} />
                            </span>
                          ))}
                          {/* Pricing pill */}
                          <span className={cn(
                            "text-[10px] font-semibold px-1.5 py-0.5 rounded-full hidden sm:inline",
                            isPaid ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-500"
                          )}>
                            {isPaid ? `$${Number(agent.price_per_call).toFixed(3)}/call` : "Free"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <p className="text-xs text-zinc-400 truncate hidden sm:block max-w-sm">{agent.description}</p>
                          {/* Confidence pill */}
                          <span className="hidden sm:inline">
                            <ConfidencePill confidence={agent.confidence ?? 0} />
                          </span>
                        </div>
                      </div>

                      {/* Composite score */}
                      <div className="text-right flex-shrink-0 hidden sm:block">
                        <div className="text-2xl font-black text-zinc-900 tabular-nums">{score.toFixed(1)}</div>
                        <div className="text-[10px] text-zinc-400">/ 100</div>
                      </div>

                      {/* Stats */}
                      <div className="hidden lg:flex items-center gap-4 flex-shrink-0">
                        <div className="text-center">
                          <div className="flex items-center gap-0.5 text-sm font-bold text-zinc-900">
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            {agent.average_rating?.toFixed(1) ?? "—"}
                          </div>
                          <div className="text-[10px] text-zinc-400">{agent.total_reviews} reviews</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-zinc-900 tabular-nums">{formatNumber(agent.total_executions)}</div>
                          <div className="text-[10px] text-zinc-400">Runs</div>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-sm font-bold text-zinc-900 tabular-nums">{agent.average_latency_ms}ms</span>
                          </div>
                          <LatencyPill label={agent.latency_label ?? "—"} color={agent.latency_color ?? "zinc"} />
                        </div>
                        {/* Failure rate — negative signal */}
                        <div className="text-center">
                          <div className={cn(
                            "text-sm font-bold tabular-nums",
                            (agent.failure_rate ?? 0) > 20 ? "text-red-500" : (agent.failure_rate ?? 0) > 5 ? "text-amber-500" : "text-green-600"
                          )}>
                            {(agent.failure_rate ?? 0).toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-zinc-400">Fail rate</div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                        <button onClick={() => setExpanded(isOpen ? null : agent.id)}
                          aria-expanded={isOpen}
                          aria-label="Show score breakdown"
                          className="p-1.5 text-zinc-400 hover:text-zinc-900 transition-colors rounded-lg hover:bg-zinc-50">
                          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-180")} />
                        </button>
                        <Link href={`/marketplace/${agent.id}`}>
                          <button className="flex items-center gap-1 text-xs font-semibold text-primary hover:gap-2 transition-all">
                            View <ArrowRight className="h-3 w-3" />
                          </button>
                        </Link>
                      </div>
                    </div>

                    {/* ── Expanded breakdown ── */}
                    {isOpen && (
                      <div className="border-t border-zinc-50 px-4 sm:px-5 pb-5 pt-4 space-y-4">
                        {/* Why this rank */}
                        <div className="flex items-start gap-2 bg-zinc-50 rounded-xl px-3 py-2.5">
                          <Info className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-zinc-600 leading-relaxed">{agent.rank_reason}</p>
                        </div>

                        {/* Score dimensions */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                          {SCORE_DIMS.map(d => (
                            <div key={d.key} title={d.tip}>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-semibold text-zinc-700">{d.label}</span>
                                <span className="text-[10px] text-zinc-400">{d.weight}</span>
                              </div>
                              <ScoreBar score={agent[d.key] ?? 0} color={d.color} />
                              <p className="text-[10px] text-zinc-400 mt-1 leading-snug">{d.tip}</p>
                            </div>
                          ))}
                        </div>

                        {/* Negative signals row */}
                        <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-zinc-50">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className={cn("h-3.5 w-3.5", (agent.failure_rate ?? 0) > 20 ? "text-red-400" : "text-zinc-300")} />
                            <span className="text-xs text-zinc-500">
                              Failure rate: <strong className={(agent.failure_rate ?? 0) > 20 ? "text-red-500" : "text-zinc-700"}>{(agent.failure_rate ?? 0).toFixed(1)}%</strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <ConfidencePill confidence={agent.confidence ?? 0} />
                            <span className="text-[10px] text-zinc-400">({formatNumber(agent.total_executions)} verified runs)</span>
                          </div>
                          {agent.evaluation_passed && (
                            <div className="flex items-center gap-1.5 text-xs text-blue-600 font-semibold">
                              <BadgeCheck className="h-3.5 w-3.5" />
                              Verified by AgentDyne eval harness ({agent.evaluation_runs} test runs)
                            </div>
                          )}
                          {/* p50 latency context */}
                          <div className="flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5 text-zinc-300" />
                            <span className="text-xs text-zinc-500">
                              Avg latency (p50): <strong className="text-zinc-700">{agent.average_latency_ms}ms</strong>
                              {" · "}
                              <LatencyPill label={agent.latency_label ?? "—"} color={agent.latency_color ?? "zinc"} />
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Footer note */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-8">
            <p className="text-xs text-zinc-400">
              Scores updated every 24h · Minimum 100 executions to qualify · Self-executions excluded
            </p>
            <p className="text-xs text-zinc-400">
              Cheapest badge requires Quality ≥ 60/100
            </p>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
