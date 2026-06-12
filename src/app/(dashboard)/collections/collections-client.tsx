"use client"

/**
 * Collections — /collections
 * Pinterest-style boards for organising agents.
 * GPT: "Collections become: 📁 Customer Support / Marketing / Finance / Engineering"
 */

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  FolderOpen, Plus, Search, Bot, Loader2, Pencil, Trash2,
  GripVertical, Check, X, MoreHorizontal, Lock, Globe,
  ChevronRight, Package, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"
import Link from "next/link"

// ─── Types ─────────────────────────────────────────────────────────────────

interface Collection {
  id:          string
  name:        string
  description: string | null
  icon:        string
  color:       string
  is_public:   boolean
  agent_count: number
  agent_ids:   string[]
  sort_order:  number
  created_at:  string
  updated_at:  string
}

interface Agent {
  id: string; name: string; icon_url?: string
  model_name?: string; status: string
}

// ─── Presets ────────────────────────────────────────────────────────────────

const ICON_OPTIONS = ["📁","🤖","💼","📊","⚡","🎯","🔬","💡","🛠️","📝","🎨","🚀","💰","🛡️","🌐"]
const COLOR_OPTIONS = [
  "#6366f1","#3b82f6","#22c55e","#f59e0b","#ef4444",
  "#8b5cf6","#14b8a6","#f97316","#ec4899","#64748b",
]
const STARTER_COLLECTIONS = [
  { name:"Marketing",       icon:"📣", color:"#ec4899",  description:"Agents for content, ads, and growth" },
  { name:"Development",     icon:"⚡", color:"#3b82f6",  description:"Code review, API design, testing" },
  { name:"Finance",         icon:"💰", color:"#22c55e",  description:"Analysis, invoicing, risk assessment" },
  { name:"Customer Support",icon:"🛡️", color:"#f59e0b",  description:"Support, FAQ, escalation agents"     },
  { name:"Research",        icon:"🔬", color:"#8b5cf6",  description:"Research, analysis, summarisation"    },
]

// ─── Colour dot picker ──────────────────────────────────────────────────────

function ColourPicker({ value, onChange }: { value: string; onChange:(c:string)=>void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {COLOR_OPTIONS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full transition-all flex items-center justify-center"
          style={{ background: c }}>
          {value === c && <Check style={{width:12,height:12,color:"#fff",strokeWidth:3}}/>}
        </button>
      ))}
    </div>
  )
}

// ─── Icon picker ─────────────────────────────────────────────────────────────

function IconPicker({ value, onChange }: { value: string; onChange:(i:string)=>void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {ICON_OPTIONS.map(ic => (
        <button key={ic} type="button" onClick={() => onChange(ic)}
          className={cn(
            "w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all",
            value === ic ? "bg-zinc-900 shadow-sm scale-110" : "bg-zinc-100 hover:bg-zinc-200"
          )}>
          {ic}
        </button>
      ))}
    </div>
  )
}

// ─── Create / Edit modal ──────────────────────────────────────────────────────

function CollectionModal({ open, onClose, onSave, initial }: {
  open: boolean
  onClose: () => void
  onSave: (data: Pick<Collection,"name"|"description"|"icon"|"color"|"is_public">) => Promise<void>
  initial?: Partial<Collection>
}) {
  const [name,      setName]      = useState(initial?.name        ?? "")
  const [desc,      setDesc]      = useState(initial?.description ?? "")
  const [icon,      setIcon]      = useState(initial?.icon        ?? "📁")
  const [color,     setColor]     = useState(initial?.color       ?? "#6366f1")
  const [isPublic,  setIsPublic]  = useState(initial?.is_public   ?? false)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? ""); setDesc(initial?.description ?? "")
      setIcon(initial?.icon ?? "📁"); setColor(initial?.color ?? "#6366f1")
      setIsPublic(initial?.is_public ?? false)
    }
  }, [open, initial])

  const handle = async () => {
    if (!name.trim()) { toast.error("Name required"); return }
    setSaving(true)
    await onSave({ name: name.trim(), description: desc.trim() || null, icon, color, is_public: isPublic })
    setSaving(false); onClose()
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    if (open) document.addEventListener("keydown", h)
    return () => document.removeEventListener("keydown", h)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{background:"rgba(0,0,0,0.4)"}}
          onClick={e => { if (e.target === e.currentTarget) onClose() }}>
          <motion.div initial={{opacity:0,scale:0.96,y:8}} animate={{opacity:1,scale:1,y:0}}
            exit={{opacity:0,scale:0.96}} transition={{duration:0.14}}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <p className="text-sm font-bold text-zinc-900">
                {initial?.id ? "Edit collection" : "New collection"}
              </p>
              <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-zinc-100 transition-colors">
                <X style={{width:13,height:13,color:"#a1a1aa"}}/>
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl"
                style={{background:`${color}14`, border:`1px solid ${color}30`}}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{background:`${color}20`}}>
                  {icon}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate" style={{color}}>{name || "Collection name"}</p>
                  <p className="text-xs text-zinc-400 truncate">{desc || "No description"}</p>
                </div>
              </div>
              {/* Name */}
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Name *</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Marketing Agents"
                  className="w-full h-9 rounded-xl border border-zinc-200 px-3 text-sm focus:outline-none transition-all"
                  onFocus={e=>(e.target.style.borderColor=color)} onBlur={e=>(e.target.style.borderColor="#e4e4e7")}/>
              </div>
              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Description</label>
                <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2}
                  placeholder="What agents belong here?"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm resize-none focus:outline-none transition-all"
                  onFocus={e=>(e.target.style.borderColor=color)} onBlur={e=>(e.target.style.borderColor="#e4e4e7")}/>
              </div>
              {/* Icon */}
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Icon</label>
                <IconPicker value={icon} onChange={setIcon}/>
              </div>
              {/* Colour */}
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Colour</label>
                <ColourPicker value={color} onChange={setColor}/>
              </div>
              {/* Visibility */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <button type="button" onClick={() => setIsPublic(v => !v)}
                  className="w-8 h-4 rounded-full transition-colors flex items-center relative"
                  style={{background: isPublic ? color : "#d4d4d8"}}>
                  <span className="absolute w-3 h-3 rounded-full bg-white shadow-sm transition-transform"
                    style={{transform: isPublic ? "translateX(18px)" : "translateX(2px)"}}/>
                </button>
                <span className="text-xs text-zinc-600 font-medium">
                  {isPublic ? <><Globe style={{width:11,height:11,display:"inline",marginRight:3}}/>Public collection</> : <><Lock style={{width:11,height:11,display:"inline",marginRight:3}}/>Private</>}
                </span>
              </label>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button onClick={onClose}
                className="flex-1 h-9 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition-colors">
                Cancel
              </button>
              <button onClick={handle} disabled={saving || !name.trim()}
                className="flex-1 h-9 rounded-xl text-sm font-bold text-white transition-all"
                style={{background: name.trim() ? color : `${color}60`, border:"none", cursor: name.trim()?"pointer":"default"}}>
                {saving ? "Saving…" : initial?.id ? "Save changes" : "Create collection"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── Collection Card ──────────────────────────────────────────────────────────

function CollectionCard({ col, onEdit, onDelete, agents }: {
  col: Collection; onEdit:(c:Collection)=>void; onDelete:(id:string)=>void; agents: Agent[]
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const colAgents = agents.filter(a => col.agent_ids?.includes(a.id))

  return (
    <motion.div
      layout
      initial={{ opacity:0, y:8 }}
      animate={{ opacity:1, y:0 }}
      exit={{ opacity:0, scale:0.95 }}
      className="group relative bg-white border rounded-2xl overflow-hidden transition-all hover:shadow-md"
      style={{ borderColor: menuOpen ? col.color+"60" : "#f0f0f1", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

      {/* Colour bar */}
      <div className="h-1.5 w-full" style={{background:`linear-gradient(90deg,${col.color},${col.color}88)`}}/>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          {/* Icon + title */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{background:`${col.color}14`}}>
              {col.icon}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-zinc-900 truncate">{col.name}</p>
              {col.description && (
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">{col.description}</p>
              )}
            </div>
          </div>

          {/* Menu */}
          <div className="relative flex-shrink-0">
            <button type="button"
              onClick={() => setMenuOpen(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-zinc-100">
              <MoreHorizontal style={{width:13,height:13,color:"#a1a1aa"}}/>
            </button>
            <AnimatePresence>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)}/>
                  <motion.div initial={{opacity:0,scale:0.95,y:-4}} animate={{opacity:1,scale:1,y:0}}
                    exit={{opacity:0,scale:0.95}} transition={{duration:0.1}}
                    className="absolute right-0 top-full mt-1 w-36 bg-white border border-zinc-100 rounded-xl shadow-lg z-20 overflow-hidden py-1">
                    <button type="button" onClick={() => { onEdit(col); setMenuOpen(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors">
                      <Pencil style={{width:12,height:12}}/> Edit
                    </button>
                    <button type="button" onClick={() => { onDelete(col.id); setMenuOpen(false) }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 style={{width:12,height:12}}/> Delete
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Agent count + previews */}
        <div className="flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {colAgents.slice(0,4).map((a,i) => (
              <div key={a.id} className="w-6 h-6 rounded-full border-2 border-white bg-zinc-100 flex items-center justify-center text-[9px] font-bold text-zinc-500"
                style={{zIndex:4-i}}>
                {a.name.charAt(0).toUpperCase()}
              </div>
            ))}
            {(col.agent_count ?? 0) > 4 && (
              <div className="w-6 h-6 rounded-full border-2 border-white bg-zinc-200 flex items-center justify-center text-[9px] font-bold text-zinc-500">
                +{(col.agent_count??0)-4}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {col.is_public ? (
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5 gap-0.5">
                <Globe style={{width:8,height:8}}/> Public
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5 gap-0.5 bg-zinc-50 text-zinc-400">
                <Lock style={{width:8,height:8}}/> Private
              </Badge>
            )}
            <span className="text-xs font-semibold text-zinc-500">
              {col.agent_count ?? 0} agent{(col.agent_count??0) !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Open link */}
      <Link href={`/collections/${col.id}`}>
        <div className="flex items-center gap-1 px-4 py-2.5 border-t border-zinc-50 text-xs font-semibold text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-all">
          <span>Open collection</span>
          <ChevronRight style={{width:12,height:12}}/>
        </div>
      </Link>
    </motion.div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function CollectionsClient() {
  const { user }                               = useUser()
  const [collections, setCollections]          = useState<Collection[]>([])
  const [agents,      setAgents]               = useState<Agent[]>([])
  const [loading,     setLoading]              = useState(true)
  const [search,      setSearch]               = useState("")
  const [showModal,   setShowModal]            = useState(false)
  const [editing,     setEditing]              = useState<Collection | undefined>(undefined)

  const supabase = createClient()

  // ── Load ─────────────────────────────────────────────────────────────
  const loadCollections = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from("collections")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at",  { ascending: false })
    setCollections((data ?? []) as Collection[])
    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    if (!user) return
    loadCollections()
    supabase.from("agents")
      .select("id, name, icon_url, model_name, status")
      .eq("seller_id", user.id)
      .eq("status", "active")
      .limit(100)
      .then(({ data }) => setAgents(data ?? []))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // ── Create ────────────────────────────────────────────────────────────
  const createCollection = async (data: Pick<Collection,"name"|"description"|"icon"|"color"|"is_public">) => {
    if (!user) return
    const { error } = await supabase.from("collections").insert({
      user_id:     user.id,
      name:        data.name,
      description: data.description,
      icon:        data.icon,
      color:       data.color,
      is_public:   data.is_public,
      agent_ids:   [],
      sort_order:  collections.length,
    })
    if (error) { toast.error(error.message); return }
    toast.success("Collection created!")
    await loadCollections()
  }

  // ── Update ────────────────────────────────────────────────────────────
  const updateCollection = async (data: Pick<Collection,"name"|"description"|"icon"|"color"|"is_public">) => {
    if (!editing) return
    const { error } = await supabase.from("collections")
      .update({ name:data.name, description:data.description, icon:data.icon, color:data.color, is_public:data.is_public })
      .eq("id", editing.id)
    if (error) { toast.error(error.message); return }
    toast.success("Collection updated!")
    setEditing(undefined)
    await loadCollections()
  }

  // ── Delete ────────────────────────────────────────────────────────────
  const deleteCollection = async (id: string) => {
    if (!confirm("Delete this collection? Agents won't be removed.")) return
    const { error } = await supabase.from("collections").delete().eq("id", id)
    if (error) { toast.error(error.message); return }
    toast.success("Collection deleted")
    setCollections(prev => prev.filter(c => c.id !== id))
  }

  // ── Create starters ───────────────────────────────────────────────────
  const createStarters = async () => {
    if (!user) return
    const rows = STARTER_COLLECTIONS.map((s, i) => ({
      user_id: user.id, name: s.name, description: s.description,
      icon: s.icon, color: s.color, is_public: false,
      agent_ids: [], sort_order: i,
    }))
    const { error } = await supabase.from("collections").insert(rows)
    if (error) { toast.error(error.message); return }
    toast.success("Starter collections created!")
    await loadCollections()
  }

  const filtered = collections.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-primary" />
            Collections
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Organise your agents into folders. Think Pinterest boards for AI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {collections.length === 0 && !loading && (
            <Button variant="outline" size="sm" onClick={createStarters}
              className="rounded-xl gap-1.5 text-xs font-semibold border-dashed border-zinc-300">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Quick start
            </Button>
          )}
          <Button size="sm" onClick={() => { setEditing(undefined); setShowModal(true) }}
            className="rounded-xl gap-1.5 text-xs font-semibold bg-zinc-900 hover:bg-zinc-700 text-white">
            <Plus className="h-3.5 w-3.5" /> New Collection
          </Button>
        </div>
      </div>

      {/* Stats */}
      {collections.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label:"Total collections", value:collections.length,                                         color:"text-primary"   },
            { label:"Agents organised",  value:collections.reduce((s,c) => s+(c.agent_count??0), 0),       color:"text-green-600" },
            { label:"Public collections",value:collections.filter(c => c.is_public).length,                color:"text-blue-600"  },
          ].map(s => (
            <div key={s.label} className="bg-white border border-zinc-100 rounded-2xl p-4"
              style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.value}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {collections.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input type="text" placeholder="Search collections…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 h-9 rounded-xl border border-zinc-200 bg-white text-sm placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all" />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        </div>
      )}

      {/* Empty state */}
      {!loading && collections.length === 0 && (
        <div className="text-center py-20 bg-white border border-zinc-100 rounded-2xl"
          style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div className="w-16 h-16 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="h-8 w-8 text-primary" />
          </div>
          <p className="text-zinc-900 font-bold text-lg mb-2">No collections yet</p>
          <p className="text-zinc-400 text-sm max-w-xs mx-auto mb-6 leading-relaxed">
            Organise your agents into collections like GitHub repos, Notion workspaces, or Pinterest boards for AI.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button size="sm" onClick={createStarters}
              className="rounded-xl gap-1.5 font-semibold bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border-0">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Create starter collections
            </Button>
            <Button size="sm" onClick={() => { setEditing(undefined); setShowModal(true) }}
              className="rounded-xl gap-1.5 font-semibold bg-zinc-900 hover:bg-zinc-700 text-white">
              <Plus className="h-3.5 w-3.5" /> Create your first
            </Button>
          </div>
          {/* Preview starters */}
          <div className="mt-8 flex items-center gap-2 justify-center flex-wrap px-4">
            {STARTER_COLLECTIONS.map(s => (
              <div key={s.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                style={{background:`${s.color}14`,color:s.color,border:`1px solid ${s.color}30`}}>
                {s.icon} {s.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      {!loading && filtered.length > 0 && (
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {filtered.map(col => (
              <CollectionCard key={col.id} col={col} agents={agents}
                onEdit={c => { setEditing(c); setShowModal(true) }}
                onDelete={deleteCollection} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* No results */}
      {!loading && collections.length > 0 && filtered.length === 0 && (
        <div className="text-center py-10 bg-white border border-zinc-100 rounded-2xl">
          <Package className="h-8 w-8 text-zinc-200 mx-auto mb-2" />
          <p className="text-zinc-400 text-sm">No collections match "{search}"</p>
        </div>
      )}

      {/* Unorganised agents hint */}
      {!loading && agents.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center gap-3">
          <Bot className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              You have {agents.length} agent{agents.length !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {collections.length === 0
                ? "Create collections to organise them."
                : `${agents.filter(a => !collections.some(c => c.agent_ids?.includes(a.id))).length} not yet in a collection.`}
            </p>
          </div>
          <Link href="/my-agents">
            <Button size="sm" variant="outline"
              className="rounded-xl text-xs font-semibold border-amber-200 text-amber-700 hover:bg-amber-100 flex-shrink-0">
              View agents <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      )}

      {/* Create / Edit modal */}
      <CollectionModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditing(undefined) }}
        onSave={editing ? updateCollection : createCollection}
        initial={editing}
      />
    </div>
  )
}
