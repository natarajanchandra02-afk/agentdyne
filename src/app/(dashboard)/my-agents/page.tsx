"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { MyAgentsClient } from "./my-agents-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function MyAgentsPage() {
  const [agents, setAgents] = useState<any[] | null>(null)
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }

    supabase
      .from("agents")
      .select("*")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setAgents(data || []))
  }, [user, authLoading])

  if (authLoading || agents === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48 rounded-xl" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    )
  }

  return <MyAgentsClient agents={agents} />
}
