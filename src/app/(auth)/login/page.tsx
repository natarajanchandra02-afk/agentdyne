"use client"

import { useState } from "react"
import { useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Loader2, Mail, Lock, Github, Chrome,
  Sparkles, Zap, ShieldCheck, Store,
  AlertTriangle, ExternalLink, Copy, Check, KeyRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import toast from "react-hot-toast"

const schema = z.object({
  email:    z.string().email("Enter a valid email"),
  password: z.string().min(8, "Min 8 characters"),
})
type FormData = z.infer<typeof schema>

// ✅ Bug fix: replaced fabricated per-category agent counts ("1,840 Coding
// agents", "12,400+ production-ready AI agents", etc.) with qualitative,
// non-numeric value props. Same class of issue already fixed on the
// homepage — a specific, precise-looking number that isn't real undermines
// trust the moment someone checks it, and there's no honest number here yet
// worth leading with. These describe real, shipped platform capabilities
// instead of unverifiable scale claims.
const VALUE_PROPS = [
  { icon: Zap,         color: "text-blue-500",   bg: "bg-blue-50",   label: "Deploy in one line of code" },
  { icon: ShieldCheck, color: "text-indigo-500", bg: "bg-indigo-50", label: "Sandboxed & rate-limited execution" },
  { icon: Store,        color: "text-pink-500",   bg: "bg-pink-50",   label: "Publish and monetize your agents" },
  { icon: Sparkles,     color: "text-green-500",  bg: "bg-green-50",  label: "Compose multi-agent workflows visually" },
]

// ─── Config-error banner ─────────────────────────────────────────────────────

function ConfigErrorBanner() {
  const [copied, setCopied] = useState(false)

  const vars = [
    { key: "NEXT_PUBLIC_SUPABASE_URL",     val: process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "(not set)" },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", val: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "(not set)" },
  ]

  const copySteps = async () => {
    const text = [
      "# Add to .env.local (local dev):",
      "# Get values from: Supabase Dashboard → your project → Settings → API",
      "",
      "NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...",
      "",
      "# ⚠️  SUPABASE_SERVICE_ROLE_KEY alone is NOT enough for login.",
      "# The browser client needs the two NEXT_PUBLIC_ vars above.",
      "",
      "# Cloudflare Pages: add these in:",
      "#   Project → Settings → Environment Variables → Add variable",
      "#   (Set as 'Production' scope — NOT as build-only secrets)",
    ].join("\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-900">Supabase not configured</p>
          <p className="text-xs text-amber-700 mt-1 leading-relaxed">
            Login requires two <strong>NEXT_PUBLIC_</strong> environment variables.
            The <code className="bg-amber-100 px-1 rounded font-mono">SUPABASE_SERVICE_ROLE_KEY</code> alone is not enough — the browser client uses the anon key.
          </p>

          <div className="mt-3 space-y-1.5">
            {vars.map(v => {
              const isSet = v.val !== "(not set)" && !v.val.includes("your-project")
              return (
                <div key={v.key} className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isSet ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                    {isSet ? "✓ SET" : "✗ MISSING"}
                  </span>
                  <code className="text-[11px] font-mono text-amber-800">{v.key}</code>
                </div>
              )
            })}
          </div>

          <div className="mt-3 text-xs text-amber-800 space-y-1">
            <p className="font-semibold">How to fix:</p>
            <ol className="list-decimal list-inside space-y-0.5 ml-1">
              <li>Open <a href="https://supabase.com/dashboard" target="_blank" rel="noopener" className="underline font-medium">Supabase Dashboard</a> → your project → <strong>Settings → API</strong></li>
              <li>Copy <strong>Project URL</strong> → set as <code className="bg-amber-100 px-1 rounded font-mono">NEXT_PUBLIC_SUPABASE_URL</code></li>
              <li>Copy <strong>anon / public key</strong> → set as <code className="bg-amber-100 px-1 rounded font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
              <li className="font-semibold text-amber-900">
                Cloudflare Pages: add in <strong>Project → Settings → Environment Variables</strong><br />
                <span className="font-normal">(NOT as build secrets — must be Production variables)</span>
              </li>
              <li>Restart dev server or redeploy</li>
            </ol>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={copySteps}
              className="flex items-center gap-1.5 text-xs font-semibold bg-white border border-amber-300 text-amber-800 px-2.5 py-1.5 rounded-lg hover:bg-amber-50 transition-colors"
            >
              {copied ? <><Check className="h-3 w-3 text-green-600" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy setup snippet</>}
            </button>
            <a
              href="https://supabase.com/dashboard/account/projects"
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-amber-700 underline hover:text-amber-900"
            >
              Open Supabase <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <a
              href="/api/debug/config"
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-amber-700 underline hover:text-amber-900"
            >
              Diagnostic <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── LoginPage ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router   = useRouter()
  const supabase = createClient()
  const configured = isSupabaseConfigured()

  const [loading,      setLoading]      = useState(false)
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)

  // ✅ MFA challenge step — added alongside the settings-page enrollment UI.
  // After signInWithPassword succeeds, Supabase issues a session at AAL1.
  // If the account has a verified TOTP factor, getAuthenticatorAssuranceLevel()
  // reports nextLevel:"aal2" while currentLevel is still "aal1" — meaning the
  // password alone isn't sufficient and a code challenge is required before
  // the session can actually access protected routes. This mirrors the
  // server-side enforcement added in middleware.ts, so this step can't be
  // skipped by disabling JS or hitting a protected URL directly — middleware
  // would just bounce back here.
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState("")
  const [mfaCode,      setMfaCode]     = useState("")
  const [mfaVerifying, setMfaVerifying] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  // ✅ Handles the case where middleware bounced an already-signed-in-at-AAL1
  // session back here (e.g. they hit a protected URL directly, or refreshed
  // mid-session before completing their MFA challenge). Reading window.location
  // directly instead of useSearchParams() avoids needing a Suspense boundary
  // for this whole page just for one param check.
  useEffect(() => {
    if (!configured) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("mfa") !== "required") return

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return // no session at all — just show the normal login form
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors()
        const factor = factors?.totp?.find(f => f.status === "verified")
        if (factor) { setMfaFactorId(factor.id); setMfaRequired(true) }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured])

  const onSubmit = async (data: FormData) => {
    if (!configured) {
      toast.error("Supabase is not configured. See the banner above.")
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword(data)
      if (error) throw error

      // Check whether this account requires a second factor before granting
      // access. currentLevel !== nextLevel means a verified factor exists
      // and hasn't been satisfied yet in this session.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors()
        const factor = factors?.totp?.find(f => f.status === "verified")
        if (factor) {
          setMfaFactorId(factor.id)
          setMfaRequired(true)
          setLoading(false)
          return
        }
      }

      router.push("/dashboard")
      router.refresh()
    } catch (err: any) {
      const msg = err?.message ?? "Login failed"
      if (msg.includes("Invalid login credentials")) {
        toast.error("Wrong email or password. Try again.")
      } else if (msg.includes("Email not confirmed")) {
        toast.error("Please confirm your email before signing in.")
      } else if (msg.includes("SUPABASE_NOT_CONFIGURED") || msg.includes("not configured")) {
        toast.error("Supabase is not configured. See the banner above.")
      } else {
        toast.error(msg)
      }
      setLoading(false)
    }
  }

  const verifyMfaCode = async () => {
    if (mfaCode.length !== 6) { toast.error("Enter the 6-digit code"); return }
    setMfaVerifying(true)
    try {
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId })
      if (challengeErr) throw challengeErr

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId:    mfaFactorId,
        challengeId: challenge.id,
        code:        mfaCode,
      })
      if (verifyErr) throw verifyErr

      router.push("/dashboard")
      router.refresh()
    } catch (err: any) {
      toast.error(err.message ?? "Invalid code — check your authenticator app and try again")
      setMfaCode("")
    } finally {
      setMfaVerifying(false)
    }
  }

  const signInWithOAuth = async (provider: "github" | "google") => {
    if (!configured) {
      toast.error("Supabase is not configured. See the banner above.")
      return
    }
    setOauthLoading(provider)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
    } catch (err: any) {
      toast.error(err.message ?? "OAuth failed")
      setOauthLoading(null)
    }
  }

  // ── MFA challenge screen — shown in place of the form after password succeeds ──
  if (mfaRequired) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-5">
            <KeyRound className="h-7 w-7 text-indigo-500" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-900 mb-2">Two-factor authentication</h2>
          <p className="text-zinc-500 text-sm leading-relaxed mb-6">
            Enter the 6-digit code from your authenticator app.
          </p>
          <div className="flex items-center justify-center gap-2 mb-4">
            <Input
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={e => e.key === "Enter" && verifyMfaCode()}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className="rounded-xl border-zinc-200 h-12 font-mono text-center text-lg tracking-widest w-40"
              maxLength={6}
            />
          </div>
          <Button
            onClick={verifyMfaCode}
            disabled={mfaVerifying || mfaCode.length !== 6}
            className="w-full h-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 disabled:opacity-40"
          >
            {mfaVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mfaVerifying ? "Verifying…" : "Verify"}
          </Button>
          <button
            onClick={() => { setMfaRequired(false); setMfaCode(""); setMfaFactorId("") }}
            className="text-xs text-zinc-400 hover:text-zinc-600 mt-4 transition-colors"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex">

      {/* ── Left — form ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          <div className="mb-8">
            <Link href="/">
              <Image
                src="/logo.png" alt="AgentDyne"
                width={130} height={36}
                className="h-8 w-auto object-contain mb-8"
              />
            </Link>
            <h1 className="text-[28px] font-bold tracking-tight text-zinc-900">Welcome back</h1>
            <p className="text-zinc-500 text-sm mt-1.5">Sign in to your AgentDyne account</p>
          </div>

          {!configured && <ConfigErrorBanner />}

          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { provider: "google" as const, icon: Chrome, label: "Google" },
              { provider: "github" as const, icon: Github, label: "GitHub" },
            ].map(({ provider, icon: Icon, label }) => (
              <button
                key={provider}
                type="button"
                onClick={() => signInWithOAuth(provider)}
                disabled={!!oauthLoading || !configured}
                aria-label={`Sign in with ${label}`}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-zinc-200 bg-white text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {oauthLoading === provider
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Icon className="h-4 w-4" />{label}</>
                }
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-6" aria-hidden="true">
            <div className="flex-1 h-px bg-zinc-100" />
            <span className="text-xs text-zinc-400 font-medium">or</span>
            <div className="flex-1 h-px bg-zinc-100" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email" className="text-sm font-medium text-zinc-700">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" aria-hidden="true" />
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="pl-10 h-10 rounded-xl border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-zinc-200"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  {...register("email")}
                />
              </div>
              {errors.email && (
                <p id="email-error" role="alert" className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password" className="text-sm font-medium text-zinc-700">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" aria-hidden="true" />
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-10 h-10 rounded-xl border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-zinc-200"
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? "pw-error" : undefined}
                  {...register("password")}
                />
              </div>
              {errors.password && (
                <p id="pw-error" role="alert" className="text-xs text-red-500">{errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={loading || !configured}
              className="w-full h-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold mt-2 gap-2 disabled:opacity-50"
              aria-busy={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-zinc-500 mt-6">
            Don{"'"}t have an account?{" "}
            <Link href="/signup" className="text-primary hover:underline font-medium">Sign up free</Link>
          </p>
        </div>
      </div>

      {/* ── Right — decorative panel ──────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-1 bg-zinc-50 border-l border-zinc-100 items-center justify-center p-12">
        <div className="max-w-sm text-center">
          <div className="grid grid-cols-2 gap-3 mb-8">
            {VALUE_PROPS.map(item => (
              <div key={item.label} className="bg-white rounded-2xl border border-zinc-100 p-4 text-left shadow-sm">
                <div className={`w-8 h-8 rounded-xl ${item.bg} flex items-center justify-center mb-2`}>
                  <item.icon className={`h-4 w-4 ${item.color}`} aria-hidden="true" />
                </div>
                <p className="text-xs font-medium text-zinc-700">{item.label}</p>
              </div>
            ))}
          </div>
          <h3 className="text-xl font-bold text-zinc-900 mb-2">The AI Agent Economy</h3>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Deploy, compose, and monetize AI agents — all from one platform.
          </p>
        </div>
      </div>
    </div>
  )
}
