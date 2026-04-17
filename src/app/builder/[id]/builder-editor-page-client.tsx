"use client"

import { useEffect, useState, useRef, Suspense } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { BuilderEditorClient } from "./builder-editor-client"
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import Link from "next/link"

// Inner component — uses useSearchParams() so must be inside Suspense
function BuilderEditorInner() {
  const { id }       = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const defaultTab   = searchParams.get("defaultTab") || "basics"
  const [agent,   setAgent]   = useState<any>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // Singleton Supabase client — never recreate on every render
  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push("/login"); return }

        const { data, error: fetchErr } = await supabase
          .from("agents")
          .select("*")
          .eq("id", id)
          .eq("seller_id", user.id)
          .single()

        if (cancelled) return

        if (fetchErr || !data) {
          setError(
            fetchErr?.code === "PGRST116"
              ? "Agent not found or you don't have access."
              : (fetchErr?.message || "Failed to load agent.")
          )
          setLoading(false)
          return
        }

        setAgent(data)
        setLoading(false)
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Unexpected error.")
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-zinc-400">Loading agent editor…</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">Agent not found</h2>
            <p className="text-sm text-zinc-500 mb-6">
              {error || "This agent doesn't exist or you don't own it."}
            </p>
            <Link href="/my-agents"
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" />
              Back to My Agents
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <BuilderEditorClient agent={agent} defaultTab={defaultTab} />
}

// Exported default — wraps inner in Suspense for useSearchParams()
export default function BuilderEditorPageClient() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-zinc-400">Loading…</p>
          </div>
        </div>
      </div>
    }>
      <BuilderEditorInner />
    </Suspense>
  )
}
