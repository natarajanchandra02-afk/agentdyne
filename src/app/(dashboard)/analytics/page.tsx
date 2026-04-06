export const dynamic = "force-dynamic"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AnalyticsClient } from "./analytics-client"
export const metadata = { title: "Analytics" }
export default async function AnalyticsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: executions } = await supabase.from("executions").select("created_at, status, latency_ms, tokens_input, tokens_output, agents(name, category)").eq("user_id", user.id).gte("created_at", thirtyDaysAgo).order("created_at", { ascending: true })
  const { data: myAgentAnalytics } = await supabase.from("agent_analytics").select("*, agents!inner(name, seller_id)").eq("agents.seller_id", user.id).gte("date", thirtyDaysAgo.slice(0, 10)).order("date", { ascending: true })
  return <AnalyticsClient executions={executions || []} agentAnalytics={myAgentAnalytics || []} />
}
