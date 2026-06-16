"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import {
  Search, CheckCircle, ExternalLink, Clock,
  Database, MessageSquare, Calendar, Code2, Cloud, Bot,
  DollarSign, Megaphone, Lock, FolderOpen, BarChart3, ShoppingBag,
  Plus, Link2, Settings, AlertCircle, Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { BRAND_LOGOS, IntegrationLogo } from "@/components/ui/integration-logos"
import { MCP_SERVERS, MCP_CATEGORIES, type MCPCategory } from "@/lib/mcp-servers"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

/* ─── Category fallback icons (when no brand logo exists) ────────── */
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

const DEMO_CONNECTED = ["github", "slack", "google-drive"]

/* ─── Logo cell — renders brand SVG or coloured category fallback ── */
function LogoCell({ id, category }: { id: string; category: string }) {
  const hasBrand     = id in BRAND_LOGOS
  const FallbackIcon = CAT_ICON[category] || Database
  const fallbackCls  = CAT_BG[category]   || "bg-zinc-50 text-zinc-500"

  if (hasBrand) {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-white border border-zinc-100 overflow-hidden shadow-sm">
        <IntegrationLogo id={id} size={26} />
      </div>
    )
  }

  return (
    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", fallbackCls)}>
      <FallbackIcon className="h-5 w-5" />
    </div>
  )
}

/* ─── Main component ─────────────────────────────────────────────── */
export default function DashboardIntegrationsClient() {
  const [search,       setSearch]    = useState("")
  const [category,     setCategory]  = useState<MCPCategory | "all">("all")
  const [verifiedOnly, setVerified]  = useState(false)
  const [connected,    setConnected] = useState<Set<string>>(new Set(DEMO_CONNECTED))
  const [activeTab,    setActiveTab] = useState<"all" | "connected">("all")

  const filtered = MCP_SERVERS.filter(s => {
    if (activeTab === "connected" && !connected.has(s.id)) return false
    if (category !== "all" && s.category !== category)    return false
    if (verifiedOnly && !s.verified)                       return false
    if (search) {
      const q = search.toLowerCase()
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.includes(q))
      )
    }
    return true
  })

  const toggleConnect = (id: string, name: string) => {
    setConnected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); toast.success(`${name} disconnected`) }
      else              { next.add(id);    toast.success(`${name} connected`)     }
      return next
    })
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-900 flex items-center gap-2.5">
            <Link2 className="h-6 w-6 text-primary" />
            Integrations
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Connect your agents to {MCP_SERVERS.length} MCP servers — databases, APIs, cloud services and more.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-50 border border-zinc-100 px-3 py-2 rounded-xl">
          <Shield className="h-3.5 w-3.5 text-green-500" />
          Credentials encrypted at rest
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total",       value: MCP_SERVERS.length,                                  color: "text-primary"   },
          { label: "Connected",   value: connected.size,                                      color: "text-green-600" },
          { label: "Verified",    value: MCP_SERVERS.filter(s => s.verified).length,          color: "text-blue-600"  },
          { label: "Quick setup", value: MCP_SERVERS.filter(s => s.setupMinutes <= 3).length, color: "text-amber-600" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-zinc-100 rounded-2xl p-4"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <p className={cn("text-2xl font-black tabular-nums", s.color)}>{s.value}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs + Search + Filter ───────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center bg-zinc-50 border border-zinc-100 rounded-xl p-1 gap-0.5">
          {[
            { id: "all",       label: `All (${MCP_SERVERS.length})`   },
            { id: "connected", label: `Connected (${connected.size})` },
          ].map(tab => (
            <button key={tab.id} type="button"
              onClick={() => setActiveTab(tab.id as "all" | "connected")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                activeTab === tab.id
                  ? "bg-white text-zinc-900 shadow-sm border border-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700"
              )}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input type="text" placeholder="Search integrations…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 h-9 rounded-xl border border-zinc-200 bg-white text-sm placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all" />
        </div>

        <button type="button" onClick={() => setVerified(!verifiedOnly)}
          className={cn(
            "flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-semibold transition-all",
            verifiedOnly
              ? "border-primary bg-primary/8 text-primary"
              : "border-zinc-200 text-zinc-500 hover:border-zinc-400 bg-white"
          )}>
          <CheckCircle className="h-3.5 w-3.5" /> Verified only
        </button>
      </div>

      {/* ── Category chips ───────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button type="button" onClick={() => setCategory("all")}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
            category === "all"
              ? "bg-zinc-900 text-white border-zinc-900"
              : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
          )}>
          All
        </button>
        {MCP_CATEGORIES.map(cat => {
          const Icon = CAT_ICON[cat.id] || Database
          return (
            <button key={cat.id} type="button" onClick={() => setCategory(cat.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                category === cat.id
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
              )}>
              <Icon className="h-3 w-3" />
              {cat.label}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-zinc-400">
        {filtered.length} integration{filtered.length !== 1 ? "s" : ""}
        {connected.size > 0 && ` · ${connected.size} connected`}
      </p>

      {/* ── Integration grid ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((server, i) => {
          const isConnected = connected.has(server.id)

          return (
            <motion.div key={server.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.25) }}>
              <div className={cn(
                "bg-white border rounded-2xl p-5 transition-all h-full flex flex-col",
                isConnected
                  ? "border-green-200 shadow-[0_0_0_3px_rgba(34,197,94,0.08)]"
                  : "border-zinc-100 hover:border-zinc-200 hover:shadow-md"
              )}
                style={{ boxShadow: isConnected ? undefined : "0 1px 3px rgba(0,0,0,0.04)" }}>

                {/* Card header */}
                <div className="flex items-start gap-3 mb-3">
                  {/* Real brand logo or category fallback */}
                  <LogoCell id={server.id} category={server.category} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <h3 className="font-semibold text-sm text-zinc-900 truncate">{server.name}</h3>
                      {server.verified && (
                        <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {server.setupMinutes}min setup
                      </span>
                      {isConnected && (
                        <span className="text-[10px] font-bold bg-green-50 text-green-600 border border-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle className="h-2.5 w-2.5" /> Connected
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-zinc-500 leading-relaxed flex-1 mb-3">
                  {server.description}
                </p>

                {/* Capability tags */}
                <div className="flex flex-wrap gap-1 mb-4">
                  {server.capabilities.slice(0, 3).map(cap => (
                    <span key={cap}
                      className="text-[10px] font-mono bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-500">
                      {cap}
                    </span>
                  ))}
                  {server.capabilities.length > 3 && (
                    <span className="text-[10px] bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-400">
                      +{server.capabilities.length - 3}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-zinc-50">
                  <button type="button"
                    onClick={() => toggleConnect(server.id, server.name)}
                    className={cn(
                      "flex-1 h-8 text-xs gap-1.5 rounded-xl font-semibold flex items-center justify-center transition-all active:scale-95",
                      isConnected
                        ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-100"
                        : "bg-zinc-900 text-white hover:bg-zinc-700"
                    )}>
                    {isConnected
                      ? <><Settings className="h-3 w-3" /> Disconnect</>
                      : <><Plus    className="h-3 w-3" /> Connect</>}
                  </button>
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
        <div className="text-center py-16 bg-white border border-zinc-100 rounded-2xl">
          <AlertCircle className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
          <p className="text-zinc-400 font-medium">No integrations found</p>
          <p className="text-zinc-300 text-sm mt-1">Try a different keyword or category</p>
        </div>
      )}
    </div>
  )
}
