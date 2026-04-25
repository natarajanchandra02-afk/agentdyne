"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion, AnimatePresence } from "framer-motion"
import {
  Save, Play, Send, ArrowLeft, Loader2, Check, X,
  Brain, DollarSign, LayoutDashboard,
  Search, CheckSquare, Square,
  Plus, Trash2, Info, ChevronDown, ChevronUp,
  Zap, Settings2, Database, Puzzle, Bot,
  FileText, Link2, Upload, BookOpen,
  Globe, Lock, ShieldCheck, AlertTriangle, Eye, EyeOff,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { SlidingTabs }                               from "@/components/ui/sliding-tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { CategoryIcon } from "@/components/ui/category-icon"
import { createClient } from "@/lib/supabase/client"
import { MCP_SERVERS, MCP_CATEGORIES, type MCPCategory } from "@/lib/mcp-servers"
import { MAX_SYSTEM_PROMPT_LENGTH, SUPPORTED_MODELS, MODEL_LABELS } from "@/lib/constants"
import { categoryLabel, cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]

const MODELS = SUPPORTED_MODELS.map(v => ({ value: v, label: MODEL_LABELS[v] ?? v }))

function sanitize(s: string) {
  return s.replace(/\x00/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardrails config type
// ─────────────────────────────────────────────────────────────────────────────

interface GuardrailsConfig {
  blockPII:           boolean
  strictMode:         boolean
  blockHarmful:       boolean
  outputScrubPII:     boolean
  maxInputChars:      number
  allowedTopics:      string   // comma-separated
  blockedKeywords:    string   // comma-separated
  requireJsonOutput:  boolean
  outputSchemaStrict: boolean
}

const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  blockPII:           false,
  strictMode:         false,
  blockHarmful:       true,
  outputScrubPII:     true,
  maxInputChars:      8000,
  allowedTopics:      "",
  blockedKeywords:    "",
  requireJsonOutput:  false,
  outputSchemaStrict: false,
}

// ─────────────────────────────────────────────────────────────────────────────
// Form schema
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  name:                       z.string().min(3, "Min 3 chars").max(60),
  description:                z.string().min(20, "Min 20 chars").max(300),
  long_description:           z.string().max(5000).optional(),
  category:                   z.string().min(1),
  tags:                       z.string().optional(),
  is_public:                  z.boolean().optional(),
  pricing_model:              z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  free_calls_per_month:       z.coerce.number().min(0).optional(),
  system_prompt:              z.string().min(10, "Min 10 chars").max(MAX_SYSTEM_PROMPT_LENGTH),
  model_name:                 z.string().refine(v => (SUPPORTED_MODELS as readonly string[]).includes(v), { message: "Invalid model" }),
  temperature:                z.coerce.number().min(0).max(2),
  max_tokens:                 z.coerce.number().min(100).max(32000),
  timeout_seconds:            z.coerce.number().min(5).max(300),
  documentation:              z.string().max(20000).optional(),
})
type FormData = z.infer<typeof schema>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function statusVariant(status: string): "success" | "warning" | "secondary" | "destructive" {
  if (status === "active")         return "success"
  if (status === "pending_review") return "warning"
  if (status === "suspended")      return "destructive"
  return "secondary"
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

// ─────────────────────────────────────────────────────────────────────────────
// Toggle row helper
// ─────────────────────────────────────────────────────────────────────────────

function ToggleRow({
  label, sublabel, checked, onChange, recommended,
}: { label: string; sublabel: string; checked: boolean; onChange: (v: boolean) => void; recommended?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-zinc-50 last:border-0">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-900">{label}</p>
          {recommended && (
            <span className="text-[10px] font-bold bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">recommended</span>
          )}
        </div>
        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{sublabel}</p>
      </div>
      <button type="button" onClick={() => onChange(!checked)} className="flex-shrink-0 mt-0.5">
        <div className={cn("w-10 h-5 rounded-full relative transition-colors", checked ? "bg-primary" : "bg-zinc-200")}>
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
        </div>
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardrails Section
// ─────────────────────────────────────────────────────────────────────────────

function GuardrailsSection({
  config, onChange,
}: { config: GuardrailsConfig; onChange: (c: GuardrailsConfig) => void }) {
  const set = (key: keyof GuardrailsConfig, value: any) =>
    onChange({ ...config, [key]: value })

  const riskLevel = (): { label: string; color: string; icon: any } => {
    const critical = config.blockHarmful && config.outputScrubPII
    const strict   = config.blockPII || config.strictMode
    if (strict && critical)  return { label: "Maximum",  color: "text-green-600 bg-green-50  border-green-200",  icon: ShieldCheck }
    if (critical)            return { label: "Standard", color: "text-blue-600  bg-blue-50   border-blue-200",   icon: ShieldCheck }
    return                          { label: "Low",      color: "text-amber-600 bg-amber-50  border-amber-200",  icon: AlertTriangle }
  }

  const risk = riskLevel()
  const RiskIcon = risk.icon

  return (
    <div className="space-y-5">
      {/* Risk level indicator */}
      <div className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold", risk.color)}>
        <RiskIcon className="h-4 w-4 flex-shrink-0" />
        <div>
          <span>{risk.label} security level</span>
          <p className="text-xs font-normal opacity-80 mt-0.5">
            {risk.label === "Maximum"  && "All guardrails active — recommended for public marketplace agents"}
            {risk.label === "Standard" && "Core protections active — good for most use cases"}
            {risk.label === "Low"      && "Minimal protection — enable at least Harmful Content and Output Scrubbing"}
          </p>
        </div>
      </div>

      {/* INPUT guardrails */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2 mb-4">
          <Eye className="h-4 w-4 text-zinc-500" />
          <p className="text-sm font-semibold text-zinc-900">Input Guardrails</p>
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider ml-auto">Applied before LLM call</span>
        </div>

        <ToggleRow
          label="Block Harmful Content"
          sublabel="Automatically reject CBRN synthesis, CSAM, malware generation, and credential-theft requests. Always recommended."
          checked={config.blockHarmful}
          onChange={v => set("blockHarmful", v)}
          recommended
        />
        <ToggleRow
          label="Block PII in Input"
          sublabel="Reject requests containing credit cards, SSNs, API keys, or phone numbers. Enable for compliance-sensitive agents."
          checked={config.blockPII}
          onChange={v => set("blockPII", v)}
        />
        <ToggleRow
          label="Strict Mode"
          sublabel="Block input containing any critical PII or suspicious injection patterns, even if not a hard policy violation. Best for enterprise."
          checked={config.strictMode}
          onChange={v => set("strictMode", v)}
        />

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Max Input Length (chars)</Label>
            <Input
              type="number" min={100} max={32000} step={500}
              value={config.maxInputChars}
              onChange={e => set("maxInputChars", parseInt(e.target.value) || 8000)}
              className="h-9 rounded-xl border-zinc-200 text-sm"
            />
            <p className="text-[11px] text-zinc-400">Inputs exceeding this limit are rejected (default 8,000)</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Blocked Keywords</Label>
            <Input
              value={config.blockedKeywords}
              onChange={e => set("blockedKeywords", e.target.value)}
              placeholder="e.g. competitor, lawsuit, confidential"
              className="h-9 rounded-xl border-zinc-200 text-sm"
            />
            <p className="text-[11px] text-zinc-400">Comma-separated. Exact word match (case-insensitive)</p>
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <Label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Allowed Topics (optional — restricts scope)</Label>
          <Input
            value={config.allowedTopics}
            onChange={e => set("allowedTopics", e.target.value)}
            placeholder="e.g. software development, code review, documentation"
            className="h-9 rounded-xl border-zinc-200 text-sm"
          />
          <p className="text-[11px] text-zinc-400">
            Leave blank for unrestricted. When set, off-topic requests are flagged (not blocked, but logged).
          </p>
        </div>
      </div>

      {/* OUTPUT guardrails */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2 mb-4">
          <EyeOff className="h-4 w-4 text-zinc-500" />
          <p className="text-sm font-semibold text-zinc-900">Output Guardrails</p>
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider ml-auto">Applied after LLM response</span>
        </div>

        <ToggleRow
          label="Scrub PII from Output"
          sublabel="Automatically redact emails, phone numbers, API keys, and credit cards from the LLM response before returning to caller. Always recommended."
          checked={config.outputScrubPII}
          onChange={v => set("outputScrubPII", v)}
          recommended
        />
        <ToggleRow
          label="Require JSON Output"
          sublabel="Return 422 if the LLM response is not valid JSON. Use this when downstream systems expect structured data."
          checked={config.requireJsonOutput}
          onChange={v => set("requireJsonOutput", v)}
        />
        <ToggleRow
          label="Strict Schema Validation"
          sublabel="Validate output against your declared Output Schema and flag (not block) responses that don't conform."
          checked={config.outputSchemaStrict}
          onChange={v => set("outputSchemaStrict", v)}
        />
      </div>

      {/* How it works explainer */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4">
        <p className="text-xs font-semibold text-zinc-600 mb-2.5 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" /> How guardrails work
        </p>
        <div className="space-y-2 text-xs text-zinc-500 leading-relaxed">
          <p>Guardrail settings are stored on the agent and enforced server-side on <strong>every API call</strong> — they cannot be bypassed by callers.</p>
          <p>The execution pipeline: <code className="font-mono bg-zinc-100 px-1 rounded">Input → Injection Filter → Guardrails → LLM → Output Scrubber → Caller</code></p>
          <p>All blocked/flagged events are logged to the Security tab in Admin Panel for audit review.</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Tool Picker
// ─────────────────────────────────────────────────────────────────────────────

function MCPPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [q,         setQ]   = useState("")
  const [catFilter, setCat] = useState<MCPCategory | "all">("all")
  const [showAll,   setShowAll] = useState(false)

  const filtered = MCP_SERVERS.filter(s => {
    const matchCat = catFilter === "all" || s.category === catFilter
    const matchQ   = !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.tags.some(t => t.includes(q.toLowerCase()))
    return matchCat && matchQ
  })

  const visible = showAll ? filtered : filtered.slice(0, 12)
  const toggle  = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id])

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <Input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search integrations…"
            className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
        </div>
        <Select value={catFilter} onValueChange={v => setCat(v as any)}>
          <SelectTrigger className="h-9 w-44 rounded-xl border-zinc-200 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="all">All categories</SelectItem>
            {MCP_CATEGORIES.map(c => (
              <SelectItem key={c.id} value={c.id} className="text-sm">{c.icon} {c.label} ({c.count})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(id => {
            const srv = MCP_SERVERS.find(s => s.id === id)
            if (!srv) return null
            return (
              <span key={id}
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/8 text-primary border border-primary/20 px-2.5 py-1 rounded-full">
                {srv.icon} {srv.name}
                <button type="button" onClick={() => toggle(id)} className="hover:text-red-500 transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {visible.map(srv => {
          const on = selected.includes(srv.id)
          return (
            <button key={srv.id} type="button" onClick={() => toggle(srv.id)}
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                on ? "border-primary/30 bg-primary/5" : "border-zinc-100 bg-white hover:border-zinc-200 hover:bg-zinc-50"
              )}>
              <span className="text-lg leading-none mt-0.5 flex-shrink-0">{srv.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900 truncate">{srv.name}</span>
                  {srv.verified && <span className="text-[9px] font-bold bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full flex-shrink-0">✓</span>}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{srv.description}</p>
              </div>
              {on ? <CheckSquare className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" /> : <Square className="h-4 w-4 text-zinc-300 flex-shrink-0 mt-0.5" />}
            </button>
          )
        })}
      </div>

      {filtered.length > 12 && (
        <button type="button" onClick={() => setShowAll(v => !v)}
          className="w-full text-xs text-zinc-400 hover:text-primary transition-colors py-2 flex items-center justify-center gap-1.5">
          {showAll ? <><ChevronUp className="h-3 w-3" /> Show fewer</> : <><ChevronDown className="h-3 w-3" /> Show {filtered.length - 12} more</>}
        </button>
      )}
      {filtered.length === 0 && <div className="text-center py-8 text-zinc-400 text-sm">No integrations match.</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge (RAG) section
// ─────────────────────────────────────────────────────────────────────────────

type KnowledgeItem = { id: string; type: "text" | "url"; label: string; content: string }

function KnowledgeSection({ items, onChange }: { items: KnowledgeItem[]; onChange: (items: KnowledgeItem[]) => void }) {
  const [adding, setAdding] = useState<"text" | "url" | null>(null)
  const [draft,  setDraft]  = useState({ label: "", content: "" })

  const add = () => {
    if (!draft.content.trim()) return
    const item: KnowledgeItem = {
      id:      Math.random().toString(36).slice(2),
      type:    adding!,
      label:   draft.label.trim() || (adding === "url" ? "URL source" : "Text chunk"),
      content: draft.content.trim(),
    }
    onChange([...items, item])
    setAdding(null)
    setDraft({ label: "", content: "" })
    toast.success("Knowledge source added")
  }

  const remove = (id: string) => onChange(items.filter(i => i.id !== id))

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
        <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>
          <strong>RAG is enabled.</strong> Add text chunks or URLs — they are embedded and injected into the agent's context at runtime via semantic search.
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setAdding("text")}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:border-primary/30 hover:bg-primary/5 transition-all">
          <FileText className="h-3.5 w-3.5" /> Add text chunk
        </button>
        <button type="button" onClick={() => setAdding("url")}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:border-primary/30 hover:bg-primary/5 transition-all">
          <Link2 className="h-3.5 w-3.5" /> Add URL
        </button>
        <button type="button" disabled
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-zinc-200 text-xs font-semibold text-zinc-300 cursor-not-allowed">
          <Upload className="h-3.5 w-3.5" /> Upload file (soon)
        </button>
      </div>
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900">{adding === "url" ? "Add URL source" : "Add text chunk"}</p>
              <button type="button" onClick={() => setAdding(null)} className="text-zinc-400 hover:text-zinc-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-600">Label (optional)</Label>
              <Input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                placeholder={adding === "url" ? "Company docs" : "FAQ answers"}
                className="h-9 rounded-xl border-zinc-200 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-600">{adding === "url" ? "URL" : "Content"} *</Label>
              {adding === "url"
                ? <Input value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
                    placeholder="https://docs.example.com/page" className="h-9 rounded-xl border-zinc-200 text-sm" />
                : <Textarea value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
                    rows={5} placeholder="Paste your knowledge content here…"
                    className="rounded-xl border-zinc-200 text-sm resize-none font-mono text-xs" />}
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={add} disabled={!draft.content.trim()}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 h-9 text-sm font-semibold">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add
              </Button>
              <Button type="button" variant="outline" onClick={() => setAdding(null)}
                className="rounded-xl border-zinc-200 h-9 text-sm">Cancel</Button>
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
              <button type="button" onClick={() => remove(item.id)} className="text-zinc-400 hover:text-red-500 transition-colors p-1 flex-shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 border-2 border-dashed border-zinc-100 rounded-xl">
          <Database className="h-6 w-6 text-zinc-300 mx-auto mb-2" />
          <p className="text-sm text-zinc-400">No knowledge sources yet.</p>
          <p className="text-xs text-zinc-300 mt-1">Add text or URLs to give your agent factual grounding.</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function BuilderEditorClient({ agent, defaultTab = "overview" }: { agent: any; defaultTab?: string }) {
  const router   = useRouter()
  const supabase = createClient()

  const [saving,       setSaving]       = useState(false)
  const [submitting,   setSubmitting]   = useState(false)
  const [mcpSelected,  setMcpSelected]  = useState<string[]>(() =>
    Array.isArray(agent.mcp_server_ids) ? agent.mcp_server_ids : []
  )
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([])
  const [guardrails, setGuardrails] = useState<GuardrailsConfig>(() => {
    // Load existing guardrail config from agent.security_config if present
    const saved = agent.security_config ?? agent.guardrails_config
    return saved ? { ...DEFAULT_GUARDRAILS, ...saved } : DEFAULT_GUARDRAILS
  })
  const [testInput,  setTestInput]  = useState('{"input": "Hello, what can you do?"}')
  const [testOutput, setTestOutput] = useState("")
  const [testing,    setTesting]    = useState(false)
  const [testTrace,  setTestTrace]  = useState<{ latencyMs: number; tokens: { input: number; output: number }; cost: number } | null>(null)

  const {
    register, handleSubmit, watch, setValue,
    formState: { errors, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:                       agent.name,
      description:                agent.description,
      long_description:           agent.long_description   || "",
      category:                   agent.category,
      tags:                       (agent.tags || []).join(", "),
      is_public:                  agent.is_public ?? false,
      pricing_model:              agent.pricing_model      || "free",
      price_per_call:             agent.price_per_call     || 0,
      subscription_price_monthly: agent.subscription_price_monthly || 0,
      free_calls_per_month:       agent.free_calls_per_month || 0,
      system_prompt:              agent.system_prompt      || "",
      model_name:                 agent.model_name         || "claude-sonnet-4-20250514",
      temperature:                agent.temperature        ?? 0.7,
      max_tokens:                 agent.max_tokens         || 4096,
      timeout_seconds:            agent.timeout_seconds    || 30,
      documentation:              agent.documentation      || "",
    },
  })

  const pricingModel = watch("pricing_model")
  const systemPrompt = watch("system_prompt") ?? ""
  const isPublic     = watch("is_public")

  // ── Save ─────────────────────────────────────────────────────────────────
  const onSave = async (data: FormData) => {
    setSaving(true)
    try {
      const tagsArray = (data.tags || "")
        .split(",").map(t => sanitize(t)).filter(Boolean).slice(0, 30)

      const { error } = await supabase.from("agents").update({
        name:                        sanitize(data.name),
        description:                 sanitize(data.description),
        long_description:            data.long_description ? sanitize(data.long_description) : null,
        category:                    data.category,
        tags:                        tagsArray,
        is_public:                   data.is_public ?? false,
        pricing_model:               data.pricing_model,
        price_per_call:              data.price_per_call ?? 0,
        subscription_price_monthly:  data.subscription_price_monthly ?? 0,
        free_calls_per_month:        data.free_calls_per_month ?? 0,
        system_prompt:               sanitize(data.system_prompt),
        model_name:                  data.model_name,
        temperature:                 data.temperature,
        max_tokens:                  data.max_tokens,
        timeout_seconds:             data.timeout_seconds,
        documentation:               data.documentation ? sanitize(data.documentation) : null,
        mcp_server_ids:              mcpSelected,
        // Guardrails stored as JSONB in security_config column
        security_config:             guardrails,
        input_schema:                knowledgeItems.length > 0
          ? { knowledgeSources: knowledgeItems }
          : agent.input_schema || {},
        updated_at:                  new Date().toISOString(),
      }).eq("id", agent.id)

      if (error) throw error
      toast.success("Saved!")
    } catch (e: any) {
      toast.error(e.message || "Save failed")
    } finally {
      setSaving(false)
    }
  }

  // ── Submit for review ─────────────────────────────────────────────────────
  const submitForReview = async () => {
    setSubmitting(true)
    try {
      const { error } = await supabase.from("agents")
        .update({ status: "pending_review" }).eq("id", agent.id)
      if (error) throw error
      toast.success("Submitted for review! We'll respond within 24 hours.")
      router.push("/my-agents")
    } catch (e: any) {
      toast.error(e.message || "Submission failed")
    } finally {
      setSubmitting(false)
    }
  }

  // ── Test runner ───────────────────────────────────────────────────────────
  const runTest = useCallback(async () => {
    setTesting(true); setTestOutput(""); setTestTrace(null)
    if (testInput.length > 32_768) { toast.error("Input too large — max 32 KB"); setTesting(false); return }
    try {
      let parsedInput: unknown
      try { parsedInput = JSON.parse(testInput) } catch { parsedInput = testInput }
      const res  = await fetch(`/api/agents/${agent.id}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ input: parsedInput }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setTestOutput(typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2))
      setTestTrace({ latencyMs: data.latencyMs ?? 0, tokens: data.tokens ?? { input: 0, output: 0 }, cost: data.cost ?? 0 })
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (e: any) {
      toast.error(e.message); setTestOutput(`Error: ${e.message}`)
    } finally { setTesting(false) }
  }, [agent.id, testInput])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Main scrollable editor ────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">

            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <Link href="/my-agents">
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </Link>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold tracking-tight text-zinc-900">{agent.name}</h1>
                    <Badge variant={statusVariant(agent.status)} className="text-[10px]">
                      {agent.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5 font-mono">ID: {agent.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isDirty && (
                  <Button variant="outline" size="sm" className="gap-1.5 rounded-xl border-zinc-200"
                    onClick={handleSubmit(onSave)} disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {saving ? "Saving…" : "Save"}
                  </Button>
                )}
                {agent.status === "active" && (
                  <Link href={`/marketplace/${agent.id}`} target="_blank">
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-xl border-zinc-200">
                      <Globe className="h-3.5 w-3.5" /> View Live
                    </Button>
                  </Link>
                )}
                {(agent.status === "draft" || agent.status === "rejected") && (
                  <Button size="sm" className="gap-1.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700"
                    onClick={submitForReview} disabled={submitting}>
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {submitting ? "Submitting…" : agent.status === "rejected" ? "Resubmit for Review" : "Submit for Review"}
                  </Button>
                )}
                {agent.status === "pending_review" && (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Under Review
                  </div>
                )}
              </div>
            </div>

            {agent.status === "rejected" && (
              <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
                <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Agent was rejected</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Update your system prompt, description, or settings based on the feedback from your notification, then click Resubmit for Review.
                  </p>
                </div>
              </div>
            )}

            {/* Tabs */}
            <form onSubmit={handleSubmit(onSave)}>
              {/* ── SlidingTabs header ─────────────────────────────────── */}
              {(() => {
                const EDITOR_TABS = [
                  { id: "overview",     label: "Overview",     icon: LayoutDashboard },
                  { id: "behavior",     label: "Behavior",     icon: Brain },
                  { id: "security",     label: "Security",     icon: ShieldCheck },
                  { id: "monetization",label: "Monetization", icon: DollarSign },
                ] as const
                return null
              })()}
              {/* eslint-disable-next-line react-hooks/rules-of-hooks */}
              {(() => {
                const EDITOR_TABS = [
                  { id: "overview",     label: "Overview",     icon: LayoutDashboard },
                  { id: "behavior",     label: "Behavior",     icon: Brain },
                  { id: "security",     label: "Security",     icon: ShieldCheck },
                  { id: "monetization",label: "Monetization", icon: DollarSign },
                ]
                const [activeEditorTab, setActiveEditorTab] = [defaultTab === "rag" ? "behavior" : (defaultTab || "overview"), () => {}]
                return (
                  <>
                    {/* Tab bar — DeepSeek-style sliding pill */}
                    <div className="mb-6">
                      <EditorTabBar defaultTab={defaultTab} />
                    </div>
                  </>
                )
              })()}

                {/* ─── OVERVIEW ──────────────────────────────────── */}
                <TabsContent value="overview" className="space-y-6">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Total Runs",    value: agent.total_executions?.toLocaleString() || "0" },
                      { label: "Avg Rating",    value: agent.average_rating?.toFixed(1) || "—" },
                      { label: "Total Revenue", value: `$${(agent.total_revenue || 0).toFixed(2)}` },
                    ].map(s => (
                      <div key={s.label} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3.5">
                        <p className="text-xs text-zinc-400 font-medium">{s.label}</p>
                        <p className="text-lg font-bold text-zinc-900 nums mt-0.5">{s.value}</p>
                      </div>
                    ))}
                  </div>

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
                      <Label className="text-sm font-medium text-zinc-700">Long Description <span className="text-zinc-400 font-normal">(detail page — optional)</span></Label>
                      <Textarea {...register("long_description")} rows={4}
                        placeholder="Describe features, use cases, example inputs/outputs…"
                        className="rounded-xl border-zinc-200 text-sm resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Category *</Label>
                        <Select defaultValue={agent.category} onValueChange={v => setValue("category", v)}>
                          <SelectTrigger className="rounded-xl border-zinc-200 h-10"><SelectValue /></SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {CATEGORIES.map(c => (
                              <SelectItem key={c} value={c} className="text-sm">
                                <span className="flex items-center gap-2">
                                  <CategoryIcon category={c} colored className="h-3.5 w-3.5 flex-shrink-0" />
                                  {categoryLabel(c)}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Tags</Label>
                        <Input {...register("tags")} className="rounded-xl border-zinc-200 h-10"
                          placeholder="email, summarize, productivity" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <SectionTitle icon={Globe} title="Visibility" subtitle="Control who can discover and use this agent" />
                    <div className="flex gap-3">
                      {[
                        { val: false, icon: Lock,  label: "Private", sub: "Only you can use this agent" },
                        { val: true,  icon: Globe, label: "Public",  sub: "Listed on the marketplace" },
                      ].map(opt => (
                        <button key={String(opt.val)} type="button" onClick={() => setValue("is_public", opt.val)}
                          className={cn("flex-1 p-3 rounded-xl border text-left transition-all",
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

                  <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <SectionTitle icon={BookOpen} title="Documentation" subtitle="Plain text shown on your agent's detail page" />
                    <Textarea {...register("documentation")} rows={8}
                      className="rounded-xl border-zinc-200 font-mono text-xs resize-none"
                      placeholder={"Overview\n--------\nThis agent takes... and returns...\n\nInput format\n------------\n{ input: \"your text\" }"}
                    />
                  </div>
                </TabsContent>

                {/* ─── BEHAVIOR ──────────────────────────────────── */}
                <TabsContent value="behavior" className="space-y-6">
                  <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div className="flex items-center justify-between mb-4">
                      <SectionTitle icon={Brain} title="Instructions" subtitle="Defines your agent's persona, role, and behaviour" />
                      <span className={cn("text-xs font-mono",
                        systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH * 0.9 ? "text-red-500" : "text-zinc-400")}>
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
                    <SectionTitle icon={Zap} title="Model & Parameters" subtitle="Choose the AI model and tune runtime settings" />
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
                          <p className="text-[11px] text-zinc-400">0 = precise · 2 = creative</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Max Tokens</Label>
                          <Input type="number" min="100" max="32000" className="rounded-xl border-zinc-200 h-10" {...register("max_tokens")} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Timeout (s)</Label>
                          <Input type="number" min="5" max="300" className="rounded-xl border-zinc-200 h-10" {...register("timeout_seconds")} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <Divider />

                  <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <SectionTitle icon={Database} title="Knowledge Base (RAG)"
                      subtitle="Ground your agent in custom facts — text chunks and URLs are embedded and retrieved at runtime" />
                    <KnowledgeSection items={knowledgeItems} onChange={setKnowledgeItems} />
                  </div>

                  <Divider />

                  <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <SectionTitle icon={Puzzle} title="MCP Tools & Integrations"
                      subtitle={`${mcpSelected.length} integration${mcpSelected.length !== 1 ? "s" : ""} connected`} />
                    <MCPPicker selected={mcpSelected} onChange={setMcpSelected} />
                  </div>
                </TabsContent>

                {/* ─── SECURITY / GUARDRAILS ─────────────────────────────── */}
                <TabsContent value="security" className="space-y-6">
                  <div className="flex items-start gap-3 bg-zinc-50 border border-zinc-100 rounded-2xl px-5 py-4">
                    <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 mb-0.5">Guardrails &amp; Security Policies</p>
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        These settings are enforced server-side on every API call — callers cannot bypass them.
                        Settings are saved with your agent config and applied at execution time.
                        All violations are logged to the Admin → Security dashboard.
                      </p>
                    </div>
                  </div>
                  <GuardrailsSection config={guardrails} onChange={setGuardrails} />
                </TabsContent>

                {/* ─── MONETIZATION ──────────────────────────────── */}
                <TabsContent value="monetization" className="space-y-6">
                  <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <SectionTitle icon={DollarSign} title="Pricing Model" subtitle="Choose how users pay to use your agent" />
                    <div className="grid grid-cols-2 gap-3 mb-5">
                      {([
                        { key: "free",         label: "Free",         sub: "No cost — platform covers inference" },
                        { key: "per_call",     label: "Pay per Call", sub: "Charge per execution, you earn 80%" },
                        { key: "subscription", label: "Subscription", sub: "Monthly recurring, you earn 80%" },
                        { key: "freemium",     label: "Freemium",     sub: "Free tier + paid calls above quota" },
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
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                          <Input type="number" step="0.0001" min="0" placeholder="0.0100" className="rounded-xl border-zinc-200 h-10" {...register("price_per_call")} />
                          <p className="text-xs text-zinc-400">You receive 80% of this amount</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Free calls/month</Label>
                          <Input type="number" min="0" placeholder="10" className="rounded-xl border-zinc-200 h-10" {...register("free_calls_per_month")} />
                        </div>
                      </div>
                    )}
                    {pricingModel === "subscription" && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                          <Input type="number" step="0.01" min="0" placeholder="9.99" className="rounded-xl border-zinc-200 h-10" {...register("subscription_price_monthly")} />
                          <p className="text-xs text-zinc-400">You receive 80% of this amount</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Free trial calls/month</Label>
                          <Input type="number" min="0" placeholder="10" className="rounded-xl border-zinc-200 h-10" {...register("free_calls_per_month")} />
                        </div>
                      </div>
                    )}
                  </div>
                  {pricingModel !== "free" && (
                    <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
                      <p className="text-sm font-semibold text-zinc-900 mb-1">Revenue estimate</p>
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        At <strong>1,000 runs/month</strong>:{" "}
                        <strong className="text-primary">
                          {pricingModel === "per_call" || pricingModel === "freemium"
                            ? `$${((watch("price_per_call") || 0) * 1000 * 0.8).toFixed(2)}/mo`
                            : pricingModel === "subscription"
                            ? `$${((watch("subscription_price_monthly") || 0) * 0.8).toFixed(2)}/mo per subscriber`
                            : "$0"}
                        </strong>.
                        Payouts via Stripe Connect, monthly.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              {/* Sticky save bar */}
              {isDirty && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                  <div className="bg-white/90 backdrop-blur-xl rounded-2xl border border-zinc-100 shadow-xl px-5 py-3 flex items-center gap-4">
                    <p className="text-sm text-zinc-500">You have unsaved changes</p>
                    <Button type="submit" size="sm" disabled={saving}
                      className="gap-1.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                      {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Check className="h-3.5 w-3.5" /> Save Changes</>}
                    </Button>
                  </div>
                </motion.div>
              )}
            </form>
          </div>
        </div>

        {/* ── Pinned Test Panel ──────────────────────────────────────────── */}
        <div className="w-80 flex-shrink-0 border-l border-zinc-100 bg-zinc-50 flex flex-col sticky top-0 h-screen overflow-hidden">
          <div className="px-4 py-3.5 border-b border-zinc-100 bg-white">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-primary/8 flex items-center justify-center">
                <Play className="h-3 w-3 text-primary" />
              </div>
              <p className="text-sm font-semibold text-zinc-900">Test Playground</p>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {agent.status !== "active" && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                Agent must be active to run. Save and submit for review first.
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Input JSON</label>
              <Textarea value={testInput} onChange={e => setTestInput(e.target.value)}
                rows={6} className="rounded-xl border-zinc-200 bg-white font-mono text-xs resize-none" />
            </div>
            <Button type="button" onClick={runTest} disabled={testing || agent.status !== "active"}
              className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 disabled:opacity-50">
              {testing ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Play className="h-4 w-4" /> Run</>}
            </Button>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Output</label>
              <div className={cn("min-h-[140px] max-h-[280px] overflow-auto rounded-xl border border-zinc-200 bg-white font-mono text-xs p-3 whitespace-pre-wrap text-zinc-600 leading-relaxed",
                testing && "animate-pulse bg-zinc-50")}>
                {testing ? "Running…" : testOutput || <span className="text-zinc-300">Output will appear here…</span>}
              </div>
            </div>
            {testTrace && (
              <div className="rounded-xl border border-zinc-100 bg-white px-3 py-2.5 space-y-1">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Execution trace</p>
                {[
                  { label: "Latency",        value: `${testTrace.latencyMs}ms` },
                  { label: "Tokens in",      value: String(testTrace.tokens.input) },
                  { label: "Tokens out",     value: String(testTrace.tokens.output) },
                  { label: "Estimated cost", value: `$${testTrace.cost.toFixed(6)}` },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-xs">
                    <span className="text-zinc-400">{r.label}</span>
                    <span className="font-mono font-semibold text-zinc-700">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-zinc-100 space-y-2">
            <Link href="/docs#execute" target="_blank"
              className="flex items-center gap-2 text-xs text-zinc-400 hover:text-primary transition-colors">
              <Settings2 className="h-3.5 w-3.5" /> API docs &amp; SDK
            </Link>
            <Link href="/my-agents"
              className="flex items-center gap-2 text-xs text-zinc-400 hover:text-primary transition-colors">
              <Bot className="h-3.5 w-3.5" /> All my agents
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
