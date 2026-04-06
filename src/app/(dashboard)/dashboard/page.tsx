"use client"
export default function DashboardPage() {
  // Client-side redirect — DashboardClient handles auth check
  return <DashboardWrapper />
}

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { DashboardClient } from "./dashboard-client"
import { Skeleton } from "@/components/ui/skeleton"

function DashboardWrapper() {
  const [data, setData]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router  = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const [
        { data: profile },
        { data: recentExecutions },
        { data: myAgents },
        { count: totalExecutions },
      ] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("executions").select("*, agents(name, icon_url)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
        supabase.from("agents").select("id, name, status, total_executions, average_rating, total_revenue").eq("seller_id", user.id).order("total_executions", { ascending: false }).limit(5),
        supabase.from("executions").select("*", { count: "exact", head: true }).eq("user_id", user.id),
      ])

      setData({ profile, recentExecutions: recentExecutions || [], myAgents: myAgents || [], totalExecutions: totalExecutions || 0 })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <DashboardSkeleton />
  if (!data) return null
  return <DashboardClient {...data} />
}

function DashboardSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  )
}
