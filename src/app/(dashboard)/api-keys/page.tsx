"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { ApiKeysClient } from "./api-keys-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<any[] | null>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    let cancelled = false
    supabase
      .from("api_keys")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setKeys(data || [])
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading])

  if (authLoading || keys === null) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-32 rounded-xl" />
            <Skeleton className="h-4 w-56 rounded-full" />
          </div>
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    )
  }

  return <ApiKeysClient initialKeys={keys} />
}
