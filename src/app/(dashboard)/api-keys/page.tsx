"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { ApiKeysClient } from "./api-keys-client"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Crown, Key, Lock, Zap, Shield, Code2, Activity,
  ArrowRight, Check, Server, RefreshCw,
} from "lucide-react"

/* ─── Upgrade gate — shown to free plan users ─────────────────────────────────
 *
 * ✅ Bug 12 fix: free users previously landed on this page and saw a blank/
 * broken form because the API returned 403 silently.
 *
 * Correct UX pattern (Apple HIG + Material Design):
 *   Show users what they're MISSING, not just a rejection. A clear upgrade gate
 *   with feature benefits gives them context and a path forward.
 *   Navigation still works (sidebar still navigates here) — the gate lives
 *   inside the page, not in the router.
 * ───────────────────────────────────────────────────────────────────────────── */
function ApiKeysUpgradeGate() {
  const FEATURES = [
    {
      icon: Key,
      title: "HMAC-SHA256 API Keys",
      desc: "Generate secure, hashed API keys for server-side agent calls. Keys are stored as one-way hashes — even a DB breach can't recover them.",
      color: "#6366f1", bg: "#eef2ff",
    },
    {
      icon: Code2,
      title: "Full SDK Quickstart",
      desc: "Ready-to-copy code snippets for cURL, Python, and Node.js. Integrate any AgentDyne agent into your app in under 5 minutes.",
      color: "#22c55e", bg: "#f0fdf4",
    },
    {
      icon: RefreshCw,
      title: "Key Rotation with Zero Downtime",
      desc: "Rotate keys with a 5-minute overlap window — new key activates, old key auto-revokes. No dropped requests during rotation.",
      color: "#3b82f6", bg: "#eff6ff",
    },
    {
      icon: Shield,
      title: "Granular Permissions & IP Allowlists",
      desc: "Scope keys to specific agents, restrict to known IP ranges, and set per-key rate limits. Enterprise-grade access control out of the box.",
      color: "#f59e0b", bg: "#fffbeb",
    },
    {
      icon: Activity,
      title: "Live Usage Analytics",
      desc: "See calls today, total calls, error rate, and cost per key in real time. Spot runaway integrations before they burn your quota.",
      color: "#8b5cf6", bg: "#f5f3ff",
    },
    {
      icon: Server,
      title: "Idempotency & Retry Safety",
      desc: "Pass Idempotency-Key headers to guarantee exactly-once execution even when your client retries on failure.",
      color: "#14b8a6", bg: "#f0fdfa",
    },
  ]

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-8">

      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto">
          <Lock className="h-8 w-8 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">API Keys</h1>
          <p className="text-zinc-500 text-sm mt-2 max-w-md mx-auto leading-relaxed">
            Call any AgentDyne agent from your own server, app, or pipeline.
            API access requires a <strong>Starter plan</strong> or above.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-1">
          <Link
            href="/billing?upgrade=starter"
            className="inline-flex items-center gap-2 bg-zinc-900 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-zinc-700 transition-colors"
          >
            <Crown className="h-4 w-4" />
            Upgrade to Starter — $19/mo
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors px-4 py-2.5 rounded-xl border border-zinc-200 hover:border-zinc-300"
          >
            Compare plans
          </Link>
        </div>
      </div>

      {/* What's included */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
          What you get with API access
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="bg-white border border-zinc-100 rounded-2xl p-4"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                style={{ background: f.bg }}
              >
                <f.icon className="h-4.5 w-4.5" style={{ color: f.color, width: 18, height: 18 }} />
              </div>
              <p className="text-sm font-semibold text-zinc-900 mb-1">{f.title}</p>
              <p className="text-xs text-zinc-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Plan comparison */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-5 py-3.5 border-b border-zinc-50">
          <p className="text-sm font-semibold text-zinc-900">Plan comparison</p>
        </div>
        <div className="divide-y divide-zinc-50">
          {[
            { label: "API key creation",            free: false, starter: true, pro: true },
            { label: "Calls per month",             free: "50 lifetime", starter: "500", pro: "5,000" },
            { label: "Key rotation",                free: false, starter: true, pro: true },
            { label: "IP allowlisting",             free: false, starter: true, pro: true },
            { label: "Agent-scoped permissions",    free: false, starter: true, pro: true },
            { label: "Live usage analytics",        free: false, starter: true, pro: true },
            { label: "Rate limit configuration",    free: false, starter: true, pro: true },
          ].map(row => (
            <div key={row.label} className="grid grid-cols-4 px-5 py-3">
              <span className="text-xs text-zinc-600 col-span-1">{row.label}</span>
              {[row.free, row.starter, row.pro].map((val, i) => (
                <div key={i} className="flex justify-center">
                  {typeof val === "boolean" ? (
                    val
                      ? <Check className="h-4 w-4 text-green-500" />
                      : <span className="text-zinc-300 text-sm">—</span>
                  ) : (
                    <span className="text-xs font-medium text-zinc-700">{val}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div className="grid grid-cols-4 px-5 py-3 bg-zinc-50/50">
            <span className="text-xs text-zinc-400 col-span-1">Plan</span>
            {["Free", "Starter", "Pro"].map((p, i) => (
              <div key={p} className="flex justify-center">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  i === 0 ? "text-zinc-400" : i === 1 ? "text-indigo-600" : "text-violet-600"
                }`}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="text-center space-y-3 pb-4">
        <p className="text-xs text-zinc-400">
          Upgrade takes 30 seconds · Cancel anytime · No contract
        </p>
        <Link
          href="/billing?upgrade=starter"
          className="inline-flex items-center gap-2 bg-zinc-900 text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-zinc-700 transition-colors"
        >
          <Zap className="h-4 w-4" />
          Start building with the API
        </Link>
      </div>
    </div>
  )
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function ApiKeysPage() {
  const [keys, setKeys]     = useState<any[] | null>(null)
  const router              = useRouter()
  const { user, profile, loading: authLoading } = useUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const isFreePlan = !profile?.subscription_plan || profile.subscription_plan === "free"

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }
    // ✅ Don't fetch keys for free-plan users — they can't use them anyway
    if (isFreePlan) return

    let cancelled = false
    supabase
      .from("api_keys")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setKeys(data || [])
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, isFreePlan])

  // Loading skeleton
  if (authLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-32 rounded-xl" />
            <Skeleton className="h-4 w-56 rounded-full" />
          </div>
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    )
  }

  // ✅ Bug 12 fix: free users see the upgrade gate (not a broken empty form)
  if (user && isFreePlan) {
    return <ApiKeysUpgradeGate />
  }

  // Keys still loading for paid users
  if (keys === null) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-32 rounded-xl" />
            <Skeleton className="h-4 w-56 rounded-full" />
          </div>
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    )
  }

  return <ApiKeysClient initialKeys={keys} />
}
