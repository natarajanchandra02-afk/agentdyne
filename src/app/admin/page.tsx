"use client"
export const dynamic = "force-dynamic"

/**
 * Admin page — data loading strategy
 *
 * Previously fetched all data via createClient() (anon key) which is subject
 * to RLS. Result: pendingReviews = [], agent counts = 0 (RLS blocked non-active
 * agents), user data filtered, transaction totals empty.
 *
 * Fix: All privileged reads go through /api/admin/* server routes which use
 * createAdminClient() (service role key) that bypasses RLS entirely.
 *
 * Auth check still uses Supabase client so it's validated server-side.
 */

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { AdminClient } from "./admin-client"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { ShieldCheck } from "lucide-react"

export default function AdminPage() {
  const [data,        setData]        = useState<any>(null)
  const [denied,      setDenied]      = useState(false)
  const [roleChecked, setRoleChecked] = useState(false)
  const [loadErr,     setLoadErr]     = useState<string | null>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  // Singleton anon client — only used for session check
  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login?next=/admin"); return }

    // Verify admin role via direct DB read — never trust client cache
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .then(({ data: profileData, error }) => {
        if (error || profileData?.role !== "admin") {
          setDenied(true)
          setRoleChecked(true)
          return
        }
        setRoleChecked(true)
        loadAdminData()
      })

    async function loadAdminData() {
      try {
        /**
         * All fetches go through authenticated API routes that use
         * createAdminClient() (service role) on the server — they read
         * everything regardless of RLS, giving accurate counts.
         */
        const [
          statsRes,
          pendingRes,
          allAgentsRes,
          usersRes,
          flaggedRes,
        ] = await Promise.all([
          fetch("/api/admin/stats"),
          fetch("/api/admin/agents?status=pending_review&limit=100"),
          fetch("/api/admin/agents?status=all&limit=50"),
          fetch("/api/admin/users?limit=50"),
          fetch("/api/admin/security?limit=50"),
        ])

        // Validate all responses
        if (!statsRes.ok)     throw new Error(`Stats: ${(await statsRes.json()).error}`)
        if (!pendingRes.ok)   throw new Error(`Pending: ${(await pendingRes.json()).error}`)
        if (!allAgentsRes.ok) throw new Error(`Agents: ${(await allAgentsRes.json()).error}`)
        if (!usersRes.ok)     throw new Error(`Users: ${(await usersRes.json()).error}`)
        if (!flaggedRes.ok)   throw new Error(`Security: ${(await flaggedRes.json()).error}`)

        const [stats, pending, allAgents, users, flagged] = await Promise.all([
          statsRes.json(),
          pendingRes.json(),
          allAgentsRes.json(),
          usersRes.json(),
          flaggedRes.json(),
        ])

        setData({
          stats:          stats,
          pendingReviews: pending.agents   ?? [],
          recentAgents:   allAgents.agents ?? [],
          recentUsers:    users.users      ?? [],
          flaggedAttempts: flagged.attempts ?? [],
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
            <p className="text-sm text-red-500 font-medium mb-2">Failed to load admin data</p>
            <p className="text-xs text-zinc-400 font-mono">{loadErr}</p>
            <button
              onClick={() => { setLoadErr(null); setData(null); window.location.reload() }}
              className="mt-4 text-xs font-semibold text-primary underline"
            >
              Retry
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
