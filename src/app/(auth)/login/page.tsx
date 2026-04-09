"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, Mail, Lock, Github, Chrome, Code2, BarChart3, Megaphone, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

const schema = z.object({
  email:    z.string().email("Enter a valid email"),
  password: z.string().min(8, "Min 8 characters"),
})
type FormData = z.infer<typeof schema>

const PANEL_STATS = [
  { icon: Code2,      color: "text-blue-500",   bg: "bg-blue-50",   label: "1,840 Coding agents"    },
  { icon: BarChart3,  color: "text-indigo-500",  bg: "bg-indigo-50", label: "1,100 Data agents"      },
  { icon: Megaphone,  color: "text-pink-500",    bg: "bg-pink-50",   label: "1,230 Marketing agents" },
  { icon: TrendingUp, color: "text-green-500",   bg: "bg-green-50",  label: "980 Finance agents"     },
]

export default function LoginPage() {
  const router   = useRouter()
  const supabase = createClient()
  const [loading, setLoading]           = useState(false)
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword(data)
      if (error) throw error
      router.push("/dashboard")
      router.refresh()
    } catch (err: any) {
      toast.error(err.message || "Login failed")
    } finally { setLoading(false) }
  }

  const signInWithOAuth = async (provider: "github" | "google") => {
    setOauthLoading(provider)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
    } catch (err: any) {
      toast.error(err.message)
      setOauthLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left — form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="mb-10">
            <Link href="/">
              <Image src="/logo.png" alt="AgentDyne" width={130} height={36}
                className="h-8 w-auto object-contain mb-8" />
            </Link>
            <h1 className="text-[28px] font-bold tracking-tight text-zinc-900">Welcome back</h1>
            <p className="text-zinc-500 text-sm mt-1.5">Sign in to your AgentDyne account</p>
          </div>

          {/* OAuth */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { provider: "google" as const, icon: Chrome, label: "Google" },
              { provider: "github" as const, icon: Github, label: "GitHub" },
            ].map(({ provider, icon: Icon, label }) => (
              <button
                key={provider}
                onClick={() => signInWithOAuth(provider)}
                disabled={!!oauthLoading}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-zinc-200 bg-white text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors disabled:opacity-50"
              >
                {oauthLoading === provider
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Icon className="h-4 w-4" />{label}</>
                }
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-zinc-100" />
            <span className="text-xs text-zinc-400 font-medium">or</span>
            <div className="flex-1 h-px bg-zinc-100" />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input
                  type="email"
                  placeholder="you@company.com"
                  className="pl-10 h-10 rounded-xl border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-zinc-200"
                  {...register("email")}
                />
              </div>
              {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-zinc-700">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input
                  type="password"
                  placeholder="••••••••"
                  className="pl-10 h-10 rounded-xl border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-zinc-200"
                  {...register("password")}
                />
              </div>
              {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold mt-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-zinc-500 mt-6">
            Don't have an account?{" "}
            <Link href="/signup" className="text-primary hover:underline font-medium">Sign up free</Link>
          </p>
        </div>
      </div>

      {/* Right — decorative panel */}
      <div className="hidden lg:flex flex-1 bg-zinc-50 border-l border-zinc-100 items-center justify-center p-12">
        <div className="max-w-sm text-center">
          <div className="grid grid-cols-2 gap-3 mb-8">
            {PANEL_STATS.map(item => (
              <div key={item.label} className="bg-white rounded-2xl border border-zinc-100 p-4 text-left shadow-sm">
                <div className={`w-8 h-8 rounded-xl ${item.bg} flex items-center justify-center mb-2`}>
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                </div>
                <p className="text-xs font-medium text-zinc-700">{item.label}</p>
              </div>
            ))}
          </div>
          <h3 className="text-xl font-bold text-zinc-900 mb-2">The AI Agent Economy</h3>
          <p className="text-sm text-zinc-500 leading-relaxed">
            12,400+ production-ready AI agents. Deploy any in one line of code.
          </p>
        </div>
      </div>
    </div>
  )
}
