"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { AnalyticsClient } from "./analytics-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    const thirtyDaysAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAgoDay = thirtyDaysAgo.slice(0, 10)

    Promise.all([
      supabase.from("executions")
        .select("created_at, status, latency_ms, tokens_input, tokens_output, agents(name, category)")
        .eq("user_id", user.id)
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: true }),
      supabase.from("agents").select("id").eq("seller_id", user.id),
    ]).then(async ([{ data: executions }, { data: sellerAgents }]) => {
      const agentIds = sellerAgents?.map((a: any) => a.id) ?? []
      let agentAnalytics: any[] = []
      if (agentIds.length > 0) {
        const { data: analytics } = await supabase
          .from("agent_analytics")
          .select("date, revenue, executions, agent_id")
          .in("agent_id", agentIds)
          .gte("date", thirtyDaysAgoDay)
          .order("date", { ascending: true })
        agentAnalytics = analytics ?? []
      }
      setData({ executions: executions || [], agentAnalytics })
    })
  }, [user, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
    )
  }

  return <AnalyticsClient {...data} />
}
