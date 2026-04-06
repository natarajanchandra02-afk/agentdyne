"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { SettingsClient } from "./settings-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsPage() {
  const [data, setData] = useState<any>(null)
  const router   = useRouter()
  const supabase = createClient()
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
      setData({ user, profile })
    }
    load()
  }, [])
  if (!data) return <div className="p-8 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  return <SettingsClient user={data.user} profile={data.profile} />
}
