"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Search, Grid3X3, List, X, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AgentCard } from "@/components/marketplace/agent-card"
import { FeaturedBanner } from "@/components/marketplace/featured-banner"
import { CategoryIcon } from "@/components/ui/category-icon"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { categoryLabel, formatNumber, cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import { createClient } from "@/lib/supabase/client"

const CATEGORIES = [
  "all", "productivity", "coding", "marketing", "finance", "legal",
  "customer_support", "data_analysis", "content", "research", "hr", "sales", "devops", "security", "other",
]
const PRICING_FILTERS = ["all", "free", "per_call", "subscription", "freemium"]
const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "rating",  label: "Top Rated"   },
  { value: "newest",  label: "Newest"       },
  { value: "revenue", label: "Top Earning"  },
]

// ── Data loader — rendered inside Suspense boundary from page.tsx ─────────────
export function MarketplaceLoader() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const supabase     = createClient()

  const [agents,   setAgents]   = useState<any[]>([])
  const [featured, setFeatured] = useState<any[]>([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [view,     setView]     = useState<"grid" | "list">("grid")
  const [search,   setSearch]   = useState(searchParams.get("q") || "")
  const debouncedSearch = useDebounce(search, 400)

  const PAGE_SIZE = 24
  const sp = Object.fromEntries(searchParams.entries())

  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(sp)
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== "all") params.set(k, v)
      else params.delete(k)
    })
    params.delete("page")
    router.push(`${pathname}?${params.toString()}`)
  }, [sp, router, pathname])

  // Sync debounced search → URL
  useEffect(() => {
    updateParams({ q: debouncedSearch || undefined })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  // Fetch data whenever URL params change
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const q        = searchParams.get("q")        || undefined
      const category = searchParams.get("category") || undefined
      const pricing  = searchParams.get("pricing")  || undefined
      const sort     = searchParams.get("sort")     || "popular"
      const page     = parseInt(searchParams.get("page") || "1")

      let query = supabase
        .from("agents")
        .select("*, profiles!seller_id(full_name, username, avatar_url, is_verified)", { count: "exact" })
        .eq("status", "active")

      if (q)                         query = query.textSearch("name", q, { type: "websearch", config: "english" })
      if (category && category !== "all") query = query.eq("category", category)
      if (pricing  && pricing  !== "all") query = query.eq("pricing_model", pricing)

      if      (sort === "popular") query = query.order("total_executions", { ascending: false })
      else if (sort === "rating")  query = query.order("average_rating",   { ascending: false })
      else if (sort === "newest")  query = query.order("created_at",       { ascending: false })
      else if (sort === "revenue") query = query.order("total_revenue",    { ascending: false })

      query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

      const [{ data: agentsData, count }, { data: featuredData }] = await Promise.all([
        query,
        supabase
          .from("agents")
          .select("*, profiles!seller_id(full_name, avatar_url, is_verified)")
          .eq("status",      "active")
          .eq("is_featured", true)
          .limit(3),
      ])

      if (!cancelled) {
        setAgents(agentsData   || [])
        setFeatured(featuredData || [])
        setTotal(count || 0)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()])

  const activeCategory = searchParams.get("category") || "all"
  const activePricing  = searchParams.get("pricing")  || "all"
  const activeSort     = searchParams.get("sort")     || "popular"
  const page           = parseInt(searchParams.get("page") || "1")
  const totalPages     = Math.ceil(total / PAGE_SIZE)
  const hasFilters     = !!(searchParams.get("q") ||
    (searchParams.get("category") && searchParams.get("category") !== "all") ||
    (searchParams.get("pricing")  && searchParams.get("pricing")  !== "all"))

  return (
    <MarketplaceClient
      agents={agents}
      featured={featured}
      total={total}
      loading={loading}
      page={page}
      totalPages={totalPages}
      hasFilters={hasFilters}
      search={search}
      activeCategory={activeCategory}
      activePricing={activePricing}
      activeSort={activeSort}
      view={view}
      onSearch={setSearch}
      onView={setView}
      onUpdateParams={updateParams}
      onClearFilters={() => router.push("/marketplace")}
      onPrev={() => updateParams({ page: String(page - 1) })}
      onNext={() => updateParams({ page: String(page + 1) })}
    />
  )
}

// ── Pure presentational component ────────────────────────────────────────────
interface MarketplaceClientProps {
  agents:          any[]
  featured:        any[]
  total:           number
  loading:         boolean
  page:            number
  totalPages:      number
  hasFilters:      boolean
  search:          string
  activeCategory:  string
  activePricing:   string
  activeSort:      string
  view:            "grid" | "list"
  onSearch:        (v: string) => void
  onView:          (v: "grid" | "list") => void
  onUpdateParams:  (u: Record<string, string | undefined>) => void
  onClearFilters:  () => void
  onPrev:          () => void
  onNext:          () => void
}

function MarketplaceClient({
  agents, featured, total, loading, page, totalPages, hasFilters,
  search, activeCategory, activePricing, activeSort, view,
  onSearch, onView, onUpdateParams, onClearFilters, onPrev, onNext,
}: MarketplaceClientProps) {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* Header */}
        <div className="bg-zinc-50 border-b border-zinc-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 mb-1">
              Agent Marketplace
            </h1>
            <p className="text-zinc-500 text-sm mb-6">
              {formatNumber(total)} production-ready agents · {CATEGORIES.length - 1} categories
            </p>
            <div className="relative max-w-xl">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="search"
                autoComplete="off"
                placeholder="Search agents by name, category, or use case…"
                className="w-full pl-10 pr-10 h-10 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-all"
                value={search}
                onChange={e => onSearch(e.target.value)}
              />
              {search && (
                <button
                  onClick={() => onSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Featured */}
          {featured.length > 0 && !hasFilters && (
            <div className="mb-10">
              <h2 className="text-sm font-semibold text-zinc-900 mb-4 flex items-center gap-2">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> Featured Agents
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {featured.map(agent => <FeaturedBanner key={agent.id} agent={agent} />)}
              </div>
            </div>
          )}

          {/* Filters row */}
          <div className="flex flex-col lg:flex-row gap-4 mb-6">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1 pb-1">
              <button
                onClick={() => onUpdateParams({ category: "all" })}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  activeCategory === "all"
                    ? "bg-zinc-900 border-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-400 bg-white"
                )}
              >
                All
              </button>
              {CATEGORIES.filter(c => c !== "all").map(cat => (
                <button
                  key={cat}
                  onClick={() => onUpdateParams({ category: cat })}
                  className={cn(
                    "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                    activeCategory === cat
                      ? "bg-zinc-900 border-zinc-900 text-white"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400 bg-white"
                  )}
                >
                  <CategoryIcon
                    category={cat}
                    className={cn("h-3 w-3 flex-shrink-0", activeCategory === cat ? "text-white" : "")}
                  />
                  {categoryLabel(cat)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Select value={activePricing} onValueChange={v => onUpdateParams({ pricing: v })}>
                <SelectTrigger className="w-36 h-9 text-xs rounded-xl border-zinc-200">
                  <SelectValue placeholder="Pricing" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {PRICING_FILTERS.map(p => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {p === "all" ? "All Pricing" : p.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={activeSort} onValueChange={v => onUpdateParams({ sort: v })}>
                <SelectTrigger className="w-40 h-9 text-xs rounded-xl border-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {SORT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex border border-zinc-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => onView("grid")}
                  className={cn("p-2 transition-colors", view === "grid" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900 bg-white")}
                  aria-label="Grid view"
                >
                  <Grid3X3 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onView("list")}
                  className={cn("p-2 transition-colors", view === "list" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900 bg-white")}
                  aria-label="List view"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Results count + clear */}
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-zinc-500">
              {loading ? "Loading…" : `${formatNumber(total)} ${hasFilters ? "results" : "agents"}`}
            </p>
            {hasFilters && (
              <button
                onClick={onClearFilters}
                className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
          </div>

          {/* Grid / Loading */}
          {loading ? (
            <div className={view === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
              : "space-y-2"}>
              {[...Array(9)].map((_, i) => (
                <div key={i} className="h-52 bg-zinc-50 border border-zinc-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center py-24">
              <div className="w-12 h-12 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
                <Search className="h-6 w-6 text-zinc-400" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-2">No agents found</h3>
              <p className="text-zinc-500 text-sm">Try different keywords or filters</p>
            </div>
          ) : (
            <div className={view === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
              : "space-y-2"}>
              {agents.map(agent => (
                <AgentCard key={agent.id} agent={agent} view={view} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && !loading && (
            <div className="flex items-center justify-center gap-2 mt-12">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={onPrev}
                className="rounded-xl border-zinc-200 text-sm"
              >
                Previous
              </Button>
              <span className="text-sm text-zinc-500 px-2">Page {page} of {totalPages}</span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={onNext}
                className="rounded-xl border-zinc-200 text-sm"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
