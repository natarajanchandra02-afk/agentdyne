"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "framer-motion"
import {
  Bot, Plus, Pencil, Trash2, EyeOff, Zap, Star, DollarSign,
  CheckCircle, ArrowUpRight, Flame, TrendingDown, AlertTriangle,
  Clock, Play, Send, Eye, ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CategoryIcon } from "@/components/ui/category-icon"
import { createClient } from "@/lib/supabase/client"
import { formatNumber, formatCurrency, formatRelativeTime, categoryLabel, cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; sortOrder: number }> = {
  active:         { label: "Active",    color: "text-green-700", bg: "bg-green-50",  sortOrder: 1 },
  pending_review: { label: "In Review", color: "text-amber-700", bg: "bg-amber-50",  sortOrder: 2 },
  draft:          { label: "Draft",     color: "text-zinc-500",  bg: "bg-zinc-100",  sortOrder: 3 },
  suspended:      { label: "Suspended", color: "text-red-600",   bg: "bg-red-50",    sortOrder: 4 },
  archived:       { label: "Archived",  color: "text-zinc-400",  bg: "bg-zinc-100",  sortOrder: 5 },
}

const PRICING_LABELS: Record<string, { label: string; desc: string }> = {
  free:         { label: "Free",         desc: "No charge per run"             },
  per_call:     { label: "Paid per run", desc: "Charged each execution"        },
  subscription: { label: "Subscription", desc: "Monthly subscription fee"      },
  freemium:     { label: "Freemium",     desc: "Free tier + paid above quota"  },
}

const FILTERS = [
  { key: "all",            label: "All"       },
  { key: "active",         label: "Active"    },
  { key: "pending_review", label: "In Review" },
  { key: "draft",          label: "Drafts"    },
]

// ─── Performance signal ───────────────────────────────────────────────────────

function PerformanceSignal({ agent }: { agent: any }) {
  const runs   = agent.total_executions || 0
  const rating = agent.average_rating   || 0

  if (runs > 100)  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
      <Flame className="h-3 w-3" /> Trending
    </span>
  )
  if (agent.status === "active" && runs < 5) return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-500 bg-zinc-50 px-2 py-0.5 rounded-full">
      <TrendingDown className="h-3 w-3" /> Low engagement
    </span>
  )
  if (agent.status === "active" && rating > 0 && rating < 3) return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
      <AlertTriangle className="h-3 w-3" /> Needs improvement
    </span>
  )
  return null
}

// ─── Status contextual message ────────────────────────────────────────────────

function StatusMessage({ agent }: { agent: any }) {
  const runs = agent.total_executions || 0

  if (agent.status === "draft") return (
    <p className="text-[11px] text-zinc-400 mt-1">
      Complete setup to publish and start earning →
    </p>
  )
  if (agent.status === "pending_review") return (
    <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
      <Clock className="h-3 w-3" /> Awaiting approval — est. &lt;24h
    </p>
  )
  if (agent.status === "active" && runs === 0) return (
    <p className="text-[11px] text-zinc-400 mt-1">
      No runs yet — publish in marketplace to start earning
    </p>
  )
  return null
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, onSubmitReview, onArchive, onDelete }: {
  agent:           any
  onSubmitReview:  (id: string) => void
  onArchive:       (id: string) => void
  onDelete:        (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const status    = STATUS_CONFIG[agent.status] || STATUS_CONFIG.draft
  const pricing   = PRICING_LABELS[agent.pricing_model] || PRICING_LABELS.free
  const hasRuns   = (agent.total_executions || 0) > 0
  const isActive  = agent.status === "active"
  const isDraft   = agent.status === "draft"
  const inReview  = agent.status === "pending_review"

  const handleDelete = () => {
    if (!confirming) { setConfirming(true); return }
    onDelete(agent.id); setConfirming(false)
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-sm transition-all"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

      {/* Top: icon + name + status */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-11 h-11 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
          <CategoryIcon category={agent.category} colored className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-zinc-900 text-sm truncate">{agent.name}</h3>
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0", status.bg, status.color)}>
              {status.label}
            </span>
            <PerformanceSignal agent={agent} />
          </div>

          {/* Category + pricing with tooltip-style desc */}
          <p className="text-xs text-zinc-400 capitalize mt-0.5">
            {categoryLabel(agent.category)} ·{" "}
            <span title={pricing.desc} className="cursor-help border-b border-dashed border-zinc-300">
              {pricing.label}
            </span>
          </p>

          <StatusMessage agent={agent} />
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-zinc-500 line-clamp-1 mb-3">{agent.description}</p>

      {/* Stats — contextual */}
      {hasRuns ? (
        <div className="flex items-center gap-4 text-xs text-zinc-400 mb-4">
          <span className="flex items-center gap-1 nums"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
          <span className="flex items-center gap-1 nums">
            <Star className={cn("h-3 w-3", (agent.average_rating || 0) > 0 ? "fill-yellow-400 text-yellow-400" : "")} />
            {agent.average_rating?.toFixed(1) || "—"}
          </span>
          <span className="flex items-center gap-1 nums font-semibold text-zinc-700 ml-auto">
            <DollarSign className="h-3 w-3 text-green-500" />{formatCurrency(agent.total_revenue || 0)}
          </span>
        </div>
      ) : (
        <div className="mb-4">
          <p className="text-[11px] text-zinc-400 italic">
            {isActive ? "No runs yet — share your marketplace link to get users" : "Stats will appear after first run"}
          </p>
        </div>
      )}

      {/* ── VISIBLE QUICK ACTIONS (no hover-hide) ───────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Primary action per status */}
        {isDraft && (
          <Link href={`/builder/${agent.id}`}>
            <Button size="sm" className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 h-7 text-xs font-semibold">
              <Pencil className="h-3 w-3" /> Continue editing
            </Button>
          </Link>
        )}
        {isDraft && (
          <Button size="sm" variant="outline" onClick={() => onSubmitReview(agent.id)}
            className="rounded-xl border-primary/30 text-primary hover:bg-primary/5 gap-1.5 h-7 text-xs font-semibold">
            <Send className="h-3 w-3" /> Submit for review
          </Button>
        )}

        {inReview && (
          <Link href={`/builder/${agent.id}`}>
            <Button size="sm" variant="outline" className="rounded-xl border-zinc-200 h-7 text-xs gap-1.5">
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          </Link>
        )}

        {isActive && (
          <>
            <Link href={`/marketplace/${agent.id}`}>
              <Button size="sm" className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 h-7 text-xs font-semibold">
                <Eye className="h-3 w-3" /> View live
              </Button>
            </Link>
            <Link href={`/builder/${agent.id}`}>
              <Button size="sm" variant="outline" className="rounded-xl border-zinc-200 h-7 text-xs gap-1.5">
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            </Link>
            <Link href={`/marketplace/${agent.id}`}>
              <Button size="sm" variant="outline" className="rounded-xl border-green-200 text-green-700 hover:bg-green-50 h-7 text-xs gap-1.5">
                <Play className="h-3 w-3" /> Test run
              </Button>
            </Link>
          </>
        )}

        {/* Secondary: archive + delete — always visible but muted */}
        <div className="ml-auto flex items-center gap-1.5">
          {agent.status !== "archived" && (
            <button onClick={() => onArchive(agent.id)} title="Archive"
              className="p-1.5 rounded-lg text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 transition-colors">
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={handleDelete} title={confirming ? "Confirm delete" : "Delete"}
            className={cn("p-1.5 rounded-lg transition-colors",
              confirming ? "text-red-500 bg-red-50" : "text-zinc-300 hover:text-red-500 hover:bg-red-50")}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {confirming && (
        <p className="text-[11px] text-red-500 mt-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Click delete again to confirm — this cannot be undone.
        </p>
      )}
    </div>
  )
}

// ─── Main My-Agents Client ────────────────────────────────────────────────────

export function MyAgentsClient({ agents: init }: { agents: any[] }) {
  const [agents, setAgents] = useState(() =>
    // Sort by status priority: active → in_review → draft → suspended → archived
    [...init].sort((a, b) => {
      const oa = STATUS_CONFIG[a.status]?.sortOrder ?? 99
      const ob = STATUS_CONFIG[b.status]?.sortOrder ?? 99
      return oa !== ob ? oa - ob : (b.total_executions || 0) - (a.total_executions || 0)
    })
  )
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const supabase = createClient()

  const filtered = agents.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) || (a.description || "").toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === "all" || a.status === filter
    return matchSearch && matchFilter
  })

  const submitForReview = async (id: string) => {
    // Run the evaluation harness BEFORE submitting (non-negotiable gate)
    const loadingToast = toast.loading("Running evaluation harness (5–15s)…")
    try {
      const evalRes = await fetch(`/api/agents/${id}/evaluate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        // Pass agent's own description as a minimal test case so eval can run
        body: JSON.stringify({
          tests: [{ input: agents.find(a => a.id === id)?.description ?? "Test this agent." }],
        }),
      })
      const evalData = await evalRes.json()
      toast.dismiss(loadingToast)

      if (!evalRes.ok) {
        // Plan/email restriction — surface the exact message
        toast.error(evalData.error || "Evaluation failed — check your plan or email verification.")
        return
      }

      if (evalData.gate === "reject") {
        toast.error(`Score ${evalData.score}/100 — below minimum 70. ${evalData.recommendation}`)
        // Status is now 'rejected' (set by eval endpoint) — refresh UI
        setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "rejected" } : a))
        return
      }

      // Score ≥ 70 → submitted (eval endpoint set status = pending_review)
      setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "pending_review" } : a))
      if (evalData.gate === "fast_track") {
        toast.success(`Score ${evalData.score}/100 — Fast-tracked! Under review in <2h.`)
      } else {
        toast.success(`Score ${evalData.score}/100 — Submitted for review (est. 24h).`)
      }
    } catch (err: any) {
      toast.dismiss(loadingToast)
      toast.error(err.message || "Evaluation failed. Please try again.")
    }
  }

  const archiveAgent = async (id: string) => {
    const { error } = await supabase.from("agents").update({ status: "archived" }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "archived" } : a))
    toast.success("Agent archived")
  }

  const deleteAgent = async (id: string) => {
    // Route through API — never delete directly from client (RLS-only is not enough)
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error || "Delete failed")
      return
    }
    setAgents(prev => prev.filter(a => a.id !== id))
    toast.success("Deleted")
  }

  // Per-filter counts
  const counts = FILTERS.reduce((acc, f) => {
    acc[f.key] = f.key === "all" ? agents.length : agents.filter(a => a.status === f.key).length
    return acc
  }, {} as Record<string, number>)

  // Portfolio health
  const activeCount  = agents.filter(a => a.status === "active").length
  const draftCount   = agents.filter(a => a.status === "draft").length
  const reviewCount  = agents.filter(a => a.status === "pending_review").length
  const totalRevenue = agents.reduce((s, a) => s + (a.total_revenue || 0), 0)

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">My Agents</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {agents.length} agent{agents.length !== 1 ? "s" : ""} in your portfolio
            {totalRevenue > 0 && ` · ${formatCurrency(totalRevenue)} total earned`}
          </p>
        </div>
        <Link href="/builder">
          <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
            <Plus className="h-4 w-4" /> New Agent
          </Button>
        </Link>
      </div>

      {/* Portfolio health banner */}
      {agents.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Active",    value: activeCount,  color: "text-green-600",  bg: "bg-green-50",  tooltip: "Live on marketplace, earning per run" },
            { label: "In Review", value: reviewCount,  color: "text-amber-600",  bg: "bg-amber-50",  tooltip: "Under admin review — est. <24h" },
            { label: "Drafts",    value: draftCount,   color: "text-zinc-500",   bg: "bg-zinc-50",   tooltip: "Incomplete — submit to go live" },
            { label: "Earned",    value: formatCurrency(totalRevenue), color: "text-green-700", bg: "bg-green-50", tooltip: "Your 80% share of all transactions" },
          ].map(m => (
            <div key={m.label} className={cn("rounded-xl px-3 py-2.5 flex items-center gap-2 cursor-default", m.bg)} title={m.tooltip}>
              <div className="flex-1">
                <p className={cn("text-sm font-bold nums", m.color)}>{m.value}</p>
                <p className="text-[10px] text-zinc-500 font-medium">{m.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Guidance banners (status-aware) ────────────────────────────── */}
      {draftCount > 0 && activeCount === 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-800 flex-1">
            You have {draftCount} draft{draftCount > 1 ? "s" : ""} — submit {draftCount === 1 ? "it" : "one"} for review to go live and start earning.
          </p>
          <button onClick={() => setFilter("draft")} className="text-xs font-semibold text-blue-700 hover:underline flex-shrink-0">
            View drafts <ChevronRight className="h-3 w-3 inline" />
          </button>
        </div>
      )}

      {reviewCount > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-center gap-3">
          <Clock className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            {reviewCount} agent{reviewCount > 1 ? "s" : ""} under review — usually approved within 24 hours.
          </p>
        </div>
      )}

      {/* ── Filters + search ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1 flex-shrink-0">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5",
                filter === f.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
              {f.label}
              {counts[f.key] > 0 && (
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  filter === f.key ? "bg-primary/10 text-primary" : "bg-zinc-100 text-zinc-400")}>
                  {counts[f.key]}
                </span>
              )}
            </button>
          ))}
        </div>
        <Input placeholder="Search agents…" value={search} onChange={e => setSearch(e.target.value)}
          className="max-w-xs rounded-xl border-zinc-200 h-9 text-sm" />
      </div>

      {/* ── Agent grid ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-zinc-100 rounded-2xl py-16 text-center"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="w-14 h-14 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
            <Bot className="h-7 w-7 text-zinc-400" />
          </div>
          <h3 className="font-semibold text-zinc-900 mb-1">{search ? "No agents match" : "No agents yet"}</h3>
          <p className="text-sm text-zinc-400 mb-4 max-w-xs mx-auto">
            {search
              ? "Try a different keyword"
              : "Build your first agent in under 5 minutes using a starter template"}
          </p>
          {!search && (
            <Link href="/builder">
              <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2">
                <Plus className="h-4 w-4" /> Create Agent
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Group by status */}
          {(["active", "pending_review", "draft", "suspended", "archived"] as const).map(status => {
            const group = filtered.filter(a => a.status === status)
            if (!group.length) return null
            const cfg = STATUS_CONFIG[status]!
            return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", cfg.bg, cfg.color)}>
                    {cfg.label}
                  </span>
                  <span className="text-[11px] text-zinc-400">{group.length} agent{group.length > 1 ? "s" : ""}</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <AnimatePresence>
                    {group.map((agent, i) => (
                      <motion.div key={agent.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }} transition={{ delay: i * 0.03 }}>
                        <AgentCard
                          agent={agent}
                          onSubmitReview={submitForReview}
                          onArchive={archiveAgent}
                          onDelete={deleteAgent}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )
          })}

          {/* New agent card */}
          <Link href="/builder">
            <div className="border border-dashed border-zinc-200 rounded-2xl p-5 flex items-center justify-center gap-2 text-zinc-400 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.01] transition-all cursor-pointer min-h-[80px]">
              <Plus className="h-5 w-5" />
              <span className="text-sm font-semibold">Create New Agent</span>
            </div>
          </Link>
        </div>
      )}
    </div>
  )
}
