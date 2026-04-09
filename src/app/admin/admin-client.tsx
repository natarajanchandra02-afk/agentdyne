"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Users, Bot, DollarSign, AlertCircle, CheckCircle, XCircle, ShieldCheck } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { formatCurrency, formatNumber, formatRelativeTime, getInitials } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

interface Stats { totalUsers: number; totalAgents: number; pendingAgents: number; totalRevenue: number }

export function AdminClient({ stats, recentAgents, recentUsers }: { stats: Stats; recentAgents: any[]; recentUsers: any[] }) {
  const [agents, setAgents] = useState(recentAgents)
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

  const METRICS = [
    { label: "Total Users",     value: formatNumber(stats.totalUsers),    icon: Users,       color: "text-primary",    bg: "bg-primary/8" },
    { label: "Total Agents",    value: formatNumber(stats.totalAgents),   icon: Bot,         color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Pending Review",  value: formatNumber(stats.pendingAgents), icon: AlertCircle, color: "text-amber-600",  bg: "bg-amber-50" },
    { label: "Platform Revenue",value: formatCurrency(stats.totalRevenue * 0.2), icon: DollarSign, color: "text-green-600", bg: "bg-green-50" },
  ]

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Admin Panel</h1>
              <p className="text-zinc-500 text-sm">Platform management and moderation</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {METRICS.map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className={`w-9 h-9 rounded-xl ${m.bg} flex items-center justify-center mb-3`}>
                    <m.icon className={`h-4 w-4 ${m.color}`} />
                  </div>
                  <p className="text-2xl font-bold text-zinc-900 nums">{m.value}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 font-medium">{m.label}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Tabs */}
          <Tabs defaultValue="agents">
            <TabsList className="bg-zinc-50 border border-zinc-100 p-1 rounded-xl mb-4">
              <TabsTrigger value="agents" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
                Agents
                {stats.pendingAgents > 0 && (
                  <span className="ml-1.5 text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                    {stats.pendingAgents}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="users" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">Users</TabsTrigger>
            </TabsList>

            <TabsContent value="agents">
              <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="divide-y divide-zinc-50">
                  {agents.map(agent => (
                    <div key={agent.id} className="flex items-center gap-4 px-6 py-4 hover:bg-zinc-50/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-zinc-900 truncate">{agent.name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                            agent.status === "active" ? "bg-green-50 text-green-600" :
                            agent.status === "pending_review" ? "bg-amber-50 text-amber-600" :
                            agent.status === "suspended" ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-500"}`}>
                            {agent.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          by {agent.profiles?.full_name || "Unknown"} · {formatRelativeTime(agent.created_at)}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{agent.description}</p>
                      </div>
                      {agent.status === "pending_review" && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => approveAgent(agent.id)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 hover:bg-green-100 px-3 py-1.5 rounded-xl transition-colors">
                            <CheckCircle className="h-3.5 w-3.5" /> Approve
                          </button>
                          <button onClick={() => rejectAgent(agent.id)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 px-3 py-1.5 rounded-xl transition-colors">
                            <XCircle className="h-3.5 w-3.5" /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {agents.length === 0 && (
                    <div className="text-center py-10 text-sm text-zinc-400">No agents to review</div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="users">
              <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="divide-y divide-zinc-50">
                  {recentUsers.map(u => (
                    <div key={u.id} className="flex items-center gap-3 px-6 py-4 hover:bg-zinc-50/50 transition-colors">
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarFallback className="text-xs bg-primary text-white">
                          {getInitials(u.full_name || u.email || "U")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 truncate">{u.full_name || "—"}</p>
                        <p className="text-xs text-zinc-400 truncate">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          u.subscription_plan !== "free" ? "bg-primary/8 text-primary" : "bg-zinc-100 text-zinc-500"}`}>
                          {u.subscription_plan}
                        </span>
                        {u.role === "admin" && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">admin</span>
                        )}
                        <span className="text-xs text-zinc-400">{formatRelativeTime(u.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>

        </div>
      </main>
    </div>
  )
}
