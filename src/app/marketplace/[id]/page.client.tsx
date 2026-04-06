"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export function AgentDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const client = createClient()

    async function load() {
      setLoading(true)
      const { data } = await client
        .from("agents")
        .select("*")
        .eq("id", id)
        .single()

      setData(data)
      setLoading(false)
    }

    load()
  }, [id])

  if (loading) return <div>Loading...</div>

  return (
    <div>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}
