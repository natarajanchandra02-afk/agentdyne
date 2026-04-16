"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { BillingClient } from "./billing-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function BillingPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("transactions").select("*").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(20),
    ]).then(([{ data: profile }, { data: transactions }]) => {
      setData({ profile, transactions: transactions || [] })
    })
  }, [user, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    )
  }

  return <BillingClient {...data} />
}
