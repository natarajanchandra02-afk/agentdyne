"use client"
// FIX: Use useUser hook instead of direct supabase.auth.getUser() in useEffect.
// The previous version called getUser() immediately on mount after a client-side
// navigation, before the auth singleton had re-validated the JWT.
// Result: user was null for ~200ms → redirected to /login → blank page until F5.

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { BuilderEditorClient } from "./builder-editor-client"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"

function LoadingSkeleton() {
  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col">
        {/* Header skeleton */}
        <div className="h-14 border-b border-zinc-100 flex items-center px-6 gap-4">
          <Skeleton className="h-8 w-8 rounded-xl" />
          <Skeleton className="h-5 w-48 rounded-lg" />
          <Skeleton className="h-5 w-16 rounded-full ml-2" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-8 w-20 rounded-xl" />
            <Skeleton className="h-8 w-32 rounded-xl" />
          </div>
        </div>
        {/* Body skeleton */}
        <div className="flex flex-1">
          <div className="flex-1 p-8 space-y-5">
            <Skeleton className="h-10 w-80 rounded-xl" />
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <div className="w-80 border-l border-zinc-100 p-6 space-y-4">
            <Skeleton className="h-5 w-24 rounded-lg" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BuilderEditorPage() {
  const { id }   = useParams<{ id: string }>()
  const [agent,    setAgent]    = useState<any>(null)
  const [notFound, setNotFound] = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  // useUser gives us stable auth state via onAuthStateChange — much more reliable
  // than a one-shot getUser() call on mount after soft navigation.
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    // Wait for auth to fully resolve before doing anything
    if (authLoading) return
    if (!user) {
      router.push(`/login?next=/builder/${id}`)
      return
    }
    if (!id) return

    let cancelled = false

    async function loadAgent() {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("id", id)
        .eq("seller_id", user!.id)
        .single()

      if (cancelled) return

      if (error || !data) {
        setNotFound(true)
      } else {
        setAgent(data)
      }
    }

    loadAgent()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, authLoading])

  // Still resolving auth or fetching agent
  if (authLoading || (!agent && !notFound)) {
    return <LoadingSkeleton />
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🤖</span>
            </div>
            <p className="text-lg font-semibold text-zinc-900">Agent not found</p>
            <p className="text-sm text-zinc-400 mt-1">
              This agent doesn&apos;t exist or you don&apos;t have access to it.
            </p>
            <Button
              onClick={() => router.push("/my-agents")}
              className="mt-5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700"
            >
              Back to My Agents
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return <BuilderEditorClient agent={agent} />
}
