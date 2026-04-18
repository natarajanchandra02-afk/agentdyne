"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { CategoryIcon } from "@/components/ui/category-icon"
import {
  Trophy, Zap, DollarSign, Shield,
  Star, ArrowRight, ChevronDown, BarChart3,
} from "lucide-react"
import { formatNumber, cn } from "@/lib/utils"

const CATEGORIES = [
  "all", "productivity", "coding", "marketing", "finance", "legal",
  "customer_support", "data_analysis", "content", "research",
  "hr", "sales", "devops", "security", "other",
]

const BADGES = [
  { key: "all",           label: "All",           icon: BarChart3 },
  { key: "top_rated",     label: "Top Rated",     icon: Trophy },
  { key: "fastest",       label: "Fastest",       icon: Zap },
  { key: "cheapest",      label: "Cheapest",      icon: DollarSign },
  { key: "most_reliable", label: "Most Reliable", icon: Shield },
]

function ScoreBar({ score, color = "bg-primary" }: { score: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-500 w-8 text-right">{score?.toFixed(0)}</span>
    </div>
  )
}

function GradeBadge({ score }: { score: number }) {
  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D"
  const color = {
    S: "bg-violet-100 text-violet-700 border-violet-200",
    A: "bg-green-100  text-green-700  border-green-200",
    B: "bg-blue-100   text-blue-700   border-blue-200",
    C: "bg-amber-100  text-amber-700  border-amber-200",
    D: "bg-zinc-100   text-zinc-600   border-zinc-200",
  }[grade] ?? "bg-zinc-100 text-zinc-600"
  return (
    <span className={cn("text-sm font-black px-2 py-0.5 rounded-lg border", color)}>{grade}</span>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xl">🥇</span>
  if (rank === 2) return <span className="text-xl">🥈</span>
  if (rank === 3) return <span className="text-xl">🥉</span>
  return <span className="text-sm font-bold text-zinc-400 w-6 text-center nums">#{rank}</span>
}

export default function LeaderboardClient() {
  const [agents,   setAgents]   = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [category, setCategory] = useState("all")
  const [badge,    setBadge]    = useState("all")
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: "50" })
    if (category !== "all") params.set("category", category)
    if (badge    !== "all") params.set("badge",    badge)

    fetch(`/api/leaderboard?${params}`)
      .then(r => r.json())
      .then(d => setAgents(d.data ?? []))
      .finally(() => setLoading(false))
  }, [category, badge])

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">
        {/* Hero */}
        <div className="bg-zinc-50 border-b border-zinc-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
                <Trophy className="h-5 w-5 text-primary" />
              </div>
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Quality Rankings</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-zinc-900 mb-2">
              Agent Leaderboard
            </h1>
            <p className="text-zinc-500 max-w-xl text-sm sm:text-base">
              Objective quality rankings based on accuracy, reliability, speed, cost, and adoption.
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              {[
                { label: "Accuracy",    weight: "30%", color: "bg-green-50 text-green-700"   },
                { label: "Reliability", weight: "25%", color: "bg-blue-50 text-blue-700"     },
                { label: "Speed",       weight: "20%", color: "bg-violet-50 text-violet-700" },
                { label: "Cost",        weight: "15%", color: "bg-amber-50 text-amber-700"   },
                { label: "Adoption",    weight: "10%", color: "bg-zinc-50 text-zinc-600"     },
              ].map(m => (
                <span key={m.label} className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", m.color)}>
                  {m.label} {m.weight}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6 sm:mb-8">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
              {BADGES.map(b => (
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
            <div className="relative flex-shrink-0">
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 rounded-full border border-zinc-200 text-xs font-semibold text-zinc-700 bg-white cursor-pointer focus:outline-none focus:border-zinc-400">
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>
                    {c === "all" ? "All Categories" : c.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="h-20 bg-zinc-50 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center py-20 text-zinc-400">
              <Trophy className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="font-semibold">No ranked agents in this filter.</p>
              <p className="text-sm mt-1">Agents need 10+ executions to earn a quality score.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((agent, i) => {
                const rank   = agent.global_rank ?? i + 1
                const isOpen = expanded === agent.id
                return (
                  <div key={agent.id}
                    className="bg-white border border-zinc-100 rounded-2xl overflow-hidden transition-all"
                    style={{ boxShadow: rank <= 3 ? "0 2px 12px rgba(0,0,0,0.06)" : "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4">
                      <div className="w-8 flex-shrink-0 flex items-center justify-center">
                        <RankBadge rank={rank} />
                      </div>
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                        <CategoryIcon category={agent.category} colored className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/marketplace/${agent.id}`}
                            className="font-bold text-zinc-900 hover:text-primary transition-colors text-sm truncate">
                            {agent.name}
                          </Link>
                          <GradeBadge score={agent.composite_score ?? 0} />
                          {agent.is_top_rated    && <span className="text-[10px] font-bold bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded-full hidden sm:inline">Top Rated</span>}
                          {agent.is_fastest      && <span className="text-[10px] font-bold bg-blue-50   text-blue-700   px-1.5 py-0.5 rounded-full hidden sm:inline">Fastest</span>}
                          {agent.is_cheapest     && <span className="text-[10px] font-bold bg-green-50  text-green-700  px-1.5 py-0.5 rounded-full hidden sm:inline">Cheapest</span>}
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate hidden sm:block">{agent.description}</p>
                      </div>
                      <div className="text-right flex-shrink-0 hidden sm:block">
                        <div className="text-2xl font-black text-zinc-900 nums">{agent.composite_score?.toFixed(1)}</div>
                        <div className="text-[10px] text-zinc-400">/ 100</div>
                      </div>
                      <div className="hidden lg:flex items-center gap-4 flex-shrink-0">
                        <div className="text-center">
                          <div className="text-sm font-bold text-zinc-900 nums">
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 inline mr-0.5" />
                            {agent.average_rating?.toFixed(1) ?? "—"}
                          </div>
                          <div className="text-[10px] text-zinc-400">Rating</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-zinc-900 nums">{formatNumber(agent.total_executions)}</div>
                          <div className="text-[10px] text-zinc-400">Runs</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-zinc-900 nums">{agent.average_latency_ms}ms</div>
                          <div className="text-[10px] text-zinc-400">Latency</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                        <button onClick={() => setExpanded(isOpen ? null : agent.id)}
                          className="p-1.5 text-zinc-400 hover:text-zinc-900 transition-colors">
                          <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                        </button>
                        <Link href={`/marketplace/${agent.id}`}>
                          <button className="flex items-center gap-1 text-xs font-semibold text-primary hover:gap-2 transition-all">
                            View <ArrowRight className="h-3 w-3" />
                          </button>
                        </Link>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="px-4 sm:px-5 pb-5 border-t border-zinc-50 pt-4 grid grid-cols-2 sm:grid-cols-5 gap-4">
                        {[
                          { label: "Accuracy",    score: agent.accuracy_score,    color: "bg-green-500",  weight: "30%" },
                          { label: "Reliability", score: agent.reliability_score, color: "bg-blue-500",   weight: "25%" },
                          { label: "Speed",       score: agent.latency_score,     color: "bg-violet-500", weight: "20%" },
                          { label: "Cost",        score: agent.cost_score,        color: "bg-amber-500",  weight: "15%" },
                          { label: "Adoption",    score: agent.popularity_score,  color: "bg-zinc-400",   weight: "10%" },
                        ].map(c => (
                          <div key={c.label}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-semibold text-zinc-600">{c.label}</span>
                              <span className="text-[10px] text-zinc-400">{c.weight}</span>
                            </div>
                            <ScoreBar score={c.score ?? 0} color={c.color} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-center text-xs text-zinc-400 mt-8">
            Scores updated every 24h from live execution data. Minimum 10 executions to qualify.
          </p>
        </div>
      </div>
      <Footer />
    </div>
  )
}
