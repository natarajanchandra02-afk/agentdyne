"use client"

// NOTE: No `export const runtime = 'edge'` here — this is a client component.
// Edge runtime declarations only apply to Server Components and Route Handlers.

import { useEffect, useState, useRef } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AgentDetailClient } from "./agent-detail-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function AgentDetailPage() {
  const { id }          = useParams<{ id: string }>()
  const [data, setData] = useState<any>(null)
  const [notFound, setNotFound] = useState(false)

  // Stable ref — prevents supabase from being recreated on every render
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
          setData({
            agent,
            reviews:          reviews ?? [],
            user,
            userSubscription: subscription,
          })
        }
      } catch (err) {
        console.error("AgentDetailPage load error:", err)
        if (!cancelled) setNotFound(true)
      }
    }

    load()
    return () => { cancelled = true }
  }, [id]) // supabase is stable via ref — safe to omit from deps

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
      <div className="pt-20 max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  return <AgentDetailClient {...data} />
}
