"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, TrendingUp, Bot, DollarSign, ArrowRight, CheckCircle, XCircle, Clock, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatNumber, formatRelativeTime } from "@/lib/utils";
import { PLANS } from "@/lib/stripe";

interface Props {
  profile: any;
  recentExecutions: any[];
  myAgents: any[];
  totalExecutions: number;
}

const STATUS_ICONS: Record<string, any> = {
  success: <CheckCircle className="h-3.5 w-3.5 text-green-400" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-400" />,
  running: <Clock className="h-3.5 w-3.5 text-yellow-400 animate-spin" />,
  queued: <Clock className="h-3.5 w-3.5 text-blue-400" />,
};

export function DashboardClient({ profile, recentExecutions, myAgents, totalExecutions }: Props) {
  const plan = profile?.subscription_plan || "free";
  const planData = PLANS[plan as keyof typeof PLANS];
  const quota = profile?.monthly_execution_quota || 100;
  const used = profile?.executions_used_this_month || 0;
  const usagePercent = Math.min((used / quota) * 100, 100);

  const stats = [
    { label: "Total Executions", value: formatNumber(totalExecutions), icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "This Month", value: formatNumber(used), icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "My Agents", value: formatNumber(myAgents.length), icon: Bot, color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "Total Earned", value: formatCurrency(profile?.total_earned || 0), icon: DollarSign, color: "text-yellow-400", bg: "bg-yellow-500/10" },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Welcome back, {profile?.full_name?.split(" ")[0] || "Developer"} 👋
          </h1>
          <p className="text-muted-foreground mt-1">Here's what's happening with your agents today.</p>
        </div>
        <Link href="/marketplace">
          <Button className="bg-gradient-brand text-white border-0">
            <Zap className="h-4 w-4 mr-2" /> Explore Agents
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
            <Card className="border-border bg-card/50">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </div>
                <div className="text-2xl font-bold text-white">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Usage */}
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Monthly Usage</CardTitle>
              <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 capitalize">{plan}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">API Calls</span>
                <span className="text-white font-medium">{formatNumber(used)} / {quota === -1 ? "∞" : formatNumber(quota)}</span>
              </div>
              <Progress value={usagePercent} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1.5">Resets in ~{Math.ceil((new Date(profile?.quota_reset_date || Date.now() + 86400000).getTime() - Date.now()) / 86400000)} days</p>
            </div>
            {plan !== "enterprise" && (
              <Link href="/billing">
                <Button variant="outline" size="sm" className="w-full text-xs">
                  Upgrade Plan <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Recent Executions */}
        <Card className="border-border bg-card/50 lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Recent Executions</CardTitle>
              <Link href="/analytics"><Button variant="ghost" size="sm" className="text-xs text-indigo-400">View all</Button></Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentExecutions.length === 0 ? (
              <div className="text-center py-8">
                <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No executions yet</p>
                <Link href="/marketplace"><Button size="sm" className="mt-3 bg-gradient-brand text-white border-0">Try an Agent</Button></Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentExecutions.map((exec: any) => (
                  <div key={exec.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-3">
                      {STATUS_ICONS[exec.status]}
                      <div>
                        <p className="text-sm font-medium text-white">{exec.agents?.name || "Deleted Agent"}</p>
                        <p className="text-xs text-muted-foreground">{formatRelativeTime(exec.created_at)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{exec.latency_ms ? `${exec.latency_ms}ms` : "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* My Agents */}
      {myAgents.length > 0 && (
        <Card className="border-border bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">My Published Agents</CardTitle>
              <Link href="/my-agents"><Button variant="ghost" size="sm" className="text-xs text-indigo-400">Manage all</Button></Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {myAgents.map((agent: any) => (
                <Link key={agent.id} href={`/builder/${agent.id}`}>
                  <div className="p-3 rounded-lg border border-border/50 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all cursor-pointer">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-white truncate">{agent.name}</span>
                      <Badge className={`text-xs ${agent.status === "active" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                        {agent.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
                      <span className="flex items-center gap-1"><Star className="h-3 w-3" />{agent.average_rating?.toFixed(1) || "—"}</span>
                      <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{formatCurrency(agent.total_revenue || 0)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
