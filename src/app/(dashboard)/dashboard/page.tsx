"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { DashboardClient } from "./dashboard-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardPage() {
  const [data, setData]       = useState<any>(null)
  const router  = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("executions")
        .select("*, agents(name, icon_url)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("agents")
        .select("id, name, status, total_executions, average_rating, total_revenue")
        .eq("seller_id", user.id)
        .order("total_executions", { ascending: false })
        .limit(5),
      supabase.from("executions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]).then(([{ data: profile }, { data: recentExecutions }, { data: myAgents }, { count }]) => {
      setData({
        profile,
        recentExecutions: recentExecutions || [],
        myAgents:         myAgents || [],
        totalExecutions:  count || 0,
      })
    })
  }, [user, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    )
  }

  return <DashboardClient {...data} />
}
