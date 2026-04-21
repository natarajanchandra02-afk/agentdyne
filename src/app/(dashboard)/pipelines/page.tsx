"use client"
export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Plus, Layers, Play, Globe, Lock, Clock,
  MoreHorizontal, Trash2, Copy, AlertCircle, Loader2,
  ChevronRight, ArrowRight, Zap, Bot, Sparkles, X,
  GitBranch, Cpu, CheckCircle2,
} from "lucide-react"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn, formatDate, formatNumber } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

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

type PatternType = "linear" | "parallel" | "branch" | "subagent" | "mixed"

interface ComposerResult {
  ok:          boolean
  dag?:        { nodes: any[]; edges: any[]; pattern: PatternType; description: string; estimatedCost: number }
  reasoning:   string
  patternUsed: PatternType
  confidence:  number
  pipelineId?: string
  error?:      string
}

// ─── Pipeline templates ────────────────────────────────────────────────────────
// Templates pre-fill the AI Composer with a proven goal + pattern.
// They deliberately do NOT hardcode agent IDs — the Composer picks the best
// available agents from the marketplace dynamically at compose-time.

interface Template {
  id:          string
  name:        string
  description: string
  goal:        string
  pattern:     PatternType
  emoji:       string
  category:    string
  tags:        string[]
  sampleInputHint: string
}

const TEMPLATES: Template[] = [
  {
    id:          "support-automation",
    name:        "Customer Support Automation",
    description: "Classify support tickets by urgency, draft personalised replies, and flag critical issues for human review.",
    goal:        "Read a customer support ticket, classify it as low/medium/high urgency, draft a helpful reply based on the urgency level, and flag critical issues. Output the classification, reply draft, and whether it needs human escalation.",
    pattern:     "branch",
    emoji:       "🎧",
    category:    "Customer Support",
    tags:        ["support", "classification", "reply-draft"],
    sampleInputHint: "Customer support ticket text",
  },
  {
    id:          "lead-enrichment",
    name:        "Lead Enrichment Pipeline",
    description: "Take a lead's name and company, research them, score qualification, and output a CRM-ready summary.",
    goal:        "Given a lead's name and company: (1) research their company size, industry, and recent news, (2) extract key facts, (3) score lead qualification from 1-10 with reasoning, (4) write a personalised outreach message. Output structured JSON with all fields.",
    pattern:     "linear",
    emoji:       "🎯",
    category:    "Sales",
    tags:        ["lead-scoring", "research", "outreach"],
    sampleInputHint: '{"name": "Sarah Chen", "company": "Acme Corp", "role": "CTO"}',
  },
  {
    id:          "content-pipeline",
    name:        "Content Generation Pipeline",
    description: "Turn a topic into a polished blog post with SEO keywords, a social media summary, and a LinkedIn caption — all in parallel.",
    goal:        "Given a topic and target audience: run in parallel — (A) write a 600-word SEO-optimised blog post, (B) extract 5 target keywords, (C) write a 280-char Twitter/X summary. Combine all three outputs into a final content package.",
    pattern:     "parallel",
    emoji:       "✍️",
    category:    "Marketing",
    tags:        ["content", "seo", "social-media"],
    sampleInputHint: '{"topic": "Benefits of AI agents for small businesses", "audience": "SME founders"}',
  },
  {
    id:          "data-extraction",
    name:        "Document Data Extraction",
    description: "Extract structured data from unstructured text, validate it, and output clean JSON ready for your database.",
    goal:        "Given raw text (invoice, contract, email, or form): (1) extract all key fields as structured JSON, (2) validate required fields are present and formatted correctly, (3) flag any missing or suspicious values. Output validated JSON + a list of any validation warnings.",
    pattern:     "linear",
    emoji:       "📄",
    category:    "Data Analysis",
    tags:        ["extraction", "validation", "structured-data"],
    sampleInputHint: "Paste invoice text, contract clause, or any unstructured document",
  },
  {
    id:          "research-summary",
    name:        "Research & Summarise",
    description: "Run multiple research queries in parallel, synthesise findings into a structured report, and highlight key insights.",
    goal:        "Given a research question: run in parallel — (A) find key facts and statistics, (B) identify main arguments for and against, (C) find 3-5 real-world examples. Then synthesise all findings into a structured research report with an executive summary, key insights, and recommended next steps.",
    pattern:     "parallel",
    emoji:       "🔬",
    category:    "Research",
    tags:        ["research", "synthesis", "report"],
    sampleInputHint: "What are the main risks and opportunities of implementing AI in healthcare?",
  },
]

// ─── Pattern badge ────────────────────────────────────────────────────────────

function PatternBadge({ pattern }: { pattern?: PatternType }) {
  if (!pattern || pattern === "linear") return null
  const map: Record<PatternType, { label: string; color: string; icon: React.ReactNode }> = {
    linear:   { label: "Linear",   color: "bg-zinc-100 text-zinc-500",  icon: <ArrowRight className="h-3 w-3" /> },
    parallel: { label: "Parallel", color: "bg-blue-50 text-blue-600",   icon: <Zap className="h-3 w-3" /> },
    branch:   { label: "Branch",   color: "bg-amber-50 text-amber-600", icon: <GitBranch className="h-3 w-3" /> },
    subagent: { label: "Subagent", color: "bg-violet-50 text-violet-600",icon: <Cpu className="h-3 w-3" /> },
    mixed:    { label: "Mixed",    color: "bg-green-50 text-green-600",  icon: <Layers className="h-3 w-3" /> },
  }
  const m = map[pattern]
  return (
    <span className={cn("flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full", m.color)}>
      {m.icon} {m.label}
    </span>
  )
}

function StatusPill({ status }: { status?: Pipeline["status"] }) {
  const map = {
    idle:    { label: "Idle",    color: "bg-zinc-100 text-zinc-500"  },
    running: { label: "Running", color: "bg-blue-50  text-blue-600"  },
    success: { label: "Success", color: "bg-green-50 text-green-600" },
    failed:  { label: "Failed",  color: "bg-red-50   text-red-600"   },
  }
  const { label, color } = map[status ?? "idle"]
  return <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", color)}>{label}</span>
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({ template, onUse }: { template: Template; onUse: (t: Template) => void }) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-4 hover:border-zinc-200 hover:shadow-sm transition-all group"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-zinc-50 flex items-center justify-center text-xl flex-shrink-0 border border-zinc-100">
          {template.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="font-semibold text-zinc-900 text-sm">{template.name}</h3>
            <PatternBadge pattern={template.pattern} />
          </div>
          <p className="text-[11px] text-zinc-400">{template.category}</p>
        </div>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed mb-3 line-clamp-2">{template.description}</p>
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {template.tags.map(tag => (
            <span key={tag} className="text-[10px] bg-zinc-50 border border-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
        <Button size="sm" onClick={() => onUse(template)}
          className="rounded-xl h-7 px-3 text-xs bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-1 flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-all">
          <Sparkles className="h-3 w-3" /> Use
        </Button>
      </div>
    </div>
  )
}

// ─── AI Composer Modal ─────────────────────────────────────────────────────────

function ComposerModal({ open, onClose, onCreated, prefillGoal, prefillPattern }: {
  open:           boolean
  onClose:        () => void
  onCreated:      (p: Pipeline) => void
  prefillGoal?:   string
  prefillPattern?: PatternType
}) {
  const router = useRouter()
  const [goal,        setGoal]        = useState(prefillGoal ?? "")
  const [budget,      setBudget]      = useState("")
  const [pattern,     setPattern]     = useState<PatternType | "">(prefillPattern ?? "")
  const [loading,     setLoading]     = useState(false)
  const [result,      setResult]      = useState<ComposerResult | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)

  // Sync prefill when template changes
  useEffect(() => {
    if (prefillGoal)    setGoal(prefillGoal)
    if (prefillPattern) setPattern(prefillPattern)
  }, [prefillGoal, prefillPattern])

  const PATTERNS: Array<{ value: PatternType; label: string; desc: string; icon: React.ReactNode }> = [
    { value: "linear",   label: "Linear",   desc: "A → B → C sequential",             icon: <ArrowRight className="h-4 w-4" /> },
    { value: "parallel", label: "Parallel", desc: "A → (B ∥ C) → D concurrent",       icon: <Zap className="h-4 w-4" /> },
    { value: "branch",   label: "Branch",   desc: "A → [condition] → B | C",           icon: <GitBranch className="h-4 w-4" /> },
    { value: "subagent", label: "Subagent", desc: "Main agent delegates to sub-agents", icon: <Cpu className="h-4 w-4" /> },
  ]

  const compose = async () => {
    if (!goal.trim()) { toast.error("Please describe your goal"); return }
    setLoading(true); setResult(null)
    try {
      const res  = await fetch("/api/composer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ goal: goal.trim(), maxBudgetUsd: budget ? parseFloat(budget) : undefined, preferredPattern: pattern || undefined }),
      })
      const data: ComposerResult = await res.json()
      setResult(data)
      if (!data.ok) toast.error(data.error ?? "Composer failed")
    } catch (err: any) {
      toast.error(err.message ?? "Composer failed")
    } finally { setLoading(false) }
  }

  const savePipeline = async () => {
    if (!result?.dag) return
    setSaveLoading(true)
    try {
      const res  = await fetch("/api/pipelines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({
          name:        result.dag.description.slice(0, 80),
          description: `AI-composed from: "${goal.slice(0, 200)}"`,
          dag:         { nodes: result.dag.nodes, edges: result.dag.edges },
          is_public:   false,
          tags:        [result.dag.pattern, "ai-composed"],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create pipeline")
      toast.success("Pipeline created from AI design!")
      onCreated(data)
      onClose()
      router.push(`/pipelines/${data.id}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setSaveLoading(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!loading) onClose() }} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-2xl z-10 overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-5 border-b border-zinc-100 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-zinc-900">AI Workflow Composer</h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Describe your goal in plain English — AI selects the best agents and builds the workflow for you.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Goal */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">
              Your Goal <span className="text-red-400">*</span>
            </label>
            <Textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={`E.g. "Research top 5 competitors in AI space and write a comparison report"\n"Classify support tickets by urgency then draft personalized replies"\n"Translate product descriptions to French and Spanish in parallel"`}
              className="rounded-xl border-zinc-200 text-sm resize-none"
            />
          </div>

          {/* Pattern selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">
              Preferred Pattern <span className="text-zinc-300">(optional — AI decides if blank)</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PATTERNS.map(p => (
                <button key={p.value}
                  onClick={() => setPattern(prev => prev === p.value ? "" : p.value)}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                    pattern === p.value
                      ? "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20"
                      : "border-zinc-100 bg-white hover:border-zinc-200 hover:bg-zinc-50"
                  )}>
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                    pattern === p.value ? "bg-primary/10 text-primary" : "bg-zinc-50 text-zinc-400"
                  )}>
                    {p.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-900">{p.label}</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{p.desc}</p>
                  </div>
                  {pattern === p.value && <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 ml-auto mt-0.5" />}
                </button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">
              Max budget per run <span className="text-zinc-300">(optional)</span>
            </label>
            <div className="relative max-w-[160px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
              <input type="number" min="0" step="0.01" value={budget} onChange={e => setBudget(e.target.value)}
                placeholder="0.10"
                className="w-full h-9 pl-7 pr-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400 transition-all" />
            </div>
          </div>

          {/* Result */}
          {result && (
            <div className={cn(
              "rounded-xl border p-4 space-y-3",
              result.ok ? "border-green-100 bg-green-50/50" : "border-red-100 bg-red-50/50"
            )}>
              {result.ok && result.dag ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm font-semibold text-zinc-900">Workflow designed!</p>
                    <PatternBadge pattern={result.dag.pattern} />
                    <span className="text-xs text-zinc-400 ml-auto">{Math.round(result.confidence * 100)}% confidence</span>
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">{result.reasoning}</p>
                  <div className="bg-white border border-zinc-100 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                      Workflow ({result.dag.nodes.length} steps)
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {result.dag.nodes.map((n: any, i: number) => (
                        <div key={n.id} className="flex items-center gap-1.5">
                          <div className="flex items-center gap-1.5 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5">
                            {n.parallel_group && <Zap className="h-3 w-3 text-blue-500" />}
                            {n.condition && <GitBranch className="h-3 w-3 text-amber-500" />}
                            <span className="text-xs font-medium text-zinc-700">{n.label}</span>
                          </div>
                          {i < result.dag!.nodes.length - 1 && <ArrowRight className="h-3 w-3 text-zinc-300 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                    {result.dag.estimatedCost > 0 && (
                      <p className="text-[11px] text-zinc-400 mt-2">Estimated: ${result.dag.estimatedCost.toFixed(4)}/run</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700">Composition failed</p>
                    <p className="text-xs text-red-600 mt-0.5">{result.error}</p>
                    <p className="text-xs text-zinc-400 mt-2">
                      Try: be more specific, add agents to the Marketplace first, or choose a different pattern.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 flex items-center gap-3">
          <Button variant="outline" onClick={onClose} disabled={loading || saveLoading}
            className="rounded-xl border-zinc-200 flex-1">Cancel</Button>
          {result?.ok ? (
            <Button onClick={savePipeline} disabled={saveLoading}
              className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
              {saveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saveLoading ? "Creating…" : "Save & Edit →"}
            </Button>
          ) : (
            <Button onClick={compose} disabled={loading || !goal.trim()}
              className="flex-1 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2">
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Composing…</>
                : <><Sparkles className="h-4 w-4" /> Compose Workflow</>}
            </Button>
          )}
          {result?.ok && (
            <Button variant="outline" onClick={() => setResult(null)} disabled={saveLoading}
              className="rounded-xl border-zinc-200 px-3">↺ Retry</Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── New pipeline modal ────────────────────────────────────────────────────────

function NewPipelineModal({ open, onClose, onCreated, prefilledAgentId, prefilledAgentName }: {
  open: boolean; onClose: () => void; onCreated: (p: Pipeline) => void
  prefilledAgentId?: string; prefilledAgentName?: string
}) {
  const router = useRouter()
  const [name,     setName]     = useState(prefilledAgentName ? `${prefilledAgentName} Pipeline` : "")
  const [desc,     setDesc]     = useState("")
  const [isPublic, setIsPublic] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState("")

  useEffect(() => {
    if (prefilledAgentName && !name) setName(`${prefilledAgentName} Pipeline`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledAgentName])

  const reset  = () => { setName(""); setDesc(""); setIsPublic(false); setError("") }
  const submit = async () => {
    if (!name.trim()) { setError("Name is required"); return }
    setLoading(true); setError("")
    try {
      const initialNodes = prefilledAgentId
        ? [{ id: `node_${Date.now()}`, agent_id: prefilledAgentId, label: prefilledAgentName ?? "Step 1", continue_on_failure: false }]
        : []
      const res  = await fetch("/api/pipelines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ name: name.trim(), description: desc.trim() || null, is_public: isPublic, dag: { nodes: initialNodes, edges: [] } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create pipeline")
      toast.success("Pipeline created!")
      onCreated(data); reset(); onClose()
      router.push(`/pipelines/${data.id}`)
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { if (!loading) { reset(); onClose() } }} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-md p-6 z-10">
        <h2 className="text-lg font-bold text-zinc-900 mb-1">New Pipeline</h2>
        <p className="text-sm text-zinc-400 mb-5">
          {prefilledAgentId ? `"${prefilledAgentName}" will be the first step.` : "You'll add agents in the editor."}
        </p>
        {prefilledAgentId && (
          <div className="flex items-center gap-3 bg-primary/[0.04] border border-primary/20 rounded-xl px-3 py-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-900">{prefilledAgentName}</p>
              <p className="text-[11px] text-zinc-400">Step 1 — pre-added from Marketplace</p>
            </div>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider block mb-1.5">Name <span className="text-red-400">*</span></label>
            <input type="text" maxLength={100} value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="e.g. Research → Summarise → Email"
              className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-all" />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider block mb-1.5">Description</label>
            <textarea rows={2} maxLength={500} value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="What does this pipeline do?"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm resize-none focus:outline-none focus:border-zinc-400 transition-all" />
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div onClick={() => setIsPublic(v => !v)}
              className={cn("w-9 h-5 rounded-full transition-colors relative flex-shrink-0", isPublic ? "bg-primary" : "bg-zinc-200")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", isPublic ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <span className="text-sm font-medium text-zinc-900">Public pipeline</span>
          </label>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-6">
          <Button variant="outline" onClick={() => { if (!loading) { reset(); onClose() } }} className="flex-1 rounded-xl border-zinc-200" disabled={loading}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !name.trim()} className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create & Edit →"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Pipeline card ─────────────────────────────────────────────────────────────

function PipelineCard({ pipeline, onDelete }: { pipeline: Pipeline; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const nodeCount = pipeline.dag?.nodes?.length ?? 0
  const pattern   = (pipeline.dag as any)?.pattern as PatternType | undefined

  const handleDelete = async () => {
    if (!confirm(`Delete "${pipeline.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Delete failed") }
      toast.success("Pipeline deleted"); onDelete(pipeline.id)
    } catch (err: any) { toast.error(err.message) }
    finally { setDeleting(false) }
  }

  const handleClone = async () => {
    try {
      const res = await fetch("/api/pipelines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ name: `${pipeline.name} (copy)`, description: pipeline.description, is_public: false, dag: pipeline.dag }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Clone failed")
      toast.success("Pipeline cloned!"); window.location.reload()
    } catch (err: any) { toast.error(err.message) }
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-sm transition-all">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
          <Layers className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="font-semibold text-zinc-900 text-sm truncate">{pipeline.name}</h3>
            <StatusPill status={pipeline.status} />
            <PatternBadge pattern={pattern} />
            {pipeline.is_public ? <Globe className="h-3.5 w-3.5 text-zinc-400" /> : <Lock className="h-3.5 w-3.5 text-zinc-400" />}
          </div>
          {pipeline.description && <p className="text-xs text-zinc-500 truncate mb-2">{pipeline.description}</p>}
          <div className="flex items-center gap-4 text-[11px] text-zinc-400 flex-wrap">
            <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> {nodeCount} {nodeCount === 1 ? "agent" : "agents"}</span>
            {pipeline.run_count != null && <span><Play className="h-3 w-3 inline mr-1" />{formatNumber(pipeline.run_count)} runs</span>}
            <span><Clock className="h-3 w-3 inline mr-1" />{pipeline.timeout_seconds}s timeout</span>
            <span className="ml-auto flex-shrink-0">Updated {formatDate(pipeline.updated_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="relative">
            <button onClick={() => setMenuOpen(o => !o)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 bg-white border border-zinc-100 rounded-xl shadow-lg p-1 w-40">
                  <button onClick={() => { setMenuOpen(false); handleClone() }} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 rounded-lg">
                    <Copy className="h-3.5 w-3.5" /> Clone
                  </button>
                  <button onClick={() => { setMenuOpen(false); handleDelete() }} disabled={deleting} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 rounded-lg">
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
          <Link href={`/pipelines/${pipeline.id}`}>
            <button className="flex items-center gap-1 text-xs font-semibold text-primary hover:gap-2 transition-all px-2 py-1.5 rounded-lg hover:bg-primary/8">
              Edit <ArrowRight className="h-3 w-3" />
            </button>
          </Link>
        </div>
      </div>
      {nodeCount > 0 && (
        <div className="flex items-center gap-1.5 mt-4 pt-4 border-t border-zinc-50 overflow-x-auto">
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

// ─── Inner page ────────────────────────────────────────────────────────────────

function PipelinesPageInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const addAgentId   = searchParams.get("add_agent") ?? undefined
  const addAgentName = searchParams.get("agent_name")
    ? decodeURIComponent(searchParams.get("agent_name")!)
    : undefined

  const [pipelines,       setPipelines]       = useState<Pipeline[]>([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState("")
  const [showNew,         setShowNew]         = useState(false)
  const [showComposer,    setShowComposer]    = useState(false)
  const [composerGoal,    setComposerGoal]    = useState("")
  const [composerPattern, setComposerPattern] = useState<PatternType | "">("")
  const [tab,             setTab]             = useState<"mine" | "public" | "templates">("mine")

  useEffect(() => { if (addAgentId) setShowNew(true) }, [addAgentId])

  const load = useCallback(async (visibility: "mine" | "public") => {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (visibility === "public") params.set("public", "true")
      const res  = await fetch(`/api/pipelines?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load pipelines")
      setPipelines(data.data ?? [])
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (tab !== "templates") load(tab as "mine" | "public")
  }, [tab, load])

  const handleCreated = (p: Pipeline) => setPipelines(prev => [p, ...prev])
  const handleDelete  = (id: string)  => setPipelines(prev => prev.filter(p => p.id !== id))

  const openComposerWithTemplate = (template: Template) => {
    setComposerGoal(template.goal)
    setComposerPattern(template.pattern)
    setShowComposer(true)
  }

  return (
    <>
      <NewPipelineModal
        open={showNew}
        onClose={() => { setShowNew(false); if (addAgentId) router.replace("/pipelines", { scroll: false }) }}
        onCreated={handleCreated}
        prefilledAgentId={addAgentId}
        prefilledAgentName={addAgentName}
      />
      <ComposerModal
        open={showComposer}
        onClose={() => { setShowComposer(false); setComposerGoal(""); setComposerPattern("") }}
        onCreated={handleCreated}
        prefillGoal={composerGoal}
        prefillPattern={composerPattern as PatternType | undefined}
      />

      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Pipelines</h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              Chain agents into multi-step workflows. Supports linear, parallel, branch and subagent patterns.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              onClick={() => { setComposerGoal(""); setComposerPattern(""); setShowComposer(true) }}
              className="rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2 shadow-md shadow-primary/20">
              <Sparkles className="h-4 w-4" /> AI Composer
            </Button>
            <Button variant="outline" onClick={() => setShowNew(true)} className="rounded-xl border-zinc-200 gap-1.5">
              <Plus className="h-4 w-4" /> Manual
            </Button>
          </div>
        </div>

        {/* Tab filter */}
        <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1 w-fit">
          {([
            ["mine",      "My Pipelines"],
            ["public",    "Public"],
            ["templates", "Templates ✦"],
          ] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                tab === t ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>
              {label}
            </button>
          ))}
        </div>

        {/* ── TEMPLATES TAB ─────────────────────────────────────────────────── */}
        {tab === "templates" && (
          <div className="space-y-5">
            <div className="bg-gradient-to-r from-primary/[0.06] to-primary/[0.02] border border-primary/20 rounded-2xl px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 mb-0.5">Pre-built workflow templates</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Click <strong>Use</strong> on any template to open the AI Composer with a pre-filled goal.
                    The AI selects the best available agents from the marketplace automatically — no agent IDs to copy, no configuration needed.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {TEMPLATES.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onUse={openComposerWithTemplate}
                />
              ))}
            </div>
            <div className="text-center py-6 border-2 border-dashed border-zinc-100 rounded-2xl">
              <p className="text-sm font-semibold text-zinc-700 mb-1">Have a workflow in mind?</p>
              <p className="text-xs text-zinc-400 mb-4">Describe your goal in plain English and let AI build it for you.</p>
              <Button
                onClick={() => { setComposerGoal(""); setComposerPattern(""); setShowComposer(true) }}
                className="rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2">
                <Sparkles className="h-4 w-4" /> Open AI Composer
              </Button>
            </div>
          </div>
        )}

        {/* ── MINE / PUBLIC TABS ────────────────────────────────────────────── */}
        {tab !== "templates" && (
          <>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
              </div>
            )}

            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-zinc-50 border border-zinc-100 rounded-2xl animate-pulse" />)}
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
                    ? "Start from a template or describe your goal to the AI Composer."
                    : "No public pipelines shared yet."}
                </p>
                {tab === "mine" && (
                  <div className="flex items-center gap-2 justify-center flex-wrap">
                    <Button
                      onClick={() => { setComposerGoal(""); setComposerPattern(""); setShowComposer(true) }}
                      className="rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2">
                      <Sparkles className="h-4 w-4" /> AI Composer
                    </Button>
                    <Button variant="outline" onClick={() => setTab("templates")} className="rounded-xl border-zinc-200 gap-1.5">
                      Browse Templates
                    </Button>
                    <Button variant="outline" onClick={() => setShowNew(true)} className="rounded-xl border-zinc-200 gap-1.5">
                      <Plus className="h-4 w-4" /> Manual
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {pipelines.map(p => <PipelineCard key={p.id} pipeline={p} onDelete={handleDelete} />)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function PipelinesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-32 bg-zinc-100 rounded-xl animate-pulse" />
          <div className="h-4 w-64 bg-zinc-50 rounded-full animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-36 bg-zinc-100 rounded-xl animate-pulse" />
          <div className="h-9 w-24 bg-zinc-50 rounded-xl animate-pulse" />
        </div>
      </div>
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-zinc-50 border border-zinc-100 rounded-2xl animate-pulse" />)}
      </div>
    </div>
  )
}

export default function PipelinesPage() {
  return (
    <Suspense fallback={<PipelinesSkeleton />}>
      <PipelinesPageInner />
    </Suspense>
  )
}
