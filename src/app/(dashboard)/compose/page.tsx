"use client"

/**
 * /compose — Hero moment page
 *
 * The single killer flow:
 *   1. User types a goal
 *   2. AI composes a pipeline (< 3s)
 *   3. Pipeline runs immediately
 *   4. User sees the output — no tab switches, no config
 *
 * This is the "aha moment" that converts visitors into power users.
 * Every element here is optimised for speed and immediate value.
 */

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Sparkles, ArrowRight, Loader2, Play, Check, AlertCircle,
  Zap, GitBranch, Cpu, Layers, ChevronRight, ExternalLink,
  RefreshCw, Bot, DollarSign, Clock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── Example goals ────────────────────────────────────────────────────────────

const EXAMPLE_GOALS = [
  { icon: "📧", text: "Summarise my support tickets and draft personalised replies" },
  { icon: "🔍", text: "Research the top 5 AI tools launched this week" },
  { icon: "📊", text: "Analyse this dataset and extract key insights" },
  { icon: "🌐", text: "Translate this product description to French, Spanish and German" },
  { icon: "📝", text: "Extract action items from this meeting transcript" },
  { icon: "🛡️", text: "Scan this code for security vulnerabilities and explain each one" },
]

// ─── Step indicator ───────────────────────────────────────────────────────────

type Step = "idle" | "composing" | "composed" | "running" | "done" | "error"

function StepBar({ step }: { step: Step }) {
  const steps: Array<{ key: Step | "running" | "done"; label: string }> = [
    { key: "composing", label: "Designing workflow" },
    { key: "running",   label: "Running agents"     },
    { key: "done",      label: "Result ready"       },
  ]
  const stepOrder: Step[] = ["idle", "composing", "composed", "running", "done"]
  const current = stepOrder.indexOf(step)

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done    = current > i + 1
        const active  = current === i + 1 || (s.key === "running" && step === "composed")
        const pending = current < i + 1
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-all",
              done    ? "bg-green-100 text-green-700"  :
              active  ? "bg-primary/10 text-primary"   :
                        "bg-zinc-100 text-zinc-400"
            )}>
              {done    ? <Check className="h-3 w-3" />         :
               active  ? <Loader2 className="h-3 w-3 animate-spin" /> :
                          <div className="w-3 h-3 rounded-full border-2 border-current opacity-40" />}
              {s.label}
            </div>
            {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-zinc-300 flex-shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}

// ─── Composed pipeline preview ────────────────────────────────────────────────

function PipelinePreview({ nodes, pattern, estimatedCost }: {
  nodes:         Array<{ id: string; label: string; parallel_group?: string; condition?: string; node_type?: string }>
  pattern:       string
  estimatedCost: number
}) {
  const patternColors: Record<string, string> = {
    linear:   "text-zinc-600 bg-zinc-50",
    parallel: "text-blue-600 bg-blue-50",
    branch:   "text-amber-600 bg-amber-50",
    subagent: "text-violet-600 bg-violet-50",
    mixed:    "text-green-600 bg-green-50",
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl px-5 py-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full capitalize", patternColors[pattern] ?? patternColors.linear)}>
            {pattern === "parallel" && <Zap className="h-3 w-3 inline mr-1" />}
            {pattern === "branch"   && <GitBranch className="h-3 w-3 inline mr-1" />}
            {pattern === "subagent" && <Cpu className="h-3 w-3 inline mr-1" />}
            {pattern === "mixed"    && <Layers className="h-3 w-3 inline mr-1" />}
            {pattern} pattern
          </span>
          <span className="text-[10px] text-zinc-400">{nodes.length} agent{nodes.length !== 1 ? "s" : ""}</span>
        </div>
        {estimatedCost > 0 && (
          <span className="text-[11px] text-zinc-400 flex items-center gap-1">
            <DollarSign className="h-3 w-3" /> ~${estimatedCost.toFixed(4)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5">
              {node.parallel_group && <Zap className="h-3 w-3 text-blue-400" />}
              {node.condition      && <GitBranch className="h-3 w-3 text-amber-400" />}
              <span className="text-xs font-medium text-zinc-700">{node.label}</span>
            </div>
            {i < nodes.length - 1 && <ArrowRight className="h-3 w-3 text-zinc-300 flex-shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Result display ───────────────────────────────────────────────────────────

function ResultDisplay({ output, latencyMs, cost, pipelineId }: {
  output:     unknown
  latencyMs:  number
  cost:       number
  pipelineId: string
}) {
  const text = typeof output === "string"
    ? output
    : typeof (output as any)?.text === "string"
      ? (output as any).text
      : JSON.stringify(output, null, 2)

  return (
    <div className="space-y-4">
      {/* Meta */}
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1 text-green-600 font-semibold">
          <Check className="h-3.5 w-3.5" /> Done
        </span>
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {latencyMs}ms</span>
        {cost > 0 && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> ${cost.toFixed(6)}</span>}
      </div>

      {/* Output */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-5 py-3 border-b border-zinc-50 flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Output</p>
          <Link href={`/pipelines/${pipelineId}`} target="_blank">
            <button className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
              Open in Pipeline Editor <ExternalLink className="h-3 w-3" />
            </button>
          </Link>
        </div>
        <div className="px-5 py-4 max-h-[400px] overflow-auto">
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ComposePage() {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [goal,       setGoal]       = useState("")
  const [step,       setStep]       = useState<Step>("idle")
  const [dag,        setDag]        = useState<any>(null)
  const [reasoning,  setReasoning]  = useState("")
  const [pipelineId, setPipelineId] = useState<string | null>(null)
  const [output,     setOutput]     = useState<unknown>(null)
  const [latencyMs,  setLatencyMs]  = useState(0)
  const [totalCost,  setTotalCost]  = useState(0)
  const [errorMsg,   setErrorMsg]   = useState("")
  const [startTime,  setStartTime]  = useState(0)

  useEffect(() => { textareaRef.current?.focus() }, [])

  const run = async () => {
    if (!goal.trim() || goal.length < 8) { toast.error("Describe your goal (min 8 chars)"); return }
    setErrorMsg(""); setDag(null); setOutput(null); setPipelineId(null)
    setStartTime(Date.now())

    // ── STEP 1: Compose ──────────────────────────────────────────────────────
    setStep("composing")
    let composedDag: any
    let savedPipelineId: string

    try {
      const composeRes = await fetch("/api/composer", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ goal: goal.trim(), saveAsPipeline: true }),
      })
      const composeData = await composeRes.json()

      if (!composeRes.ok || !composeData.ok) {
        throw new Error(composeData.error ?? "Could not design a workflow for this goal. Try rephrasing.")
      }

      composedDag      = composeData.dag
      savedPipelineId  = composeData.pipelineId

      setDag(composeData.dag)
      setReasoning(composeData.reasoning)
      setStep("composed")

      if (!savedPipelineId) {
        // Composer didn't auto-save — create the pipeline explicitly
        const createRes = await fetch("/api/pipelines", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            name:        (composedDag.description ?? goal).slice(0, 80),
            description: `Auto-composed: "${goal.slice(0, 200)}"`,
            dag:         { nodes: composedDag.nodes, edges: composedDag.edges },
            is_public:   false,
          }),
        })
        const createData = await createRes.json()
        if (!createRes.ok) throw new Error(createData.error ?? "Failed to save pipeline")
        savedPipelineId = createData.id
      }

      setPipelineId(savedPipelineId)
    } catch (err: any) {
      setErrorMsg(err.message); setStep("error"); return
    }

    // ── STEP 2: Execute immediately ──────────────────────────────────────────
    setStep("running")
    try {
      const execRes = await fetch(`/api/pipelines/${savedPipelineId}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ input: { text: goal.trim() } }),
      })
      const execData = await execRes.json()

      if (!execRes.ok) throw new Error(execData.error ?? "Execution failed")

      setOutput(execData.output ?? execData.result)
      setLatencyMs(Date.now() - startTime)
      setTotalCost(parseFloat(execData.summary?.total_cost_usd ?? execData.cost ?? "0"))
      setStep("done")
    } catch (err: any) {
      setErrorMsg(err.message); setStep("error")
    }
  }

  const reset = () => {
    setGoal(""); setStep("idle"); setDag(null); setOutput(null)
    setPipelineId(null); setErrorMsg(""); setReasoning("")
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const isRunning = step === "composing" || step === "running"

  return (
    <div className="max-w-3xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
          <Sparkles className="h-3.5 w-3.5" /> AI Composer
        </div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 mb-2">
          Describe your goal.
        </h1>
        <p className="text-zinc-400 text-sm max-w-md mx-auto">
          AI selects the right agents, wires them into a workflow, and runs it immediately.
          No config. No pipeline editor. Just results.
        </p>
      </div>

      {/* ── Goal input ──────────────────────────────────────────────────────── */}
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm mb-4">
        <textarea
          ref={textareaRef}
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isRunning) run() }}
          disabled={isRunning || step === "done"}
          rows={3}
          maxLength={1000}
          placeholder="e.g. Summarise this article and extract 5 key takeaways with sentiment scores..."
          className="w-full px-5 pt-5 pb-3 text-sm text-zinc-900 placeholder:text-zinc-400 bg-transparent border-none outline-none resize-none disabled:opacity-60"
        />
        <div className="px-5 pb-4 flex items-center justify-between">
          <span className="text-[11px] text-zinc-300">{goal.length}/1000 · ⌘↵ to run</span>
          <Button onClick={run} disabled={isRunning || goal.length < 8 || step === "done"}
            className="rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2 shadow-md shadow-primary/20 hover:shadow-lg transition-all px-6">
            {isRunning
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</>
              : step === "done"
                ? <><Check className="h-4 w-4" /> Done</>
                : <><Play className="h-4 w-4" /> Run</>}
          </Button>
        </div>
      </div>

      {/* ── Example goals ───────────────────────────────────────────────────── */}
      {step === "idle" && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider text-center">Try an example</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EXAMPLE_GOALS.map(eg => (
              <button key={eg.text} onClick={() => { setGoal(eg.text); textareaRef.current?.focus() }}
                className="flex items-start gap-3 p-3.5 bg-white border border-zinc-100 rounded-xl hover:border-primary/30 hover:bg-primary/[0.02] transition-all text-left group">
                <span className="text-lg flex-shrink-0">{eg.icon}</span>
                <span className="text-xs text-zinc-600 group-hover:text-zinc-900 transition-colors leading-relaxed">{eg.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Progress ────────────────────────────────────────────────────────── */}
      {step !== "idle" && step !== "error" && (
        <div className="space-y-4">
          {/* Step bar */}
          <div className="flex justify-center">
            <StepBar step={step} />
          </div>

          {/* Pipeline preview (shown as soon as composed) */}
          {dag && step !== "composing" && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Workflow designed</p>
              <PipelinePreview
                nodes={dag.nodes}
                pattern={dag.pattern ?? "linear"}
                estimatedCost={dag.estimatedCost ?? 0}
              />
              {reasoning && (
                <p className="text-xs text-zinc-400 leading-relaxed px-1">{reasoning}</p>
              )}
            </div>
          )}

          {/* Running indicator */}
          {step === "running" && (
            <div className="flex items-center gap-3 bg-primary/[0.04] border border-primary/20 rounded-xl px-5 py-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-zinc-900">Agents running…</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {dag?.nodes?.length ?? 0} agent{dag?.nodes?.length !== 1 ? "s" : ""} executing in sequence
                </p>
              </div>
            </div>
          )}

          {/* Result */}
          {step === "done" && output !== null && pipelineId && (
            <ResultDisplay
              output={output}
              latencyMs={latencyMs}
              cost={totalCost}
              pipelineId={pipelineId}
            />
          )}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {step === "error" && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Something went wrong</p>
              <p className="text-xs text-red-600 mt-1 leading-relaxed">{errorMsg}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={reset} variant="outline" className="rounded-xl border-red-200 text-red-600 hover:bg-red-50">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
            </Button>
            <Link href="/marketplace">
              <Button size="sm" variant="outline" className="rounded-xl border-zinc-200 text-zinc-600">
                <Bot className="h-3.5 w-3.5 mr-1.5" /> Browse agents
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ── Post-result actions ──────────────────────────────────────────────── */}
      {step === "done" && pipelineId && (
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <Button onClick={reset} variant="outline" className="rounded-xl border-zinc-200 gap-1.5">
            <RefreshCw className="h-4 w-4" /> New goal
          </Button>
          <Link href={`/pipelines/${pipelineId}`}>
            <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 font-semibold">
              <ExternalLink className="h-4 w-4" /> Open pipeline editor
            </Button>
          </Link>
          <p className="text-xs text-zinc-400 ml-auto">
            Pipeline saved · <Link href="/pipelines" className="text-primary hover:underline">View all</Link>
          </p>
        </div>
      )}
    </div>
  )
}
