"use client"

import { useEffect, useState, useRef } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AgentDetailClient } from "./agent-detail-client"
import { Loader2 } from "lucide-react"

export default function AgentDetailPage() {
  const { id }          = useParams<{ id: string }>()
  const [data, setData] = useState<any>(null)
  const [notFound, setNotFound] = useState(false)

  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        const { data: agent, error: agentErr } = await supabase
          .from("agents")
          .select("*, profiles!seller_id(id, full_name, username, avatar_url, is_verified, bio, total_earned)")
          .eq("id", id)
          .single()

        if (agentErr || !agent || agent.status !== "active") {
          if (!cancelled) setNotFound(true)
          return
        }

        const [{ data: reviews }, { data: subscription }] = await Promise.all([
          supabase
            .from("reviews")
            .select("*, profiles!user_id(full_name, avatar_url)")
            .eq("agent_id", id)
            .eq("status", "approved")
            .order("created_at", { ascending: false })
            .limit(10),
          user
            ? supabase
                .from("agent_subscriptions")
                .select("*")
                .eq("user_id", user.id)
                .eq("agent_id", id)
                .single()
            : Promise.resolve({ data: null }),
        ])

        if (!cancelled) {
          setData({ agent, reviews: reviews ?? [], user, userSubscription: subscription })
        }
      } catch {
        if (!cancelled) setNotFound(true)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-zinc-900 mb-2">Agent not found</p>
          <p className="text-sm text-zinc-500">This agent may have been removed or is no longer active.</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-zinc-400">Loading agent…</p>
        </div>
      </div>
    )
  }

  return <AgentDetailClient {...data} />
}
