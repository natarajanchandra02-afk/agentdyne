"use client"

/**
 * /compose — The "Aha Moment" page
 *
 * Flow: Input → Plan Preview (trust layer) → Execute → Result → Save
 *
 * Key design decisions:
 * - User sees the plan BEFORE execution (trust + transparency)
 * - Can edit the plan or change goal before committing
 * - Live step-by-step progress during run
 * - Cost shown before AND after
 * - "Save as pipeline" is always one click
 * - Full iteration loop: refine → re-run without losing context
 */

import { useState, useRef, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  Sparkles, Play, Check, AlertCircle, Zap, GitBranch, Cpu,
  Layers, ChevronRight, ExternalLink, RefreshCw, Bot, DollarSign,
  Clock, Loader2, X, ArrowRight, Lightbulb, Save, Pencil,
  CheckCircle2, Eye, RotateCcw, Copy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"
import { Suspense } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage =
  | "input"       // goal being written
  | "composing"   // AI building plan
  | "preview"     // plan shown — awaiting user confirmation
  | "running"     // executing pipeline
  | "done"        // result ready
  | "error"       // something failed

interface PlanNode {
  id:              string
  agent_id:        string
  label:           string
  node_type?:      string
  parallel_group?: string
  condition?:      string
  agent_name?:     string
  agent_desc?:     string
  pricing_model?:  string
  price_per_call?: number
}

interface Plan {
  nodes:         PlanNode[]
  edges:         any[]
  pattern:       string
  description:   string
  estimatedCost: number
}

interface NodeResult {
  node_id:    string
  agent_name: string
  status:     "success" | "failed" | "skipped"
  latency_ms: number
  cost:       number
  output?:    unknown
  input?:     unknown
  error?:     string
}

// ─── Examples ─────────────────────────────────────────────────────────────────

const EXAMPLES = [
  { icon: "🎧", text: "Analyse a support ticket, classify urgency, and draft a reply" },
  { icon: "🔬", text: "Research a topic and write a 300-word summary with key takeaways" },
  { icon: "🌐", text: "Translate this text into Spanish, French, and German in parallel" },
  { icon: "📊", text: "Analyse sales data and generate an executive insights report" },
  { icon: "🛡️", text: "Review this code for security vulnerabilities and suggest fixes" },
  { icon: "🎯", text: "Score this sales lead and write a personalised outreach email" },
]

// ─── Pattern badge ────────────────────────────────────────────────────────────

function PatternBadge({ pattern }: { pattern: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
    linear:   { icon: <ArrowRight className="h-3 w-3" />, label: "Sequential",  color: "text-zinc-600",   bg: "bg-zinc-50 border-zinc-100"   },
    parallel: { icon: <Zap className="h-3 w-3" />,        label: "Parallel",    color: "text-blue-600",   bg: "bg-blue-50 border-blue-100"   },
    branch:   { icon: <GitBranch className="h-3 w-3" />,  label: "Conditional", color: "text-amber-600",  bg: "bg-amber-50 border-amber-100" },
    subagent: { icon: <Cpu className="h-3 w-3" />,        label: "Nested",      color: "text-violet-600", bg: "bg-violet-50 border-violet-100"},
    mixed:    { icon: <Layers className="h-3 w-3" />,     label: "Mixed",       color: "text-green-600",  bg: "bg-green-50 border-green-100" },
  }
  const m = map[pattern] ?? map.linear!
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border", m.color, m.bg)}>
      {m.icon} {m.label}
    </span>
  )
}

// ─── Plan Preview ─────────────────────────────────────────────────────────────

function PlanPreview({ plan, reasoning, confidence, onRun, onEdit, running }: {
  plan:       Plan
  reasoning:  string
  confidence: number
  onRun:      () => void
  onEdit:     () => void
  running:    boolean
}) {
  const [showReasoning, setShowReasoning] = useState(false)

  return (
    <div className="space-y-4">
      {/* Plan header */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div className="px-5 py-4 border-b border-zinc-50">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-bold text-zinc-900">Here's what will run</p>
            <div className="flex items-center gap-2">
              <PatternBadge pattern={plan.pattern} />
              <span className="text-[11px] text-zinc-400">{Math.round(confidence * 100)}% confidence</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500">{plan.description}</p>
        </div>

        {/* Step list */}
        <div className="px-5 py-4 space-y-3">
          {plan.nodes.map((node, i) => (
            <div key={node.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center flex-shrink-0 mt-0.5">
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold",
                  node.parallel_group ? "bg-blue-100 text-blue-600" :
                  node.condition      ? "bg-amber-100 text-amber-600" :
                                        "bg-primary/10 text-primary"
                )}>
                  {node.parallel_group ? <Zap className="h-3 w-3" /> :
                   node.condition      ? <GitBranch className="h-3 w-3" /> :
                                         i + 1}
                </div>
                {i < plan.nodes.length - 1 && (
                  <div className="w-px h-3 bg-zinc-100 mt-1" />
                )}
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <p className="text-sm font-semibold text-zinc-900">{node.label}</p>
                {node.agent_desc && (
                  <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{node.agent_desc}</p>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {node.parallel_group && (
                    <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium">Runs in parallel</span>
                  )}
                  {node.condition && (
                    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-mono">if: {node.condition.slice(0, 30)}</span>
                  )}
                  {node.pricing_model === "free"
                    ? <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full font-medium">Free</span>
                    : node.price_per_call != null && node.price_per_call > 0
                      ? <span className="text-[10px] text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded-full font-medium">~${node.price_per_call.toFixed(4)}/run</span>
                      : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Cost + reasoning */}
        <div className="px-5 pb-4 space-y-2.5">
          <div className="flex items-center justify-between bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2.5">
            <span className="text-xs text-zinc-500 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-zinc-400" /> Estimated cost
            </span>
            <span className="text-sm font-bold text-zinc-900">
              {plan.estimatedCost > 0 ? `~$${plan.estimatedCost.toFixed(4)}` : "Free"}
            </span>
          </div>

          <button onClick={() => setShowReasoning(v => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
            <Lightbulb className="h-3 w-3" />
            Why these agents?
            <ChevronRight className={cn("h-3 w-3 ml-auto transition-transform", showReasoning && "rotate-90")} />
          </button>
          {showReasoning && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
              {reasoning}
            </div>
          )}
        </div>
      </div>

      {/* CTA row */}
      <div className="flex items-center gap-2">
        <Button onClick={onRun} disabled={running}
          className="flex-1 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2 shadow-md shadow-primary/20 hover:shadow-lg transition-all h-11">
          {running
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
            : <><Play className="h-4 w-4" /> Run this workflow</>}
        </Button>
        <Button variant="outline" onClick={onEdit} disabled={running} className="rounded-xl border-zinc-200 gap-1.5 h-11">
          <Pencil className="h-4 w-4" /> Edit goal
        </Button>
      </div>

      <p className="text-center text-[11px] text-zinc-400">
        Costs are deducted from your credit balance · Free agents cost nothing
      </p>
    </div>
  )
}

// ─── Live execution tracker ────────────────────────────────────────────────────

function LiveExecution({ plan, nodeResults }: {
  plan:        Plan
  nodeResults: NodeResult[]
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
      <div className="px-5 py-4 border-b border-zinc-50">
        <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Agents running…
        </p>
      </div>
      <div className="px-5 py-4 space-y-2.5">
        {plan.nodes.map((node, i) => {
          const result = nodeResults.find(r => r.node_id === node.id)
          const status = result?.status ?? (i === nodeResults.length ? "running" : "pending")

          return (
            <div key={node.id} className={cn(
              "flex items-center gap-3 p-3 rounded-xl border transition-all",
              status === "running" ? "bg-blue-50 border-blue-100"  :
              status === "success" ? "bg-green-50 border-green-100":
              status === "failed"  ? "bg-red-50 border-red-100"    :
                                     "bg-zinc-50 border-zinc-100"
            )}>
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                status === "running" ? "bg-blue-100"  :
                status === "success" ? "bg-green-100" :
                status === "failed"  ? "bg-red-100"   :
                                       "bg-zinc-200"
              )}>
                {status === "running" ? <Loader2 className="h-3 w-3 text-blue-600 animate-spin" /> :
                 status === "success" ? <Check className="h-3 w-3 text-green-600" /> :
                 status === "failed"  ? <X className="h-3 w-3 text-red-500" /> :
                                        <div className="w-2 h-2 rounded-full bg-zinc-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-800 truncate">{node.label}</p>
                {result?.error && <p className="text-[11px] text-red-500 truncate">{result.error}</p>}
              </div>
              {result && (
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 flex-shrink-0">
                  <span>{result.latency_ms}ms</span>
                  {result.cost > 0 && <span>${result.cost.toFixed(6)}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ output, latencyMs, cost, pipelineId, nodeResults, plan, onReset, onRefine, goal }: {
  output:      unknown
  latencyMs:   number
  cost:        number
  pipelineId:  string
  nodeResults: NodeResult[]
  plan:        Plan
  onReset:     () => void
  onRefine:    (goal: string) => void
  goal:        string
}) {
  const [showTrace,  setShowTrace]  = useState(false)
  const [copied,     setCopied]     = useState(false)
  const [refineGoal, setRefineGoal] = useState("")
  const [showRefine, setShowRefine] = useState(false)

  const outputText = typeof output === "string"
    ? output
    : typeof (output as any)?.text === "string"
      ? (output as any).text
      : typeof (output as any)?.output === "string"
        ? (output as any).output
        : JSON.stringify(output, null, 2)

  const copyOutput = async () => {
    await navigator.clipboard.writeText(outputText).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 1500)
    toast.success("Copied!")
  }

  const successNodes = nodeResults.filter(r => r.status === "success").length
  const failedNodes  = nodeResults.filter(r => r.status === "failed").length

  return (
    <div className="space-y-4">

      {/* Success header */}
      <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-2xl px-5 py-4">
        <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-zinc-900">Done in {(latencyMs / 1000).toFixed(1)}s</p>
          <p className="text-xs text-zinc-500">
            {successNodes} agent{successNodes !== 1 ? "s" : ""} completed
            {failedNodes > 0 && ` · ${failedNodes} failed`}
            {cost > 0 && ` · $${cost.toFixed(6)} used`}
          </p>
        </div>
        <PatternBadge pattern={plan.pattern} />
      </div>

      {/* Output */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-50">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Output</p>
          <button onClick={copyOutput} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 transition-colors">
            {copied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
          </button>
        </div>
        <div className="px-5 py-4 max-h-[400px] overflow-auto">
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">{outputText}</p>
        </div>
      </div>

      {/* Per-node trace (collapsible) */}
      {nodeResults.length > 0 && (
        <div>
          <button onClick={() => setShowTrace(v => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors mb-2">
            <Eye className="h-3.5 w-3.5" />
            {showTrace ? "Hide" : "Show"} step-by-step trace ({nodeResults.length} steps)
            <ChevronRight className={cn("h-3 w-3 ml-1 transition-transform", showTrace && "rotate-90")} />
          </button>

          {showTrace && (
            <div className="space-y-2 bg-white border border-zinc-100 rounded-2xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              {nodeResults.map((nr, i) => (
                <div key={i} className={cn(
                  "rounded-xl border px-3 py-2.5",
                  nr.status === "success" ? "bg-green-50 border-green-100" :
                  nr.status === "failed"  ? "bg-red-50 border-red-100"     :
                                            "bg-zinc-50 border-zinc-100"
                )}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-zinc-800 flex items-center gap-2">
                      {nr.status === "success"
                        ? <Check className="h-3.5 w-3.5 text-green-500" />
                        : <X className="h-3.5 w-3.5 text-red-400" />}
                      {nr.agent_name}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                      <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{nr.latency_ms}ms</span>
                      {nr.cost > 0 && <span>${nr.cost.toFixed(6)}</span>}
                    </div>
                  </div>
                  {nr.error && <p className="text-[11px] text-red-500 mb-1">{nr.error}</p>}
                  {nr.output && (
                    <p className="text-[11px] text-zinc-600 font-mono leading-relaxed line-clamp-2">
                      {typeof nr.output === "string" ? nr.output : JSON.stringify(nr.output)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Refine goal */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <button onClick={() => setShowRefine(v => !v)}
          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-zinc-50 transition-colors">
          <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
            <RotateCcw className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-900">Refine this result</p>
            <p className="text-xs text-zinc-400">Adjust the goal and re-run with the same workflow</p>
          </div>
          <ChevronRight className={cn("h-4 w-4 text-zinc-400 transition-transform", showRefine && "rotate-90")} />
        </button>
        {showRefine && (
          <div className="px-5 pb-5 border-t border-zinc-50 pt-4 space-y-3">
            <textarea
              value={refineGoal}
              onChange={e => setRefineGoal(e.target.value)}
              rows={2}
              placeholder={`Original: "${goal.slice(0, 80)}…"\n\nAdjust: make it shorter / more detailed / focus on X…`}
              className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-xl bg-white resize-none focus:outline-none focus:border-primary/40 transition-colors"
            />
            <Button
              onClick={() => { if (refineGoal.trim()) onRefine(refineGoal.trim()) }}
              disabled={!refineGoal.trim()}
              className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
              <Play className="h-4 w-4" /> Re-run with changes
            </Button>
          </div>
        )}
      </div>

      {/* Primary actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/pipelines/${pipelineId}`}>
          <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
            <Save className="h-4 w-4" /> Open in Pipeline Editor
          </Button>
        </Link>
        <Button variant="outline" onClick={onReset} className="rounded-xl border-zinc-200 gap-1.5">
          <RefreshCw className="h-4 w-4" /> New goal
        </Button>
        <p className="text-xs text-zinc-400 ml-auto">
          Saved · <Link href="/pipelines" className="text-primary hover:underline">View all pipelines</Link>
        </p>
      </div>
    </div>
  )
}

// ─── Inner page (needs useSearchParams) ──────────────────────────────────────

function ComposeInner() {
  const searchParams = useSearchParams()

  const [goal,        setGoal]        = useState(() => searchParams.get("goal") ?? "")
  const [stage,       setStage]       = useState<Stage>(searchParams.get("goal") ? "input" : "input")
  const [plan,        setPlan]        = useState<Plan | null>(null)
  const [reasoning,   setReasoning]   = useState("")
  const [confidence,  setConfidence]  = useState(0.8)
  const [pipelineId,  setPipelineId]  = useState<string | null>(null)
  const [output,      setOutput]      = useState<unknown>(null)
  const [nodeResults, setNodeResults] = useState<NodeResult[]>([])
  const [latencyMs,   setLatencyMs]   = useState(0)
  const [totalCost,   setTotalCost]   = useState(0)
  const [errorMsg,    setErrorMsg]    = useState("")
  const [composing,   setComposing]   = useState(false)
  const [running,     setRunning]     = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const startRef    = useRef(0)

  // Auto-focus textarea
  useEffect(() => {
    if (stage === "input") textareaRef.current?.focus()
  }, [stage])

  // If pre-filled goal from URL, immediately compose on mount
  useEffect(() => {
    const preGoal = searchParams.get("goal")
    if (preGoal && preGoal.trim().length >= 8) {
      setGoal(preGoal.trim())
      // Give React a tick to render, then compose
      const t = setTimeout(() => handleCompose(preGoal.trim()), 100)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCompose = useCallback(async (goalText?: string) => {
    const g = (goalText ?? goal).trim()
    if (g.length < 8) { toast.error("Describe your goal (min 8 chars)"); return }

    setComposing(true); setStage("composing")
    setErrorMsg(""); setPlan(null); setOutput(null); setPipelineId(null); setNodeResults([])

    try {
      const res  = await fetch("/api/composer", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ goal: g, saveAsPipeline: true }),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Could not design a workflow. Try rephrasing your goal.")
      }

      setPlan(data.dag)
      setReasoning(data.reasoning ?? "")
      setConfidence(data.confidence ?? 0.8)
      // Save pipeline ID from auto-save
      if (data.pipelineId) setPipelineId(data.pipelineId)
      setStage("preview")
    } catch (err: any) {
      setErrorMsg(err.message); setStage("error")
    } finally {
      setComposing(false)
    }
  }, [goal])

  const handleRun = useCallback(async () => {
    if (!plan || !pipelineId) {
      // Need to save pipeline first
      toast.error("Saving pipeline first…")
      return
    }

    setRunning(true); setStage("running")
    startRef.current = Date.now()
    setNodeResults([])

    try {
      const res  = await fetch(`/api/pipelines/${pipelineId}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ input: { text: goal.trim(), goal: goal.trim() } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Execution failed (HTTP ${res.status})`)

      setNodeResults(data.node_results ?? [])
      setOutput(data.output ?? data.result)
      setLatencyMs(Date.now() - startRef.current)
      setTotalCost(parseFloat(data.summary?.total_cost_usd ?? data.cost ?? "0"))
      setStage("done")
    } catch (err: any) {
      setErrorMsg(err.message); setStage("error")
    } finally {
      setRunning(false)
    }
  }, [plan, pipelineId, goal])

  const handleReset = () => {
    setGoal(""); setStage("input"); setPlan(null); setOutput(null)
    setPipelineId(null); setErrorMsg(""); setReasoning("")
    setNodeResults([]); setComposing(false); setRunning(false)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const handleRefine = (newGoal: string) => {
    setGoal(newGoal)
    handleCompose(newGoal)
  }

  const handleEditGoal = () => {
    setStage("input")
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const isProcessing = composing || running

  return (
    <div className="max-w-2xl mx-auto">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
          <Sparkles className="h-3.5 w-3.5" /> AI Composer
        </div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 mb-2">
          Describe your goal.
        </h1>
        <p className="text-zinc-400 text-sm max-w-md mx-auto">
          AI designs the workflow, shows you the plan, then runs it. Full transparency — no black box.
        </p>
      </div>

      {/* ── Goal input (always visible, disabled when processing) ─────────── */}
      {(stage === "input" || stage === "error") && (
        <div className="space-y-4">
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
            <textarea
              ref={textareaRef}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isProcessing) handleCompose() }}
              disabled={isProcessing}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Analyse this support ticket, classify urgency, and draft a personalised reply…"
              className="w-full px-5 pt-5 pb-3 text-sm text-zinc-900 placeholder:text-zinc-400 bg-transparent border-none outline-none resize-none"
            />
            <div className="px-5 pb-4 flex items-center justify-between">
              <span className="text-[11px] text-zinc-300">{goal.length}/1000 · ⌘↵ to compose</span>
              <Button onClick={() => handleCompose()} disabled={isProcessing || goal.length < 8}
                className="rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2 shadow-md shadow-primary/20 px-6 h-9">
                {composing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Designing…</>
                  : <><Sparkles className="h-4 w-4" /> Design Workflow</>}
              </Button>
            </div>
          </div>

          {/* Examples */}
          {!goal && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider text-center">Try an example</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EXAMPLES.map(eg => (
                  <button key={eg.text}
                    onClick={() => { setGoal(eg.text); setTimeout(() => textareaRef.current?.focus(), 50) }}
                    className="flex items-start gap-3 p-3.5 bg-white border border-zinc-100 rounded-xl hover:border-primary/30 hover:bg-primary/[0.02] transition-all text-left group">
                    <span className="text-lg flex-shrink-0">{eg.icon}</span>
                    <span className="text-xs text-zinc-600 group-hover:text-zinc-900 transition-colors leading-relaxed">{eg.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Composing indicator ──────────────────────────────────────────── */}
      {stage === "composing" && (
        <div className="space-y-6">
          {/* Goal read-only display */}
          <div className="bg-white border border-zinc-100 rounded-2xl px-5 py-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Goal</p>
            <p className="text-sm text-zinc-700 leading-relaxed">{goal}</p>
          </div>

          <div className="flex items-center gap-4 justify-center py-6">
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-7 w-7 text-primary animate-pulse" />
              </div>
              <p className="text-sm font-semibold text-zinc-700">Designing your workflow…</p>
              <p className="text-xs text-zinc-400 text-center max-w-xs">
                Analysing your goal, selecting the best agents, and planning execution
              </p>
            </div>
          </div>

          {/* Animated skeleton */}
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="bg-white border border-zinc-100 rounded-xl px-4 py-3 flex items-center gap-3 animate-pulse">
                <div className="w-6 h-6 rounded-full bg-zinc-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-zinc-100 rounded-full" style={{ width: `${60 + i * 10}%` }} />
                  <div className="h-2.5 bg-zinc-50 rounded-full" style={{ width: `${40 + i * 5}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Plan preview ─────────────────────────────────────────────────── */}
      {stage === "preview" && plan && (
        <div className="space-y-4">
          {/* Goal header */}
          <div className="bg-white border border-zinc-100 rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5">Your goal</p>
              <p className="text-xs text-zinc-700 truncate">{goal}</p>
            </div>
            <button onClick={handleEditGoal} className="flex items-center gap-1 text-xs text-primary hover:underline font-medium flex-shrink-0 ml-3">
              <Pencil className="h-3 w-3" /> Change
            </button>
          </div>

          <PlanPreview
            plan={plan}
            reasoning={reasoning}
            confidence={confidence}
            onRun={handleRun}
            onEdit={handleEditGoal}
            running={running}
          />
        </div>
      )}

      {/* ── Running ──────────────────────────────────────────────────────── */}
      {stage === "running" && plan && (
        <div className="space-y-4">
          <div className="bg-white border border-zinc-100 rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5">Running</p>
            <p className="text-xs text-zinc-700 truncate">{goal}</p>
          </div>
          <LiveExecution plan={plan} nodeResults={nodeResults} />
        </div>
      )}

      {/* ── Done ─────────────────────────────────────────────────────────── */}
      {stage === "done" && output !== null && plan && pipelineId && (
        <div className="space-y-4">
          <div className="bg-white border border-zinc-100 rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5">Goal</p>
            <p className="text-xs text-zinc-700 truncate">{goal}</p>
          </div>
          <ResultCard
            output={output}
            latencyMs={latencyMs}
            cost={totalCost}
            pipelineId={pipelineId}
            nodeResults={nodeResults}
            plan={plan}
            onReset={handleReset}
            onRefine={handleRefine}
            goal={goal}
          />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {stage === "error" && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 space-y-3 mt-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Something went wrong</p>
              <p className="text-xs text-red-600 mt-1 leading-relaxed">{errorMsg}</p>
              <p className="text-xs text-zinc-400 mt-2">Try rephrasing your goal, or check that you have active agents in your marketplace.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setStage("input")} variant="outline" className="rounded-xl border-red-200 text-red-700 hover:bg-red-50 gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit goal
            </Button>
            <Link href="/marketplace">
              <Button size="sm" variant="outline" className="rounded-xl border-zinc-200 text-zinc-600 gap-1.5">
                <Bot className="h-3.5 w-3.5" /> Browse agents
              </Button>
            </Link>
            <Button size="sm" variant="outline" onClick={handleReset} className="rounded-xl border-zinc-200 text-zinc-600 ml-auto gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Start over
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}

// ─── Page export (Suspense wraps useSearchParams) ────────────────────────────

export default function ComposePage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 text-center">
          <div className="h-6 w-32 bg-zinc-100 rounded-full mx-auto mb-4 animate-pulse" />
          <div className="h-9 w-56 bg-zinc-100 rounded-xl mx-auto mb-2 animate-pulse" />
          <div className="h-4 w-72 bg-zinc-50 rounded-full mx-auto animate-pulse" />
        </div>
        <div className="bg-white border border-zinc-200 rounded-2xl p-5 h-36 animate-pulse" />
      </div>
    }>
      <ComposeInner />
    </Suspense>
  )
}
