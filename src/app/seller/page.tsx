"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { SellerClient } from "./seller-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function SellerPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("agents").select("*").eq("seller_id", user.id).order("created_at", { ascending: false }),
      supabase.from("payouts").select("*").eq("seller_id", user.id)
        .order("created_at", { ascending: false }).limit(10),
      supabase.from("transactions").select("*").eq("seller_id", user.id)
        .order("created_at", { ascending: false }).limit(20),
    ]).then(([{ data: profile }, { data: agents }, { data: payouts }, { data: transactions }]) => {
      setData({
        profile,
        agents:       agents || [],
        payouts:      payouts || [],
        transactions: transactions || [],
      })
    })
  }, [user, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    )
  }

  return <SellerClient {...data} />
}
