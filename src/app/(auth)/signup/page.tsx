"use client"

import { useState, Suspense } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, Mail, Lock, User, Github, Chrome, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

const schema = z.object({
  full_name:        z.string().min(2, "Name must be at least 2 characters"),
  email:            z.string().email("Enter a valid email"),
  password:         z.string().min(8, "Min 8 characters"),
  confirm_password: z.string(),
}).refine(d => d.password === d.confirm_password, {
  message: "Passwords do not match",
  path:    ["confirm_password"],
})
type FormData = z.infer<typeof schema>

// Valid plan keys — used to validate the ?plan= param
const VALID_PLANS = new Set(["starter", "pro"])

function SignupForm() {
  const router      = useRouter()
  const params      = useSearchParams()
  const supabase    = createClient()

  // Capture ?plan= from URL — used to redirect to billing upgrade after signup
  const rawPlan     = params.get("plan") ?? ""
  const planParam   = VALID_PLANS.has(rawPlan) ? rawPlan : ""

  // After email confirmation, Supabase calls /auth/callback.
  // We pass `next` so the callback redirects to billing upgrade.
  // /auth/callback validates that `next` starts with "/" (safe path).
  const postSignupPath = planParam
    ? `/billing?upgrade=${planParam}`
    : "/dashboard"

  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.signUp({
        email:    data.email,
        password: data.password,
        options:  {
          data:        { full_name: data.full_name },
          // After clicking the email confirmation link, redirect here.
          // /auth/callback reads ?next= and validates it before redirecting.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(postSignupPath)}`,
        },
      })
      if (error) throw error
      setDone(true)
    } catch (err: any) {
      toast.error(err.message || "Signup failed")
    } finally {
      setLoading(false)
    }
  }

  const signInWithOAuth = async (provider: "github" | "google") => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(postSignupPath)}`,
        },
      })
      if (error) throw error
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  if (done) return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-5">
          <CheckCircle className="h-7 w-7 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-900 mb-2">Check your email</h2>
        <p className="text-zinc-500 text-sm leading-relaxed mb-6">
          We sent a confirmation link to your email. Click it to activate your account
          {planParam && ` and start your ${planParam.charAt(0).toUpperCase() + planParam.slice(1)} trial`}.
        </p>
        <Link href="/login">
          <Button variant="outline" className="rounded-xl border-zinc-200">Back to Sign in</Button>
        </Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <Link href="/">
              <Image src="/logo.png" alt="AgentDyne" width={130} height={36}
                className="h-8 w-auto object-contain mb-8" />
            </Link>
            <h1 className="text-[28px] font-bold tracking-tight text-zinc-900">Create an account</h1>
            <p className="text-zinc-500 text-sm mt-1.5">
              {planParam
                ? `Start your ${planParam.charAt(0).toUpperCase() + planParam.slice(1)} trial — no credit card required`
                : "Start building and deploying agents today"}
            </p>
            {planParam && (
              <div className="mt-3 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-2 rounded-xl font-semibold">
                14-day free trial · No credit card required · Cancel anytime
              </div>
            )}
          </div>

          {/* OAuth */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { provider: "google" as const, icon: Chrome, label: "Google" },
              { provider: "github" as const, icon: Github, label: "GitHub" },
            ].map(({ provider, icon: Icon, label }) => (
              <button key={provider} onClick={() => signInWithOAuth(provider)}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-zinc-200 bg-white text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors">
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-zinc-100" />
            <span className="text-xs text-zinc-400 font-medium">or</span>
            <div className="flex-1 h-px bg-zinc-100" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input placeholder="John Smith"
                  className="pl-10 h-10 rounded-xl border-zinc-200"
                  {...register("full_name")} />
              </div>
              {errors.full_name && <p className="text-xs text-red-500">{errors.full_name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input type="email" placeholder="you@company.com"
                  className="pl-10 h-10 rounded-xl border-zinc-200"
                  {...register("email")} />
              </div>
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input type="password" placeholder="Min. 8 characters"
                  className="pl-10 h-10 rounded-xl border-zinc-200"
                  {...register("password")} />
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input type="password" placeholder="Repeat password"
                  className="pl-10 h-10 rounded-xl border-zinc-200"
                  {...register("confirm_password")} />
              </div>
              {errors.confirm_password && <p className="text-xs text-red-500">{errors.confirm_password.message}</p>}
            </div>

            <Button type="submit" disabled={loading}
              className="w-full h-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold mt-1">
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {loading ? "Creating account…" : planParam ? `Start ${planParam.charAt(0).toUpperCase() + planParam.slice(1)} Trial` : "Create account"}
            </Button>
          </form>

          <p className="text-center text-xs text-zinc-400 mt-4">
            By signing up you agree to our{" "}
            <Link href="/terms" className="text-primary hover:underline">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          </p>

          <p className="text-center text-sm text-zinc-500 mt-4">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">Sign in</Link>
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="hidden lg:flex flex-1 bg-zinc-50 border-l border-zinc-100 items-center justify-center p-12">
        <div className="max-w-sm">
          <div className="space-y-3 mb-8">
            {[
              "Publish your first agent in under 10 minutes",
              "Reach 89,000+ developers worldwide",
              "Earn 80% of every transaction — we take 20%",
              "40+ MCP integrations, zero infrastructure headaches",
            ].map(item => (
              <div key={item} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="h-3 w-3 text-primary" />
                </div>
                <p className="text-sm text-zinc-700 leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-zinc-100 p-5 shadow-sm">
            <div className="flex gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-1 flex-1 rounded-full bg-primary" />
              ))}
            </div>
            <p className="text-sm text-zinc-600 italic">
              "Made $12K in my first month as a seller. AgentDyne handles everything."
            </p>
            <p className="text-xs text-zinc-400 mt-2 font-medium">— Priya S., Agent Creator</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Wrap in Suspense because useSearchParams() requires it in Next.js 15
export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  )
}
