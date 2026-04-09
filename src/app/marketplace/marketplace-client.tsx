"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Search, Grid3X3, List, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AgentCard } from "@/components/marketplace/agent-card"
import { FeaturedBanner } from "@/components/marketplace/featured-banner"
import { CategoryIcon } from "@/components/ui/category-icon"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { categoryLabel, formatNumber, cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"

const CATEGORIES = [
  "all", "productivity", "coding", "marketing", "finance", "legal",
  "customer_support", "data_analysis", "content", "research", "hr", "sales", "devops", "security", "other",
]
const PRICING_FILTERS = ["all", "free", "per_call", "subscription", "freemium"]
const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "rating",  label: "Top Rated" },
  { value: "newest",  label: "Newest" },
  { value: "revenue", label: "Top Earning" },
]

interface Props {
  agents: any[]; featured: any[]; total: number
  page: number; pageSize: number; searchParams: Record<string, string>
}

export function MarketplaceClient({ agents, featured, total, page, pageSize, searchParams: sp }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState(sp.q || "")
  const [view,   setView]   = useState<"grid" | "list">("grid")
  const debouncedSearch     = useDebounce(search, 400)

  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(sp)
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== "all") params.set(k, v)
      else params.delete(k)
    })
    params.delete("page")
    router.push(`${pathname}?${params.toString()}`)
  }, [sp, router, pathname])

  useEffect(() => { updateParams({ q: debouncedSearch || undefined }) }, [debouncedSearch])

  const activeCategory = sp.category || "all"
  const activePricing  = sp.pricing  || "all"
  const activeSort     = sp.sort     || "popular"
  const totalPages     = Math.ceil(total / pageSize)
  const hasFilters     = sp.q || (sp.category && sp.category !== "all") || (sp.pricing && sp.pricing !== "all")

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">
        {/* Header */}
        <div className="bg-zinc-50 border-b border-zinc-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 mb-1">Agent Marketplace</h1>
            <p className="text-zinc-500 text-sm mb-6">
              {formatNumber(total)} production-ready agents · {CATEGORIES.length - 1} categories
            </p>
            <div className="relative max-w-xl">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Search agents by name, category, or use case…"
                className="w-full pl-10 pr-10 h-10 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-all"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
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
            {/* Category pills — icon + label */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1 pb-1">
              {/* All pill */}
              <button
                onClick={() => updateParams({ category: "all" })}
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
                  onClick={() => updateParams({ category: cat })}
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
              <Select value={activePricing} onValueChange={v => updateParams({ pricing: v })}>
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

              <Select value={activeSort} onValueChange={v => updateParams({ sort: v })}>
                <SelectTrigger className="w-40 h-9 text-xs rounded-xl border-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="flex border border-zinc-200 rounded-xl overflow-hidden">
                <button onClick={() => setView("grid")}
                  className={cn("p-2 transition-colors", view === "grid" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900 bg-white")}>
                  <Grid3X3 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setView("list")}
                  className={cn("p-2 transition-colors", view === "list" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900 bg-white")}>
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Results count */}
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-zinc-500">{formatNumber(total)} {hasFilters ? "results" : "agents"}</p>
            {hasFilters && (
              <button onClick={() => router.push("/marketplace")}
                className="text-xs text-primary hover:underline font-medium flex items-center gap-1">
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
          </div>

          {/* Grid */}
          {agents.length === 0 ? (
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
              {agents.map(agent => <AgentCard key={agent.id} agent={agent} view={view} />)}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-12">
              <Button variant="outline" disabled={page <= 1}
                onClick={() => updateParams({ page: String(page - 1) })}
                className="rounded-xl border-zinc-200 text-sm">
                Previous
              </Button>
              <span className="text-sm text-zinc-500 px-2">Page {page} of {totalPages}</span>
              <Button variant="outline" disabled={page >= totalPages}
                onClick={() => updateParams({ page: String(page + 1) })}
                className="rounded-xl border-zinc-200 text-sm">
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

// Missing import — add Star locally
import { Star } from "lucide-react"
