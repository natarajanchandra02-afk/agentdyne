"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import {
  Plus, Layers, Play, Globe, Lock, Clock, Tag,
  MoreHorizontal, Trash2, Copy, AlertCircle, Loader2,
  ChevronRight, ArrowRight, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn, formatDate, formatNumber } from "@/lib/utils"
import toast from "react-hot-toast"

// ── Types ─────────────────────────────────────────────────────────────────────
interface Pipeline {
  id:              string
  name:            string
  description:     string | null
  is_public:       boolean
  timeout_seconds: number
  tags:            string[]
  dag:             { nodes: { agent_id: string; label?: string }[]; edges: any[] }
  created_at:      string
  updated_at:      string
  run_count?:      number
  last_run_at?:    string | null
  status?:         "idle" | "running" | "success" | "failed"
}

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }: { status?: Pipeline["status"] }) {
  const map = {
    idle:    { label: "Idle",    color: "bg-zinc-100   text-zinc-500"  },
    running: { label: "Running", color: "bg-blue-50    text-blue-600"  },
    success: { label: "Success", color: "bg-green-50   text-green-600" },
    failed:  { label: "Failed",  color: "bg-red-50     text-red-600"   },
  }
  const { label, color } = map[status ?? "idle"]
  return (
    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", color)}>
      {label}
    </span>
  )
}

// ── New pipeline modal ────────────────────────────────────────────────────────
function NewPipelineModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (p: Pipeline) => void }) {
  const [name,     setName]     = useState("")
  const [desc,     setDesc]     = useState("")
  const [isPublic, setIsPublic] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState("")

  const reset = () => { setName(""); setDesc(""); setIsPublic(false); setError("") }

  const submit = async () => {
    if (!name.trim()) { setError("Name is required"); return }
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/pipelines", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:        name.trim(),
          description: desc.trim() || null,
          is_public:   isPublic,
          // Minimal valid DAG — user edits via builder later
          dag: { nodes: [], edges: [] },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create pipeline")
      toast.success("Pipeline created!")
      onCreated(data)
      reset()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => { if (!loading) { reset(); onClose() } }}
      />
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-md p-6 z-10">
        <h2 className="text-lg font-bold text-zinc-900 mb-1">New Pipeline</h2>
        <p className="text-sm text-zinc-400 mb-5">Chain agents into a sequential workflow.</p>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider block mb-1.5">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              maxLength={100}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Research → Summarise → Email"
              className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider block mb-1.5">
              Description
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What does this pipeline do?"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm resize-none focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-all"
            />
          </div>

          {/* Visibility */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => setIsPublic(v => !v)}
              className={cn(
                "w-9 h-5 rounded-full transition-colors relative flex-shrink-0",
                isPublic ? "bg-primary" : "bg-zinc-200"
              )}
            >
              <span className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                isPublic ? "translate-x-4" : "translate-x-0.5"
              )} />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-900">Public pipeline</p>
              <p className="text-xs text-zinc-400">Other users can discover and clone this pipeline</p>
            </div>
          </label>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-6">
          <Button
            variant="outline"
            onClick={() => { if (!loading) { reset(); onClose() } }}
            className="flex-1 rounded-xl border-zinc-200"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={loading || !name.trim()}
            className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Pipeline"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Pipeline row card ─────────────────────────────────────────────────────────
function PipelineCard({
  pipeline, onDelete,
}: { pipeline: Pipeline; onDelete: (id: string) => void }) {
  const [menuOpen,  setMenuOpen]  = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const nodeCount = pipeline.dag?.nodes?.length ?? 0

  const handleDelete = async () => {
    if (!confirm(`Delete "${pipeline.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}`, { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Delete failed")
      }
      toast.success("Pipeline deleted")
      onDelete(pipeline.id)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleClone = async () => {
    try {
      const res = await fetch("/api/pipelines", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:        `${pipeline.name} (copy)`,
          description: pipeline.description,
          is_public:   false,
          dag:         pipeline.dag,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Clone failed")
      toast.success("Pipeline cloned!")
      // Reload the page to pick up new row
      window.location.reload()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-sm transition-all relative group">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
          <Layers className="h-5 w-5 text-primary" />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="font-semibold text-zinc-900 text-sm truncate">{pipeline.name}</h3>
            <StatusPill status={pipeline.status} />
            {pipeline.is_public
              ? <Globe className="h-3.5 w-3.5 text-zinc-400" />
              : <Lock  className="h-3.5 w-3.5 text-zinc-400" />}
          </div>

          {pipeline.description && (
            <p className="text-xs text-zinc-500 truncate mb-2">{pipeline.description}</p>
          )}

          <div className="flex items-center gap-4 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {nodeCount} {nodeCount === 1 ? "agent" : "agents"}
            </span>
            {pipeline.run_count != null && (
              <span className="flex items-center gap-1">
                <Play className="h-3 w-3" />
                {formatNumber(pipeline.run_count)} runs
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {pipeline.timeout_seconds}s timeout
            </span>
            {pipeline.tags?.length > 0 && (
              <span className="flex items-center gap-1 hidden sm:flex">
                <Tag className="h-3 w-3" />
                {pipeline.tags.slice(0, 2).join(", ")}
                {pipeline.tags.length > 2 && ` +${pipeline.tags.length - 2}`}
              </span>
            )}
            <span className="ml-auto flex-shrink-0">
              Updated {formatDate(pipeline.updated_at)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 3-dot menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors"
              aria-label="Pipeline options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 bg-white border border-zinc-100 rounded-xl shadow-lg p-1 w-40">
                  <button
                    onClick={() => { setMenuOpen(false); handleClone() }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 rounded-lg transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" /> Clone
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); handleDelete() }}
                    disabled={deleting}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    {deleting
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2  className="h-3.5 w-3.5" />}
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>

          <Link href={`/builder?pipeline=${pipeline.id}`}>
            <button className="flex items-center gap-1 text-xs font-semibold text-primary hover:gap-2 transition-all px-2 py-1.5 rounded-lg hover:bg-primary/8">
              Edit <ArrowRight className="h-3 w-3" />
            </button>
          </Link>
        </div>
      </div>

      {/* Node chips */}
      {nodeCount > 0 && (
        <div className="flex items-center gap-1.5 mt-4 pt-4 border-t border-zinc-50 overflow-x-auto scrollbar-hide">
          {pipeline.dag.nodes.map((node, i) => (
            <div key={i} className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-medium">
                {node.label || `Agent ${i + 1}`}
              </span>
              {i < nodeCount - 1 && <ChevronRight className="h-3 w-3 text-zinc-300 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState("")
  const [showModal, setShowModal] = useState(false)
  const [tab,       setTab]       = useState<"mine" | "public">("mine")

  const load = useCallback(async (visibility: "mine" | "public") => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (visibility === "public") params.set("public", "true")
      const res  = await fetch(`/api/pipelines?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load pipelines")
      setPipelines(data.data ?? [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  const handleCreated = (p: Pipeline) => setPipelines(prev => [p, ...prev])
  const handleDelete  = (id: string) => setPipelines(prev => prev.filter(p => p.id !== id))

  return (
    <>
      <NewPipelineModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={handleCreated}
      />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Pipelines</h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              Chain agents into sequential workflows — pass output from one agent directly into the next.
            </p>
          </div>
          <Button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 flex-shrink-0"
          >
            <Plus className="h-4 w-4" /> New Pipeline
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1 w-fit">
          {(["mine", "public"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                tab === t
                  ? "bg-white shadow-sm text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              )}
            >
              {t === "mine" ? "My Pipelines" : "Public"}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-zinc-50 border border-zinc-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : pipelines.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-zinc-100 rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-4">
              <Layers className="h-7 w-7 text-primary" />
            </div>
            <h3 className="font-semibold text-zinc-900 mb-1">
              {tab === "mine" ? "No pipelines yet" : "No public pipelines"}
            </h3>
            <p className="text-sm text-zinc-400 mb-5 max-w-xs mx-auto">
              {tab === "mine"
                ? "Create your first pipeline to chain agents into automated workflows."
                : "No public pipelines have been shared yet."}
            </p>
            {tab === "mine" && (
              <Button
                onClick={() => setShowModal(true)}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2"
              >
                <Plus className="h-4 w-4" /> Create Pipeline
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {pipelines.map(p => (
              <PipelineCard key={p.id} pipeline={p} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {/* Info callout — how to use in microagent scenario */}
        <div className="bg-zinc-50 border border-zinc-100 rounded-2xl px-5 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 mb-1">How to build a multi-agent workflow</p>
              <ol className="space-y-2 text-xs text-zinc-600 list-none">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <span><strong>Create individual agents</strong> in Builder Studio — one agent per task (e.g. Researcher, Summariser, Email Drafter). Each agent has its own system prompt, model, and pricing.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <span><strong>Create a pipeline</strong> here with New Pipeline. Add your agents as nodes and draw edges between them — the output of node A becomes the input of node B.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <span><strong>Run via API</strong> with <code className="font-mono bg-zinc-100 px-1 py-0.5 rounded text-[11px]">POST /api/pipelines/:id/execute</code> — pass your initial input and get back per-node traces, latency, and cost.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                  <span><strong>Add MCP tools</strong> to individual nodes via Builder Studio → MCP Tools. A Researcher agent can use Browserbase to scrape URLs; a Summariser can use Notion to save results.</span>
                </li>
              </ol>
            </div>
          </div>
          <div className="border-t border-zinc-200 pt-4 flex items-center gap-4 text-xs text-zinc-400">
            <Link href="/docs#pipelines" className="text-primary hover:underline font-semibold flex items-center gap-1">
              <ArrowRight className="h-3 w-3" /> Pipeline API docs
            </Link>
            <Link href="/builder" className="text-primary hover:underline font-semibold flex items-center gap-1">
              <ArrowRight className="h-3 w-3" /> Create agents first
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
