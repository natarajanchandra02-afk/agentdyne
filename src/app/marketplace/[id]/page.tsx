"use client"

export const runtime = 'edge'

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AgentDetailClient } from "./agent-detail-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function AgentDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const [data, setData] = useState<any>(null)
  const [notFound, setNotFound] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!id) return
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: agent } = await supabase
        .from("agents")
        .select("*, profiles!seller_id(id, full_name, username, avatar_url, is_verified, bio, total_earned)")
        .eq("id", id)
        .single()
      if (!agent || agent.status !== "active") { setNotFound(true); return }
      const [{ data: reviews }, { data: subscription }] = await Promise.all([
        supabase.from("reviews").select("*, profiles!user_id(full_name, avatar_url)").eq("agent_id", id).eq("status", "approved").order("created_at", { ascending: false }).limit(10),
        user ? supabase.from("agent_subscriptions").select("*").eq("user_id", user.id).eq("agent_id", id).single() : Promise.resolve({ data: null }),
      ])
      setData({ agent, reviews: reviews || [], user, userSubscription: subscription })
    }
    load()
  }, [id])

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Agent not found</p>
    </div>
  )

  if (!data) return (
    <div className="pt-20 max-w-7xl mx-auto px-6 py-8 grid grid-cols-3 gap-4">
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
    </div>
  )

  return <AgentDetailClient {...data} />
}
