"use client"

/**
 * Multi-Agent Swarm Dashboard
 *
 * NOTE: Rendered inside (dashboard)/layout.tsx which already provides
 * <DashboardSidebar /> — do NOT add another sidebar here.
 * Removed self-contained layout wrapper (div.flex + DashboardSidebar import)
 * that caused the double-nav bug.
 */

import { useState, useCallback, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Network, X, Play, Loader2, Check,
  ChevronDown, ChevronUp, Bot, MessageSquare,
  AlertCircle, Copy,
} from "lucide-react"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input }    from "@/components/ui/input"
import { Label }    from "@/components/ui/label"
import { Badge }    from "@/components/ui/badge"
import { cn }       from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentOption  { id: string; name: string; model_name: string; status: string }
interface SwarmSession {
  sessionId: string; status: string; mode: string
  agentCount: number; finalAnswer: string; messageLog: any[]; rounds: number
}

const MODES = [
  {
    id: "orchestrate", label: "Orchestrate", icon: "🎯",
    desc: "Agent 1 decomposes the task; specialists execute sub-tasks; Agent 1 synthesises",
  },
  {
    id: "debate", label: "Debate", icon: "⚖️",
    desc: "Agents propose, then critique each other's answers across multiple rounds",
  },
  {
    id: "parallel", label: "Parallel", icon: "⚡",
    desc: "All agents work on the same task independently; results merged",
  },
]

// ─── AgentSelector ────────────────────────────────────────────────────────────

function AgentSelector({
  agents, selected, onChange, maxAgents,
}: {
  agents: AgentOption[]; selected: string[]; onChange: (ids: string[]) => void; maxAgents: number
}) {
  const [q, setQ] = useState("")
  const filtered  = agents.filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()))

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id))
    } else if (selected.length < maxAgents) {
      onChange([...selected, id])
    } else {
      toast.error(`Max ${maxAgents} agents per swarm`)
    }
  }

  return (
    <div className="space-y-3">
      <Input
        value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search your agents…"
        className="h-9 rounded-xl border-zinc-200 text-sm"
      />

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(id => {
            const a = agents.find(x => x.id === id)
            return (
              <span key={id}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-primary/8 text-primary border border-primary/20 px-2.5 py-1 rounded-full">
                <Bot className="h-3 w-3" /> {a?.name ?? id.slice(0, 8)}
                <button type="button" onClick={() => toggle(id)}>
                  <X className="h-3 w-3 hover:text-red-500" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-400 py-4 text-center">
            No active agents found.{" "}
            <a href="/builder" className="text-primary underline">Create one</a>
          </p>
        )}
        {filtered.map(a => {
          const on = selected.includes(a.id)
          return (
            <button key={a.id} type="button" onClick={() => toggle(a.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                on
                  ? "border-primary/30 bg-primary/5"
                  : "border-zinc-100 bg-white hover:border-zinc-200",
              )}>
              <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center flex-shrink-0">
                <Bot className="h-3.5 w-3.5 text-zinc-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{a.name}</p>
                <p className="text-[11px] text-zinc-400">{a.model_name}</p>
              </div>
              {on && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── MessageLogViewer ─────────────────────────────────────────────────────────

function MessageLogViewer({ log }: { log: any[] }) {
  const [open, setOpen] = useState(false)
  if (!log.length) return null
  return (
    <div className="border border-zinc-100 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors">
        <span className="text-sm font-semibold text-zinc-700 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zinc-400" />
          Message Log ({log.length} events)
        </span>
        {open
          ? <ChevronUp   className="h-4 w-4 text-zinc-400" />
          : <ChevronDown className="h-4 w-4 text-zinc-400" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            className="overflow-hidden">
            <div className="border-t border-zinc-100 p-4 space-y-3 max-h-80 overflow-y-auto">
              {log.map((entry: any, i: number) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      "font-bold px-2 py-0.5 rounded-full",
                      entry.from === "orchestrator"
                        ? "bg-primary/10 text-primary"
                        : entry.type?.includes("result")
                          ? "bg-green-50 text-green-700"
                          : "bg-zinc-100 text-zinc-600",
                    )}>
                      {entry.from ?? entry.type ?? "event"}
                    </span>
                    <span className="text-zinc-300">
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ""}
                    </span>
                  </div>
                  <pre className="bg-zinc-50 rounded-lg p-2 text-[10px] font-mono text-zinc-600 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(
                      entry.content ?? entry.outputs ?? entry.results ?? entry,
                      null, 2,
                    ).slice(0, 400)}
                  </pre>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── SwarmClient ──────────────────────────────────────────────────────────────

export default function SwarmClient() {
  const [agents,    setAgents]    = useState<AgentOption[]>([])
  const [loading,   setLoading]   = useState(false)
  const [running,   setRunning]   = useState(false)
  const [task,      setTask]      = useState("")
  const [name,      setName]      = useState("")
  const [mode,      setMode]      = useState("orchestrate")
  const [maxRounds, setMaxRounds] = useState(2)
  const [selected,  setSelected]  = useState<string[]>([])
  const [result,    setResult]    = useState<SwarmSession | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [sessions,  setSessions]  = useState<any[]>([])
  const [copied,    setCopied]    = useState(false)
  const supabase = createClient()

  useEffect(() => {
    setLoading(true)
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setLoading(false); return }
      supabase
        .from("agents")
        .select("id, name, model_name, status")
        .eq("seller_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(50)
        .then(({ data }) => { setAgents(data ?? []); setLoading(false) })
    })
    fetch("/api/swarm")
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = useCallback(async () => {
    if (!task.trim())        { toast.error("Task is required");           return }
    if (selected.length < 2) { toast.error("Select at least 2 agents"); return }

    setRunning(true); setError(null); setResult(null)
    try {
      const res  = await fetch("/api/swarm", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          task: task.trim(), agentIds: selected,
          name: name.trim() || undefined, mode, maxRounds,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setResult(data)
      setSessions(prev => [
        {
          id:         data.sessionId,
          name:       name || task.slice(0, 40),
          status:     "completed",
          created_at: new Date().toISOString(),
        },
        ...prev.slice(0, 9),
      ])
      toast.success(`Swarm completed — ${data.agentCount} agents, ${data.rounds} steps`)
    } catch (err: any) {
      setError(err.message ?? "Swarm failed")
      toast.error(err.message ?? "Swarm failed")
    } finally {
      setRunning(false)
    }
  }, [task, selected, name, mode, maxRounds])

  const copyAnswer = useCallback(async () => {
    if (!result?.finalAnswer) return
    await navigator.clipboard.writeText(result.finalAnswer)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success("Copied to clipboard")
  }, [result?.finalAnswer])

  // ── Render — content only, no sidebar/layout wrapper ─────────────────────
  return (
    <div className="max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" /> Multi-Agent Swarm
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Orchestrate multiple agents in parallel. Google A2A-compatible peer-to-peer communication.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Left: config ───────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-5">

          {/* Mode */}
          <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-3"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <Label className="text-sm font-semibold text-zinc-900">Swarm Mode</Label>
            <div className="space-y-2">
              {MODES.map(m => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={cn(
                    "w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                    mode === m.id
                      ? "border-primary/30 bg-primary/5"
                      : "border-zinc-100 hover:border-zinc-200",
                  )}>
                  <span className="text-xl flex-shrink-0 mt-0.5">{m.icon}</span>
                  <div>
                    <p className={cn(
                      "text-sm font-semibold",
                      mode === m.id ? "text-primary" : "text-zinc-900",
                    )}>
                      {m.label}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{m.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            {mode === "debate" && (
              <div className="flex items-center gap-3 pt-1">
                <Label className="text-xs font-medium text-zinc-600 flex-shrink-0">
                  Debate rounds
                </Label>
                <Input
                  type="number" min={1} max={5} value={maxRounds}
                  onChange={e => setMaxRounds(Math.min(5, Math.max(1, parseInt(e.target.value) || 2)))}
                  className="w-20 h-8 rounded-xl border-zinc-200 text-sm"
                />
              </div>
            )}
          </div>

          {/* Task + name */}
          <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-3"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-zinc-900">Task *</Label>
              <Textarea
                value={task} onChange={e => setTask(e.target.value)} rows={4}
                placeholder="e.g. Research the competitive landscape of AI agent marketplaces and write an investment memo…"
                className="rounded-xl border-zinc-200 text-sm resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">
                Session Name{" "}
                <span className="text-zinc-400 font-normal">(optional)</span>
              </Label>
              <Input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Q4 competitive analysis"
                className="h-9 rounded-xl border-zinc-200 text-sm"
              />
            </div>
          </div>

          {/* Agent picker */}
          <div className="bg-white border border-zinc-100 rounded-2xl p-5"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <Label className="text-sm font-semibold text-zinc-900 block mb-3">
              Select Agents *{" "}
              <span className="text-zinc-400 font-normal text-xs">(2–8, min 2)</span>
            </Label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400 py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your agents…
              </div>
            ) : (
              <AgentSelector
                agents={agents} selected={selected}
                onChange={setSelected} maxAgents={8}
              />
            )}
          </div>

          {/* Launch button */}
          <Button
            type="button" onClick={run}
            disabled={running || selected.length < 2 || !task.trim()}
            className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-bold h-12 text-sm gap-2"
            aria-busy={running}>
            {running
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Running swarm…</>
              : <><Play className="h-4 w-4" /> Launch Swarm ({selected.length} agents)</>}
          </Button>

          {error && (
            <div role="alert"
              className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* ── Right: result / history ─────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
                style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <div className="px-4 py-3 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-zinc-100 flex items-center justify-between">
                  <span className="text-sm font-bold text-green-800 flex items-center gap-2">
                    <Check className="h-4 w-4" /> Swarm complete
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] capitalize">{result.mode}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{result.agentCount} agents</Badge>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      Final Answer
                    </p>
                    <div className="bg-zinc-50 rounded-xl p-3 text-sm text-zinc-700 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap font-sans">
                      {result.finalAnswer}
                    </div>
                  </div>
                  <button type="button" onClick={copyAnswer}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 font-medium px-2 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 transition-colors">
                    {copied
                      ? <><Check className="h-3 w-3 text-green-600" /> Copied!</>
                      : <><Copy className="h-3 w-3" /> Copy answer</>}
                  </button>
                  <MessageLogViewer log={result.messageLog} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Usage tip (shown when no result yet) */}
          {!result && (
            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-2xl p-5">
              <div className="flex items-start gap-3 mb-3">
                <Network className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-zinc-900">Best for complex tasks</p>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    Swarms excel when a single agent can't hold enough context: research + write +
                    review pipelines, multi-domain analysis, adversarial red-teaming.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  "🔍 Research + summarise + critique",
                  "📊 Multi-domain data analysis",
                  "⚖️ Devil's advocate debate",
                  "🏗️ Plan + execute + review",
                ].map(tip => (
                  <button key={tip} type="button"
                    onClick={() => setTask(tip.slice(3))}
                    className="w-full text-left text-xs text-indigo-700 hover:text-indigo-900 py-0.5 transition-colors hover:underline">
                    {tip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recent sessions */}
          {sessions.length > 0 && (
            <div className="bg-white border border-zinc-100 rounded-2xl p-4"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">
                Recent Sessions
              </p>
              <div className="space-y-2">
                {sessions.slice(0, 5).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      s.status === "completed" ? "bg-green-500" :
                      s.status === "failed"    ? "bg-red-400"   : "bg-amber-400",
                    )} />
                    <span className="text-zinc-600 truncate flex-1">
                      {s.name ?? s.id.slice(0, 20)}
                    </span>
                    <span className="text-zinc-300 flex-shrink-0">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
