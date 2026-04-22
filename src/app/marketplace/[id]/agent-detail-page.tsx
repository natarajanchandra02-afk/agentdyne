"use client"

import { useEffect, useState, useRef } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AgentDetailClient } from "./agent-detail-client"
import { Navbar } from "@/components/layout/navbar"
import { Loader2, AlertTriangle } from "lucide-react"
import Link from "next/link"

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
          .select([
            "*",
            // Bug 9 FIX: total_earned is private seller data — never send to all authenticated users.
            // Only expose safe public fields from the seller profile.
            "profiles!seller_id(id, full_name, username, avatar_url, is_verified, bio)",
          ].join(", "))
          .eq("id", id)
          .single()

        if (agentErr || !agent) {
          if (!cancelled) setNotFound(true)
          return
        }

        // Bug 10 FIX: sellers can view their own non-active agents,
        // but anyone else hitting a non-active agent gets 404.
        const isOwner = user?.id === agent.seller_id
        if (agent.status !== "active" && !isOwner) {
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
            isOwner,          // Bug 10 FIX: pass down so client can show draft banner
          })
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
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="pt-14 min-h-screen flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 rounded-2xl bg-zinc-50 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-lg font-semibold text-zinc-900 mb-2">Agent not found</p>
            <p className="text-sm text-zinc-500 mb-5">
              This agent may have been removed, is pending review, or is no longer active.
            </p>
            <Link href="/marketplace"
              className="text-sm font-semibold text-primary hover:underline">
              ← Back to Marketplace
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="pt-14 min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm text-zinc-400">Loading agent…</p>
          </div>
        </div>
      </div>
    )
  }

  return <AgentDetailClient {...data} />
}
