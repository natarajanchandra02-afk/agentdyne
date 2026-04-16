"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Bot, Loader2, ArrowRight, Wand2, Cpu, DollarSign,
  Zap, Activity, Gauge, Layers, Database, CheckCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CategoryIcon } from "@/components/ui/category-icon"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { createClient } from "@/lib/supabase/client"
import { slugify, categoryLabel, cn } from "@/lib/utils"
import { SUPPORTED_MODELS, MODEL_LABELS } from "@/lib/constants"
import toast from "react-hot-toast"

// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]

const MODELS = SUPPORTED_MODELS.map(v => ({
  value: v,
  label: MODEL_LABELS[v] ?? v,
  badge: v.includes("opus") ? "Best" : v.includes("sonnet") ? "Popular" : v.includes("haiku") ? "Fast" : null,
  sub: v.includes("opus") ? "Most powerful" :
       v.includes("sonnet") ? "Balanced — recommended" :
       v.includes("haiku") ? "Fastest / lowest cost" :
       v.includes("gpt-4o-mini") ? "OpenAI lightweight" :
       v.includes("gpt-4o") ? "OpenAI flagship" :
       "Google flagship",
}))

// ─────────────────────────────────────────────────────────────────────────────
// Agent types — shown FIRST, before any wizard steps
// ─────────────────────────────────────────────────────────────────────────────

type AgentType = "single" | "rag" | "pipeline"

const AGENT_TYPES: {
  key: AgentType
  icon: any
  title: string
  sub: string
  badge?: string
  badgeColor?: string
}[] = [
  {
    key: "single",
    icon: Bot,
    title: "Single Agent",
    sub: "One AI model with a system prompt. Perfect for most use cases — text processing, Q&A, generation, classification.",
    badge: "Most common",
    badgeColor: "bg-primary/8 text-primary",
  },
  {
    key: "rag",
    icon: Database,
    title: "RAG Agent",
    sub: "Single agent augmented with your documents, URLs, or knowledge base. The agent retrieves relevant context at runtime.",
    badge: "Knowledge-powered",
    badgeColor: "bg-green-50 text-green-700",
  },
  {
    key: "pipeline",
    icon: Layers,
    title: "Multi-Agent Pipeline",
    sub: "Chain multiple agents in sequence. Output from agent N flows automatically into agent N+1. Build complex workflows.",
    badge: "Advanced",
    badgeColor: "bg-amber-50 text-amber-700",
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Form schema
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  name:          z.string().min(3, "Name must be at least 3 characters").max(60),
  description:   z.string().min(20, "Description must be at least 20 characters").max(300),
  category:      z.string().min(1, "Please select a category"),
  pricing_model: z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  system_prompt: z.string().min(20, "System prompt must be at least 20 characters"),
  model_name:    z.string(),
  temperature:   z.coerce.number().min(0).max(2),
  max_tokens:    z.coerce.number().min(100).max(32000),
})
type FormData = z.infer<typeof schema>

const STEP_FIELDS: Record<number, (keyof FormData)[]> = {
  1: ["name", "description", "category"],
  2: ["system_prompt", "model_name", "temperature", "max_tokens"],
  3: ["pricing_model", "price_per_call", "subscription_price_monthly"],
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BuilderPage() {
  const router   = useRouter()
  const supabase = createClient()
  const [loading,   setLoading]   = useState(false)
  const [step,      setStep]      = useState(0)          // 0 = type selector
  const [agentType, setAgentType] = useState<AgentType>("single")

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      pricing_model: "free",
      model_name:    "claude-sonnet-4-20250514",
      temperature:   0.7,
      max_tokens:    4096,
    },
  })

  const pricingModel = watch("pricing_model")
  const modelName    = watch("model_name")

  // ── Submit — creates the agent and redirects to editor ──────────────────
  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const { data: agent, error } = await supabase.from("agents").insert({
        ...data,
        seller_id:  user.id,
        slug:       slugify(data.name) + "-" + Math.random().toString(36).slice(2, 7),
        status:     "draft",
        // Tag rag agents so the editor can pre-open Knowledge section
        tags:       agentType === "rag" ? ["rag"] : [],
      }).select().single()

      if (error) throw error
      toast.success("Agent created!")
      router.push(`/builder/${agent.id}${agentType === "rag" ? "?tab=behavior#knowledge" : ""}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false) }
  }

  const onError = (formErrors: typeof errors) => {
    for (const stepNum of [1, 2, 3] as const) {
      if (STEP_FIELDS[stepNum].some(f => formErrors[f])) {
        setStep(stepNum)
        setTimeout(() => {
          const msg = STEP_FIELDS[stepNum].map(f => formErrors[f]?.message).find(Boolean)
          toast.error(msg || "Please fix the highlighted fields")
        }, 50)
        return
      }
    }
    toast.error("Please check all fields before submitting")
  }

  const WIZARD_STEPS = [
    { n: 1, label: "Details",   icon: Wand2 },
    { n: 2, label: "AI Config", icon: Cpu },
    { n: 3, label: "Pricing",   icon: DollarSign },
  ]

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-2xl mx-auto px-6 py-10">

          {/* Header */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900">Create New Agent</h1>
              <p className="text-sm text-zinc-500">Build and publish your AI microagent</p>
            </div>
          </div>

          {/* ── STEP 0: Agent type selection ──────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 mb-1">What kind of agent are you building?</h2>
                <p className="text-sm text-zinc-400">Choose the right architecture — you can always adjust later in the editor.</p>
              </div>

              <div className="space-y-3">
                {AGENT_TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => setAgentType(t.key)}
                    className={cn(
                      "w-full p-5 rounded-2xl border text-left transition-all flex items-start gap-4",
                      agentType === t.key
                        ? "border-zinc-900 bg-zinc-900 ring-2 ring-zinc-900/10"
                        : "border-zinc-100 bg-white hover:border-zinc-300 hover:shadow-sm"
                    )}
                    style={{ boxShadow: agentType !== t.key ? "0 1px 3px rgba(0,0,0,0.04)" : undefined }}>
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5",
                      agentType === t.key ? "bg-white/10" : "bg-zinc-50 border border-zinc-100")}>
                      <t.icon className={cn("h-5 w-5", agentType === t.key ? "text-white" : "text-zinc-500")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={cn("font-semibold text-sm", agentType === t.key ? "text-white" : "text-zinc-900")}>
                          {t.title}
                        </span>
                        {t.badge && (
                          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                            agentType === t.key ? "bg-white/20 text-white" : t.badgeColor)}>
                            {t.badge}
                          </span>
                        )}
                      </div>
                      <p className={cn("text-xs leading-relaxed",
                        agentType === t.key ? "text-zinc-400" : "text-zinc-500")}>
                        {t.sub}
                      </p>
                    </div>
                    {agentType === t.key && (
                      <CheckCircle className="h-5 w-5 text-white flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                ))}
              </div>

              {/* Pipeline redirect notice */}
              {agentType === "pipeline" ? (
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700 leading-relaxed">
                    <strong>Multi-Agent Pipelines</strong> are built in the Pipeline Studio, not in this wizard.
                    You&apos;ll create individual agents first, then chain them together in a pipeline.
                  </div>
                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={() => setAgentType("single")}
                      className="flex-1 rounded-xl border-zinc-200 h-10">
                      Back to Single Agent
                    </Button>
                    <Button type="button" onClick={() => router.push("/pipelines")}
                      className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                      Go to Pipeline Studio <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" onClick={() => setStep(1)}
                  className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                  Continue to Details <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          )}

          {/* ── WIZARD (steps 1–3) ─────────────────────────────────────────── */}
          {step > 0 && (
            <>
              {/* Agent type chip + step indicator */}
              <div className="flex items-center gap-3 mb-8">
                <button type="button" onClick={() => setStep(0)}
                  className={cn("flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-colors",
                    agentType === "rag"
                      ? "bg-green-50 text-green-700 border border-green-100"
                      : "bg-primary/8 text-primary border border-primary/20")}>
                  {agentType === "rag" ? <Database className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                  {agentType === "rag" ? "RAG Agent" : "Single Agent"}
                </button>

                <div className="flex items-center gap-2">
                  {WIZARD_STEPS.map((s, i) => (
                    <div key={s.n} className="flex items-center gap-2">
                      <button type="button" onClick={() => step > s.n && setStep(s.n)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                          step === s.n  ? "bg-zinc-900 text-white" :
                          step >  s.n  ? "bg-green-50 text-green-700 border border-green-100 cursor-pointer" :
                                         "bg-zinc-50 text-zinc-400 border border-zinc-100 cursor-default"
                        )}>
                        <s.icon className="h-3 w-3" />
                        {s.label}
                      </button>
                      {i < WIZARD_STEPS.length - 1 && <div className="h-px w-4 bg-zinc-100" />}
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-5">

                {/* ── Step 1: Details ──────────────────────────────────── */}
                {step === 1 && (
                  <div className="space-y-4">
                    <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Wand2 className="h-4 w-4 text-primary" />
                        <h2 className="font-semibold text-zinc-900 text-sm">Basic Information</h2>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Agent Name *</Label>
                        <Input placeholder="e.g. Email Summarizer Pro"
                          className={cn("rounded-xl h-10", errors.name ? "border-red-300" : "border-zinc-200")}
                          {...register("name")} />
                        {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">
                          Description * <span className="text-zinc-400 font-normal">(shown on marketplace)</span>
                        </Label>
                        <Textarea rows={3}
                          placeholder="Describe what your agent does, who it's for, and what makes it unique…"
                          className={cn("rounded-xl resize-none text-sm", errors.description ? "border-red-300" : "border-zinc-200")}
                          {...register("description")} />
                        {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Category *</Label>
                        <Select onValueChange={v => setValue("category", v, { shouldValidate: true })}>
                          <SelectTrigger className={cn("rounded-xl h-10", errors.category ? "border-red-300" : "border-zinc-200")}>
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
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
                        {errors.category && <p className="text-xs text-red-500">{errors.category.message}</p>}
                      </div>

                      {agentType === "rag" && (
                        <div className="flex items-start gap-2.5 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5 text-xs text-green-700">
                          <Database className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                          You&apos;ll add knowledge sources (text / URLs) in the editor after creation.
                        </div>
                      )}
                    </div>

                    <Button type="button" onClick={() => setStep(2)}
                      className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                      Continue to AI Config <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* ── Step 2: AI Config ──────────────────────────────────── */}
                {step === 2 && (
                  <div className="space-y-4">
                    <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Cpu className="h-4 w-4 text-primary" />
                        <h2 className="font-semibold text-zinc-900 text-sm">AI Configuration</h2>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">AI Model *</Label>
                        <div className="grid grid-cols-1 gap-2">
                          {MODELS.map(m => (
                            <button key={m.value} type="button" onClick={() => setValue("model_name", m.value)}
                              className={cn(
                                "flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all",
                                modelName === m.value
                                  ? "border-zinc-900 bg-zinc-900"
                                  : "border-zinc-200 bg-white hover:border-zinc-400"
                              )}>
                              <div>
                                <span className={cn("text-sm font-semibold", modelName === m.value ? "text-white" : "text-zinc-900")}>
                                  {m.label.split(" — ")[0]}
                                </span>
                                <span className={cn("text-xs ml-2", modelName === m.value ? "text-zinc-400" : "text-zinc-400")}>
                                  {m.sub}
                                </span>
                              </div>
                              {m.badge && (
                                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                                  modelName === m.value ? "bg-white/20 text-white" : "bg-primary/8 text-primary")}>
                                  {m.badge}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">System Prompt *</Label>
                        <Textarea rows={8}
                          placeholder={"You are an expert email analyst. When given an email thread:\n1. Summarize key points concisely\n2. Identify action items\n3. Flag urgent requests\n\nReturn JSON: { summary, action_items, urgent }"}
                          className={cn("rounded-xl font-mono text-sm resize-none", errors.system_prompt ? "border-red-300" : "border-zinc-200")}
                          {...register("system_prompt")} />
                        {errors.system_prompt && <p className="text-xs text-red-500">{errors.system_prompt.message}</p>}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700 flex items-center gap-1.5">
                            <Gauge className="h-3.5 w-3.5 text-zinc-400" /> Temperature
                          </Label>
                          <Input type="number" step="0.1" min="0" max="2"
                            className="rounded-xl border-zinc-200 h-10" {...register("temperature")} />
                          <p className="text-[11px] text-zinc-400">0 = precise · 2 = creative</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700 flex items-center gap-1.5">
                            <Activity className="h-3.5 w-3.5 text-zinc-400" /> Max Tokens
                          </Label>
                          <Input type="number" min="100" max="32000"
                            className="rounded-xl border-zinc-200 h-10" {...register("max_tokens")} />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setStep(1)}
                        className="flex-1 rounded-xl border-zinc-200 h-10">Back</Button>
                      <Button type="button" onClick={() => setStep(3)}
                        className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                        Continue to Pricing <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Step 3: Pricing ────────────────────────────────────── */}
                {step === 3 && (
                  <div className="space-y-4">
                    <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <h2 className="font-semibold text-zinc-900 text-sm">Pricing Model</h2>
                      </div>

                      {pricingModel === "free" && (
                        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
                          <strong>Free agents</strong> are covered by AgentDyne&apos;s platform quota.
                          No LLM vendor account needed — inference costs are absorbed by the platform.
                          The agent will be created as a <strong>draft</strong>; submit for review when ready to publish.
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { key: "free",         label: "Free",          sub: "No cost to users" },
                          { key: "per_call",     label: "Pay per Call",  sub: "Charge per execution" },
                          { key: "subscription", label: "Subscription",  sub: "Monthly recurring fee" },
                          { key: "freemium",     label: "Freemium",      sub: "Free tier + paid calls" },
                        ] as const).map(p => (
                          <button key={p.key} type="button" onClick={() => setValue("pricing_model", p.key)}
                            className={cn(
                              "p-4 rounded-xl border text-left transition-all",
                              pricingModel === p.key
                                ? "border-zinc-900 bg-zinc-900"
                                : "border-zinc-200 text-zinc-700 hover:border-zinc-400 bg-white"
                            )}>
                            <div className={cn("font-bold text-sm mb-0.5", pricingModel === p.key ? "text-white" : "text-zinc-900")}>
                              {p.label}
                            </div>
                            <div className={cn("text-xs", pricingModel === p.key ? "text-zinc-400" : "text-zinc-400")}>
                              {p.sub}
                            </div>
                          </button>
                        ))}
                      </div>

                      {(pricingModel === "per_call" || pricingModel === "freemium") && (
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                          <Input type="number" step="0.001" min="0" placeholder="0.010"
                            className="rounded-xl border-zinc-200 h-10" {...register("price_per_call")} />
                          <p className="text-xs text-zinc-400">You earn 80% — AgentDyne keeps 20%</p>
                        </div>
                      )}
                      {pricingModel === "subscription" && (
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                          <Input type="number" step="0.01" min="0" placeholder="9.99"
                            className="rounded-xl border-zinc-200 h-10" {...register("subscription_price_monthly")} />
                          <p className="text-xs text-zinc-400">You earn 80% — AgentDyne keeps 20%</p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setStep(2)}
                        className="flex-1 rounded-xl border-zinc-200 h-10">Back</Button>
                      <Button type="submit" disabled={loading}
                        className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                        {loading
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating…</>
                          : <><Zap className="h-4 w-4 mr-1" /> Create Agent</>}
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
