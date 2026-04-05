import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AdminClient } from "./admin-client"
export const metadata = { title: "Admin Panel" }

export default async function AdminPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") redirect("/dashboard")

  const [
    { count: totalUsers },
    { count: totalAgents },
    { count: pendingAgents },
    { data: recentAgents },
    { data: recentUsers },
    { data: revenue },
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("agents").select("*", { count: "exact", head: true }),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase.from("agents").select("*, profiles!seller_id(full_name, email)").order("created_at", { ascending: false }).limit(10),
    supabase.from("profiles").select("id, full_name, email, created_at, subscription_plan, role").order("created_at", { ascending: false }).limit(10),
    supabase.from("transactions").select("amount").eq("status", "succeeded"),
  ])

  const totalRevenue = (revenue || []).reduce((s: number, t: any) => s + t.amount, 0)

  return (
    <AdminClient
      stats={{ totalUsers: totalUsers || 0, totalAgents: totalAgents || 0, pendingAgents: pendingAgents || 0, totalRevenue }}
      recentAgents={recentAgents || []}
      recentUsers={recentUsers || []}
    />
  )
}
