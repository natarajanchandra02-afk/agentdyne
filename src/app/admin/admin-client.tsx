"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  Users, Bot, DollarSign, AlertCircle, CheckCircle, XCircle,
  ShieldCheck, TrendingUp, Zap, Shield, BarChart3, Eye,
  Ban, RefreshCw, ChevronRight, Search, Filter,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatRelativeTime, getInitials, cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

interface Stats {
  totalUsers:     number
  totalAgents:    number
  pendingAgents:  number
  totalExecutions: number
  totalRevenue:   number
  platformEarned: number
}

interface Props {
  stats:           Stats
  recentAgents:    any[]
  recentUsers:     any[]
  flaggedAttempts: any[]
}

export function AdminClient({ stats, recentAgents: initAgents, recentUsers: initUsers, flaggedAttempts }: Props) {
  const [agents, setAgents] = useState(initAgents)
  const [users,  setUsers]  = useState(initUsers)
  const [agentSearch, setAgentSearch] = useState("")
  const [userSearch,  setUserSearch]  = useState("")
  const [agentFilter, setAgentFilter] = useState<"all" | "pending_review" | "active" | "suspended">("all")
  const supabase = createClient()

  const approveAgent = async (id: string) => {
    const { error } = await supabase.from("agents").update({ status: "active" }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "active" } : a))
    toast.success("Agent approved ✓")
  }

  const rejectAgent = async (id: string) => {
    const { error } = await supabase.from("agents").update({ status: "suspended" }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "suspended" } : a))
    toast.success("Agent rejected")
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

  const filteredUsers = users.filter(u =>
    !userSearch ||
    u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(userSearch.toLowerCase())
  )

  const pendingCount = agents.filter(a => a.status === "pending_review").length

  const METRICS = [
    { label: "Total Users",      value: formatNumber(stats.totalUsers),      icon: Users,      color: "text-primary",    bg: "bg-primary/8",   sub: "registered accounts" },
    { label: "Total Agents",     value: formatNumber(stats.totalAgents),     icon: Bot,        color: "text-violet-600", bg: "bg-violet-50",   sub: `${pendingCount} pending review` },
    { label: "Total Executions", value: formatNumber(stats.totalExecutions), icon: Zap,        color: "text-amber-600",  bg: "bg-amber-50",    sub: "all time" },
    { label: "Gross Revenue",    value: formatCurrency(stats.totalRevenue),  icon: DollarSign, color: "text-green-600",  bg: "bg-green-50",    sub: `${formatCurrency(stats.platformEarned)} platform` },
    { label: "Pending Review",   value: formatNumber(pendingCount),          icon: AlertCircle,color: "text-orange-600", bg: "bg-orange-50",   sub: "needs action" },
    { label: "Security Flags",   value: formatNumber(flaggedAttempts.length),icon: Shield,     color: "text-red-600",    bg: "bg-red-50",      sub: "injection attempts" },
  ]

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Admin Panel</h1>
                <p className="text-zinc-500 text-sm">Platform management · Global view</p>
              </div>
            </div>
            {pendingCount > 0 && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-700">{pendingCount} agent{pendingCount > 1 ? "s" : ""} waiting for review</span>
              </div>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {METRICS.map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className={`w-8 h-8 rounded-xl ${m.bg} flex items-center justify-center mb-2.5`}>
                    <m.icon className={`h-4 w-4 ${m.color}`} />
                  </div>
                  <p className="text-xl font-bold text-zinc-900 nums leading-none mb-0.5">{m.value}</p>
                  <p className="text-[11px] font-medium text-zinc-600">{m.label}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{m.sub}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Tabs */}
          <Tabs defaultValue="agents">
            <TabsList className="bg-zinc-50 border border-zinc-100 p-1 rounded-xl mb-5">
              <TabsTrigger value="agents" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                <Bot className="h-3.5 w-3.5" /> Agents
                {pendingCount > 0 && (
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="users" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                <Users className="h-3.5 w-3.5" /> Users
              </TabsTrigger>
              <TabsTrigger value="security" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                <Shield className="h-3.5 w-3.5" /> Security
                {flaggedAttempts.length > 0 && (
                  <span className="text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                    {flaggedAttempts.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── Agents tab ──────────────────────────────────────────────── */}
            <TabsContent value="agents" className="space-y-4">
              {/* Filter bar */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  <Input value={agentSearch} onChange={e => setAgentSearch(e.target.value)}
                    placeholder="Search agents…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
                </div>
                <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1">
                  {(["all","pending_review","active","suspended"] as const).map(f => (
                    <button key={f} onClick={() => setAgentFilter(f)}
                      className={cn("px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize",
                        agentFilter === f ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>
                      {f.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                {/* Table header */}
                <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <div className="col-span-4">Agent</div>
                  <div className="col-span-2">Category</div>
                  <div className="col-span-2">Seller</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-1">Date</div>
                  <div className="col-span-2 text-right">Actions</div>
                </div>
                <div className="divide-y divide-zinc-50">
                  {filteredAgents.length === 0 ? (
                    <div className="text-center py-10 text-sm text-zinc-400">No agents match</div>
                  ) : filteredAgents.map(agent => (
                    <div key={agent.id} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors">
                      <div className="col-span-4 min-w-0">
                        <p className="font-medium text-sm text-zinc-900 truncate">{agent.name}</p>
                        <p className="text-xs text-zinc-400 truncate mt-0.5 line-clamp-1">{agent.description}</p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-xs text-zinc-500 capitalize">{agent.category?.replace("_", " ")}</span>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <p className="text-xs text-zinc-600 truncate">{agent.profiles?.full_name || "—"}</p>
                        <p className="text-[11px] text-zinc-400 truncate">{agent.profiles?.email || ""}</p>
                      </div>
                      <div className="col-span-1">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                          agent.status === "active"         ? "bg-green-50 text-green-600" :
                          agent.status === "pending_review" ? "bg-amber-50 text-amber-600" :
                          agent.status === "suspended"      ? "bg-red-50 text-red-600" :
                                                              "bg-zinc-100 text-zinc-500")}>
                          {agent.status?.replace("_", " ")}
                        </span>
                      </div>
                      <div className="col-span-1">
                        <span className="text-xs text-zinc-400">{formatRelativeTime(agent.created_at)}</span>
                      </div>
                      <div className="col-span-2 flex items-center justify-end gap-1.5">
                        <Link href={`/marketplace/${agent.id}`} target="_blank">
                          <button className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" title="View">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </Link>
                        {agent.status === "pending_review" && (
                          <>
                            <button onClick={() => approveAgent(agent.id)}
                              className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 hover:bg-green-100 px-2.5 py-1 rounded-lg transition-colors">
                              <CheckCircle className="h-3 w-3" /> Approve
                            </button>
                            <button onClick={() => rejectAgent(agent.id)}
                              className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-2.5 py-1 rounded-lg transition-colors">
                              <XCircle className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                        {agent.status === "active" && (
                          <button onClick={() => rejectAgent(agent.id)}
                            className="text-xs text-zinc-400 hover:text-red-500 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors">
                            Suspend
                          </button>
                        )}
                        {agent.status === "suspended" && (
                          <button onClick={() => approveAgent(agent.id)}
                            className="text-xs text-zinc-400 hover:text-green-600 hover:bg-green-50 px-2.5 py-1 rounded-lg transition-colors">
                            Restore
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* ── Users tab ───────────────────────────────────────────────── */}
            <TabsContent value="users" className="space-y-4">
              <div className="relative max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                <Input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search users…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
              </div>

              <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <div className="col-span-4">User</div>
                  <div className="col-span-2">Plan</div>
                  <div className="col-span-2">Role</div>
                  <div className="col-span-2">Earned</div>
                  <div className="col-span-1">Joined</div>
                  <div className="col-span-1 text-right">Action</div>
                </div>
                <div className="divide-y divide-zinc-50">
                  {filteredUsers.length === 0 ? (
                    <div className="text-center py-10 text-sm text-zinc-400">No users found</div>
                  ) : filteredUsers.map(u => (
                    <div key={u.id} className={cn("grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-zinc-50/50 transition-colors",
                      u.is_banned && "opacity-50")}>
                      <div className="col-span-4 flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-7 w-7 flex-shrink-0">
                          <AvatarFallback className="text-[10px] bg-primary/8 text-primary">
                            {getInitials(u.full_name || u.email || "U")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-900 truncate">{u.full_name || "—"}</p>
                          <p className="text-xs text-zinc-400 truncate">{u.email}</p>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                          u.subscription_plan !== "free" ? "bg-primary/8 text-primary" : "bg-zinc-100 text-zinc-500")}>
                          {u.subscription_plan}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                          u.role === "admin" ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500")}>
                          {u.role}
                        </span>
                        {u.is_banned && <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">banned</span>}
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-zinc-600 nums">{formatCurrency(u.total_earned || 0)}</p>
                        <p className="text-[11px] text-zinc-400">earned</p>
                      </div>
                      <div className="col-span-1">
                        <p className="text-xs text-zinc-400">{formatRelativeTime(u.created_at)}</p>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => banUser(u.id, u.is_banned)}
                          className={cn("p-1.5 rounded-lg transition-colors",
                            u.is_banned
                              ? "text-green-500 hover:bg-green-50"
                              : "text-zinc-400 hover:text-red-500 hover:bg-red-50")}
                          title={u.is_banned ? "Unban" : "Ban"}>
                          {u.is_banned ? <RefreshCw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* ── Security tab ────────────────────────────────────────────── */}
            <TabsContent value="security" className="space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                <Shield className="h-4 w-4 flex-shrink-0" />
                Prompt injection attempts are logged here. Blocked = immediately rejected. Flagged = suspicious but allowed, logged for review.
              </div>
              <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-zinc-50 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <div className="col-span-2">Action</div>
                  <div className="col-span-3">Pattern</div>
                  <div className="col-span-4">Input preview</div>
                  <div className="col-span-2">User</div>
                  <div className="col-span-1">Time</div>
                </div>
                <div className="divide-y divide-zinc-50">
                  {flaggedAttempts.length === 0 ? (
                    <div className="text-center py-10 text-sm text-zinc-400">No flagged attempts — platform is clean ✓</div>
                  ) : flaggedAttempts.map((a: any) => (
                    <div key={a.id} className="grid grid-cols-12 gap-3 px-5 py-3 items-center">
                      <div className="col-span-2">
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                          a.action === "blocked" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600")}>
                          {a.action}
                        </span>
                      </div>
                      <div className="col-span-3">
                        <code className="text-[11px] bg-zinc-50 px-1.5 py-0.5 rounded text-zinc-600 font-mono">
                          {a.pattern}
                        </code>
                      </div>
                      <div className="col-span-4">
                        <p className="text-xs text-zinc-500 line-clamp-1 font-mono">{a.input}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-zinc-400 truncate font-mono">{a.user_id?.slice(0, 8)}…</p>
                      </div>
                      <div className="col-span-1">
                        <p className="text-xs text-zinc-400">{formatRelativeTime(a.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* SQL quickstart for new installs */}
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
