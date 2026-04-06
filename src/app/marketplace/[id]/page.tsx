export const dynamic = "force-dynamic"
import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { AgentDetailClient } from "./agent-detail-client"
import type { Metadata } from "next"

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const supabase = createClient()
  const { data } = await supabase.from("agents").select("name, description").eq("id", params.id).single()
  if (!data) return { title: "Agent Not Found" }
  return { title: data.name, description: data.description }
}

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: agent } = await supabase.from("agents").select("*, profiles!seller_id(id, full_name, username, avatar_url, is_verified, bio, total_earned)").eq("id", params.id).single()
  if (!agent || agent.status !== "active") notFound()
  const { data: reviews } = await supabase.from("reviews").select("*, profiles!user_id(full_name, avatar_url)").eq("agent_id", params.id).eq("status", "approved").order("created_at", { ascending: false }).limit(10)
  const { data: subscription } = user
    ? await supabase.from("agent_subscriptions").select("*").eq("user_id", user.id).eq("agent_id", params.id).single()
    : { data: null }
  return <AgentDetailClient agent={agent} reviews={reviews || []} user={user} userSubscription={subscription} />
}
