"use client"
export const dynamic = "force-dynamic"

/**
 * Admin page — data loading strategy
 *
 * All privileged reads go through /api/admin/* server routes which use
 * createAdminClient() (service role key). This bypasses RLS entirely so
 * we see agents from ALL sellers — including pending_review submissions
 * from other users. The anon Supabase client here is used ONLY to
 * validate the session JWT and do the role check.
 */

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { AdminClient } from "./admin-client"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { ShieldCheck, RefreshCw } from "lucide-react"

export default function AdminPage() {
  const [data,        setData]        = useState<any>(null)
  const [denied,      setDenied]      = useState(false)
  const [loadErr,     setLoadErr]     = useState<string | null>(null)
  const [roleChecked, setRoleChecked] = useState(false)

  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login?next=/admin"); return }

    // Always query role fresh — never trust the hook's module-level cache
    // (fixes "access denied" after running UPDATE profiles SET role='admin')
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .then(({ data: p, error }) => {
        if (error || p?.role !== "admin") {
          setDenied(true)
          setRoleChecked(true)
          return
        }
        setRoleChecked(true)
        loadAdminData()
      })

    async function loadAdminData() {
      try {
        // All requests use service-role on the server → RLS bypassed
        const [statsRes, pendingRes, allAgentsRes, usersRes, secRes] = await Promise.all([
          fetch("/api/admin/stats"),
          fetch("/api/admin/agents?status=pending_review&limit=100"),
          fetch("/api/admin/agents?status=all&limit=100"),
          fetch("/api/admin/users?limit=100"),
          fetch("/api/admin/security?limit=50"),
        ])

        const check = async (r: Response, label: string) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
            throw new Error(`${label}: ${body.error ?? r.statusText}`)
          }
          return r.json()
        }

        const [stats, pending, allAgents, users, sec] = await Promise.all([
          check(statsRes,     "Stats"),
          check(pendingRes,   "Pending agents"),
          check(allAgentsRes, "All agents"),
          check(usersRes,     "Users"),
          check(secRes,       "Security"),
        ])

        setData({
          stats: {
            totalUsers:      stats.totalUsers      ?? 0,
            totalAgents:     stats.totalAgents     ?? 0,
            pendingAgents:   stats.pendingAgents   ?? 0,
            totalExecutions: stats.totalExecutions ?? 0,
            totalRevenue:    stats.totalRevenue    ?? 0,
            platformEarned:  stats.platformEarned  ?? 0,
          },
          pendingReviews:  pending.agents   ?? [],
          recentAgents:    allAgents.agents ?? [],
          recentUsers:     users.users      ?? [],
          flaggedAttempts: sec.attempts     ?? [],
        })
      } catch (err: any) {
        console.error("Admin data load failed:", err)
        setLoadErr(err.message ?? "Failed to load admin data")
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  // ── Access denied ──────────────────────────────────────────────────────────
  if (denied) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="h-8 w-8 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 mb-2">Admin Access Required</h1>
            <p className="text-sm text-zinc-500 mb-5">
              Your account does not have admin privileges. Run this in Supabase SQL Editor,
              then <strong>sign out and back in</strong>:
            </p>
            <pre className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-xs font-mono text-zinc-700 text-left overflow-auto">
              {`UPDATE profiles\nSET role = 'admin'\nWHERE email = '${user?.email ?? "your@email.com"}';`}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  // ── Load error ─────────────────────────────────────────────────────────────
  if (loadErr) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <p className="text-sm font-semibold text-zinc-900 mb-1">Failed to load admin data</p>
            <p className="text-xs text-zinc-400 font-mono break-all mb-4">{loadErr}</p>
            <button
              onClick={() => { setLoadErr(null); setData(null); window.location.reload() }}
              className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline mx-auto"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (authLoading || !roleChecked || !data) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <main className="flex-1 p-8 space-y-5">
          <Skeleton className="h-8 w-48 rounded-xl" />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </main>
      </div>
    )
  }

  return <AdminClient {...data} />
}
