"use client"

import { useState, useCallback, useRef }               from "react"
import { useRouter }                                    from "next/navigation"
import { useForm }                                      from "react-hook-form"
import { zodResolver }                                  from "@hookform/resolvers/zod"
import { z }                                            from "zod"
import { motion, AnimatePresence }                      from "framer-motion"
import {
  Play, Send, Loader2, Check, X,
  Brain, DollarSign, Search, CheckSquare, Square,
  Plus, Trash2, Info, ChevronDown, ChevronUp,
  Zap, Settings2, Database, Puzzle, Bot,
  FileText, Link2, Upload, BookOpen,
  Globe, Lock, ShieldCheck, AlertTriangle, Eye, EyeOff,
  Home, ChevronRight, Trophy, TrendingUp,
  Clock, Banknote, BarChart3, Star,
} from "lucide-react"
import Link                                             from "next/link"
import { Button }                                       from "@/components/ui/button"
import { Input }                                        from "@/components/ui/input"
import { Label }                                        from "@/components/ui/label"
import { Textarea }                                     from "@/components/ui/textarea"
import { Badge }                                        from "@/components/ui/badge"
import { EditorTabBar, tabVariants, type EditorTabId }  from "./editor-tab-bar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CategoryIcon }                                 from "@/components/ui/category-icon"
import { createClient }                                 from "@/lib/supabase/client"
import { MCP_SERVERS, MCP_CATEGORIES, type MCPCategory } from "@/lib/mcp-servers"
import { MAX_SYSTEM_PROMPT_LENGTH, SUPPORTED_MODELS, MODEL_LABELS } from "@/lib/constants"
import { categoryLabel, cn }                            from "@/lib/utils"
import toast                                            from "react-hot-toast"

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]
const MODELS = SUPPORTED_MODELS.map(v => ({ value: v, label: MODEL_LABELS[v] ?? v }))

// Market price benchmarks per category ($/call) — shown in Monetization tab
const PRICE_BENCH: Record<string, { low: number; mid: number; high: number }> = {
  coding:           { low: 0.01,  mid: 0.03,  high: 0.10 },
  finance:          { low: 0.02,  mid: 0.05,  high: 0.15 },
  data_analysis:    { low: 0.02,  mid: 0.04,  high: 0.12 },
  customer_support: { low: 0.005, mid: 0.015, high: 0.05 },
  marketing:        { low: 0.01,  mid: 0.025, high: 0.08 },
  legal:            { low: 0.05,  mid: 0.08,  high: 0.25 },
  default:          { low: 0.005, mid: 0.02,  high: 0.10 },
}

function sanitize(s: string) {
  return s.replace(/\x00/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim()
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuardrailsCfg {
  blockPII: boolean; strictMode: boolean; blockHarmful: boolean
  outputScrubPII: boolean; maxInputChars: number
  blockedKeywords: string; requireJsonOutput: boolean; outputSchemaStrict: boolean
}
const DEFAULT_GUARDRAILS: GuardrailsCfg = {
  blockPII: false, strictMode: false, blockHarmful: true, outputScrubPII: true,
  maxInputChars: 8000, blockedKeywords: "", requireJsonOutput: false, outputSchemaStrict: false,
}
type KnowledgeItem = { id: string; type: "text"|"url"; label: string; content: string }

interface EvalResult {
  score: number
  gate:  "reject"|"pending_review"|"fast_track"
  breakdown: Record<string, number>
  stats: { successRate: number; avgLatencyMs: number; avgCostUsd: number; adversarialPassed?: number; adversarialTotal?: number }
  recommendation: string
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const schema = z.object({
  name:                       z.string().min(3).max(60),
  description:                z.string().min(20).max(300),
  long_description:           z.string().max(5000).optional(),
  category:                   z.string().min(1),
  tags:                       z.string().optional(),
  is_public:                  z.boolean().optional(),
  pricing_model:              z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  free_calls_per_month:       z.coerce.number().min(0).optional(),
  system_prompt:              z.string().min(10).max(MAX_SYSTEM_PROMPT_LENGTH),
  model_name:                 z.string().refine(v => (SUPPORTED_MODELS as readonly string[]).includes(v)),
  temperature:                z.coerce.number().min(0).max(2),
  max_tokens:                 z.coerce.number().min(100).max(32000),
  timeout_seconds:            z.coerce.number().min(5).max(300),
  documentation:              z.string().max(20000).optional(),
})
type FormData = z.infer<typeof schema>

// ─── Small helpers ────────────────────────────────────────────────────────────

function statusVariant(s: string) {
  if (s === "active")         return "success"  as const
  if (s === "pending_review") return "warning"  as const
  if (s === "suspended")      return "destructive" as const
  return "secondary" as const
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="font-semibold text-zinc-900 text-sm">{title}</p>
        {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function Divider() { return <div className="border-t border-zinc-100 my-8" /> }

function Toggle({ label, sub, checked, onChange, recommended }: {
  label: string; sub: string; checked: boolean; onChange(v:boolean): void; recommended?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-zinc-50 last:border-0">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-900">{label}</p>
          {recommended && <span className="text-[10px] font-bold bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">recommended</span>}
        </div>
        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{sub}</p>
      </div>
      <button type="button" onClick={() => onChange(!checked)} className="flex-shrink-0 mt-0.5">
        <div className={cn("w-10 h-5 rounded-full relative transition-colors duration-200", checked ? "bg-primary" : "bg-zinc-200")}>
          <motion.span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
            animate={{ x: checked ? 20 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
        </div>
      </button>
    </div>
  )
}

// ─── EvalScorePanel — simplified, anti-gaming (hides formulas / hidden tests)

function EvalScorePanel({ result, onDismiss }: { result: EvalResult; onDismiss(): void }) {
  const isGood   = result.score >= 85
  const isMid    = result.score >= 70 && result.score < 85
  const isBad    = result.score < 70
  const bgBorder = isGood ? "bg-green-50 border-green-200" : isMid ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"
  const scoreClr = isGood ? "text-green-700" : isMid ? "text-amber-700" : "text-red-700"

  // Human-readable dimension labels (NEVER expose raw numbers or formulas)
  function dimLabel(key: string, val: number) {
    if (val >= 80) return { text: "Great ✓",    color: "text-green-700" }
    if (val >= 55) return { text: "Acceptable", color: "text-amber-700" }
    return               { text: "Needs work ✗", color: "text-red-600" }
  }

  // Actionable suggestions derived from breakdown — NOT from scoring formula
  const suggestions: string[] = []
  const b = result.breakdown
  if ((b.latency    ?? 100) < 55) suggestions.push("Reduce max_tokens — lower limit speeds up responses")
  if ((b.correctness?? 100) < 55) suggestions.push("Improve your system prompt with clearer output instructions")
  if ((b.reliability?? 100) < 65) suggestions.push("Add more example inputs in your documentation")
  if ((b.cost       ?? 100) < 55) suggestions.push("Consider a lighter model (Haiku) for simple tasks")
  if (result.stats.successRate < 0.8) suggestions.push("Some inputs produced empty or invalid outputs — add edge-case handling")
  if (result.stats.adversarialTotal && result.stats.adversarialPassed !== result.stats.adversarialTotal)
    suggestions.push("Strengthen your system prompt against unexpected or adversarial inputs")

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className={cn("rounded-2xl border p-5 mb-6", bgBorder)}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {isGood && <Trophy   className="h-5 w-5 text-green-600 flex-shrink-0" />}
          {isMid  && <BarChart3 className="h-5 w-5 text-amber-600 flex-shrink-0" />}
          {isBad  && <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-2xl font-black nums", scoreClr)}>{result.score}</span>
              <span className="text-sm text-zinc-500 font-medium">/ 100 Quality Score</span>
              {isGood && (
                <span className="text-[10px] font-black bg-green-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Trophy className="h-2.5 w-2.5" /> Verified by AgentDyne
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-sm">{result.recommendation}</p>
          </div>
        </div>
        <button onClick={onDismiss} className="text-zinc-400 hover:text-zinc-700 p-1 rounded-lg"><X className="h-4 w-4" /></button>
      </div>

      {/* Simplified dimension labels — NEVER show raw scores or formulas */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {Object.entries(result.breakdown).map(([key, val]) => {
          const { text, color } = dimLabel(key, val as number)
          return (
            <div key={key} className="flex items-center justify-between bg-white/60 rounded-xl px-3 py-2 text-xs">
              <span className="font-medium text-zinc-700 capitalize">{key.replace(/_/g, " ")}</span>
              <span className={cn("font-semibold", color)}>{text}</span>
            </div>
          )
        })}
      </div>

      {/* Actionable improvements — only shown when not perfect */}
      {suggestions.length > 0 && !isGood && (
        <div className="bg-white/70 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" /> How to improve
          </p>
          <ul className="space-y-1">
            {suggestions.map((s, i) => (
              <li key={i} className="text-xs text-zinc-600 flex items-start gap-2">
                <span className="text-primary mt-0.5 flex-shrink-0">•</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  )
}

// ─── GuardrailsSection ────────────────────────────────────────────────────────

function GuardrailsSection({ cfg, onChange }: { cfg: GuardrailsCfg; onChange(c: GuardrailsCfg): void }) {
  const set = (k: keyof GuardrailsCfg, v: any) => onChange({ ...cfg, [k]: v })
  const preset = (p: "standard"|"strict"|"minimal") => {
    if (p === "standard") onChange({ ...DEFAULT_GUARDRAILS })
    if (p === "strict")   onChange({ ...DEFAULT_GUARDRAILS, blockPII: true, strictMode: true, maxInputChars: 4000 })
    if (p === "minimal")  onChange({ ...DEFAULT_GUARDRAILS, outputScrubPII: false })
  }
  const { label: lbl, clr, Icon: RI } = (() => {
    if ((cfg.blockPII || cfg.strictMode) && cfg.blockHarmful)
      return { label: "Maximum",  clr: "text-green-600 bg-green-50 border-green-200",  Icon: ShieldCheck   }
    if (cfg.blockHarmful)
      return { label: "Standard", clr: "text-blue-600 bg-blue-50 border-blue-200",     Icon: ShieldCheck   }
    return   { label: "Low",      clr: "text-amber-600 bg-amber-50 border-amber-200",  Icon: AlertTriangle }
  })()

  return (
    <div className="space-y-5">
      {/* One-click presets */}
      <div className="flex gap-2">
        {([
          { k: "standard" as const, label: "🟢 Standard", sub: "Recommended" },
          { k: "strict"   as const, label: "🔵 Strict",   sub: "Enterprise"  },
          { k: "minimal"  as const, label: "🟠 Minimal",  sub: "Custom"      },
        ]).map(p => (
          <button key={p.k} type="button" onClick={() => preset(p.k)}
            className="flex-1 text-left px-3 py-2.5 rounded-xl border border-zinc-200 hover:border-zinc-400 bg-white transition-all">
            <p className="text-xs font-bold text-zinc-900">{p.label}</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">{p.sub}</p>
          </button>
        ))}
      </div>

      <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold", clr)}>
        <RI className="h-4 w-4 flex-shrink-0" />
        <span>{lbl} security level</span>
      </div>

      {/* Input guardrails */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2"><Eye className="h-3.5 w-3.5" /> Input — Before LLM Call</p>
        <Toggle label="Block Harmful Content"  sub="Reject CBRN, CSAM, malware, credential-theft."                     checked={cfg.blockHarmful}     onChange={v => set("blockHarmful",     v)} recommended />
        <Toggle label="Block PII in Input"     sub="Reject requests containing credit cards, SSNs, API keys."           checked={cfg.blockPII}         onChange={v => set("blockPII",         v)} />
        <Toggle label="Strict Mode"            sub="Block suspicious injection patterns — best for enterprise."          checked={cfg.strictMode}       onChange={v => set("strictMode",       v)} />
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Max Input (chars)</Label>
            <Input type="number" min={100} max={32000} step={500} value={cfg.maxInputChars}
              onChange={e => set("maxInputChars", parseInt(e.target.value) || 8000)} className="h-9 rounded-xl border-zinc-200 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Blocked Keywords</Label>
            <Input value={cfg.blockedKeywords} onChange={e => set("blockedKeywords", e.target.value)}
              placeholder="competitor, lawsuit" className="h-9 rounded-xl border-zinc-200 text-sm" />
          </div>
        </div>
      </div>

      {/* Output guardrails */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2"><EyeOff className="h-3.5 w-3.5" /> Output — After LLM Response</p>
        <Toggle label="Scrub PII from Output"   sub="Auto-redact emails, phones, API keys in responses." checked={cfg.outputScrubPII}     onChange={v => set("outputScrubPII",     v)} recommended />
        <Toggle label="Require JSON Output"      sub="Return 422 if the response is not valid JSON."      checked={cfg.requireJsonOutput}   onChange={v => set("requireJsonOutput",   v)} />
        <Toggle label="Strict Schema Validation" sub="Flag responses not matching declared output schema." checked={cfg.outputSchemaStrict} onChange={v => set("outputSchemaStrict", v)} />
      </div>
    </div>
  )
}

// ─── MCPPicker ────────────────────────────────────────────────────────────────

function MCPPicker({ selected, onChange }: { selected: string[]; onChange(ids: string[]): void }) {
  const [q, setQ]         = useState("")
  const [cat, setCat]     = useState<MCPCategory|"all">("all")
  const [showAll, setAll] = useState(false)
  const filtered = MCP_SERVERS.filter(s =>
    (cat === "all" || s.category === cat) &&
    (!q || s.name.toLowerCase().includes(q.toLowerCase()))
  )
  const visible = showAll ? filtered : filtered.slice(0, 12)
  const toggle  = (id: string) => onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search integrations…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
        </div>
        <Select value={cat} onValueChange={v => setCat(v as any)}>
          <SelectTrigger className="h-9 w-44 rounded-xl border-zinc-200 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="all">All categories</SelectItem>
            {MCP_CATEGORIES.map(c => <SelectItem key={c.id} value={c.id} className="text-sm">{c.icon} {c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(id => {
            const s = MCP_SERVERS.find(x => x.id === id); if (!s) return null
            return (
              <span key={id} className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/8 text-primary border border-primary/20 px-2.5 py-1 rounded-full">
                {s.icon} {s.name}
                <button type="button" onClick={() => toggle(id)}><X className="h-3 w-3 hover:text-red-500" /></button>
              </span>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {visible.map(s => {
          const on = selected.includes(s.id)
          return (
            <button key={s.id} type="button" onClick={() => toggle(s.id)}
              className={cn("flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                on ? "border-primary/30 bg-primary/5" : "border-zinc-100 bg-white hover:border-zinc-200")}>
              <span className="text-lg leading-none mt-0.5 flex-shrink-0">{s.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900 truncate">{s.name}</span>
                  {s.verified && <span className="text-[9px] font-bold bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">✓</span>}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{s.description}</p>
              </div>
              {on ? <CheckSquare className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" /> : <Square className="h-4 w-4 text-zinc-300 flex-shrink-0 mt-0.5" />}
            </button>
          )
        })}
      </div>
      {filtered.length > 12 && (
        <button type="button" onClick={() => setAll(v => !v)}
          className="w-full text-xs text-zinc-400 hover:text-primary py-2 flex items-center justify-center gap-1.5">
          {showAll ? <><ChevronUp className="h-3 w-3" /> Show fewer</> : <><ChevronDown className="h-3 w-3" /> Show {filtered.length - 12} more</>}
        </button>
      )}
      {filtered.length === 0 && <p className="text-center py-8 text-zinc-400 text-sm">No integrations match.</p>}
    </div>
  )
}

// ─── KnowledgeSection ─────────────────────────────────────────────────────────

function KnowledgeSection({ items, onChange }: { items: KnowledgeItem[]; onChange(i: KnowledgeItem[]): void }) {
  const [adding, setAdding] = useState<"text"|"url"|null>(null)
  const [draft,  setDraft]  = useState({ label: "", content: "" })
  const add = () => {
    if (!draft.content.trim()) return
    onChange([...items, { id: crypto.randomUUID(), type: adding!, label: draft.label.trim() || (adding === "url" ? "URL source" : "Text chunk"), content: draft.content.trim() }])
    setAdding(null); setDraft({ label: "", content: "" })
    toast.success("Knowledge source added")
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span><strong>RAG enabled.</strong> Text and URLs are embedded and retrieved at runtime via semantic search.</span>
      </div>
      <div className="flex gap-2">
        {(["text","url"] as const).map(type => (
          <button key={type} type="button" onClick={() => setAdding(type)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:border-primary/30 hover:bg-primary/5 transition-all">
            {type === "text" ? <FileText className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            Add {type === "text" ? "text chunk" : "URL"}
          </button>
        ))}
        <button type="button" disabled className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-zinc-200 text-xs font-semibold text-zinc-300 cursor-not-allowed">
          <Upload className="h-3.5 w-3.5" /> Upload file (soon)
        </button>
      </div>
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900">{adding === "url" ? "Add URL" : "Add text chunk"}</p>
              <button type="button" onClick={() => setAdding(null)}><X className="h-4 w-4 text-zinc-400" /></button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-600">Label (optional)</Label>
              <Input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder={adding === "url" ? "Company docs" : "FAQ answers"} className="h-9 rounded-xl border-zinc-200 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-600">{adding === "url" ? "URL" : "Content"} *</Label>
              {adding === "url"
                ? <Input value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))} placeholder="https://docs.example.com" className="h-9 rounded-xl border-zinc-200 text-sm" />
                : <Textarea value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))} rows={5} className="rounded-xl border-zinc-200 text-sm resize-none font-mono text-xs" />}
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={add} disabled={!draft.content.trim()} className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 h-9 text-sm font-semibold"><Plus className="h-3.5 w-3.5 mr-1.5" /> Add</Button>
              <Button type="button" variant="outline" onClick={() => setAdding(null)} className="rounded-xl border-zinc-200 h-9 text-sm">Cancel</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-start gap-3 bg-white border border-zinc-100 rounded-xl p-3">
              <div className="w-7 h-7 rounded-lg bg-zinc-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                {item.type === "url" ? <Globe className="h-3.5 w-3.5 text-zinc-400" /> : <BookOpen className="h-3.5 w-3.5 text-zinc-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 truncate">{item.label}</p>
                <p className="text-xs text-zinc-400 truncate mt-0.5">{item.content.slice(0, 80)}{item.content.length > 80 ? "…" : ""}</p>
              </div>
              <button type="button" onClick={() => onChange(items.filter(i => i.id !== item.id))} className="text-zinc-400 hover:text-red-500 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 border-2 border-dashed border-zinc-100 rounded-xl">
          <Database className="h-6 w-6 text-zinc-300 mx-auto mb-2" />
          <p className="text-sm text-zinc-400">No knowledge sources yet.</p>
        </div>
      )}
    </div>
  )
}

// ─── BuilderEditorClient — main export ───────────────────────────────────────

export function BuilderEditorClient({ agent, defaultTab = "overview" }: { agent: any; defaultTab?: string }) {
  const supabase = createClient()

  // State
  const [saving,      setSaving]      = useState(false)
  const [saveState,   setSaveState]   = useState<"idle"|"saving"|"saved">("idle")
  const [submitting,  setSubmitting]  = useState(false)
  const [activeTab,   setActiveTab]   = useState<EditorTabId>(
    defaultTab === "rag" ? "behavior" : (defaultTab as EditorTabId) || "overview"
  )
  const [mcpSelected,   setMcpSelected]   = useState<string[]>(() => Array.isArray(agent.mcp_server_ids) ? agent.mcp_server_ids : [])
  const [knowledgeItems, setKnowledge]    = useState<KnowledgeItem[]>([])
  const [guardrails,     setGuardrails]   = useState<GuardrailsCfg>(() => {
    const s = agent.security_config ?? agent.guardrails_config
    return s ? { ...DEFAULT_GUARDRAILS, ...s } : DEFAULT_GUARDRAILS
  })
  const [testInput,  setTestInput]  = useState('{"input": "Hello, what can you do?"}')
  const [testOutput, setTestOutput] = useState("")
  const [testing,    setTesting]    = useState(false)
  const [testTrace,  setTestTrace]  = useState<{ latencyMs: number; tokens: { input: number; output: number }; cost: number }|null>(null)
  const [evalResult, setEvalResult] = useState<EvalResult|null>(null)
  const [evalTests,  setEvalTests]  = useState("")

  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  // Form
  const { register, handleSubmit, watch, setValue, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: agent.name, description: agent.description,
      long_description: agent.long_description || "",
      category: agent.category, tags: (agent.tags || []).join(", "),
      is_public: agent.is_public ?? false,
      pricing_model: agent.pricing_model || "free",
      price_per_call: agent.price_per_call || 0,
      subscription_price_monthly: agent.subscription_price_monthly || 0,
      free_calls_per_month: agent.free_calls_per_month || 0,
      system_prompt: agent.system_prompt || "",
      model_name: agent.model_name || "claude-sonnet-4-6",
      temperature: agent.temperature ?? 0.7,
      max_tokens: agent.max_tokens || 4096,
      timeout_seconds: agent.timeout_seconds || 30,
      documentation: agent.documentation || "",
    },
  })

  const pricingModel = watch("pricing_model")
  const category     = watch("category") || "default"
  const systemPrompt = watch("system_prompt") ?? ""
  const isPublic     = watch("is_public")
  const pricePerCall = watch("price_per_call") || 0
  const subPrice     = watch("subscription_price_monthly") || 0
  const bench        = PRICE_BENCH[category] ?? PRICE_BENCH.default

  // Save
  const onSave = async (data: FormData) => {
    setSaving(true); setSaveState("saving")
    try {
      const { error } = await supabase.from("agents").update({
        name:                       sanitize(data.name),
        description:                sanitize(data.description),
        long_description:           data.long_description ? sanitize(data.long_description) : null,
        category:                   data.category,
        tags:                       (data.tags || "").split(",").map(t => sanitize(t)).filter(Boolean).slice(0, 30),
        is_public:                  data.is_public ?? false,
        pricing_model:              data.pricing_model,
        price_per_call:             data.price_per_call ?? 0,
        subscription_price_monthly: data.subscription_price_monthly ?? 0,
        free_calls_per_month:       data.free_calls_per_month ?? 0,
        system_prompt:              sanitize(data.system_prompt),
        model_name:                 data.model_name,
        temperature:                data.temperature,
        max_tokens:                 data.max_tokens,
        timeout_seconds:            data.timeout_seconds,
        documentation:              data.documentation ? sanitize(data.documentation) : null,
        mcp_server_ids:             mcpSelected,
        security_config:            guardrails,
        input_schema:               knowledgeItems.length > 0 ? { knowledgeSources: knowledgeItems } : agent.input_schema || {},
        updated_at:                 new Date().toISOString(),
      }).eq("id", agent.id)
      if (error) throw error
      setSaveState("saved")
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaveState("idle"), 3000)
    } catch (e: any) { toast.error(e.message || "Save failed"); setSaveState("idle") }
    finally { setSaving(false) }
  }

  // Submit for review — eval harness first
  const submitForReview = async () => {
    setSubmitting(true)
    const tid = toast.loading("Running quality evaluation (5–15s)…")
    try {
      const tests = evalTests.split("\n").map(t => t.trim()).filter(Boolean).slice(0, 5).map(input => ({ input }))
      if (tests.length === 0) tests.push({ input: agent.description ?? "Test this agent." })

      const res  = await fetch(`/api/agents/${agent.id}/evaluate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tests }),
      })
      const data = await res.json()
      toast.dismiss(tid)

      if (!res.ok) { toast.error(data.error || "Evaluation failed. Check plan or email verification."); return }

      // Show simplified score — internals always hidden
      setEvalResult({
        score: data.score, gate: data.gate, breakdown: data.breakdown,
        stats: data.stats, recommendation: data.recommendation,
      })

      if (data.gate === "reject") {
        toast.error(`Score ${data.score}/100 — below 70. See improvement tips below.`)
      } else if (data.gate === "fast_track") {
        toast.success(`Score ${data.score}/100 ⚡ Fast-tracked for review!`)
      } else {
        toast.success(`Score ${data.score}/100 — submitted for review (est. 24h).`)
      }
    } catch (e: any) { toast.dismiss(tid); toast.error(e.message || "Submission failed.") }
    finally { setSubmitting(false) }
  }

  // Test runner
  const runTest = useCallback(async () => {
    setTesting(true); setTestOutput(""); setTestTrace(null)
    try {
      let parsed: unknown
      try { parsed = JSON.parse(testInput) } catch { parsed = testInput }
      const res  = await fetch(`/api/agents/${agent.id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: parsed }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setTestOutput(typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2))
      setTestTrace({ latencyMs: data.latencyMs ?? 0, tokens: data.tokens ?? { input: 0, output: 0 }, cost: data.cost ?? 0 })
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (e: any) { toast.error(e.message); setTestOutput(`Error: ${e.message}`) }
    finally { setTesting(false) }
  }, [agent.id, testInput])

  // ── Panels ────────────────────────────────────────────────────────────────
  const panels: Record<EditorTabId, React.ReactNode> = {

    overview: (
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Runs",  value: agent.total_executions?.toLocaleString() || "0", icon: Zap },
            { label: "Avg Rating",  value: agent.average_rating?.toFixed(1) || "—",          icon: Star },
            { label: "Revenue",     value: `$${(agent.total_revenue || 0).toFixed(2)}`,      icon: TrendingUp },
          ].map(s => (
            <div key={s.label} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3.5 flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-white border border-zinc-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <s.icon className="h-3.5 w-3.5 text-zinc-500" />
              </div>
              <div>
                <p className="text-xs text-zinc-400 font-medium">{s.label}</p>
                <p className="text-lg font-bold text-zinc-900 mt-0.5">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Quality score badge */}
        {agent.evaluation_score && (
          <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border",
            agent.evaluation_score >= 85 ? "bg-green-50 border-green-200" : agent.evaluation_score >= 70 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200")}>
            <Trophy className={cn("h-4 w-4", agent.evaluation_score >= 85 ? "text-green-600" : agent.evaluation_score >= 70 ? "text-amber-600" : "text-red-600")} />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-zinc-900">
                Quality Score: <span className={agent.evaluation_score >= 85 ? "text-green-600" : agent.evaluation_score >= 70 ? "text-amber-700" : "text-red-600"}>{Math.round(agent.evaluation_score)}/100</span>
              </span>
              {agent.evaluation_score >= 85 && (
                <span className="text-[10px] font-black bg-green-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Trophy className="h-2.5 w-2.5" /> Verified by AgentDyne
                </span>
              )}
            </div>
          </div>
        )}

        {/* Identity */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <SectionTitle icon={Bot} title="Agent Identity" subtitle="How your agent appears in the marketplace" />
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-zinc-700">Name *</Label>
            <Input {...register("name")} className="rounded-xl border-zinc-200 h-10" />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-zinc-700">Short Description * <span className="text-zinc-400 font-normal">(marketplace cards)</span></Label>
            <Textarea {...register("description")} rows={2} className="rounded-xl border-zinc-200 text-sm resize-none" />
            {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-zinc-700">Long Description <span className="text-zinc-400 font-normal">(detail page)</span></Label>
            <Textarea {...register("long_description")} rows={4} placeholder="Describe features, use cases, example inputs/outputs…" className="rounded-xl border-zinc-200 text-sm resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Category *</Label>
              <Select defaultValue={agent.category} onValueChange={v => setValue("category", v as any)}>
                <SelectTrigger className="rounded-xl border-zinc-200 h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c} className="text-sm">
                      <span className="flex items-center gap-2"><CategoryIcon category={c} colored className="h-3.5 w-3.5 flex-shrink-0" />{categoryLabel(c)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">Tags</Label>
              <Input {...register("tags")} className="rounded-xl border-zinc-200 h-10" placeholder="email, summarize, productivity" />
            </div>
          </div>
        </div>

        {/* Visibility */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <SectionTitle icon={Globe} title="Visibility" />
          <div className="flex gap-3">
            {[{ val: false, icon: Lock, label: "Private", sub: "Only you" }, { val: true, icon: Globe, label: "Public", sub: "On marketplace" }].map(opt => (
              <button key={String(opt.val)} type="button" onClick={() => setValue("is_public", opt.val)}
                className={cn("flex-1 p-3.5 rounded-xl border text-left transition-all",
                  isPublic === opt.val ? "border-zinc-900 bg-zinc-900" : "border-zinc-200 bg-white hover:border-zinc-400")}>
                <div className="flex items-center gap-2 mb-1">
                  <opt.icon className={cn("h-4 w-4", isPublic === opt.val ? "text-white" : "text-zinc-500")} />
                  <span className={cn("font-bold text-sm", isPublic === opt.val ? "text-white" : "text-zinc-900")}>{opt.label}</span>
                </div>
                <p className={cn("text-xs", isPublic === opt.val ? "text-zinc-400" : "text-zinc-500")}>{opt.sub}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Documentation */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <SectionTitle icon={BookOpen} title="Documentation" subtitle="Shown on your agent's detail page" />
          <Textarea {...register("documentation")} rows={8} className="rounded-xl border-zinc-200 font-mono text-xs resize-none"
            placeholder={"Overview\n--------\nThis agent takes… and returns…"} />
        </div>

        {/* Test inputs — only shown before submission */}
        {["draft","rejected"].includes(agent.status) && (
          <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <SectionTitle icon={CheckSquare} title="Test Cases for Review" subtitle="One input per line (max 5). Used when you click Submit for Review." />
            <Textarea value={evalTests} onChange={e => setEvalTests(e.target.value)} rows={5}
              placeholder={"Summarise this article: ...\nTranslate to French: Hello\nWhat are the key points from: ..."}
              className="rounded-xl border-zinc-200 font-mono text-xs resize-none" />
            <p className="text-[11px] text-zinc-400 mt-2 flex items-center gap-1.5">
              <Info className="h-3 w-3" /> We also run our own hidden tests — your agent must pass all of them.
            </p>
          </div>
        )}
      </div>
    ),

    behavior: (
      <div className="space-y-6">
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle icon={Brain} title="Instructions" subtitle="Persona, role, and output format" />
            <span className={cn("text-xs font-mono", systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH * 0.9 ? "text-red-500" : "text-zinc-400")}>
              {systemPrompt.length}/{MAX_SYSTEM_PROMPT_LENGTH}
            </span>
          </div>
          <Textarea {...register("system_prompt")} rows={12}
            className="rounded-xl border-zinc-200 font-mono text-xs resize-none leading-relaxed"
            placeholder="You are an expert at… When given input, you will…" />
          {errors.system_prompt && <p className="text-xs text-red-500 mt-1">{errors.system_prompt.message}</p>}
        </div>

        <Divider />

        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <SectionTitle icon={Zap} title="Model & Parameters" />
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-zinc-700">AI Model</Label>
              <Select defaultValue={agent.model_name} onValueChange={v => setValue("model_name", v)}>
                <SelectTrigger className="rounded-xl border-zinc-200 h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  {MODELS.map(m => <SelectItem key={m.value} value={m.value} className="text-sm">{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Temperature</Label>
                <Input type="number" step="0.1" min="0" max="2" className="rounded-xl border-zinc-200 h-10" {...register("temperature")} />
                {/* Plain English helper — no jargon */}
                <p className="text-[11px] text-zinc-400">0 = precise & deterministic · 2 = creative & varied</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Max Tokens</Label>
                <Input type="number" min="100" max="32000" className="rounded-xl border-zinc-200 h-10" {...register("max_tokens")} />
                <p className="text-[11px] text-zinc-400">Max response length. Lower = faster + cheaper.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Timeout (s)</Label>
                <Input type="number" min="5" max="300" className="rounded-xl border-zinc-200 h-10" {...register("timeout_seconds")} />
                <p className="text-[11px] text-zinc-400">Hard execution cap</p>
              </div>
            </div>
          </div>
        </div>

        <Divider />

        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <SectionTitle icon={Database} title="Knowledge Base (RAG)" subtitle="Embedded and retrieved at runtime via semantic search" />
          <KnowledgeSection items={knowledgeItems} onChange={setKnowledge} />
        </div>

        <Divider />

        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <SectionTitle icon={Puzzle} title="MCP Tools & Integrations" subtitle={`${mcpSelected.length} integration${mcpSelected.length !== 1 ? "s" : ""} connected`} />
          <MCPPicker selected={mcpSelected} onChange={setMcpSelected} />
        </div>
      </div>
    ),

    security: (
      <div className="space-y-6">
        <div className="flex items-start gap-3 bg-zinc-50 border border-zinc-100 rounded-2xl px-5 py-4">
          <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-zinc-900 mb-0.5">Guardrails & Security Policies</p>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Enforced server-side on every API call — callers cannot bypass them. Start with a preset or configure individually.
            </p>
          </div>
        </div>
        <GuardrailsSection cfg={guardrails} onChange={setGuardrails} />
      </div>
    ),

    monetization: (
      <div className="space-y-6">
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <SectionTitle icon={DollarSign} title="Pricing Model" subtitle="Choose how users pay to use your agent" />

          <div className="grid grid-cols-2 gap-3 mb-5">
            {([
              { key: "free",         label: "Free",         sub: "Platform covers inference" },
              { key: "per_call",     label: "Pay per Call", sub: "Charge per execution (80% yours)" },
              { key: "subscription", label: "Subscription", sub: "Monthly recurring (80% yours)" },
              { key: "freemium",     label: "Freemium",     sub: "Free tier + paid above quota" },
            ] as const).map(p => (
              <button key={p.key} type="button" onClick={() => setValue("pricing_model", p.key)}
                className={cn("p-4 rounded-xl border text-left transition-all",
                  pricingModel === p.key ? "border-zinc-900 bg-zinc-900" : "border-zinc-200 bg-white hover:border-zinc-400")}>
                <p className={cn("font-bold text-sm mb-0.5", pricingModel === p.key ? "text-white" : "text-zinc-900")}>{p.label}</p>
                <p className={cn("text-xs", pricingModel === p.key ? "text-zinc-400" : "text-zinc-500")}>{p.sub}</p>
              </button>
            ))}
          </div>

          {(pricingModel === "per_call" || pricingModel === "freemium") && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                  <Input type="number" step="0.0001" min="0" placeholder="0.02" className="rounded-xl border-zinc-200 h-10" {...register("price_per_call")} />
                  <p className="text-xs text-zinc-400">You receive 80%</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-zinc-700">Free calls/month</Label>
                  <Input type="number" min="0" placeholder="10" className="rounded-xl border-zinc-200 h-10" {...register("free_calls_per_month")} />
                </div>
              </div>
              {/* Market pricing guidance — critical missing feature */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-blue-800 mb-1.5 flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5" /> Market pricing for <span className="capitalize ml-1">{categoryLabel(category)}</span> agents
                </p>
                <div className="flex gap-5 text-xs mb-1.5">
                  <span className="text-blue-600">Low: <strong>${bench.low.toFixed(3)}</strong></span>
                  <span className="text-blue-800 font-bold">Median: <strong>${bench.mid.toFixed(3)}</strong></span>
                  <span className="text-blue-600">High: <strong>${bench.high.toFixed(2)}</strong></span>
                </div>
                <p className="text-[11px] text-blue-600">
                  {!pricePerCall && `💡 Suggested: $${bench.mid.toFixed(3)}/call — aligns with similar agents in this category.`}
                  {pricePerCall > 0 && pricePerCall < bench.low && "⚠ Below market — you may be undervaluing your agent."}
                  {pricePerCall > 0 && pricePerCall >= bench.low && pricePerCall <= bench.high && "✓ Competitive range."}
                  {pricePerCall > 0 && pricePerCall > bench.high && "ℹ Above market — justify with a high quality score (>85)."}
                </p>
              </div>
            </div>
          )}

          {pricingModel === "subscription" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                <Input type="number" step="0.01" min="0" placeholder="9.99" className="rounded-xl border-zinc-200 h-10" {...register("subscription_price_monthly")} />
                <p className="text-xs text-zinc-400">You receive 80%</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-zinc-700">Free trial calls/month</Label>
                <Input type="number" min="0" placeholder="10" className="rounded-xl border-zinc-200 h-10" {...register("free_calls_per_month")} />
              </div>
            </div>
          )}
        </div>

        {/* Revenue projections */}
        {pricingModel !== "free" && (
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
            <p className="text-sm font-semibold text-zinc-900 mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-zinc-400" /> Revenue projections (80% share)</p>
            <div className="grid grid-cols-3 gap-3">
              {[100, 1000, 10000].map(mult => {
                const earn = pricingModel === "subscription" ? subPrice * 0.8 : pricePerCall * mult * 0.8
                return (
                  <div key={mult} className="bg-white border border-zinc-100 rounded-xl p-3 text-center">
                    <p className="text-xs text-zinc-400 mb-1">{mult.toLocaleString()} runs/mo</p>
                    <p className="text-base font-bold text-zinc-900 nums">${earn.toFixed(earn < 1 ? 3 : 2)}</p>
                    <p className="text-[10px] text-zinc-400">your share</p>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-zinc-400 mt-3 text-center">Payouts via Stripe Connect monthly.</p>
          </div>
        )}
      </div>
    ),
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen bg-white">

      {/* ── Breadcrumb bar — Notion/Figma style ─────────────────────────── */}
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-zinc-100 px-6 py-2.5 flex items-center justify-between">
        <nav className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Link href="/dashboard" className="hover:text-zinc-700 flex items-center gap-1 transition-colors">
            <Home className="h-3 w-3" /> Dashboard
          </Link>
          <ChevronRight className="h-3 w-3 text-zinc-300" />
          <Link href="/my-agents" className="hover:text-zinc-700 transition-colors">My Agents</Link>
          <ChevronRight className="h-3 w-3 text-zinc-300" />
          <span className="text-zinc-900 font-medium truncate max-w-[180px]">{agent.name}</span>
        </nav>
        <div className="flex items-center gap-3">
          {/* Autosave indicator */}
          <AnimatePresence mode="wait">
            {saveState === "saving" && (
              <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-xs text-zinc-400 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </motion.span>
            )}
            {saveState === "saved" && (
              <motion.span key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-xs text-green-600 font-medium flex items-center gap-1.5">
                <Check className="h-3 w-3" /> Saved
              </motion.span>
            )}
          </AnimatePresence>
          <Link href="/my-agents">
            <Button variant="outline" size="sm" className="rounded-xl border-zinc-200 text-xs h-8 gap-1.5">
              ← Back
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Main editor */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">

            {/* Agent header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold tracking-tight text-zinc-900">{agent.name}</h1>
                  <Badge variant={statusVariant(agent.status)} className="text-[10px]">{agent.status.replace("_", " ")}</Badge>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5 font-mono">ID: {agent.id.slice(0, 8)}…</p>
              </div>
              <div className="flex items-center gap-2">
                {agent.status === "active" && (
                  <Link href={`/marketplace/${agent.id}`} target="_blank">
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-xl border-zinc-200"><Globe className="h-3.5 w-3.5" /> View Live</Button>
                  </Link>
                )}
                {["draft","rejected"].includes(agent.status) && (
                  <Button size="sm" className="gap-1.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700" onClick={submitForReview} disabled={submitting}>
                    {submitting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Evaluating…</> : <><Send className="h-3.5 w-3.5" /> Submit for Review</>}
                  </Button>
                )}
                {agent.status === "pending_review" && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
                    <Clock className="h-3.5 w-3.5" /> Under Review
                  </div>
                )}
              </div>
            </div>

            {/* Rejection banner */}
            {agent.status === "rejected" && (
              <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
                <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Agent rejected</p>
                  <p className="text-xs text-red-600 mt-0.5">{agent.auto_disable_reason || "Review the quality score below and resubmit."}</p>
                </div>
              </div>
            )}

            {/* Eval score panel — simplified, anti-gaming */}
            <AnimatePresence>
              {evalResult && <EvalScorePanel result={evalResult} onDismiss={() => setEvalResult(null)} />}
            </AnimatePresence>

            {/* Form with tabs */}
            <form onSubmit={handleSubmit(onSave)}>
              <EditorTabBar active={activeTab} onChange={setActiveTab} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={activeTab} variants={tabVariants} initial="enter" animate="center" exit="exit" className="mt-6">
                  {panels[activeTab]}
                </motion.div>
              </AnimatePresence>

              {/* Floating save bar */}
              <AnimatePresence>
                {isDirty && (
                  <motion.div
                    initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                    <div className="bg-white/90 backdrop-blur-xl rounded-2xl border border-zinc-200 shadow-xl px-5 py-3 flex items-center gap-4">
                      <p className="text-sm text-zinc-500 font-medium">Unsaved changes</p>
                      <Button type="submit" size="sm" disabled={saving}
                        className="gap-1.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                        {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Check className="h-3.5 w-3.5" /> Save</>}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </div>
        </div>

        {/* Test Playground */}
        <div className="w-80 flex-shrink-0 border-l border-zinc-100 bg-zinc-50 flex flex-col sticky top-[49px] h-[calc(100vh-49px)] overflow-hidden">
          <div className="px-4 py-3.5 border-b border-zinc-100 bg-white">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-primary/8 flex items-center justify-center"><Play className="h-3 w-3 text-primary" /></div>
              <p className="text-sm font-semibold text-zinc-900">Test Playground</p>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {agent.status !== "active" && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                <Info className="h-3.5 w-3.5 flex-shrink-0" /> Must be active to test live.
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Input JSON</label>
              <Textarea value={testInput} onChange={e => setTestInput(e.target.value)} rows={6} className="rounded-xl border-zinc-200 bg-white font-mono text-xs resize-none" />
            </div>
            <Button type="button" onClick={runTest} disabled={testing || agent.status !== "active"}
              className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 disabled:opacity-50">
              {testing ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Play className="h-4 w-4" /> Run</>}
            </Button>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Output</label>
              <div className={cn("min-h-[130px] max-h-[260px] overflow-auto rounded-xl border border-zinc-200 bg-white font-mono text-xs p-3 whitespace-pre-wrap text-zinc-600 leading-relaxed", testing && "animate-pulse")}>
                {testing ? "Running…" : testOutput || <span className="text-zinc-300">Output appears here…</span>}
              </div>
            </div>
            {testTrace && (
              <div className="rounded-xl border border-zinc-100 bg-white px-3 py-2.5 space-y-1">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Trace</p>
                {[["Latency", `${testTrace.latencyMs}ms`], ["Tokens in", String(testTrace.tokens.input)], ["Tokens out", String(testTrace.tokens.output)], ["Est. cost", `$${testTrace.cost.toFixed(6)}`]].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-zinc-400">{k}</span>
                    <span className="font-mono font-semibold text-zinc-700">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-zinc-100 space-y-2">
            <Link href="/docs#execute" target="_blank" className="flex items-center gap-2 text-xs text-zinc-400 hover:text-primary transition-colors">
              <Settings2 className="h-3.5 w-3.5" /> API docs & SDK
            </Link>
            <Link href="/my-agents" className="flex items-center gap-2 text-xs text-zinc-400 hover:text-primary transition-colors">
              <Bot className="h-3.5 w-3.5" /> All my agents
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
