"use client";

import { useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Search, Filter, Grid3X3, List, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentCard } from "@/components/marketplace/agent-card";
import { FeaturedBanner } from "@/components/marketplace/featured-banner";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { CATEGORY_ICONS, categoryLabel, formatNumber } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { useEffect } from "react";

const CATEGORIES = [
  "all", "productivity", "coding", "marketing", "finance", "legal",
  "customer_support", "data_analysis", "content", "research", "hr", "sales", "devops", "security", "other"
];

const PRICING_FILTERS = ["all", "free", "per_call", "subscription", "freemium"];
const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "rating", label: "Top Rated" },
  { value: "newest", label: "Newest" },
  { value: "revenue", label: "Top Earning" },
];

interface Props {
  agents: any[];
  featured: any[];
  total: number;
  page: number;
  pageSize: number;
  searchParams: any;
}

export function MarketplaceClient({ agents, featured, total, page, pageSize, searchParams }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(searchParams.q || "");
  const [view, setView] = useState<"grid" | "list">("grid");
  const debouncedSearch = useDebounce(search, 400);

  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== "all") params.set(k, v);
      else params.delete(k);
    });
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }, [searchParams, router, pathname]);

  useEffect(() => {
    updateParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch]);

  const activeCategory = searchParams.category || "all";
  const activePricing = searchParams.pricing || "all";
  const activeSort = searchParams.sort || "popular";

  const totalPages = Math.ceil(total / pageSize);
  const hasFilters = searchParams.q || (searchParams.category && searchParams.category !== "all") || (searchParams.pricing && searchParams.pricing !== "all");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        {/* Header */}
        <div className="bg-muted/20 border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-black text-white mb-2">Agent Marketplace</h1>
            <p className="text-muted-foreground mb-6">{formatNumber(total)} production-ready agents across {CATEGORIES.length - 1} categories</p>

            {/* Search */}
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents by name, category, or use case..."
                className="pl-10 h-11 bg-card border-border"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Featured */}
          {featured.length > 0 && !hasFilters && (
            <div className="mb-10">
              <h2 className="text-lg font-semibold text-white mb-4">⭐ Featured Agents</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {featured.map(agent => (
                  <FeaturedBanner key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-col lg:flex-row gap-4 mb-6">
            {/* Category pills */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => updateParams({ category: cat })}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-all ${
                    activeCategory === cat
                      ? "bg-indigo-500 border-indigo-500 text-white"
                      : "border-border text-muted-foreground hover:border-indigo-500/50 hover:text-white"
                  }`}
                >
                  {cat !== "all" && <span>{CATEGORY_ICONS[cat]}</span>}
                  {cat === "all" ? "All" : categoryLabel(cat)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Select value={activePricing} onValueChange={v => updateParams({ pricing: v })}>
                <SelectTrigger className="w-36 h-9 text-sm">
                  <SelectValue placeholder="Pricing" />
                </SelectTrigger>
                <SelectContent>
                  {PRICING_FILTERS.map(p => (
                    <SelectItem key={p} value={p}>{p === "all" ? "All Pricing" : p.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={activeSort} onValueChange={v => updateParams({ sort: v })}>
                <SelectTrigger className="w-40 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="flex border border-border rounded-lg overflow-hidden">
                <button onClick={() => setView("grid")} className={`p-2 ${view === "grid" ? "bg-indigo-500 text-white" : "text-muted-foreground hover:text-white"}`}>
                  <Grid3X3 className="h-4 w-4" />
                </button>
                <button onClick={() => setView("list")} className={`p-2 ${view === "list" ? "bg-indigo-500 text-white" : "text-muted-foreground hover:text-white"}`}>
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {hasFilters ? `${formatNumber(total)} results` : `Showing ${formatNumber(total)} agents`}
            </p>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => router.push("/marketplace")} className="text-xs text-indigo-400">
                <X className="h-3 w-3 mr-1" /> Clear filters
              </Button>
            )}
          </div>

          {agents.length === 0 ? (
            <div className="text-center py-24">
              <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">No agents found</h3>
              <p className="text-muted-foreground">Try different keywords or filters</p>
            </div>
          ) : (
            <div className={view === "grid" ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5" : "space-y-3"}>
              {agents.map((agent, i) => (
                <motion.div key={agent.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <AgentCard agent={agent} view={view} />
                </motion.div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-10">
              <Button variant="outline" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => updateParams({ page: String(page + 1) })}>Next</Button>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
