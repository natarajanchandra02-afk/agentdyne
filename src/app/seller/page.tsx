"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { SellerClient } from "./seller-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function SellerPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const [{ data: profile }, { data: agents }, { data: payouts }, { data: transactions }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("agents").select("*").eq("seller_id", user.id).order("created_at", { ascending: false }),
        supabase.from("payouts").select("*").eq("seller_id", user.id).order("created_at", { ascending: false }).limit(10),
        supabase.from("transactions").select("*").eq("seller_id", user.id).order("created_at", { ascending: false }).limit(20),
      ])
      setData({ profile, agents: agents || [], payouts: payouts || [], transactions: transactions || [] })
    }
    load()
  }, [])
  if (!data) return <div className="p-8 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  return <SellerClient {...data} />
}
