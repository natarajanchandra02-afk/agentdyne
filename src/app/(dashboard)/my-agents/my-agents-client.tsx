"use client"

import { useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  Bot, Plus, Pencil, Trash2, Eye, EyeOff, Zap, Star,
  DollarSign, Clock, CheckCircle, AlertCircle, FileText, ArrowUpRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createClient } from "@/lib/supabase/client"
import { formatNumber, formatCurrency, formatRelativeTime, categoryLabel, CATEGORY_ICONS } from "@/lib/utils"
import toast from "react-hot-toast"

const STATUS_CONFIG: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" | "info" }> = {
  active:          { label: "Active",          variant: "success"     },
  draft:           { label: "Draft",           variant: "secondary"   },
  pending_review:  { label: "Pending Review",  variant: "warning"     },
  suspended:       { label: "Suspended",       variant: "destructive" },
  archived:        { label: "Archived",        variant: "secondary"   },
}

export function MyAgentsClient({ agents: initialAgents }: { agents: any[] }) {
  const [agents,  setAgents]  = useState(initialAgents)
  const [search,  setSearch]  = useState("")
  const [filter,  setFilter]  = useState("all")
  const supabase = createClient()

  const filtered = agents.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) || a.description?.toLowerCase().includes(search.toLowerCase())
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
    if (!confirm("Delete this agent permanently? This cannot be undone.")) return
    const { error } = await supabase.from("agents").delete().eq("id", id)
    if (error) { toast.error(error.message); return }
    setAgents(prev => prev.filter(a => a.id !== id))
    toast.success("Agent deleted")
  }

  const FILTER_TABS = [
    { key: "all",           label: "All",     count: agents.length },
    { key: "active",        label: "Active",  count: agents.filter(a => a.status === "active").length },
    { key: "draft",         label: "Drafts",  count: agents.filter(a => a.status === "draft").length },
    { key: "pending_review",label: "Review",  count: agents.filter(a => a.status === "pending_review").length },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Agents</h1>
          <p className="text-muted-foreground text-sm mt-1">{agents.length} agent{agents.length !== 1 ? "s" : ""} in your portfolio</p>
        </div>
        <Link href="/builder">
          <Button variant="brand" className="gap-2">
            <Plus className="h-4 w-4" /> New Agent
          </Button>
        </Link>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-muted/60 rounded-xl p-1 flex-shrink-0">
          {FILTER_TABS.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                filter === tab.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}>
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  filter === tab.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
        <Input
          placeholder="Search agents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 max-w-xs"
        />
      </div>

      {/* Agents grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              {search ? "No agents match your search" : "No agents yet"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {search ? "Try a different keyword." : "Create your first agent and start earning."}
            </p>
            {!search && (
              <Link href="/builder">
                <Button variant="brand">Create My First Agent</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnimatePresence>
            {filtered.map((agent, i) => {
              const statusConfig = STATUS_CONFIG[agent.status] || STATUS_CONFIG.draft
              return (
                <motion.div key={agent.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.05 }}>
                  <Card className="hover:border-primary/20 transition-all group">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/10 border border-border flex items-center justify-center text-xl flex-shrink-0">
                          {CATEGORY_ICONS[agent.category] || "🤖"}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-foreground text-sm truncate">{agent.name}</h3>
                            <Badge variant={statusConfig.variant} className="text-[10px] flex-shrink-0">
                              {statusConfig.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                            {categoryLabel(agent.category)} · {agent.pricing_model?.replace("_", " ")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{agent.description}</p>

                          {/* Stats row */}
                          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)} runs</span>
                            <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{agent.average_rating?.toFixed(1) || "—"}</span>
                            <span className="flex items-center gap-1 font-semibold text-foreground"><DollarSign className="h-3 w-3 text-green-500" />{formatCurrency(agent.total_revenue || 0)}</span>
                            <span className="flex items-center gap-1 ml-auto"><Clock className="h-3 w-3" />{formatRelativeTime(agent.created_at)}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-base leading-none">⋯</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem asChild>
                              <Link href={`/builder/${agent.id}`} className="flex items-center gap-2">
                                <Pencil className="h-3.5 w-3.5" /> Edit Agent
                              </Link>
                            </DropdownMenuItem>
                            {agent.status === "active" && (
                              <DropdownMenuItem asChild>
                                <Link href={`/marketplace/${agent.id}`} className="flex items-center gap-2">
                                  <ArrowUpRight className="h-3.5 w-3.5" /> View Live
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {agent.status === "draft" && (
                              <DropdownMenuItem onClick={() => submitForReview(agent.id)} className="flex items-center gap-2 text-primary">
                                <CheckCircle className="h-3.5 w-3.5" /> Submit for Review
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {agent.status !== "archived" && (
                              <DropdownMenuItem onClick={() => archiveAgent(agent.id)} className="flex items-center gap-2">
                                <EyeOff className="h-3.5 w-3.5" /> Archive
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => deleteAgent(agent.id)} className="flex items-center gap-2 text-destructive focus:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
