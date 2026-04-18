"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { AnalyticsClient } from "./analytics-client"
import { Loader2 } from "lucide-react"

export default function AnalyticsPage() {
  const [data,    setData]    = useState<any>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false
    const thirtyDaysAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAgoDay = thirtyDaysAgo.slice(0, 10)

    Promise.all([
      supabase.from("executions")
        .select("id, created_at, status, latency_ms, tokens_input, tokens_output, cost_usd, agents(name, category, id)")
        .eq("user_id", user.id)
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: true }),
      supabase.from("agents")
        .select("id")
        .eq("seller_id", user.id),
    ]).then(async ([{ data: executions }, { data: sellerAgents }]) => {
      if (cancelled) return
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
      if (!cancelled) {
        setData({ executions: executions || [], agentAnalytics })
      }
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white border border-zinc-100 rounded-2xl p-5 animate-pulse h-36" />
        ))}
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 pt-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading analytics…
        </div>
      </div>
    )
  }

  return <AnalyticsClient {...data} />
}
