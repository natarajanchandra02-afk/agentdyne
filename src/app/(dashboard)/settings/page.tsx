"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { SettingsClient } from "./settings-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    supabase.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data: profile }) => setData({ user, profile }))
  }, [user, authLoading])

  if (authLoading || !data) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    )
  }

  return <SettingsClient user={data.user} profile={data.profile} />
}
