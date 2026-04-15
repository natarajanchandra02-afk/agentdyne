"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "framer-motion"
import { Bot, Plus, Pencil, Trash2, EyeOff, Zap, Star, DollarSign, Clock, CheckCircle, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CategoryIcon } from "@/components/ui/category-icon"
import { createClient } from "@/lib/supabase/client"
import { formatNumber, formatCurrency, formatRelativeTime, categoryLabel, cn } from "@/lib/utils"
import toast from "react-hot-toast"

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:         { label: "Active",         color: "bg-green-50 text-green-700" },
  draft:          { label: "Draft",          color: "bg-zinc-100 text-zinc-500" },
  pending_review: { label: "In Review",      color: "bg-amber-50 text-amber-700" },
  suspended:      { label: "Suspended",      color: "bg-red-50 text-red-600" },
  archived:       { label: "Archived",       color: "bg-zinc-100 text-zinc-400" },
}

const FILTERS = [
  { key: "all",           label: "All" },
  { key: "active",        label: "Active" },
  { key: "draft",         label: "Drafts" },
  { key: "pending_review",label: "In Review" },
]

export function MyAgentsClient({ agents: init }: { agents: any[] }) {
  const [agents, setAgents] = useState(init)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const supabase = createClient()

  const filtered = agents.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === "all" || a.status === filter
    return matchSearch && matchFilter
  })

  const submitForReview = async (id: string) => {
    const { error } = await supabase.from("agents").update({ status: "pending_review" }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "pending_review" } : a))
    toast.success("Submitted for review!")
  }

  const archiveAgent = async (id: string) => {
    const { error } = await supabase.from("agents").update({ status: "archived" }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "archived" } : a))
    toast.success("Agent archived")
  }

  const deleteAgent = async (id: string) => {
    if (!confirm("Delete this agent permanently?")) return
    const { error } = await supabase.from("agents").delete().eq("id", id)
    if (error) { toast.error(error.message); return }
    setAgents(prev => prev.filter(a => a.id !== id))
    toast.success("Deleted")
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">My Agents</h1>
          <p className="text-zinc-500 text-sm mt-1">{agents.length} agent{agents.length !== 1 ? "s" : ""} in your portfolio</p>
        </div>
        <Link href="/builder">
          <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
            <Plus className="h-4 w-4" /> New Agent
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1 flex-shrink-0">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5",
                filter === f.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
              {f.label}
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                filter === f.key ? "bg-primary/10 text-primary" : "bg-zinc-100 text-zinc-400")}>
                {f.key === "all" ? agents.length : agents.filter(a => a.status === f.key).length}
              </span>
            </button>
          ))}
        </div>
        <Input placeholder="Search agents…" value={search} onChange={e => setSearch(e.target.value)}
          className="max-w-xs rounded-xl border-zinc-200 h-9 text-sm" />
      </div>

      {/* Agents grid */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-zinc-100 rounded-2xl py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
            <Bot className="h-7 w-7 text-zinc-400" />
          </div>
          <h3 className="font-semibold text-zinc-900 mb-1">{search ? "No agents match" : "No agents yet"}</h3>
          <p className="text-sm text-zinc-400 mb-4">{search ? "Try a different keyword." : "Create your first agent."}</p>
          {!search && <Link href="/builder"><Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700">Create Agent</Button></Link>}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnimatePresence>
            {filtered.map((agent, i) => {
              const status = STATUS_CONFIG[agent.status] || STATUS_CONFIG.draft
              return (
                <motion.div key={agent.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }} transition={{ delay: i * 0.04 }}>
                  <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-sm transition-all group"
                    style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className="w-11 h-11 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                        <CategoryIcon category={agent.category} colored className="h-5 w-5" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <h3 className="font-semibold text-zinc-900 text-sm truncate">{agent.name}</h3>
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0", status.color)}>
                            {status.label}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 capitalize mb-2">
                          {categoryLabel(agent.category)} · {agent.pricing_model?.replace("_", " ")}
                        </p>
                        <p className="text-xs text-zinc-500 line-clamp-1">{agent.description}</p>

                        {/* Stats */}
                        <div className="flex items-center gap-4 mt-3 text-xs text-zinc-400">
                          <span className="flex items-center gap-1 nums"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
                          <span className="flex items-center gap-1 nums"><Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{agent.average_rating?.toFixed(1) || "—"}</span>
                          <span className="flex items-center gap-1 nums font-semibold text-zinc-700 ml-auto">
                            <DollarSign className="h-3 w-3 text-green-500" />{formatCurrency(agent.total_revenue || 0)}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="h-8 w-8 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-900 hover:bg-zinc-50 transition-all opacity-0 group-hover:opacity-100">
                            <span className="text-lg leading-none">⋯</span>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 rounded-2xl shadow-lg">
                          <DropdownMenuItem asChild>
                            <Link href={`/builder/${agent.id}`} className="flex items-center gap-2 text-sm">
                              <Pencil className="h-3.5 w-3.5" /> Edit Agent
                            </Link>
                          </DropdownMenuItem>
                          {agent.status === "active" && (
                            <DropdownMenuItem asChild>
                              <Link href={`/marketplace/${agent.id}`} className="flex items-center gap-2 text-sm">
                                <ArrowUpRight className="h-3.5 w-3.5" /> View Live
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {agent.status === "draft" && (
                            <DropdownMenuItem onClick={() => submitForReview(agent.id)}
                              className="flex items-center gap-2 text-sm text-primary">
                              <CheckCircle className="h-3.5 w-3.5" /> Submit for Review
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {agent.status !== "archived" && (
                            <DropdownMenuItem onClick={() => archiveAgent(agent.id)}
                              className="flex items-center gap-2 text-sm">
                              <EyeOff className="h-3.5 w-3.5" /> Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => deleteAgent(agent.id)}
                            className="flex items-center gap-2 text-sm text-red-500 focus:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

          {/* New agent card */}
          <Link href="/builder">
            <div className="border border-dashed border-zinc-200 rounded-2xl p-5 flex items-center justify-center gap-2 text-zinc-400 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.01] transition-all cursor-pointer h-full min-h-[120px]">
              <Plus className="h-5 w-5" />
              <span className="text-sm font-semibold">Create New Agent</span>
            </div>
          </Link>
        </div>
      )}
    </div>
  )
}
