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
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const [{ data: executions }, { data: agentAnalytics }] = await Promise.all([
        supabase.from("executions").select("created_at, status, latency_ms, tokens_input, tokens_output, agents(name, category)").eq("user_id", user.id).gte("created_at", thirtyDaysAgo).order("created_at", { ascending: true }),
        supabase.from("agent_analytics").select("*, agents!inner(name, seller_id)").eq("agents.seller_id", user.id).gte("date", thirtyDaysAgo.slice(0, 10)).order("date", { ascending: true }),
      ])
      setData({ executions: executions || [], agentAnalytics: agentAnalytics || [] })
    }
    load()
  }, [])
  if (!data) return <div className="p-8 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
  return <AnalyticsClient {...data} />
}
