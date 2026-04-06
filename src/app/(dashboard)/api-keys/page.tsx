"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { ApiKeysClient } from "./api-keys-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function ApiKeysPage() {
  const [keys, setKeys]   = useState<any[] | null>(null)
  const router  = useRouter()
  const supabase = createClient()
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const { data } = await supabase.from("api_keys").select("*").eq("user_id", user.id).order("created_at", { ascending: false })
      setKeys(data || [])
    }
    load()
  }, [])
  if (keys === null) return <div className="p-8 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
  return <ApiKeysClient initialKeys={keys} />
}
