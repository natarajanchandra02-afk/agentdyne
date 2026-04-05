"use client"

import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import { Search, CheckCircle, ExternalLink, Zap, Shield, Clock, Filter } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { MCP_SERVERS, MCP_CATEGORIES, type MCPCategory } from "@/lib/mcp-servers"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { Metadata } from "next"

const AUTH_COLORS: Record<string, string> = {
  api_key: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  oauth:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
  url:     "bg-green-500/10 text-green-400 border-green-500/20",
  none:    "bg-muted text-muted-foreground border-border",
}
const AUTH_LABELS: Record<string, string> = {
  api_key: "API Key", oauth: "OAuth", url: "URL", none: "No auth"
}

export default function IntegrationsPage() {
  const [search, setSearch]           = useState("")
  const [activeCategory, setCategory] = useState<MCPCategory | "all">("all")
  const [showVerifiedOnly, setVerified] = useState(false)

  const filtered = useMemo(() => {
    return MCP_SERVERS.filter(s => {
      const matchCat    = activeCategory === "all" || s.category === activeCategory
      const matchSearch = !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase()) ||
        s.tags.some(t => t.includes(search.toLowerCase()))
      const matchVerified = !showVerifiedOnly || s.verified
      return matchCat && matchSearch && matchVerified
    })
  }, [search, activeCategory, showVerifiedOnly])

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14">
        {/* Hero */}
        <section className="py-20 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-radial-brand opacity-20 pointer-events-none" />
          <div className="absolute inset-0 bg-grid bg-grid-light opacity-[0.02] pointer-events-none" />
          <div className="relative max-w-4xl mx-auto px-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <Badge className="mb-4">MCP Native</Badge>
              <h1 className="text-5xl font-black tracking-tighter mb-4">
                Connect your agents to <span className="gradient-text">anything</span>
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-6">
                {MCP_SERVERS.length} verified MCP servers. Databases, APIs, cloud services, and AI tools —
                all available as one-click integrations for any agent you build on AgentDyne.
              </p>
              <div className="flex flex-wrap gap-3 justify-center text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-400" />{MCP_SERVERS.filter(s => s.verified).length} verified</span>
                <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-yellow-400" />Zero configuration needed</span>
                <span className="flex items-center gap-1.5"><Shield className="h-4 w-4 text-blue-400" />Credentials encrypted at rest</span>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Stats row */}
        <div className="border-y border-border bg-muted/20">
          <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-4 divide-x divide-border text-center">
            {[
              { value: MCP_SERVERS.length,                                     label: "Total integrations" },
              { value: MCP_CATEGORIES.length,                                  label: "Categories" },
              { value: MCP_SERVERS.filter(s => s.featured).length,             label: "Featured" },
              { value: MCP_SERVERS.filter(s => s.setupMinutes <= 3).length,    label: "3-min setup" },
            ].map(s => (
              <div key={s.label} className="px-6">
                <p className="text-3xl font-black gradient-text">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex gap-8">
            {/* Sidebar */}
            <aside className="w-52 flex-shrink-0 hidden lg:block">
              <div className="sticky top-24 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">Category</p>
                <button onClick={() => setCategory("all")}
                  className={cn("w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all",
                    activeCategory === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                  All ({MCP_SERVERS.length})
                </button>
                {MCP_CATEGORIES.map(cat => (
                  <button key={cat.id} onClick={() => setCategory(cat.id)}
                    className={cn("w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2",
                      activeCategory === cat.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                    <span>{cat.icon}</span>
                    <span className="flex-1 truncate text-xs">{cat.label}</span>
                    <span className="text-xs opacity-50">{cat.count}</span>
                  </button>
                ))}
              </div>
            </aside>

            {/* Main */}
            <div className="flex-1 min-w-0">
              {/* Toolbar */}
              <div className="flex items-center gap-3 mb-6 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={`Search ${MCP_SERVERS.length} integrations…`} className="pl-10" />
                </div>
                <button onClick={() => setVerified(!showVerifiedOnly)}
                  className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all",
                    showVerifiedOnly ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40")}>
                  <CheckCircle className="h-3.5 w-3.5" /> Verified only
                </button>
                <p className="text-sm text-muted-foreground">{filtered.length} results</p>
              </div>

              {/* Featured row */}
              {activeCategory === "all" && !search && (
                <div className="mb-8">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">⭐ Featured Integrations</h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {MCP_SERVERS.filter(s => s.featured).map((server, i) => (
                      <motion.div key={server.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                        <div className="bg-card border border-primary/20 rounded-2xl p-4 hover:border-primary/40 transition-all group cursor-pointer">
                          <div className="flex items-center gap-2.5 mb-2">
                            <span className="text-xl">{server.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <p className="text-sm font-semibold truncate">{server.name}</p>
                                {server.verified && <CheckCircle className="h-3 w-3 text-blue-400 flex-shrink-0" />}
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{server.description}</p>
                          <div className="flex items-center justify-between">
                            <Badge className={cn("text-[10px] border", AUTH_COLORS[server.authType])}>{AUTH_LABELS[server.authType]}</Badge>
                            <span className="text-[10px] text-muted-foreground">{server.setupMinutes}min</span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* All servers grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((server, i) => (
                  <motion.div key={server.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                    <div className="bg-card border border-border rounded-2xl p-5 hover:border-primary/30 hover:shadow-md transition-all group h-full flex flex-col">
                      {/* Header */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xl flex-shrink-0">{server.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-semibold text-sm truncate">{server.name}</h3>
                            {server.verified && <CheckCircle className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge className={cn("text-[10px] border px-1.5 py-0", AUTH_COLORS[server.authType])}>{AUTH_LABELS[server.authType]}</Badge>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />{server.setupMinutes}min
                            </span>
                            <span className="text-[10px]">{"⭐".repeat(server.popularity)}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-3">{server.description}</p>

                      {/* Capabilities preview */}
                      <div className="flex flex-wrap gap-1 mb-4">
                        {server.capabilities.slice(0, 3).map(cap => (
                          <span key={cap} className="text-[10px] font-mono bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{cap}</span>
                        ))}
                        {server.capabilities.length > 3 && (
                          <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">+{server.capabilities.length - 3} more</span>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                        <Link href="/builder" className="flex-1">
                          <Button variant="brand" size="sm" className="w-full h-8 text-xs gap-1.5">
                            <Zap className="h-3 w-3" /> Use in Agent
                          </Button>
                        </Link>
                        <a href={server.docsUrl} target="_blank" rel="noopener noreferrer">
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-xl">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <section className="py-20 bg-gradient-brand text-center">
          <div className="max-w-2xl mx-auto px-4">
            <h2 className="text-3xl font-black text-white mb-4">Don't see what you need?</h2>
            <p className="text-white/70 mb-8">Request an integration or build your own MCP server and publish it to AgentDyne.</p>
            <div className="flex gap-3 justify-center">
              <a href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener noreferrer">
                <Button className="bg-white text-primary hover:bg-white/90">Build an MCP Server</Button>
              </a>
              <Link href="/contact">
                <Button variant="outline" className="border-white/30 text-white hover:bg-white/10">Request Integration</Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
