"use client"
export const dynamic = 'force-dynamic'

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { AdminClient } from "./admin-client"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { Skeleton } from "@/components/ui/skeleton"

export default function AdminPage() {
  const [data, setData]       = useState<any>(null)
  const [denied, setDenied]   = useState(false)
  const router   = useRouter()
  const supabase = createClient()
  const { user, profile, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login?next=/admin"); return }
    if (profile && profile.role !== "admin") { setDenied(true); return }
    if (!profile) return  // still loading profile

    async function load() {
      const [
        { count: totalUsers },
        { count: totalAgents },
        { count: pendingAgents },
        { count: totalExecutions },
        { data: recentAgents },
        { data: recentUsers },
        { data: revenue },
        { data: flaggedAttempts },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("agents").select("*", { count: "exact", head: true }),
        supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
        supabase.from("executions").select("*", { count: "exact", head: true }),
        supabase.from("agents")
          .select("id, name, description, category, status, pricing_model, created_at, profiles!seller_id(full_name, email)")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("profiles")
          .select("id, full_name, email, created_at, subscription_plan, role, is_banned, total_earned, total_spent")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("transactions").select("amount").eq("status", "succeeded"),
        supabase.from("injection_attempts")
          .select("id, user_id, agent_id, input, pattern, action, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ])

      const totalRevenue  = (revenue || []).reduce((s: number, t: any) => s + Number(t.amount), 0)
      const platformEarned = totalRevenue * 0.20

      setData({
        stats: {
          totalUsers:    totalUsers    || 0,
          totalAgents:   totalAgents   || 0,
          pendingAgents: pendingAgents || 0,
          totalExecutions: totalExecutions || 0,
          totalRevenue,
          platformEarned,
        },
        recentAgents:    recentAgents    || [],
        recentUsers:     recentUsers     || [],
        flaggedAttempts: flaggedAttempts || [],
      })
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, authLoading])

  if (denied) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-4xl mb-3">🚫</p>
            <h1 className="text-xl font-bold text-zinc-900">Access Denied</h1>
            <p className="text-sm text-zinc-400 mt-2">You need admin privileges to view this page.</p>
            <p className="text-xs text-zinc-300 mt-2">
              Run this SQL in Supabase:<br />
              <code className="bg-zinc-50 border px-2 py-1 rounded text-xs">
                UPDATE profiles SET role = &apos;admin&apos; WHERE email = &apos;your@email.com&apos;;
              </code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (authLoading || !data) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <main className="flex-1 p-8 space-y-5">
          <Skeleton className="h-8 w-48 rounded-xl" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </main>
      </div>
    )
  }

  return <AdminClient {...data} />
}
