"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AnalyticsClient } from "./analytics-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const thirtyDaysAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const thirtyDaysAgoDay = thirtyDaysAgo.slice(0, 10)

      // Step 1: fetch user executions (always works — user_id direct filter)
      const { data: executions } = await supabase
        .from("executions")
        .select("created_at, status, latency_ms, tokens_input, tokens_output, agents(name, category)")
        .eq("user_id", user.id)
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: true })

      // Step 2: fetch the seller's agent IDs first (avoids fragile joined-table filter)
      const { data: sellerAgents } = await supabase
        .from("agents")
        .select("id")
        .eq("seller_id", user.id)

      const agentIds = sellerAgents?.map((a: any) => a.id) ?? []

      // Step 3: query agent_analytics only if the user has agents
      let agentAnalytics: any[] = []
      if (agentIds.length > 0) {
        const { data: analyticsData } = await supabase
          .from("agent_analytics")
          .select("date, revenue, executions, agent_id")
          .in("agent_id", agentIds)
          .gte("date", thirtyDaysAgoDay)
          .order("date", { ascending: true })
        agentAnalytics = analyticsData ?? []
      }

      setData({ executions: executions || [], agentAnalytics })
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!data) {
    return (
      <div className="p-8 space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
    )
  }

  return <AnalyticsClient {...data} />
}
