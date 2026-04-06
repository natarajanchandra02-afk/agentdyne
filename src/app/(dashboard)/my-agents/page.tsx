"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { MyAgentsClient } from "./my-agents-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function MyAgentsPage() {
  const [agents, setAgents] = useState<any[] | null>(null)
  const router   = useRouter()
  const supabase = createClient()
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const { data } = await supabase.from("agents").select("*").eq("seller_id", user.id).order("created_at", { ascending: false })
      setAgents(data || [])
    }
    load()
  }, [])
  if (agents === null) return <div className="p-8 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
  return <MyAgentsClient agents={agents} />
}
