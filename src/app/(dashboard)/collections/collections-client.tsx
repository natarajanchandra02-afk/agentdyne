"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  FolderOpen, Plus, Search, Bot, MoreHorizontal,
  Sparkles, Star, Briefcase, FlaskConical, Megaphone,
  Code2, DollarSign, Users, ChevronRight, Trash2, Edit3,
  Package, Grid3x3, List, Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

/* ─── Types ───────────────────────────────────────────────────── */
type Collection = {
  id: string
  name: string
  description: string
  icon: string
  color: string
  agentCount: number
  lastUsed: string
  pinned?: boolean
  agents: { id: string; name: string; runs: number }[]
}

/* ─── Demo data ───────────────────────────────────────────────── */
const DEMO_COLLECTIONS: Collection[] = [
  {
    id: "c1",
    name: "Marketing Stack",
    description: "LinkedIn posts, SEO, ad copy, content planning",
    icon: "Megaphone",
    color: "#6366f1",
    agentCount: 4,
    lastUsed: "2 hours ago",
    pinned: true,
    agents: [
      { id: "a1", name: "LinkedIn Post Generator", runs: 342 },
      { id: "a2", name: "SEO Writer", runs: 217 },
      { id: "a3", name: "Ad Copy Generator", runs: 189 },
      { id: "a4", name: "Content Planner", runs: 156 },
    ],
  },
  {
    id: "c2",
    name: "Development Tools",
    description: "Code review, SQL, API design, test generation",
    icon: "Code2",
    color: "#0ea5e9",
    agentCount: 4,
    lastUsed: "Yesterday",
    pinned: true,
    agents: [
      { id: "a5", name: "Code Reviewer", runs: 891 },
      { id: "a6", name: "SQL Query Builder", runs: 723 },
      { id: "a7", name: "API Designer", runs: 312 },
      { id: "a8", name: "Test Generator", runs: 245 },
    ],
  },
  {
    id: "c3",
    name: "Finance & Research",
    description: "Financial analysis, invoice extraction, risk assessment",
    icon: "DollarSign",
    color: "#22c55e",
    agentCount: 3,
    lastUsed: "3 days ago",
    agents: [
      { id: "a9",  name: "Financial Analyzer", runs: 534 },
      { id: "a10", name: "Invoice Extractor",  runs: 312 },
      { id: "a11", name: "Risk Assessor",      runs: 198 },
    ],
  },
  {
    id: "c4",
    name: "Customer Support",
    description: "Ticket routing, FAQ bot, escalation assistant",
    icon: "Users",
    color: "#f59e0b",
    agentCount: 3,
    lastUsed: "1 week ago",
    agents: [
      { id: "a12", name: "Ticket Router",        runs: 2341 },
      { id: "a13", name: "FAQ Bot",              runs: 1892 },
      { id: "a14", name: "Escalation Assistant", runs: 456  },
    ],
  },
  {
    id: "c5",
    name: "Research Lab",
    description: "Web research, summarisation, competitive intel",
    icon: "FlaskConical",
    color: "#8b5cf6",
    agentCount: 2,
    lastUsed: "2 weeks ago",
    agents: [
      { id: "a15", name: "Web Researcher",     runs: 1123 },
      { id: "a16", name: "Competitive Intel",  runs: 678  },
    ],
  },
  {
    id: "c6",
    name: "Favourites",
    description: "Agents I use most often",
    icon: "Star",
    color: "#ef4444",
    agentCount: 5,
    lastUsed: "Today",
    pinned: true,
    agents: [
      { id: "a1", name: "LinkedIn Post Generator", runs: 342 },
      { id: "a5", name: "Code Reviewer",           runs: 891 },
      { id: "a9", name: "Financial Analyzer",      runs: 534 },
    ],
  },
]

const ICON_MAP: Record<string, any> = {
  Megaphone, Code2, DollarSign, Users, FlaskConical, Star, Briefcase, Sparkles,
}

/* ─── Colour helpers ──────────────────────────────────────────── */
const hex2rgb = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

/* ─── Collection card ─────────────────────────────────────────── */
function CollectionCard({ col, view }: { col: Collection; view: "grid" | "list" }) {
  const Icon = ICON_MAP[col.icon] || FolderOpen
  const rgb  = hex2rgb(col.color)
  const [menuOpen, setMenuOpen] = useState(false)

  if (view === "list") {
    return (
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-4 px-4 py-3.5 bg-white border border-zinc-100 rounded-2xl hover:border-zinc-200 hover:shadow-sm transition-all cursor-pointer group"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `rgba(${rgb},0.10)` }}
        >
          <Icon className="h-5 w-5" style={{ color: col.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-zinc-900 truncate">{col.name}</p>
            {col.pinned && <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
          </div>
          <p className="text-xs text-zinc-400 truncate">{col.description}</p>
        </div>
        <div className="hidden sm:flex items-center gap-6 flex-shrink-0 text-right">
          <div>
            <p className="text-sm font-bold text-zinc-900">{col.agentCount}</p>
            <p className="text-[10px] text-zinc-400">agents</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">{col.lastUsed}</p>
            <p className="text-[10px] text-zinc-400">last used</p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-zinc-500 transition-colors flex-shrink-0" />
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-zinc-100 rounded-2xl overflow-hidden hover:border-zinc-200 hover:shadow-md transition-all cursor-pointer group relative"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
    >
      {/* colour strip */}
      <div className="h-1.5 w-full" style={{ background: col.color }} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `rgba(${rgb},0.10)` }}
          >
            <Icon className="h-5 w-5" style={{ color: col.color }} />
          </div>
          <div className="flex items-center gap-1.5">
            {col.pinned && <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />}
            <div className="relative">
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
                className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-zinc-100 transition-all"
              >
                <MoreHorizontal className="h-4 w-4 text-zinc-400" />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    className="absolute right-0 top-7 z-10 bg-white border border-zinc-100 rounded-xl shadow-lg py-1 w-36"
                    onClick={e => e.stopPropagation()}
                  >
                    {[
                      { icon: Edit3,  label: "Rename"     },
                      { icon: Plus,   label: "Add agents" },
                      { icon: Trash2, label: "Delete", danger: true },
                    ].map(({ icon: MIcon, label, danger }) => (
                      <button key={label}
                        onClick={() => setMenuOpen(false)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors",
                          danger ? "text-red-500 hover:bg-red-50" : "text-zinc-600 hover:bg-zinc-50"
                        )}
                      >
                        <MIcon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <h3 className="text-sm font-bold text-zinc-900 mb-0.5">{col.name}</h3>
        <p className="text-xs text-zinc-400 leading-relaxed mb-3 line-clamp-2">{col.description}</p>

        {/* Agent previews */}
        <div className="space-y-1 mb-3">
          {col.agents.slice(0, 3).map(a => (
            <div key={a.id} className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-zinc-100 flex items-center justify-center flex-shrink-0">
                <Bot className="h-3 w-3 text-zinc-400" />
              </div>
              <span className="text-[11px] text-zinc-600 truncate flex-1">{a.name}</span>
              <span className="text-[10px] text-zinc-300 tabular-nums">{a.runs.toLocaleString()} runs</span>
            </div>
          ))}
          {col.agentCount > 3 && (
            <p className="text-[10px] text-zinc-400 pl-7">+{col.agentCount - 3} more</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-50">
          <span className="text-[10px] text-zinc-400">{col.lastUsed}</span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `rgba(${rgb},0.10)`, color: col.color }}
          >
            {col.agentCount} agents
          </span>
        </div>
      </div>
    </motion.div>
  )
}

/* ─── Main component ──────────────────────────────────────────── */
export default function CollectionsClient() {
  const [search,  setSearch]  = useState("")
  const [view,    setView]    = useState<"grid" | "list">("grid")
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")

  const filtered = DEMO_COLLECTIONS.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.description.toLowerCase().includes(search.toLowerCase())
  )

  const pinned   = filtered.filter(c => c.pinned)
  const unpinned = filtered.filter(c => !c.pinned)

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-900">Collections</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Organise your agents into focused groups for every workflow
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all shadow-sm active:scale-95"
        >
          <Plus className="h-4 w-4" /> New Collection
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Collections",   value: DEMO_COLLECTIONS.length, icon: Package   },
          { label: "Total Agents",  value: DEMO_COLLECTIONS.reduce((s, c) => s + c.agentCount, 0), icon: Bot },
          { label: "Pinned",        value: DEMO_COLLECTIONS.filter(c => c.pinned).length, icon: Star },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-white border border-zinc-100 rounded-2xl px-4 py-3 flex items-center gap-3"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xl font-black text-zinc-900 tabular-nums">{value}</p>
              <p className="text-[10px] text-zinc-400 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search collections…"
            className="w-full pl-10 pr-4 h-9 rounded-xl border border-zinc-200 bg-white text-sm placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all"
          />
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-0.5">
          {([["grid", Grid3x3], ["list", List]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-all",
                view === v ? "bg-white shadow-sm text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Pinned */}
      {pinned.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">⭐ Pinned</p>
          <div className={cn(
            view === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              : "space-y-2"
          )}>
            {pinned.map((col, i) => (
              <CollectionCard key={col.id} col={col} view={view} />
            ))}
          </div>
        </div>
      )}

      {/* All collections */}
      {unpinned.length > 0 && (
        <div>
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">All Collections</p>
          <div className={cn(
            view === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              : "space-y-2"
          )}>
            {unpinned.map(col => (
              <CollectionCard key={col.id} col={col} view={view} />
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-20">
          <FolderOpen className="h-10 w-10 text-zinc-200 mx-auto mb-3" />
          <p className="text-zinc-400 font-semibold">No collections found</p>
          <p className="text-zinc-300 text-sm mt-1">Try a different search or create a new one</p>
        </div>
      )}

      {/* New collection modal */}
      <AnimatePresence>
        {showNew && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={e => { if (e.target === e.currentTarget) setShowNew(false) }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
                <p className="font-bold text-zinc-900">New Collection</p>
                <button onClick={() => setShowNew(false)} className="p-1 rounded-lg hover:bg-zinc-100">
                  <Plus className="h-4 w-4 text-zinc-400 rotate-45" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1.5">Name</label>
                  <input
                    value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Marketing Stack"
                    className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-primary transition-all"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-700 block mb-1.5">Description</label>
                  <textarea rows={2} placeholder="What agents will live here?"
                    className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-primary transition-all resize-none" />
                </div>
                <div className="flex gap-2.5 pt-1">
                  <button onClick={() => setShowNew(false)}
                    className="flex-1 h-9 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-500 hover:bg-zinc-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={() => setShowNew(false)}
                    className="flex-1 h-9 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-all shadow-sm flex items-center justify-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" /> Create
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
