"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Mail, ArrowLeft, CheckCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

const schema = z.object({ email: z.string().email("Enter a valid email") })
type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [done, setDone]       = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      })
      if (error) throw error
      setDone(true)
    } catch (e: any) {
      toast.error(e.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Link href="/">
            <Image src="/logo.png" alt="AgentDyne" width={130} height={36}
              className="h-8 w-auto object-contain mb-8" />
          </Link>
        </div>

        <div className="bg-white border border-zinc-100 rounded-2xl p-8" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
          {done ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-7 w-7 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-zinc-900 mb-2">Check your inbox</h2>
              <p className="text-sm text-zinc-500 mb-6 leading-relaxed">
                If an account with that email exists, we've sent a reset link. Check spam if you don't see it.
              </p>
              <Link href="/login">
                <Button variant="outline" className="w-full rounded-xl border-zinc-200">Back to Sign in</Button>
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-zinc-900 mb-1">Forgot password?</h1>
              <p className="text-sm text-zinc-500 mb-6">Enter your email and we'll send a reset link.</p>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-zinc-700">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input type="email" placeholder="you@company.com"
                      className="pl-10 h-10 rounded-xl border-zinc-200" {...register("email")} />
                  </div>
                  {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
                </div>

                <Button type="submit" disabled={loading}
                  className="w-full h-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : "Send Reset Link"}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/login"
                  className="flex items-center justify-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-900 transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
