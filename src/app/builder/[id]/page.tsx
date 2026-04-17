"use client"

export const runtime = 'edge'

import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { BuilderEditorClient } from "./builder-editor-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function BuilderEditorPage() {
  const { id }             = useParams<{ id: string }>()
  const [agent,   setAgent]   = useState<any>(null)
  const [error,   setError]   = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // Stable client — createClient() must NOT be called on every render because
  // it creates a new GoTrueClient instance each time, causing subscription leaks
  // and auth-state race conditions that leave the page blank.
  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push("/login"); return }

        const { data, error: fetchErr } = await supabase
          .from("agents")
          .select("*")
          .eq("id", id)
          .eq("seller_id", user.id)
          .single()

        if (cancelled) return
        if (fetchErr || !data) { setError(true); setLoading(false); return }

        setAgent(data)
        setLoading(false)
      } catch {
        if (!cancelled) { setError(true); setLoading(false) }
      }
    }

    load()
    return () => { cancelled = true }
  }, [id]) // supabase is stable via ref — safe to omit from deps

  if (loading) {
    return (
      <div className="flex min-h-screen bg-white">
        <div className="w-60 border-r border-zinc-100 flex-shrink-0" />
        <div className="flex-1 p-8 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-zinc-900 mb-2">Agent not found</p>
          <p className="text-sm text-zinc-500 mb-4">
            This agent doesn't exist or you don't own it.
          </p>
          <button
            onClick={() => router.push("/my-agents")}
            className="text-primary text-sm hover:underline font-medium"
          >
            ← Back to My Agents
          </button>
        </div>
      </div>
    )
  }

  return <BuilderEditorClient agent={agent} />
}
