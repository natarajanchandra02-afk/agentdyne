"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { MyAgentsClient } from "./my-agents-client"
import { Loader2, Bot } from "lucide-react"

export default function MyAgentsPage() {
  const [agents, setAgents] = useState<any[] | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  // Singleton client — must NOT be created on every render.
  // A new GoTrueClient per render leaks subscriptions and causes
  // race conditions that show stale/empty data until manual refresh.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false

    supabase
      .from("agents")
      .select([
        "id","name","slug","description","category","status",
        "pricing_model","price_per_call","subscription_price_monthly",
        "total_executions","average_rating","total_reviews","total_revenue",
        "is_verified","is_featured","model_name","created_at","updated_at","tags",
      ].join(","))
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error: fetchErr }: { data: any[] | null; error: any }) => {
        if (cancelled) return
        if (fetchErr) { setError(fetchErr.message); setAgents([]) }
        else           { setAgents(data || []) }
      })

    return () => { cancelled = true }
  }, [user, authLoading])

  // Auth resolving
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-zinc-400">Loading your account…</p>
        </div>
      </div>
    )
  }

  // Agents loading
  if (agents === null) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-7 w-32 bg-zinc-100 rounded-xl animate-pulse" />
            <div className="h-4 w-48 bg-zinc-50 rounded-full animate-pulse" />
          </div>
          <div className="h-9 w-28 bg-zinc-100 rounded-xl animate-pulse" />
        </div>
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-8 w-20 bg-zinc-50 rounded-xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white border border-zinc-100 rounded-2xl p-5 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-zinc-100 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-zinc-100 rounded-full" />
                  <div className="h-3 w-1/3 bg-zinc-50 rounded-full" />
                  <div className="h-3 w-full bg-zinc-50 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Error
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
          <Bot className="h-6 w-6 text-red-400" />
        </div>
        <p className="text-sm font-semibold text-zinc-900">Failed to load agents</p>
        <p className="text-xs text-zinc-400 max-w-xs text-center">{error}</p>
        <button
          onClick={() => { setAgents(null); setError(null) }}
          className="text-xs text-primary hover:underline font-semibold mt-1"
        >
          Retry
        </button>
      </div>
    )
  }

  return <MyAgentsClient agents={agents} />
}
