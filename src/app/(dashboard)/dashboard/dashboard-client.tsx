"use client"

import Link from "next/link"
import { Zap, TrendingUp, Bot, DollarSign, ArrowRight, CheckCircle, XCircle, Clock, Star, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatCurrency, formatNumber, formatRelativeTime } from "@/lib/utils"

interface Props {
  profile: any
  recentExecutions: any[]
  myAgents: any[]
  totalExecutions: number
}

const STATUS_ICON: Record<string, any> = {
  success: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
  failed:  <XCircle    className="h-3.5 w-3.5 text-red-400"   />,
  running: <Clock      className="h-3.5 w-3.5 text-yellow-500 animate-spin" />,
  queued:  <Clock      className="h-3.5 w-3.5 text-zinc-400"  />,
}

export function DashboardClient({ profile, recentExecutions, myAgents, totalExecutions }: Props) {
  const plan  = profile?.subscription_plan || "free"
  const quota = profile?.monthly_execution_quota || 100
  const used  = profile?.executions_used_this_month || 0
  const pct   = Math.min((used / quota) * 100, 100)

  // Time-aware greeting
  const hour     = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  const STATS = [
    { label: "Total Executions", value: formatNumber(totalExecutions), icon: Zap,         color: "text-primary",    bg: "bg-primary/6" },
    { label: "This Month",       value: formatNumber(used),            icon: TrendingUp,  color: "text-green-600",  bg: "bg-green-50" },
    { label: "My Agents",        value: formatNumber(myAgents.length), icon: Bot,         color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Total Earned",     value: formatCurrency(profile?.total_earned || 0), icon: DollarSign, color: "text-amber-600", bg: "bg-amber-50" },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {greeting}, {profile?.full_name?.split(" ")[0] || "Developer"} 👋
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Here's what's happening with your agents.</p>
        </div>
        <Link href="/marketplace">
          <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
            <Zap className="h-4 w-4" /> Explore Agents
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((s, i) => (
          <div key={s.label} className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <p className="text-2xl font-bold text-zinc-900 nums">{s.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Usage */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Monthly Usage</h2>
            <span className="text-xs bg-primary/8 text-primary px-2.5 py-0.5 rounded-full font-semibold capitalize">{plan}</span>
          </div>
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-2 font-medium">
              <span className="text-zinc-500">API Calls</span>
              <span className="text-zinc-900 nums">{formatNumber(used)} / {quota === -1 ? "∞" : formatNumber(quota)}</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
          <p className="text-[11px] text-zinc-400">
            Resets in ~{Math.max(0, Math.ceil((new Date(profile?.quota_reset_date || Date.now() + 86400000).getTime() - Date.now()) / 86400000))} days
          </p>
          {plan === "free" && (
            <Link href="/billing" className="block mt-4">
              <button className="w-full text-xs text-primary font-semibold flex items-center justify-center gap-1 py-2 rounded-xl border border-primary/20 hover:bg-primary/5 transition-colors">
                Upgrade plan <ArrowRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>

        {/* Recent executions */}
        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Recent Executions</h2>
            <Link href="/analytics">
              <button className="text-xs text-primary font-semibold hover:underline">View all</button>
            </Link>
          </div>
          {recentExecutions.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-10 h-10 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-3">
                <Zap className="h-5 w-5 text-zinc-400" />
              </div>
              <p className="text-sm text-zinc-500 mb-3">No executions yet</p>
              <Link href="/marketplace">
                <Button size="sm" className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700">Try an Agent</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              {recentExecutions.map((exec: any) => (
                <div key={exec.id} className="flex items-center justify-between py-2.5 border-b border-zinc-50 last:border-0">
                  <div className="flex items-center gap-2.5">
                    {STATUS_ICON[exec.status] || STATUS_ICON.queued}
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{exec.agents?.name || "Deleted Agent"}</p>
                      <p className="text-xs text-zinc-400">{formatRelativeTime(exec.created_at)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 nums">{exec.latency_ms ? `${exec.latency_ms}ms` : "—"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* My Agents */}
      {myAgents.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">My Published Agents</h2>
            <Link href="/my-agents">
              <button className="text-xs text-primary font-semibold hover:underline">Manage all</button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {myAgents.map((agent: any) => (
              <Link key={agent.id} href={`/builder/${agent.id}`}>
                <div className="p-3.5 rounded-xl border border-zinc-100 hover:border-primary/20 hover:bg-primary/[0.02] transition-all cursor-pointer">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agent.status === "active" ? "bg-green-50 text-green-600" : "bg-zinc-100 text-zinc-500"}`}>
                      {agent.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span className="flex items-center gap-1 nums"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
                    <span className="flex items-center gap-1 nums"><Star className="h-3 w-3" />{agent.average_rating?.toFixed(1) || "—"}</span>
                    <span className="flex items-center gap-1 nums ml-auto font-medium text-zinc-600">{formatCurrency(agent.total_revenue || 0)}</span>
                  </div>
                </div>
              </Link>
            ))}
            <Link href="/builder">
              <div className="p-3.5 rounded-xl border border-dashed border-zinc-200 hover:border-primary/40 hover:bg-primary/[0.02] transition-all cursor-pointer flex items-center justify-center gap-2 text-zinc-400 hover:text-primary">
                <Plus className="h-4 w-4" />
                <span className="text-sm font-medium">New Agent</span>
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
