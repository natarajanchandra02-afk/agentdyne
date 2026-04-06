"use client"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { MarketplaceClient } from "./marketplace-client"
import { Skeleton } from "@/components/ui/skeleton"

export default function MarketplacePage() {
  const [data, setData]   = useState<any>(null)
  const searchParams = useSearchParams()
  const supabase     = createClient()

  useEffect(() => {
    async function load() {
      const q        = searchParams.get("q")        || undefined
      const category = searchParams.get("category") || undefined
      const pricing  = searchParams.get("pricing")  || undefined
      const sort     = searchParams.get("sort")     || "popular"
      const page     = parseInt(searchParams.get("page") || "1")
      const pageSize = 24

      let query = supabase
        .from("agents")
        .select("*, profiles!seller_id(full_name, username, avatar_url, is_verified)", { count: "exact" })
        .eq("status", "active")

      if (q)        query = query.textSearch("name", q, { type: "websearch", config: "english" })
      if (category && category !== "all") query = query.eq("category", category)
      if (pricing  && pricing  !== "all") query = query.eq("pricing_model", pricing)
      if (sort === "popular") query = query.order("total_executions", { ascending: false })
      else if (sort === "rating")  query = query.order("average_rating",    { ascending: false })
      else if (sort === "newest")  query = query.order("created_at",        { ascending: false })
      query = query.range((page - 1) * pageSize, page * pageSize - 1)

      const [{ data: agents, count }, { data: featured }] = await Promise.all([
        query,
        supabase.from("agents").select("*, profiles!seller_id(full_name, avatar_url, is_verified)").eq("status", "active").eq("is_featured", true).limit(3),
      ])
      setData({ agents: agents || [], featured: featured || [], total: count || 0, page, pageSize, searchParams: Object.fromEntries(searchParams.entries()) })
    }
    load()
  }, [searchParams.toString()])

  if (!data) return (
    <div className="pt-20 max-w-7xl mx-auto px-6 py-8 grid grid-cols-3 gap-4">
      {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
    </div>
  )
  return <MarketplaceClient {...data} />
}
