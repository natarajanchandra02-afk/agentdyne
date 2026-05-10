"use client"
export const dynamic = "force-dynamic"

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

    supabase.from("profiles").select("role").eq("id", user.id).single()
      .then(({ data: p, error }) => {
        if (error || p?.role !== "admin") {
          setDenied(true); setRoleChecked(true); return
        }
        setRoleChecked(true)
        loadAdminData()
      })

    async function loadAdminData() {
      try {
        // Critical routes — throw on failure
        const [statsRes, pendingRes, allAgentsRes, usersRes, secRes] = await Promise.all([
          fetch("/api/admin/stats"),
          fetch("/api/admin/agents?status=pending_review&limit=100"),
          fetch("/api/admin/agents?status=all&limit=100"),
          fetch("/api/admin/users?limit=100"),
          fetch("/api/admin/security?limit=50"),
        ])

        const check = async (r: Response, label: string) => {
          if (!r.ok) {
            const b = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
            throw new Error(`${label}: ${b.error ?? r.statusText}`)
          }
          return r.json()
        }

        const [stats, pending, allAgents, users, sec] = await Promise.all([
          check(statsRes,    "Stats"),
          check(pendingRes,  "Pending agents"),
          check(allAgentsRes,"All agents"),
          check(usersRes,    "Users"),
          check(secRes,      "Security"),
        ])

        // Non-critical routes — null on failure (panels show empty state)
        const safe = (r: Response) => r.ok ? r.json().catch(() => null) : Promise.resolve(null)
        const [econ, routing, execHealth, credits, queue, marketplace] = await Promise.all([
          fetch("/api/admin/economics").then(safe),
          fetch("/api/admin/routing").then(safe),
          fetch("/api/admin/execution-health").then(safe),
          fetch("/api/admin/credits").then(safe),
          fetch("/api/admin/queue").then(safe),
          fetch("/api/admin/marketplace-intel").then(safe),
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
          economics:  econ,
          routing,
          execHealth,
          credits,
          queue,
          marketplace,
        })
      } catch (err: any) {
        console.error("Admin data load failed:", err)
        setLoadErr(err.message ?? "Failed to load admin data")
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  if (denied) return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 mb-2">Admin Access Required</h1>
          <p className="text-sm text-zinc-500 mb-5">
            Run this in Supabase SQL Editor, then <strong>sign out and back in</strong>:
          </p>
          <pre className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-xs font-mono text-zinc-700 text-left overflow-auto">
            {`UPDATE profiles\nSET role = 'admin'\nWHERE email = '${user?.email ?? "your@email.com"}';`}
          </pre>
        </div>
      </div>
    </div>
  )

  if (loadErr) return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <p className="text-sm font-semibold text-zinc-900 mb-1">Failed to load admin data</p>
          <p className="text-xs text-zinc-400 font-mono break-all mb-4">{loadErr}</p>
          <button
            onClick={() => { setLoadErr(null); setData(null); window.location.reload() }}
            className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 hover:underline mx-auto"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      </div>
    </div>
  )

  if (authLoading || !roleChecked || !data) return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 p-6 space-y-4">
        {/* Top bar skeleton */}
        <div className="bg-white border border-zinc-100 rounded-2xl h-16 animate-pulse" />
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white border border-zinc-100 rounded-2xl h-28 animate-pulse" />
          ))}
        </div>
        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-zinc-100 rounded-2xl h-56 animate-pulse" />
          <div className="bg-white border border-zinc-100 rounded-2xl h-56 animate-pulse" />
        </div>
        <div className="bg-white border border-zinc-100 rounded-2xl h-72 animate-pulse" />
      </main>
    </div>
  )

  return <AdminClient {...data} />
}
