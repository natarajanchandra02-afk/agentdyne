"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { SettingsClient } from "./settings-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsPage() {
  const [data, setData] = useState<any>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  // Singleton client — never recreate on re-render
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false
    supabase.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data: profile }) => {
        if (!cancelled) setData({ user, profile })
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-40 bg-zinc-100 rounded-xl animate-pulse" />
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    )
  }

  return <SettingsClient user={data.user} profile={data.profile} />
}
