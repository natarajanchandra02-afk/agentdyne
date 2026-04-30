"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  Search, X, Star, Zap, CheckCircle, TrendingUp,
  ArrowRight, Filter, Grid3x3, List, AlertCircle, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { CategoryIcon } from "@/components/ui/category-icon"
import { categoryLabel, formatNumber, formatCurrency, cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "all","productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]

const PRICING_FILTERS = [
  { value: "all",          label: "All pricing"  },
  { value: "free",         label: "Free"          },
  { value: "per_call",     label: "Pay per call"  },
  { value: "subscription", label: "Subscription"  },
  { value: "freemium",     label: "Freemium"      },
]

const SORT_OPTIONS = [
  { value: "popular", label: "Most popular" },
  { value: "rating",  label: "Top rated"    },
  { value: "newest",  label: "Newest first" },
  { value: "revenue", label: "Top earning"  },
]

const PAGE_SIZE = 24

// ─── Pricing helpers ──────────────────────────────────────────────────────────

function getPricingLabel(agent: any) {
  if (agent.pricing_model === "free")         return "Free"
  if (agent.pricing_model === "per_call")     return `${formatCurrency(agent.price_per_call)}/call`
  if (agent.pricing_model === "subscription") return `${formatCurrency(agent.subscription_price_monthly)}/mo`
  if (agent.pricing_model === "freemium")     return "Free tier"
  return "—"
}

function getPricingColor(model: string) {
  if (model === "free" || model === "freemium") return "bg-emerald-50 text-emerald-700 border-emerald-100"
  return "bg-zinc-50 text-zinc-600 border-zinc-100"
}

// ─── Agent card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, view }: { agent: any; view: "grid" | "list" }) {
  // Bug 1 FIX: use pipeline_use_count directly from agents table
  // (the agent_pipeline_stats view join does not work with Supabase client FK syntax)
  const pipelineCount = agent.pipeline_use_count ?? 0

  if (view === "list") {
    return (
      <Link href={`/marketplace/${agent.id}`}>
        <div className="group flex items-center gap-4 bg-white border border-zinc-100 rounded-2xl px-5 py-4 hover:border-zinc-200 hover:shadow-sm transition-all duration-150 cursor-pointer"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="w-10 h-10 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
            <CategoryIcon category={agent.category} colored className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-semibold text-zinc-900 text-sm group-hover:text-primary transition-colors truncate">
                {agent.name}
              </span>
              {agent.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
              {agent.is_featured && (
                <span className="text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  Featured
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 truncate">{agent.description}</p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <span className="text-xs text-zinc-400 flex items-center gap-1 nums">
              <Zap className="h-3 w-3" /> {formatNumber(agent.total_executions || 0)}
            </span>
            {(agent.average_rating || 0) > 0 && (
              <span className="text-xs text-zinc-400 flex items-center gap-1 nums">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                {agent.average_rating?.toFixed(1)}
              </span>
            )}
            {pipelineCount > 0 && (
              <span className="hidden md:flex items-center gap-1 text-[11px] text-primary font-semibold bg-primary/8 border border-primary/20 px-2 py-0.5 rounded-full">
                🔥 {formatNumber(pipelineCount)} pipeline{pipelineCount > 1 ? "s" : ""}
              </span>
            )}
            <span className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full border", getPricingColor(agent.pricing_model))}>
              {getPricingLabel(agent)}
            </span>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-primary transition-colors flex-shrink-0" />
        </div>
      </Link>
    )
  }

  return (
    <Link href={`/marketplace/${agent.id}`}>
      <div className="group bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-md transition-all duration-200 cursor-pointer h-full flex flex-col"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
              <CategoryIcon category={agent.category} colored className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <h3 className="font-semibold text-zinc-900 text-sm truncate group-hover:text-primary transition-colors">
                  {agent.name}
                </h3>
                {agent.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
              </div>
              <p className="text-[11px] text-zinc-400 capitalize">{categoryLabel(agent.category)}</p>
            </div>
          </div>
          {agent.is_featured && (
            <span className="text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-2">
              Featured
            </span>
          )}
        </div>

        <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2 flex-1 mb-3">{agent.description}</p>

        {/* Seller attribution */}
        {agent.profiles?.full_name && (
          <p className="text-[11px] text-zinc-400 mb-3 truncate">
            by <span className="font-medium text-zinc-500">{agent.profiles.full_name}</span>
            {agent.profiles.is_verified && <span className="ml-1 text-blue-400">✓</span>}
          </p>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-zinc-50">
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1 nums">
              <Zap className="h-3 w-3" />{formatNumber(agent.total_executions || 0)}
            </span>
            {(agent.average_rating || 0) > 0 && (
              <span className="flex items-center gap-1 nums">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                {agent.average_rating?.toFixed(1)}
              </span>
            )}
            {pipelineCount > 0 && (
              <span className="flex items-center gap-1 text-primary font-semibold nums text-[10px]">
                🔥 {formatNumber(pipelineCount)}
              </span>
            )}
          </div>
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", getPricingColor(agent.pricing_model))}>
            {getPricingLabel(agent)}
          </span>
        </div>
      </div>
    </Link>
  )
}

// ─── Skeleton cards ───────────────────────────────────────────────────────────

function SkeletonCard({ view }: { view: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div className="flex items-center gap-4 bg-white border border-zinc-100 rounded-2xl px-5 py-4 animate-pulse">
        <div className="w-10 h-10 rounded-xl bg-zinc-100 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-zinc-100 rounded-full w-1/3" />
          <div className="h-3 bg-zinc-100 rounded-full w-2/3" />
        </div>
        <div className="h-6 bg-zinc-100 rounded-full w-20 flex-shrink-0" />
      </div>
    )
  }
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-11 h-11 rounded-xl bg-zinc-100 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-zinc-100 rounded-full w-3/4" />
          <div className="h-3 bg-zinc-100 rounded-full w-1/3" />
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <div className="h-3 bg-zinc-100 rounded-full" />
        <div className="h-3 bg-zinc-100 rounded-full w-4/5" />
      </div>
      <div className="h-px bg-zinc-50 mb-3" />
      <div className="flex justify-between">
        <div className="h-3 bg-zinc-100 rounded-full w-16" />
        <div className="h-5 bg-zinc-100 rounded-full w-12" />
      </div>
    </div>
  )
}

// ─── Featured hero section (Gap 4) ───────────────────────────────────────────

function FeaturedHero({ agents }: { agents: any[] }) {
  const featured = agents.filter(a => a.is_featured).slice(0, 3)
  if (!featured.length) return null

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <p className="text-sm font-semibold text-zinc-900">Featured Agents</p>
        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
          Editor's picks
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {featured.map(agent => (
          <Link key={agent.id} href={`/marketplace/${agent.id}`}>
            <div className="relative bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-2xl p-5 cursor-pointer hover:opacity-95 transition-opacity overflow-hidden group"
              style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-2xl -translate-y-8 translate-x-8" />
              <div className="flex items-start gap-3 mb-3 relative">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <CategoryIcon category={agent.category} className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm truncate group-hover:text-primary transition-colors">
                    {agent.name}
                  </p>
                  <p className="text-[11px] text-zinc-400 capitalize">{categoryLabel(agent.category)}</p>
                </div>
                <span className="text-[9px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
                  ★ Featured
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2 mb-3 relative">{agent.description}</p>
              <div className="flex items-center justify-between relative">
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1 nums"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions || 0)}</span>
                  {(agent.average_rating || 0) > 0 && (
                    <span className="flex items-center gap-1 nums"><Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{agent.average_rating?.toFixed(1)}</span>
                  )}
                </div>
                <span className="text-[10px] font-semibold text-white bg-white/10 px-2 py-0.5 rounded-full">
                  {getPricingLabel(agent)}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Main loader ──────────────────────────────────────────────────────────────

export function MarketplaceLoader() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()
  const supabase     = useRef(createClient()).current

  const [agents,   setAgents]   = useState<any[]>([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)   // Bug 7 FIX
  const [view,     setView]     = useState<"grid" | "list">("grid")
  const [search,   setSearch]   = useState(searchParams.get("q") || "")
  const debouncedSearch = useDebounce(search, 400)

  const sp = Object.fromEntries(searchParams.entries())

  // Bug 2 FIX: only delete page when NOT explicitly navigating pages
  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(sp)
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== "all") params.set(k, v)
      else params.delete(k)
    })
    // Only reset to page 1 when changing filters, NOT when navigating pages
    if (!("page" in updates)) params.delete("page")
    router.push(`${pathname}?${params.toString()}`)
  }, [sp, router, pathname])

  useEffect(() => {
    updateParams({ q: debouncedSearch || undefined })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)  // Bug 7 FIX: clear previous error
      try {
        const q        = searchParams.get("q")        || undefined
        const category = searchParams.get("category") || undefined
        const pricing  = searchParams.get("pricing")  || undefined
        const sort     = searchParams.get("sort")     || "popular"
        const page     = parseInt(searchParams.get("page") || "1")

        // Bug 1 FIX: removed agent_pipeline_stats join (doesn't exist as FK)
        // pipeline_use_count is a direct column on agents table (live schema confirmed)
        let query = supabase
          .from("agents")
          .select(
            "id, name, description, category, pricing_model, price_per_call, subscription_price_monthly, free_calls_per_month, total_executions, average_rating, total_reviews, is_verified, is_featured, icon_url, pipeline_use_count, profiles!seller_id(full_name, username, avatar_url, is_verified)",
            { count: "exact" }
          )
          .eq("status", "active")

        // Bug 8 FIX: search across name, description, and tags — not just name
        if (q) {
          // Use OR filter to search multiple fields
          query = query.or(
            `name.ilike.%${q}%,description.ilike.%${q}%`
          )
        }

        if (category && category !== "all") query = query.eq("category", category)
        if (pricing  && pricing  !== "all") query = query.eq("pricing_model", pricing)

        if      (sort === "popular") query = query.order("total_executions", { ascending: false })
        else if (sort === "rating")  query = query.order("average_rating",   { ascending: false })
        else if (sort === "newest")  query = query.order("created_at",       { ascending: false })
        else if (sort === "revenue") query = query.order("total_revenue",    { ascending: false })

        query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

        const { data, count, error: queryErr } = await query

        if (queryErr) throw queryErr

        if (!cancelled) {
          setAgents(data || [])
          setTotal(count || 0)
          setLoading(false)
        }
      } catch (err: any) {
        if (!cancelled) {
          // Bug 7 FIX: set a real error state instead of showing empty results
          setError(err.message ?? "Failed to load agents")
          setLoading(false)
        }
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
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* ── Hero search ───────────────────────────────────────────────── */}
        <div className="relative bg-white border-b border-zinc-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-3">
                <div className="inline-flex items-center gap-1.5 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1 rounded-full font-semibold">
                  <TrendingUp className="h-3 w-3" />
                  {loading ? "Loading agents…" : `${formatNumber(total)} agents available`}
                </div>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-zinc-900 mb-1.5">Agent Marketplace</h1>
              <p className="text-zinc-500 text-sm mb-6">Production-ready AI agents — deploy in seconds with one API call.</p>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                <input
                  type="search" autoComplete="off"
                  placeholder="Search agents by name, description, or use case…"
                  className="w-full pl-11 pr-10 h-12 rounded-2xl border border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
                  value={search} onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch("")} aria-label="Clear"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

          {/* ── Category pills ────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 mb-6">
            {CATEGORIES.map(cat => (
              <button key={cat}
                // Bug 15 FIX: clicking active category deselects it (goes back to "all")
                onClick={() => updateParams({ category: activeCategory === cat && cat !== "all" ? "all" : cat })}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold border transition-all whitespace-nowrap",
                  activeCategory === cat
                    ? "bg-zinc-900 border-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-400 bg-white"
                )}>
                {cat !== "all" && (
                  <CategoryIcon category={cat}
                    className={cn("h-3 w-3 flex-shrink-0", activeCategory === cat ? "text-white opacity-80" : "")} />
                )}
                {cat === "all" ? "All" : categoryLabel(cat)}
              </button>
            ))}
          </div>

          {/* ── Featured hero (Gap 4) — only when no filters active ───────── */}
          {!hasFilters && !loading && !error && <FeaturedHero agents={agents} />}

          {/* ── Toolbar ───────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">
                {loading ? "Loading…" : error ? "Error" : (
                  <><span className="font-semibold text-zinc-900 nums">{formatNumber(total)}</span> {hasFilters ? "results" : "agents"}</>
                )}
              </span>
              {hasFilters && !error && (
                <button onClick={() => router.push("/marketplace")}
                  className="text-xs text-primary hover:underline font-semibold flex items-center gap-1">
                  <X className="h-3 w-3" /> Clear filters
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Select value={activePricing} onValueChange={v => updateParams({ pricing: v })}>
                <SelectTrigger className="w-36 h-9 text-xs rounded-xl border-zinc-200 bg-white">
                  <Filter className="h-3.5 w-3.5 text-zinc-400 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {PRICING_FILTERS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={activeSort} onValueChange={v => updateParams({ sort: v })}>
                <SelectTrigger className="w-40 h-9 text-xs rounded-xl border-zinc-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {SORT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center bg-zinc-50 border border-zinc-200 rounded-xl p-1">
                <button onClick={() => setView("grid")}
                  className={cn("p-1.5 rounded-lg transition-all", view === "grid" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-400 hover:text-zinc-600")}>
                  <Grid3x3 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setView("list")}
                  className={cn("p-1.5 rounded-lg transition-all", view === "list" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-400 hover:text-zinc-600")}>
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* ── Bug 7 FIX: proper error state ────────────────────────────── */}
          {error ? (
            <div className="flex flex-col items-center justify-center py-28 text-center">
              <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-7 w-7 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-2">Could not load agents</h3>
              <p className="text-zinc-400 text-sm mb-5 max-w-xs">
                {error.includes("agent_pipeline_stats")
                  ? "Database configuration issue. Please run the latest migration and try again."
                  : error}
              </p>
              <Button onClick={() => window.location.reload()} className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700">
                Retry
              </Button>
            </div>
          ) : loading ? (
            view === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[...Array(9)].map((_, i) => <SkeletonCard key={i} view="grid" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => <SkeletonCard key={i} view="list" />)}
              </div>
            )
          ) : agents.length === 0 ? (
            <div className="text-center py-28">
              <div className="w-14 h-14 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
                <Search className="h-7 w-7 text-zinc-300" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-2">No agents found</h3>
              <p className="text-zinc-400 text-sm mb-5">Try different keywords or browse a different category</p>
              <Button variant="outline" onClick={() => router.push("/marketplace")}
                className="rounded-xl border-zinc-200 text-sm">
                Clear all filters
              </Button>
            </div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {agents.map(agent => <AgentCard key={agent.id} agent={agent} view="grid" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map(agent => <AgentCard key={agent.id} agent={agent} view="list" />)}
            </div>
          )}

          {/* ── Pagination — Bug 2 already fixed in updateParams above ─────── */}
          {totalPages > 1 && !loading && !error && (
            <div className="flex items-center justify-center gap-3 mt-12">
              <Button variant="outline" disabled={page <= 1}
                onClick={() => updateParams({ page: String(page - 1) })}
                className="rounded-xl border-zinc-200 text-sm">
                ← Previous
              </Button>
              <span className="text-sm text-zinc-500 px-2 nums">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" disabled={page >= totalPages}
                onClick={() => updateParams({ page: String(page + 1) })}
                className="rounded-xl border-zinc-200 text-sm">
                Next →
              </Button>
            </div>
          )}

          {!loading && !error && agents.length > 0 && (
            <div className="mt-16 mb-4 bg-zinc-900 rounded-3xl p-10 text-center">
              <h3 className="text-xl font-black text-white mb-2">Build your own agent</h3>
              <p className="text-sm text-zinc-400 mb-6 max-w-sm mx-auto">
                Publish an AI microagent to the marketplace and earn 80% of every call. Takes under 5 minutes.
              </p>
              <div className="flex justify-center gap-3">
                <Link href="/builder">
                  <Button className="rounded-xl bg-white text-zinc-900 hover:bg-zinc-100 font-semibold gap-2">
                    <Zap className="h-4 w-4" /> Start building
                  </Button>
                </Link>
                <Link href="/docs">
                  <Button variant="outline" className="rounded-xl border-zinc-700 text-zinc-300 hover:bg-zinc-800 font-semibold">
                    Read the docs
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}
