"use client"

import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import {
  Search, CheckCircle, ExternalLink, Zap, Shield, Clock,
  Database, MessageSquare, Calendar, Code2, Cloud, Bot,
  DollarSign, Megaphone, Lock, FolderOpen, BarChart3, ShoppingBag,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { MCP_SERVERS, MCP_CATEGORIES, type MCPCategory } from "@/lib/mcp-servers"
import { cn } from "@/lib/utils"
import Link from "next/link"

// Map MCP category → Lucide icon
const CAT_ICON: Record<string, React.FC<{ className?: string }>> = {
  databases:     Database,
  communication: MessageSquare,
  productivity:  Calendar,
  development:   Code2,
  cloud:         Cloud,
  ai:            Bot,
  finance:       DollarSign,
  marketing:     Megaphone,
  security:      Lock,
  files:         FolderOpen,
  analytics:     BarChart3,
  ecommerce:     ShoppingBag,
}

// Category background colors for server icons
const CAT_BG: Record<string, string> = {
  databases:     "bg-blue-50   text-blue-600",
  communication: "bg-cyan-50   text-cyan-600",
  productivity:  "bg-violet-50 text-violet-600",
  development:   "bg-orange-50 text-orange-600",
  cloud:         "bg-sky-50    text-sky-600",
  ai:            "bg-indigo-50 text-indigo-600",
  finance:       "bg-green-50  text-green-600",
  marketing:     "bg-pink-50   text-pink-600",
  security:      "bg-red-50    text-red-600",
  files:         "bg-amber-50  text-amber-600",
  analytics:     "bg-teal-50   text-teal-600",
  ecommerce:     "bg-emerald-50 text-emerald-600",
}

const AUTH_COLORS: Record<string, string> = {
  api_key: "bg-blue-50 text-blue-700 border-blue-100",
  oauth:   "bg-violet-50 text-violet-700 border-violet-100",
  url:     "bg-green-50 text-green-700 border-green-100",
  none:    "bg-zinc-50 text-zinc-500 border-zinc-100",
}
const AUTH_LABELS: Record<string, string> = {
  api_key: "API Key", oauth: "OAuth", url: "URL", none: "No auth",
}

// Popularity dots instead of star emojis
function PopularityDots({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className={cn(
          "w-1.5 h-1.5 rounded-full",
          i <= level ? "bg-primary" : "bg-zinc-200"
        )} />
      ))}
    </div>
  )
}

export default function IntegrationsPage() {
  const [search, setSearch]             = useState("")
  const [activeCategory, setCategory]   = useState<MCPCategory | "all">("all")
  const [showVerifiedOnly, setVerified] = useState(false)

  const filtered = useMemo(() => {
    return MCP_SERVERS.filter(s => {
      const matchCat     = activeCategory === "all" || s.category === activeCategory
      const matchSearch  = !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase()) ||
        s.tags.some(t => t.includes(search.toLowerCase()))
      const matchVerified = !showVerifiedOnly || s.verified
      return matchCat && matchSearch && matchVerified
    })
  }, [search, activeCategory, showVerifiedOnly])

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* Hero */}
        <section className="py-20 text-center bg-zinc-50 border-b border-zinc-100">
          <div className="max-w-4xl mx-auto px-4">
            <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
              <Zap className="h-3.5 w-3.5" /> MCP Native
            </div>
            <h1 className="text-5xl font-black tracking-tighter text-zinc-900 mb-4">
              Connect your agents to <span className="gradient-text">anything</span>
            </h1>
            <p className="text-xl text-zinc-500 max-w-2xl mx-auto mb-6">
              {MCP_SERVERS.length} verified MCP servers. Databases, APIs, cloud services, and AI tools —
              all available as one-click integrations for any agent you build on AgentDyne.
            </p>
            <div className="flex flex-wrap gap-4 justify-center text-sm text-zinc-500">
              <span className="flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-green-500" />
                {MCP_SERVERS.filter(s => s.verified).length} verified
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-amber-500" />
                Zero configuration needed
              </span>
              <span className="flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-blue-500" />
                Credentials encrypted at rest
              </span>
            </div>
          </div>
        </section>

        {/* Stats */}
        <div className="border-b border-zinc-100">
          <div className="max-w-7xl mx-auto px-4 py-5 grid grid-cols-4 divide-x divide-zinc-100 text-center">
            {[
              { value: MCP_SERVERS.length,                                  label: "Total integrations" },
              { value: MCP_CATEGORIES.length,                               label: "Categories" },
              { value: MCP_SERVERS.filter(s => s.featured).length,          label: "Featured" },
              { value: MCP_SERVERS.filter(s => s.setupMinutes <= 3).length, label: "3-min setup" },
            ].map(s => (
              <div key={s.label} className="px-4 py-2">
                <p className="text-3xl font-black gradient-text nums">{s.value}</p>
                <p className="text-xs text-zinc-400 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex gap-8">

            {/* Sidebar */}
            <aside className="w-52 flex-shrink-0 hidden lg:block">
              <div className="sticky top-24 space-y-0.5">
                <p className="section-header px-3 mb-2">Category</p>
                <button onClick={() => setCategory("all")}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all",
                    activeCategory === "all"
                      ? "bg-primary/8 text-primary"
                      : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                  )}>
                  All ({MCP_SERVERS.length})
                </button>
                {MCP_CATEGORIES.map(cat => {
                  const Icon = CAT_ICON[cat.id] || Database
                  return (
                    <button key={cat.id} onClick={() => setCategory(cat.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2",
                        activeCategory === cat.id
                          ? "bg-primary/8 text-primary"
                          : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                      )}>
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="flex-1 truncate capitalize">{cat.label}</span>
                      <span className="text-[10px] text-zinc-400 ml-auto">
                        {MCP_SERVERS.filter(s => s.category === cat.id).length}
                      </span>
                    </button>
                  )
                })}
              </div>
            </aside>

            {/* Main */}
            <div className="flex-1 min-w-0">
              {/* Search + filters */}
              <div className="flex items-center gap-3 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Search integrations…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 h-10 rounded-xl border border-zinc-200 bg-white text-sm placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-all"
                  />
                </div>
                <button
                  onClick={() => setVerified(!showVerifiedOnly)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all",
                    showVerifiedOnly
                      ? "border-primary bg-primary/8 text-primary"
                      : "border-zinc-200 text-zinc-500 hover:border-zinc-400 bg-white"
                  )}>
                  <CheckCircle className="h-3.5 w-3.5" />
                  Verified only
                </button>
              </div>

              {/* Results count */}
              <p className="text-sm text-zinc-400 mb-5">{filtered.length} integration{filtered.length !== 1 ? "s" : ""}</p>

              {/* Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((server, i) => {
                  const Icon  = CAT_ICON[server.category] || Database
                  const iconCls = CAT_BG[server.category] || "bg-zinc-50 text-zinc-500"

                  return (
                    <motion.div key={server.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.3) }}>
                      <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-md transition-all group h-full flex flex-col"
                        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

                        {/* Header */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", iconCls)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <h3 className="font-semibold text-sm text-zinc-900 truncate">{server.name}</h3>
                              {server.verified && (
                                <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", AUTH_COLORS[server.authType])}>
                                {AUTH_LABELS[server.authType]}
                              </span>
                              <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />{server.setupMinutes}min
                              </span>
                              <PopularityDots level={server.popularity} />
                            </div>
                          </div>
                        </div>

                        <p className="text-xs text-zinc-500 leading-relaxed flex-1 mb-3">{server.description}</p>

                        {/* Capability tags */}
                        <div className="flex flex-wrap gap-1 mb-4">
                          {server.capabilities.slice(0, 3).map(cap => (
                            <span key={cap} className="text-[10px] font-mono bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-500">
                              {cap}
                            </span>
                          ))}
                          {server.capabilities.length > 3 && (
                            <span className="text-[10px] bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-400">
                              +{server.capabilities.length - 3} more
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-3 border-t border-zinc-50">
                          <Link href="/builder" className="flex-1">
                            <Button className="w-full h-8 text-xs gap-1.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                              <Zap className="h-3 w-3" /> Use in Agent
                            </Button>
                          </Link>
                          <a href={server.docsUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm"
                              className="h-8 w-8 p-0 rounded-xl border-zinc-200 hover:border-zinc-400">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              {filtered.length === 0 && (
                <div className="text-center py-16">
                  <Search className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
                  <p className="text-zinc-400 font-medium">No integrations found</p>
                  <p className="text-zinc-300 text-sm mt-1">Try a different keyword or category</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CTA */}
        <section className="py-20 bg-zinc-900 text-center">
          <div className="max-w-2xl mx-auto px-4">
            <h2 className="text-3xl font-black text-white mb-4">Don't see what you need?</h2>
            <p className="text-zinc-400 mb-8">Request an integration or build your own MCP server and publish it to AgentDyne.</p>
            <div className="flex gap-3 justify-center">
              <a href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener noreferrer">
                <Button className="rounded-xl bg-white text-zinc-900 hover:bg-zinc-100 font-semibold">
                  Build an MCP Server
                </Button>
              </a>
              <Link href="/contact">
                <Button variant="outline" className="rounded-xl border-zinc-700 text-zinc-300 hover:bg-zinc-800 font-semibold">
                  Request Integration
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
