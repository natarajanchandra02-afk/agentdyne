"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Lock, Loader2, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import Image from "next/image"
import toast from "react-hot-toast"

const schema = z.object({
  password: z.string().min(8, "Min 8 characters"),
  confirm:  z.string(),
}).refine(d => d.password === d.confirm, { message: "Passwords do not match", path: ["confirm"] })
type FormData = z.infer<typeof schema>

export default function ResetPasswordPage() {
  const [done, setDone]       = useState(false)
  const [loading, setLoading] = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: data.password })
      if (error) throw error
      setDone(true)
      setTimeout(() => router.push("/dashboard"), 2000)
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
              <h2 className="text-xl font-bold text-zinc-900 mb-2">Password updated!</h2>
              <p className="text-sm text-zinc-500">Redirecting to your dashboard…</p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-zinc-900 mb-1">Set new password</h1>
              <p className="text-sm text-zinc-500 mb-6">Choose a strong password for your account.</p>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-zinc-700">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input type="password" placeholder="Min. 8 characters"
                      className="pl-10 h-10 rounded-xl border-zinc-200" {...register("password")} />
                  </div>
                  {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-zinc-700">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input type="password" placeholder="Repeat password"
                      className="pl-10 h-10 rounded-xl border-zinc-200" {...register("confirm")} />
                  </div>
                  {errors.confirm && <p className="text-xs text-red-500">{errors.confirm.message}</p>}
                </div>
                <Button type="submit" disabled={loading}
                  className="w-full h-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {loading ? "Updating…" : "Update Password"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
