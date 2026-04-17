"use client"
import { useEffect, useState, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { BillingClient } from "./billing-client"
import { Loader2 } from "lucide-react"
import toast from "react-hot-toast"

function BillingPageInner() {
  const [data,          setData]          = useState<any>(null)
  const [autoUpgrading, setAutoUpgrading] = useState(false)
  const [upgradeError,  setUpgradeError]  = useState<string | null>(null)
  const router       = useRouter()
  const searchParams  = useSearchParams()
  const upgradeParam  = searchParams.get("upgrade")  // "pro" | "starter" | null
  const successParam  = searchParams.get("success")
  const canceledParam = searchParams.get("canceled")
  const { user, loading: authLoading } = useUser()

  // Singleton Supabase client
  const { createClient } = require("@/lib/supabase/client")
  const supabaseRef = useRef<any>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false
    Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("transactions").select("*").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(20),
    ]).then(([{ data: profile }, { data: transactions }]) => {
      if (cancelled) return
      setData({ profile, transactions: transactions || [] })

      // Auto-trigger Stripe checkout when ?upgrade=plan param is present
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
            if (cancelled) return
            if (d.url) {
              window.location.href = d.url
            } else {
              // Stripe not configured or plan not found — show billing page normally
              const msg = d.error || "Checkout unavailable. Please configure Stripe price IDs."
              setUpgradeError(msg)
              toast.error(msg)
              setAutoUpgrading(false)
            }
          })
          .catch(err => {
            if (cancelled) return
            toast.error("Checkout failed. Please try again.")
            setAutoUpgrading(false)
          })
      }
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading])

  useEffect(() => {
    if (successParam) toast.success("Subscription activated! Welcome to the upgraded plan.")
    if (canceledParam) toast("Checkout was cancelled — you can try again any time.")
  }, [successParam, canceledParam])

  // Auth resolving
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    )
  }

  // Data loading
  if (!data) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 bg-zinc-50 border border-zinc-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    )
  }

  // Auto-redirecting to Stripe
  if (autoUpgrading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-sm font-semibold text-zinc-900">Redirecting to secure checkout…</p>
          <p className="text-xs text-zinc-400 mt-1">You&apos;ll be back here once payment is confirmed.</p>
        </div>
      </div>
    )
  }

  // Stripe not configured — show billing page with error banner
  return (
    <>
      {upgradeError && (
        <div className="mb-4 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
          <strong>Checkout unavailable:</strong> {upgradeError}
          {upgradeError.includes("price ID") && (
            <span> Set <code className="font-mono">STRIPE_PRO_PRICE_ID</code> and <code className="font-mono">STRIPE_STARTER_PRICE_ID</code> in your environment variables.</span>
          )}
        </div>
      )}
      <BillingClient {...data} />
    </>
  )
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    }>
      <BillingPageInner />
    </Suspense>
  )
}
