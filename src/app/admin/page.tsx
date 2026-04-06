"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AdminClient } from "./admin-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function AdminPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
      if (profile?.role !== "admin") { router.push("/dashboard"); return }
      const [
        { count: totalUsers }, { count: totalAgents }, { count: pendingAgents },
        { data: recentAgents }, { data: recentUsers }, { data: revenue },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("agents").select("*", { count: "exact", head: true }),
        supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
        supabase.from("agents").select("*, profiles!seller_id(full_name, email)").order("created_at", { ascending: false }).limit(10),
        supabase.from("profiles").select("id, full_name, email, created_at, subscription_plan, role").order("created_at", { ascending: false }).limit(10),
        supabase.from("transactions").select("amount").eq("status", "succeeded"),
      ])
      const totalRevenue = (revenue || []).reduce((s: number, t: any) => s + t.amount, 0)
      setData({ stats: { totalUsers: totalUsers || 0, totalAgents: totalAgents || 0, pendingAgents: pendingAgents || 0, totalRevenue }, recentAgents: recentAgents || [], recentUsers: recentUsers || [] })
    }
    load()
  }, [])
  if (!data) return <div className="p-8 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  return <AdminClient {...data} />
}
