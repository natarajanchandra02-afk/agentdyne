"use client"
export const dynamic = 'force-dynamic'

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { AdminClient } from "./admin-client"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { ShieldCheck } from "lucide-react"

export default function AdminPage() {
  const [data,   setData]   = useState<any>(null)
  const [denied, setDenied] = useState(false)
  const [roleChecked, setRoleChecked] = useState(false)
  const router = useRouter()

  // useUser hook gives us the auth user (session). We then do a
  // FRESH DB query for role — never trust the module-level cache
  // because a just-promoted admin still has `role:"user"` in cache.
  const { user, loading: authLoading } = useUser()

  // Singleton supabase client for data loading
  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login?next=/admin"); return }

    // Always fetch role fresh from the DB — never from hook cache
    // This is the fix for "access denied after setting role = 'admin'"
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .then(({ data: profileData }) => {
        if (profileData?.role !== "admin") {
          setDenied(true)
          setRoleChecked(true)
          return
        }
        setRoleChecked(true)
        loadAdminData()
      })

    async function loadAdminData() {
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

      const totalRevenue   = (revenue || []).reduce((s: number, t: any) => s + Number(t.amount), 0)
      const platformEarned = totalRevenue * 0.20

      setData({
        stats: {
          totalUsers:      totalUsers      || 0,
          totalAgents:     totalAgents     || 0,
          pendingAgents:   pendingAgents   || 0,
          totalExecutions: totalExecutions || 0,
          totalRevenue,
          platformEarned,
        },
        recentAgents:    recentAgents    || [],
        recentUsers:     recentUsers     || [],
        flaggedAttempts: flaggedAttempts || [],
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  // ── Access denied ─────────────────────────────────────────────────────────
  if (denied) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="h-8 w-8 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 mb-2">Admin Access Required</h1>
            <p className="text-sm text-zinc-500 mb-5">
              Your account does not have admin privileges. Run this SQL in your Supabase SQL Editor,
              then <strong>sign out and sign back in</strong>:
            </p>
            <pre className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-xs font-mono text-zinc-700 text-left overflow-auto">
              {`UPDATE profiles\nSET role = 'admin'\nWHERE email = '${user?.email ?? "your@email.com"}';`}
            </pre>
            <p className="text-xs text-zinc-400 mt-3">
              After running the SQL, sign out and back in to refresh your session.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (authLoading || !roleChecked || !data) {
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
