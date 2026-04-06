export const dynamic = "force-dynamic"
import { createClient } from "@/lib/supabase/server"
import { MarketplaceClient } from "./marketplace-client"
export const metadata = { title: "Marketplace — Discover AI Agents" }

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; pricing?: string; sort?: string; page?: string }
}) {
  const supabase = createClient()
  let query = supabase.from("agents").select("*, profiles!seller_id(full_name, username, avatar_url, is_verified)", { count: "exact" }).eq("status", "active")
  if (searchParams.q) query = query.textSearch("name", searchParams.q, { type: "websearch", config: "english" })
  if (searchParams.category && searchParams.category !== "all") query = query.eq("category", searchParams.category)
  if (searchParams.pricing && searchParams.pricing !== "all") query = query.eq("pricing_model", searchParams.pricing)
  const sort = searchParams.sort || "popular"
  if (sort === "popular") query = query.order("total_executions", { ascending: false })
  else if (sort === "rating") query = query.order("average_rating", { ascending: false })
  else if (sort === "newest") query = query.order("created_at", { ascending: false })
  else if (sort === "revenue") query = query.order("total_revenue", { ascending: false })
  const page = parseInt(searchParams.page || "1")
  const pageSize = 24
  query = query.range((page - 1) * pageSize, page * pageSize - 1)
  const { data: agents, count } = await query
  const { data: featured } = await supabase.from("agents").select("*, profiles!seller_id(full_name, avatar_url, is_verified)").eq("status", "active").eq("is_featured", true).limit(3)
  return <MarketplaceClient agents={agents || []} featured={featured || []} total={count || 0} page={page} pageSize={pageSize} searchParams={searchParams} />
}
