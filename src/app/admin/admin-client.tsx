"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Users, Bot, DollarSign, AlertCircle, CheckCircle, XCircle, Clock, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
    { label: "Total Users",    value: formatNumber(stats.totalUsers),    icon: Users,        color: "text-blue-500",   bg: "bg-blue-500/10" },
    { label: "Total Agents",   value: formatNumber(stats.totalAgents),   icon: Bot,          color: "text-primary",    bg: "bg-primary/10" },
    { label: "Pending Review", value: formatNumber(stats.pendingAgents), icon: AlertCircle,  color: "text-yellow-500", bg: "bg-yellow-500/10" },
    { label: "Platform Revenue", value: formatCurrency(stats.totalRevenue * 0.2), icon: DollarSign, color: "text-green-500", bg: "bg-green-500/10" },
  ]

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
          <div className="page-header flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
              <p className="text-muted-foreground text-sm">Platform management and moderation</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {METRICS.map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                <Card className="metric-card">
                  <div className={`w-9 h-9 rounded-xl ${m.bg} flex items-center justify-center mb-3`}>
                    <m.icon className={`h-4 w-4 ${m.color}`} />
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{m.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
                </Card>
              </motion.div>
            ))}
          </div>

          <Tabs defaultValue="agents">
            <TabsList>
              <TabsTrigger value="agents">Agents {stats.pendingAgents > 0 && <Badge variant="warning" className="ml-1.5 text-[10px] h-4 px-1.5">{stats.pendingAgents}</Badge>}</TabsTrigger>
              <TabsTrigger value="users">Users</TabsTrigger>
            </TabsList>

            <TabsContent value="agents" className="mt-4">
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {agents.map(agent => (
                    <div key={agent.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-foreground">{agent.name}</span>
                          <Badge variant={
                            agent.status === "active" ? "success" :
                            agent.status === "pending_review" ? "warning" :
                            agent.status === "suspended" ? "destructive" : "secondary"
                          } className="text-[10px]">
                            {agent.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          by {agent.profiles?.full_name} · {formatRelativeTime(agent.created_at)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{agent.description}</p>
                      </div>
                      {agent.status === "pending_review" && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-green-500 border-green-500/30 hover:bg-green-500/10 rounded-xl" onClick={() => approveAgent(agent.id)}>
                            <CheckCircle className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-xl" onClick={() => rejectAgent(agent.id)}>
                            <XCircle className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="users" className="mt-4">
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {recentUsers.map(u => (
                    <div key={u.id} className="flex items-center gap-3 px-6 py-4">
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarFallback className="text-xs">{getInitials(u.full_name || u.email || "U")}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{u.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={u.subscription_plan !== "free" ? "default" : "secondary"} className="text-[10px]">{u.subscription_plan}</Badge>
                        {u.role === "admin" && <Badge variant="destructive" className="text-[10px]">admin</Badge>}
                        <span className="text-xs text-muted-foreground">{formatRelativeTime(u.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
