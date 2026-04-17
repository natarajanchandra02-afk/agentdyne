"use client"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { BillingClient } from "./billing-client"
import { Skeleton } from "@/components/ui/skeleton"
import { Loader2 } from "lucide-react"
import toast from "react-hot-toast"

function BillingPageInner() {
  const [data,            setData]            = useState<any>(null)
  const [autoUpgrading,   setAutoUpgrading]   = useState(false)
  const router     = useRouter()
  const supabase   = createClient()
  const searchParams = useSearchParams()
  const upgradeParam = searchParams.get("upgrade") // "pro" | "starter" | null
  const successParam = searchParams.get("success")
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

      // Auto-trigger Stripe checkout if ?upgrade=plan is set and user isn't already on it
      const current = profile?.subscription_plan || "free"
      if (upgradeParam && upgradeParam !== current && upgradeParam !== "free") {
        setAutoUpgrading(true)
        fetch("/api/billing/checkout", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ plan: upgradeParam }),
        })
          .then(r => r.json())
          .then(d => {
            if (d.url) {
              window.location.href = d.url
            } else {
              toast.error(d.error || "Failed to open checkout")
              setAutoUpgrading(false)
            }
          })
          .catch(() => {
            toast.error("Checkout unavailable. Please try again.")
            setAutoUpgrading(false)
          })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading])

  // Show success toast when returning from Stripe
  useEffect(() => {
    if (successParam) {
      toast.success("Subscription activated! Your plan has been upgraded.")
    }
  }, [successParam])

  if (authLoading || !data) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    )
  }

  // Show a loading overlay while auto-redirecting to Stripe
  if (autoUpgrading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-zinc-500">Redirecting to secure checkout…</p>
      </div>
    )
  }

  return <BillingClient {...data} />
}

import { Suspense } from "react"
export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    }>
      <BillingPageInner />
    </Suspense>
  )
}
