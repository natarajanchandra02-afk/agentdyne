"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { ExecutionsClient } from "./executions-client"
import { Loader2 } from "lucide-react"

export default function ExecutionsPage() {
  const [data,   setData]   = useState<any>(null)
  const router  = useRouter()
  const { user, loading: authLoading } = useUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false

    Promise.all([
      // Last 200 executions with agent info
      supabase
        .from("executions")
        .select("id, agent_id, status, latency_ms, cost_usd, cost, tokens_input, tokens_output, created_at, agents(id, name, category, icon_url)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
      // Total count
      supabase
        .from("executions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id),
      // Profile for quota info
      supabase
        .from("profiles")
        .select("subscription_plan, monthly_execution_quota, executions_used_this_month")
        .eq("id", user.id)
        .single(),
    ]).then(([
      { data: executions },
      { count },
      { data: profile },
    ]) => {
      if (cancelled) return
      setData({
        executions:      executions || [],
        totalExecutions: count || 0,
        profile,
      })
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-4">
        {/* Header skeleton */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-7 w-52 bg-zinc-100 rounded-xl animate-pulse" />
            <div className="h-4 w-72 bg-zinc-50 rounded-full animate-pulse" />
          </div>
          <div className="h-9 w-28 bg-zinc-100 rounded-xl animate-pulse" />
        </div>
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white border border-zinc-100 rounded-2xl px-4 py-3.5 animate-pulse">
              <div className="h-6 w-12 bg-zinc-100 rounded mb-1" />
              <div className="h-3 w-16 bg-zinc-50 rounded" />
            </div>
          ))}
        </div>
        {/* Table skeleton */}
        <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-zinc-50 animate-pulse">
              <div className="w-8 h-8 rounded-xl bg-zinc-100 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-40 bg-zinc-100 rounded" />
                <div className="h-3 w-24 bg-zinc-50 rounded" />
              </div>
              <div className="h-6 w-20 bg-zinc-100 rounded-full" />
              <div className="h-4 w-14 bg-zinc-50 rounded hidden sm:block" />
              <div className="h-4 w-14 bg-zinc-50 rounded hidden sm:block" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 pt-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading executions…
        </div>
      </div>
    )
  }

  return <ExecutionsClient {...data} />
}
