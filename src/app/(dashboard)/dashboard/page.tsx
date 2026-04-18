"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { DashboardClient } from "./dashboard-client"
import { Loader2 } from "lucide-react"

export default function DashboardPage() {
  const [data,    setData]    = useState<any>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  // Singleton — never recreate on every render
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false

    Promise.all([
      supabase.from("profiles")
        .select("*")
        .eq("id", user.id)
        .single(),
      supabase.from("executions")
        .select("id, status, latency_ms, created_at, agents(name, icon_url)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase.from("agents")
        .select("id, name, status, total_executions, average_rating, total_revenue")
        .eq("seller_id", user.id)
        .order("total_executions", { ascending: false })
        .limit(6),
      supabase.from("executions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]).then(([
      { data: profile },
      { data: recentExecutions },
      { data: myAgents },
      { count },
    ]) => {
      if (cancelled) return
      setData({
        profile,
        recentExecutions: recentExecutions || [],
        myAgents:         myAgents || [],
        totalExecutions:  count || 0,
      })
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-7 w-48 bg-zinc-100 rounded-xl animate-pulse" />
            <div className="h-4 w-72 bg-zinc-50 rounded-full animate-pulse" />
          </div>
          <div className="h-9 w-32 bg-zinc-100 rounded-xl animate-pulse" />
        </div>
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white border border-zinc-100 rounded-2xl p-5 animate-pulse">
              <div className="w-9 h-9 rounded-xl bg-zinc-100 mb-3" />
              <div className="h-7 w-16 bg-zinc-100 rounded mb-1" />
              <div className="h-3 w-24 bg-zinc-50 rounded" />
            </div>
          ))}
        </div>
        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="bg-white border border-zinc-100 rounded-2xl p-5 animate-pulse h-48" />
          <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5 animate-pulse h-48" />
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 pt-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading dashboard…
        </div>
      </div>
    )
  }

  return <DashboardClient {...data} />
}
