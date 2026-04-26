"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  Users, Bot, DollarSign, AlertCircle, CheckCircle, XCircle,
  ShieldCheck, Zap, Shield, Eye, Ban, RefreshCw, Search,
  Star, ClipboardList, ExternalLink, ChevronDown, ChevronUp,
  Tag, Cpu, Hash, MessageSquare, Calendar, ArrowUpRight,
} from "lucide-react"
import { SlidingTabs }                               from "@/components/ui/sliding-tabs"
import { Input }                                     from "@/components/ui/input"
import { Textarea }                                  from "@/components/ui/textarea"
import { Avatar, AvatarFallback }                   from "@/components/ui/avatar"
import { DashboardSidebar }                          from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatRelativeTime, getInitials, cn } from "@/lib/utils"
import { createClient }                              from "@/lib/supabase/client"
import toast                                         from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  totalUsers:      number
  totalAgents:     number
  pendingAgents:   number
  totalExecutions: number
  totalRevenue:    number
  platformEarned:  number
}

interface AgentReview {
  id: string; name: string; description: string; category: string; status: string
  pricing_model: string; price_per_call: number | null; subscription_price_monthly: number | null
  model_name: string; temperature: number; max_tokens: number; tags: string[]
  capability_tags: string[]; created_at: string; updated_at: string
  profiles: { full_name: string; email: string; is_verified?: boolean } | null
}

interface Props {
  stats: Stats; recentAgents: any[]; recentUsers: any[]
  flaggedAttempts: any[]; pendingReviews: AgentReview[]
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-50 text-green-600", pending_review: "bg-amber-50 text-amber-600",
    suspended: "bg-red-50 text-red-600", draft: "bg-zinc-100 text-zinc-500",
  }
  return <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", map[status] ?? "bg-zinc-100 text-zinc-500")}>{status?.replace(/_/g, " ")}</span>
}

// ─── Review card ──────────────────────────────────────────────────────────────

function ReviewCard({ agent, onApprove, onReject }: {
  agent: AgentReview; onApprove: (id: string) => Promise<void>; onReject: (id: string, reason: string) => Promise<void>
}) {
  const [expanded,     setExpanded]     = useState(false)
  const [rejecting,    setRejecting]    = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [loadingAction, setLoadingAction] = useState<"approve" | "reject" | null>(null)

  const handleApprove = async () => { setLoadingAction("approve"); await onApprove(agent.id); setLoadingAction(null) }
  const handleReject  = async () => {
    if (!rejectReason.trim()) { toast.error("Please provide a rejection reason"); return }
    setLoadingAction("reject"); await onReject(agent.id, rejectReason); setLoadingAction(null)
  }

  return (
    <motion.div layout className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-zinc-900 text-sm">{agent.name}</h3>
              <StatusBadge status={agent.status} />
              <span className="text-[10px] text-zinc-400">{agent.category?.replace(/_/g, " ")}</span>
            </div>
            <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{agent.description}</p>
            {agent.profiles && (
              <p className="text-[11px] text-zinc-400 mt-1.5">
                By <strong>{agent.profiles.full_name || agent.profiles.email}</strong>
                {agent.profiles.is_verified && " ✓"} · {new Date(agent.created_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors">
              {expanded ? <><ChevronUp className="h-3.5 w-3.5" /> Less</> : <><ChevronDown className="h-3.5 w-3.5" /> Details</>}
            </button>
            <button onClick={handleApprove} disabled={loadingAction !== null}
              className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              <CheckCircle className="h-3.5 w-3.5" />
              {loadingAction === "approve" ? "Approving…" : "Approve"}
            </button>
            <button onClick={() => setRejecting(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors">
              <XCircle className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>

        <AnimatePresence>
          {rejecting && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="mt-3 space-y-2 overflow-hidden">
              <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
                placeholder="Rejection reason (shown to seller)…" className="rounded-xl border-zinc-200 text-sm resize-none" />
              <div className="flex gap-2">
                <button onClick={handleReject} disabled={loadingAction !== null}
                  className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  {loadingAction === "reject" ? "Rejecting…" : "Confirm Reject"}
                </button>
                <button onClick={() => setRejecting(false)} className="text-xs text-zinc-400 hover:text-zinc-700 px-3 py-1.5 rounded-lg">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t border-zinc-50 px-5 py-4 space-y-3 overflow-hidden bg-zinc-50/50">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Model",      value: agent.model_name?.replace("claude-", "Claude ") },
                { label: "Pricing",    value: agent.pricing_model?.replace(/_/g, " ") },
                { label: "Max tokens", value: String(agent.max_tokens) },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">{f.label}</p>
                  <p className="text-xs font-semibold text-zinc-700 capitalize">{f.value}</p>
                </div>
              ))}
            </div>
            {(agent.tags?.length > 0 || agent.capability_tags?.length > 0) && (
              <div>
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...(agent.tags ?? []), ...(agent.capability_tags ?? [])].map(tag => (
                    <span key={tag} className="text-[11px] font-medium px-2 py-0.5 bg-white border border-zinc-100 rounded-full text-zinc-600">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Description</p>
              <p className="text-xs text-zinc-600 leading-relaxed bg-white border border-zinc-100 rounded-xl px-4 py-3">{agent.description}</p>
            </div>
            {agent.profiles && (
              <div className="flex items-center gap-3 bg-white border border-zinc-100 rounded-xl px-4 py-3">
                <Avatar className="h-8 w-8"><AvatarFallback className="text-xs bg-primary/8 text-primary">{getInitials(agent.profiles.full_name || agent.profiles.email || "?")}</AvatarFallback></Avatar>
                <div>
                  <p className="text-xs font-semibold text-zinc-900">{agent.profiles.full_name || "Unknown seller"}</p>
                  <p className="text-[11px] text-zinc-400">{agent.profiles.email}</p>
                </div>
                {agent.profiles.is_verified && <CheckCircle className="h-4 w-4 text-green-500 ml-auto" />}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminClient({ stats, recentAgents: initAgents, recentUsers: initUsers, flaggedAttempts, pendingReviews: initPendingReviews }: Props) {
  const [agents,         setAgents]         = useState(initAgents)
  const [users,          setUsers]          = useState(initUsers)
  const [pendingReviews, setPendingReviews] = useState<AgentReview[]>(initPendingReviews)
  const [agentSearch,    setAgentSearch]    = useState("")
  const [userSearch,     setUserSearch]     = useState("")
  const [agentFilter,    setAgentFilter]    = useState<"all" | "pending_review" | "active" | "suspended">("all")
  const supabase = createClient()

  const approveReview = useCallback(async (id: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "approve" }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error || "Failed to approve"); return }
    setPendingReviews(prev => prev.filter(a => a.id !== id))
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "active" } : a))
    toast.success("Agent approved and is now live ✓")
  }, [])

  const rejectReview = useCallback(async (id: string, reason: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "reject", reason }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error || "Failed to reject"); return }
    setPendingReviews(prev => prev.filter(a => a.id !== id))
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "draft" } : a))
    toast.success("Agent rejected — seller notified")
  }, [])

  const approveAgent = async (id: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "approve" }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "active" } : a))
    toast.success("Agent approved ✓")
  }

  const rejectAgent = async (id: string) => {
    const res = await fetch("/api/admin/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: id, action: "suspend", reason: "Admin moderation" }) })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "suspended" } : a))
    toast.success("Agent suspended")
  }

  const banUser = async (id: string, isBanned: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_banned: !isBanned }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setUsers(prev => prev.map(u => u.id === id ? { ...u, is_banned: !isBanned } : u))
    toast.success(isBanned ? "User unbanned" : "User banned")
  }

  const filteredAgents = agents.filter(a => {
    const matchSearch = !agentSearch || a.name.toLowerCase().includes(agentSearch.toLowerCase())
    const matchFilter = agentFilter === "all" || a.status === agentFilter
    return matchSearch && matchFilter
  })
  const filteredUsers = users.filter(u => !userSearch || u.email?.toLowerCase().includes(userSearch.toLowerCase()) || u.full_name?.toLowerCase().includes(userSearch.toLowerCase()))

  const pendingCount    = pendingReviews.length
  const agentTabPending = agents.filter(a => a.status === "pending_review").length
  const [activeAdminTab, setActiveAdminTab] = useState(pendingCount > 0 ? "reviews" : "agents")

  const METRICS = [
    { label: "Total Users",      value: formatNumber(stats.totalUsers),      icon: Users,        color: "text-primary",    bg: "bg-primary/8",  sub: "registered" },
    { label: "Total Agents",     value: formatNumber(stats.totalAgents),     icon: Bot,          color: "text-violet-600", bg: "bg-violet-50",  sub: `${agentTabPending} pending` },
    { label: "Total Executions", value: formatNumber(stats.totalExecutions), icon: Zap,          color: "text-amber-600",  bg: "bg-amber-50",   sub: "all time" },
    { label: "Gross Revenue",    value: formatCurrency(stats.totalRevenue),  icon: DollarSign,   color: "text-green-600",  bg: "bg-green-50",   sub: `${formatCurrency(stats.platformEarned)} platform` },
    { label: "Pending Review",   value: formatNumber(pendingCount),          icon: ClipboardList,color: "text-orange-600", bg: "bg-orange-50",  sub: "needs action" },
    { label: "Security Flags",   value: formatNumber(flaggedAttempts.length),icon: Shield,       color: "text-red-600",    bg: "bg-red-50",     sub: "injection attempts" },
  ]

  const tabVariants = {
    enter:  { opacity: 0, y: 8  },
    center: { opacity: 1, y: 0,  transition: { duration: 0.20, ease: [0.25, 0.46, 0.45, 0.94] as const } },
    exit:   { opacity: 0, y: -5, transition: { duration: 0.14, ease: [0.55, 0.06, 0.68, 0.19] as const } },
  }

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center"><ShieldCheck className="h-5 w-5 text-red-600" /></div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Admin Panel</h1>
                <p className="text-zinc-500 text-sm">Platform management · Global view</p>
              </div>
            </div>
            {pendingCount > 0 && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-700">{pendingCount} submission{pendingCount > 1 ? "s" : ""} waiting for review</span>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {METRICS.map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className={`w-8 h-8 rounded-xl ${m.bg} flex items-center justify-center mb-2.5`}><m.icon className={`h-4 w-4 ${m.color}`} /></div>
                  <p className="text-xl font-bold text-zinc-900 nums leading-none mb-0.5">{m.value}</p>
                  <p className="text-[11px] font-medium text-zinc-600">{m.label}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{m.sub}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* SlidingTabs */}
          <div>
            <SlidingTabs
              variant="card"
              bg="bg-zinc-50 border border-zinc-100"
              tabs={[
                { id: "reviews",  label: "Review Submissions", icon: ClipboardList, badge: pendingCount > 0 ? String(pendingCount) : undefined },
                { id: "agents",   label: "All Agents",         icon: Bot,           badge: agentTabPending > 0 ? String(agentTabPending) : undefined },
                { id: "users",    label: "Users",              icon: Users },
                { id: "security", label: "Security",           icon: Shield,        badge: flaggedAttempts.length > 0 ? String(flaggedAttempts.length) : undefined, danger: flaggedAttempts.length > 0 },
              ]}
              active={activeAdminTab}
              onChange={setActiveAdminTab}
              className="mb-5"
            />

            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={activeAdminTab} variants={tabVariants} initial="enter" animate="center" exit="exit">

              {/* Reviews */}
              {activeAdminTab === "reviews" && (
                <div className="space-y-4">
                  {pendingCount === 0 ? (
                    <div className="bg-white border border-zinc-100 rounded-2xl flex flex-col items-center justify-center py-16 text-center" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mb-3"><CheckCircle className="h-6 w-6 text-green-500" /></div>
                      <h3 className="font-semibold text-zinc-900 text-sm mb-1">All caught up!</h3>
                      <p className="text-xs text-zinc-400 max-w-xs">No agent submissions waiting for review. New submissions appear here automatically.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <span><strong>{pendingCount}</strong> agent{pendingCount > 1 ? "s" : ""} submitted for review. Rejected agents return to <em>draft</em> status.</span>
                      </div>
                      <div className="space-y-3">{pendingReviews.map(agent => <ReviewCard key={agent.id} agent={agent} onApprove={approveReview} onReject={rejectReview} />)}</div>
                    </>
                  )}
                </div>
              )}

              {/* All Agents */}
              {activeAdminTab === "agents" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                      <Input value={agentSearch} onChange={e => setAgentSearch(e.target.value)} placeholder="Search agents…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
                    </div>
                    <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1">
                      {(["all","pending_review","active","suspended"] as const).map(f => (
                        <button key={f} onClick={() => setAgentFilter(f)} className={cn("px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize", agentFilter === f ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>{f.replace(/_/g, " ")}</button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      <div className="col-span-4">Agent</div><div className="col-span-2">Category</div><div className="col-span-2">Seller</div><div className="col-span-1">Status</div><div className="col-span-1">Date</div><div className="col-span-2 text-right">Actions</div>
                    </div>
                    <div className="divide-y divide-zinc-50">
                      {filteredAgents.length === 0 ? <div className="text-center py-10 text-sm text-zinc-400">No agents match</div>
                      : filteredAgents.map(agent => (
                        <div key={agent.id} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors">
                          <div className="col-span-4 min-w-0"><p className="font-medium text-sm text-zinc-900 truncate">{agent.name}</p><p className="text-xs text-zinc-400 truncate mt-0.5">{agent.description}</p></div>
                          <div className="col-span-2"><span className="text-xs text-zinc-500 capitalize">{agent.category?.replace(/_/g, " ")}</span></div>
                          <div className="col-span-2 min-w-0"><p className="text-xs text-zinc-600 truncate">{agent.profiles?.full_name || "—"}</p><p className="text-[11px] text-zinc-400 truncate">{agent.profiles?.email || ""}</p></div>
                          <div className="col-span-1"><StatusBadge status={agent.status} /></div>
                          <div className="col-span-1"><span className="text-xs text-zinc-400">{formatRelativeTime(agent.created_at)}</span></div>
                          <div className="col-span-2 flex items-center justify-end gap-1.5">
                            <Link href={`/marketplace/${agent.id}`} target="_blank"><button className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"><Eye className="h-3.5 w-3.5" /></button></Link>
                            {agent.status === "pending_review" && <>
                              <button onClick={() => approveAgent(agent.id)} className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 hover:bg-green-100 px-2.5 py-1 rounded-lg"><CheckCircle className="h-3 w-3" /> Approve</button>
                              <button onClick={() => rejectAgent(agent.id)}  className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-2.5 py-1 rounded-lg"><XCircle className="h-3 w-3" /> Reject</button>
                            </>}
                            {agent.status === "active"    && <button onClick={() => rejectAgent(agent.id)}  className="text-xs text-zinc-400 hover:text-red-500 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors">Suspend</button>}
                            {agent.status === "suspended" && <button onClick={() => approveAgent(agent.id)} className="text-xs text-zinc-400 hover:text-green-600 hover:bg-green-50 px-2.5 py-1 rounded-lg transition-colors">Restore</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Users */}
              {activeAdminTab === "users" && (
                <div className="space-y-4">
                  <div className="relative max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                    <Input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search users…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
                  </div>
                  <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      <div className="col-span-4">User</div><div className="col-span-2">Plan</div><div className="col-span-2">Role</div><div className="col-span-2">Earned</div><div className="col-span-1">Joined</div><div className="col-span-1 text-right">Action</div>
                    </div>
                    <div className="divide-y divide-zinc-50">
                      {filteredUsers.length === 0 ? <div className="text-center py-10 text-sm text-zinc-400">No users found</div>
                      : filteredUsers.map(u => (
                        <div key={u.id} className={cn("grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors", u.is_banned && "opacity-50")}>
                          <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                            <Avatar className="h-7 w-7 flex-shrink-0"><AvatarFallback className="text-[10px] bg-primary/8 text-primary">{getInitials(u.full_name || u.email || "U")}</AvatarFallback></Avatar>
                            <div className="min-w-0"><p className="text-sm font-medium text-zinc-900 truncate">{u.full_name || "—"}</p><p className="text-xs text-zinc-400 truncate">{u.email}</p></div>
                          </div>
                          <div className="col-span-2"><span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.subscription_plan !== "free" ? "bg-primary/8 text-primary" : "bg-zinc-100 text-zinc-500")}>{u.subscription_plan}</span></div>
                          <div className="col-span-2">
                            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", u.role === "admin" ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500")}>{u.role}</span>
                            {u.is_banned && <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">banned</span>}
                          </div>
                          <div className="col-span-2"><p className="text-xs text-zinc-600 nums">{formatCurrency(u.total_earned || 0)}</p><p className="text-[11px] text-zinc-400">earned</p></div>
                          <div className="col-span-1"><p className="text-xs text-zinc-400">{formatRelativeTime(u.created_at)}</p></div>
                          <div className="col-span-1 flex justify-end">
                            <button onClick={() => banUser(u.id, u.is_banned)} className={cn("p-1.5 rounded-lg transition-colors", u.is_banned ? "text-green-500 hover:bg-green-50" : "text-zinc-400 hover:text-red-500 hover:bg-red-50")} title={u.is_banned ? "Unban" : "Ban"}>
                              {u.is_banned ? <RefreshCw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Security */}
              {activeAdminTab === "security" && (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                    <Shield className="h-4 w-4 flex-shrink-0" />
                    Injection attempts logged here. <strong className="mx-1">Blocked</strong> = rejected immediately. <strong className="mx-1">Flagged</strong> = logged for review.
                  </div>
                  <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      <div className="col-span-2">Action</div><div className="col-span-3">Pattern</div><div className="col-span-4">Input preview</div><div className="col-span-2">User</div><div className="col-span-1">Time</div>
                    </div>
                    <div className="divide-y divide-zinc-50">
                      {flaggedAttempts.length === 0 ? (
                        <div className="text-center py-10 text-sm text-zinc-400 flex flex-col items-center gap-2"><Shield className="h-6 w-6 text-green-400" />No flagged attempts — platform is clean ✓</div>
                      ) : flaggedAttempts.map((a: any) => (
                        <div key={a.id} className="grid grid-cols-12 gap-3 px-5 py-3 items-center">
                          <div className="col-span-2"><span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", a.action === "blocked" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600")}>{a.action}</span></div>
                          <div className="col-span-3"><code className="text-[11px] bg-zinc-50 px-1.5 py-0.5 rounded text-zinc-600 font-mono">{a.pattern}</code></div>
                          <div className="col-span-4"><p className="text-xs text-zinc-500 line-clamp-1 font-mono">{a.input}</p></div>
                          <div className="col-span-2"><p className="text-xs text-zinc-400 truncate font-mono">{a.user_id?.slice(0, 8)}…</p></div>
                          <div className="col-span-1"><p className="text-xs text-zinc-400">{formatRelativeTime(a.created_at)}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              </motion.div>
            </AnimatePresence>
          </div>

          {/* Admin setup reminder */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Admin Setup</p>
            <p className="text-xs text-zinc-500 mb-2">To grant admin access, run in Supabase SQL Editor:</p>
            <code className="block text-[11px] font-mono bg-white border border-zinc-200 rounded-xl px-4 py-3 text-zinc-700 leading-relaxed">
              UPDATE public.profiles SET role = &apos;admin&apos; WHERE email = &apos;your@email.com&apos;;
            </code>
          </div>

        </div>
      </main>
    </div>
  )
}
