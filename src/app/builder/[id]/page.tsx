"use client"

export const runtime = 'edge'

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { BuilderEditorClient } from "./builder-editor-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function BuilderEditorPage() {
  const { id }   = useParams<{ id: string }>()
  const [agent, setAgent]   = useState<any>(null)
  const [error, setError]   = useState(false)
  const [loading, setLoading] = useState(true)
  const router   = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (!id) return
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("id", id)
        .eq("seller_id", user.id)
        .single()

      if (error || !data) { setError(true); setLoading(false); return }
      setAgent(data)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return (
    <div className="flex min-h-screen bg-background">
      <div className="w-60 border-r border-border" />
      <div className="flex-1 p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-lg font-semibold">Agent not found</p>
        <p className="text-muted-foreground text-sm mt-1">This agent doesn't exist or you don't own it.</p>
        <button onClick={() => router.push("/my-agents")} className="mt-4 text-primary text-sm hover:underline">
          Back to My Agents
        </button>
      </div>
    </div>
  )

  return <BuilderEditorClient agent={agent} />
}
