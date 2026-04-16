"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { ApiKeysClient } from "./api-keys-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<any[] | null>(null)
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    supabase
      .from("api_keys")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setKeys(data || []))
  }, [user, authLoading])

  if (authLoading || keys === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48 rounded-xl" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    )
  }

  return <ApiKeysClient initialKeys={keys} />
}
