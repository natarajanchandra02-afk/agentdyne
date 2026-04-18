"use client"

// Force dynamic — builder uses auth hooks and query params
export const dynamic = 'force-dynamic'

import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import Link from "next/link"
import {
  Bot, Loader2, ArrowRight, ArrowLeft, Wand2, Cpu, DollarSign,
  Zap, Activity, Gauge, Layers, Database, CheckCircle,
  GitMerge, ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { CategoryIcon } from "@/components/ui/category-icon"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { categoryLabel, cn } from "@/lib/utils"
import {
  SUPPORTED_MODELS, MODEL_LABELS, MAX_SYSTEM_PROMPT_LENGTH,
} from "@/lib/constants"
import toast from "react-hot-toast"

// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]

const MODELS = SUPPORTED_MODELS.map(v => ({
  value: v,
  label: MODEL_LABELS[v]?.split(" — ")[0] ?? v,
  sub:   MODEL_LABELS[v]?.split(" — ")[1] ?? "",
  badge: v.includes("opus") ? "Best" : v.includes("sonnet") ? "Popular" : v.includes("haiku") ? "Fast" : null,
}))

type AgentType = "single" | "rag" | "pipeline"

const AGENT_TYPES = [
  {
    key:   "single" as AgentType,
    icon:  Bot,
    title: "Single Agent",
    desc:  "One AI model with a system prompt. Best for focused tasks — summarisation, classification, generation, Q&A.",
    badge: "Most common",
    color: "bg-primary/8 text-primary border-primary/20",
  },
  {
    key:   "rag" as AgentType,
    icon:  Database,
    title: "RAG Agent",
    desc:  "Augment with a knowledge base. Retrieves relevant docs at runtime before answering.",
    badge: "Knowledge-powered",
    color: "bg-green-50 text-green-700 border-green-100",
  },
  {
    key:   "pipeline" as AgentType,
    icon:  GitMerge,
    title: "Multi-Agent Pipeline",
    desc:  "Chain agents in sequence. Output of agent A flows automatically into agent B.",
    badge: "Advanced",
    color: "bg-amber-50 text-amber-700 border-amber-100",
  },
]

const schema = z.object({
  name:          z.string().min(3, "Name must be at least 3 characters").max(60),
  description:   z.string().min(20, "Description must be at least 20 characters").max(300),
  category:      z.string().min(1, "Please select a category"),
  pricing_model: z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  system_prompt: z.string()
    .min(20, "System prompt must be at least 20 characters")
    .max(MAX_SYSTEM_PROMPT_LENGTH),
  model_name:  z.string().min(1),
  temperature: z.coerce.number().min(0).max(2),
  max_tokens:  z.coerce.number().min(100).max(32000),
})
type FormData = z.infer<typeof schema>

const STEP_FIELDS: Record<number, (keyof FormData)[]> = {
  1: ["name", "description", "category"],
  2: ["system_prompt", "model_name", "temperature", "max_tokens"],
  3: ["pricing_model", "price_per_call", "subscription_price_monthly"],
}

const WIZARD_STEPS = [
  { n: 1, label: "Details",   icon: Wand2 },
  { n: 2, label: "AI Config", icon: Cpu },
  { n: 3, label: "Pricing",   icon: DollarSign },
]

// ─── Inner component — reads search params (must be inside Suspense) ──────────

function BuilderInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [loading,   setLoading]   = useState(false)
  const [step,      setStep]      = useState(0)
  const [agentType, setAgentType] = useState<AgentType>("single")
  // Track whether Select category has been programmatically set by template
  const [categoryKey, setCategoryKey] = useState(0)

  const {
    register, handleSubmit, watch, setValue, trigger,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      pricing_model: "free",
      model_name:    "claude-sonnet-4-20250514",
      temperature:   0.7,
      max_tokens:    4096,
    },
  })

  // Pre-fill from template query params — runs once on mount
  useEffect(() => {
    const prompt   = searchParams.get("prompt")
    const category = searchParams.get("category")
    if (prompt) {
      setValue("system_prompt", decodeURIComponent(prompt))
      setStep(1) // skip type selector — template implies single agent
    }
    if (category) {
      setValue("category", category, { shouldValidate: false })
      setCategoryKey(k => k + 1) // force Select to re-render with new value
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pricingModel = watch("pricing_model")
  const modelName    = watch("model_name")
  const category     = watch("category")
  const systemPrompt = watch("system_prompt") || ""

  const advance = async (next: number) => {
    if (step > 0) {
      const valid = await trigger(STEP_FIELDS[step] as any)
      if (!valid) {
        const msg = STEP_FIELDS[step].map(f => errors[f]?.message).find(Boolean)
        toast.error(msg || "Please complete all required fields")
        return
      }
    }
    setStep(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const res = await fetch("/api/agents/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:                       data.name.trim(),
          description:                data.description.trim(),
          category:                   data.category,
          pricing_model:              data.pricing_model,
          price_per_call:             data.price_per_call,
          subscription_price_monthly: data.subscription_price_monthly,
          system_prompt:              data.system_prompt.replace(/\x00/g, "").trim(),
          model_name:                 data.model_name,
          temperature:                data.temperature,
          max_tokens:                 data.max_tokens,
        }),
      })
      const json = await res.json()
      if (!res.ok)   { toast.error(json.error || "Failed to create agent"); return }
      if (!json?.id) { toast.error("Missing agent ID"); router.push("/my-agents"); return }
      toast.success("Agent created! Configure it in the editor.")
      router.push(`/builder/${json.id}${agentType === "rag" ? "?defaultTab=rag" : ""}`)
    } catch (err: any) {
      toast.error(err.message || "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const onError = (formErrors: typeof errors) => {
    for (const s of [1, 2, 3] as const) {
      if (STEP_FIELDS[s].some(f => formErrors[f])) {
        setStep(s)
        setTimeout(() => {
          const msg = STEP_FIELDS[s].map(f => formErrors[f]?.message).find(Boolean)
          toast.error(msg || "Please fix highlighted fields")
        }, 50)
        return
      }
    }
  }

  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-zinc-50">
        {/* Breadcrumb */}
        <div className="bg-white border-b border-zinc-100 px-6 py-3 flex items-center gap-2 text-sm text-zinc-400">
          <Link href="/my-agents" className="hover:text-zinc-700 transition-colors">My Agents</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-zinc-700 font-medium">New Agent</span>
        </div>

        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Page heading */}
          <div className="mb-8">
            {step > 0 && (
              <button type="button"
                onClick={() => setStep(s => s === 1 ? 0 : s - 1)}
                className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-900 transition-colors mb-4">
                <ArrowLeft className="h-4 w-4" />
                {step === 1 ? "Change type" : "Back"}
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-zinc-900">
                  {step === 0 ? "Create New Agent" : "Configure Agent"}
                </h1>
                <p className="text-sm text-zinc-400 mt-0.5">
                  {step === 0
                    ? "Choose what kind of agent you want to build"
                    : `${agentType === "rag" ? "RAG Agent" : "Single Agent"} · Step ${step} of 3`}
                </p>
              </div>
            </div>
          </div>

          {/* ── STEP 0: Type selector ──────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3">
                {AGENT_TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => setAgentType(t.key)}
                    className={cn(
                      "w-full p-5 rounded-2xl border-2 text-left transition-all flex items-start gap-4 bg-white",
                      agentType === t.key
                        ? "border-zinc-900 shadow-sm ring-4 ring-zinc-900/[0.06]"
                        : "border-zinc-100 hover:border-zinc-300 hover:shadow-sm"
                    )}>
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5",
                      agentType === t.key ? "bg-zinc-900" : "bg-zinc-50 border border-zinc-100"
                    )}>
                      <t.icon className={cn("h-5 w-5", agentType === t.key ? "text-white" : "text-zinc-500")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-sm text-zinc-900">{t.title}</span>
                        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border",
                          agentType === t.key ? "bg-zinc-100 text-zinc-700 border-zinc-200" : t.color)}>
                          {t.badge}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 leading-relaxed">{t.desc}</p>
                    </div>
                    <div className={cn(
                      "w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center",
                      agentType === t.key ? "border-zinc-900 bg-zinc-900" : "border-zinc-200"
                    )}>
                      {agentType === t.key && <CheckCircle className="h-3.5 w-3.5 text-white" />}
                    </div>
                  </button>
                ))}
              </div>

              {agentType === "pipeline" ? (
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4">
                    <p className="text-sm font-semibold text-amber-900 mb-1">Multi-Agent Pipelines live in Pipeline Studio</p>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      Create individual agents first, then chain them in the Pipeline Studio.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={() => setAgentType("single")}
                      className="flex-1 rounded-xl h-11 font-semibold border-zinc-200">
                      Back to Single Agent
                    </Button>
                    <Button type="button" onClick={() => router.push("/pipelines")}
                      className="flex-1 rounded-xl h-11 bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                      Open Pipeline Studio <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" onClick={() => advance(1)}
                  className="w-full rounded-xl h-11 bg-zinc-900 text-white hover:bg-zinc-700 font-semibold text-sm">
                  Continue with {agentType === "rag" ? "RAG Agent" : "Single Agent"}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}

              <div className="border-t border-zinc-100 pt-6">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4">How it works</p>
                <div className="grid grid-cols-3 gap-4 text-center">
                  {[
                    { icon: Wand2, n: "1", label: "Define",    desc: "Name, category, description" },
                    { icon: Cpu,   n: "2", label: "Configure", desc: "System prompt + AI model" },
                    { icon: Zap,   n: "3", label: "Publish",   desc: "Submit for review & go live" },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="w-8 h-8 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-2 text-xs font-bold text-zinc-400">
                        {s.n}
                      </div>
                      <p className="text-xs font-semibold text-zinc-700">{s.label}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">{s.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── WIZARD STEPS 1–3 ──────────────────────────────────── */}
          {step > 0 && (
            <>
              {/* Step indicator */}
              <div className="flex items-center gap-2 mb-6">
                <span className={cn(
                  "flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border",
                  agentType === "rag"
                    ? "bg-green-50 text-green-700 border-green-100"
                    : "bg-primary/8 text-primary border-primary/20"
                )}>
                  {agentType === "rag" ? <Database className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                  {agentType === "rag" ? "RAG Agent" : "Single Agent"}
                </span>
                <ChevronRight className="h-3 w-3 text-zinc-300" />
                {WIZARD_STEPS.map((s, i) => (
                  <div key={s.n} className="flex items-center gap-2">
                    <button type="button"
                      onClick={() => step > s.n && setStep(s.n)}
                      disabled={step <= s.n}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                        step === s.n ? "bg-zinc-900 text-white" :
                        step >  s.n ? "bg-green-50 text-green-700 border border-green-100 cursor-pointer hover:bg-green-100" :
                                      "bg-zinc-50 text-zinc-400 border border-zinc-100 cursor-default"
                      )}>
                      <s.icon className="h-3 w-3" />
                      {s.label}
                    </button>
                    {i < WIZARD_STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-zinc-200" />}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-5">

                {/* Step 1 */}
                {step === 1 && (
                  <div className="space-y-4">
                    <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      {agentType === "rag" && (
                        <div className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                          <Database className="h-3.5 w-3.5 text-green-600 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-green-700 leading-relaxed">
                            <strong>RAG Agent:</strong> Attach a knowledge base in the editor after creation.
                          </p>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Agent Name <span className="text-red-500">*</span></Label>
                        <Input placeholder="e.g. Support Ticket Classifier"
                          className={cn("rounded-xl h-10 bg-white", errors.name ? "border-red-300" : "border-zinc-200")}
                          {...register("name")} />
                        {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">
                          Description <span className="text-red-500">*</span>
                          <span className="text-zinc-400 font-normal ml-1">(shown on marketplace cards)</span>
                        </Label>
                        <Textarea rows={3}
                          placeholder="Describe what your agent does, who it's for, and what makes it valuable…"
                          className={cn("rounded-xl resize-none text-sm bg-white", errors.description ? "border-red-300" : "border-zinc-200")}
                          {...register("description")} />
                        {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Category <span className="text-red-500">*</span></Label>
                        {/* key forces re-render when template sets category */}
                        <Select key={categoryKey} defaultValue={category || undefined}
                          onValueChange={v => setValue("category", v, { shouldValidate: true })}>
                          <SelectTrigger className={cn("rounded-xl h-10 bg-white", errors.category ? "border-red-300" : "border-zinc-200")}>
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
                    </div>
                    <Button type="button" onClick={() => advance(2)}
                      className="w-full rounded-xl h-11 bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                      Continue to AI Config <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Step 2 */}
                {step === 2 && (
                  <div className="space-y-4">
                    <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-zinc-700">AI Model <span className="text-red-500">*</span></Label>
                        <div className="grid grid-cols-1 gap-2">
                          {MODELS.map(m => (
                            <button key={m.value} type="button"
                              onClick={() => setValue("model_name", m.value)}
                              className={cn(
                                "flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all",
                                modelName === m.value ? "border-zinc-900 bg-zinc-900" : "border-zinc-100 bg-white hover:border-zinc-300"
                              )}>
                              <div>
                                <span className={cn("text-sm font-semibold", modelName === m.value ? "text-white" : "text-zinc-900")}>{m.label}</span>
                                <span className="text-xs ml-2 text-zinc-400">{m.sub}</span>
                              </div>
                              {m.badge && (
                                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                                  modelName === m.value ? "bg-white/15 text-white" : "bg-primary/8 text-primary")}>
                                  {m.badge}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium text-zinc-700">System Prompt <span className="text-red-500">*</span></Label>
                          <span className={cn("text-xs font-mono",
                            systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH * 0.9 ? "text-red-500" : "text-zinc-400")}>
                            {systemPrompt.length}/{MAX_SYSTEM_PROMPT_LENGTH}
                          </span>
                        </div>
                        <Textarea rows={10}
                          placeholder={agentType === "rag"
                            ? "You are a knowledgeable assistant. Use the context provided to answer questions accurately. Always cite the source document when referencing specific facts."
                            : "You are an expert task specialist.\n\n1. Analyse the input carefully\n2. Produce a structured, accurate response\n\nAlways respond in valid JSON."}
                          className={cn("rounded-xl font-mono text-xs resize-none leading-relaxed bg-white",
                            errors.system_prompt ? "border-red-300" : "border-zinc-200")}
                          {...register("system_prompt")} />
                        {errors.system_prompt
                          ? <p className="text-xs text-red-500">{errors.system_prompt.message}</p>
                          : <p className="text-xs text-zinc-400">Define your agent's persona, instructions, and output format.</p>}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700 flex items-center gap-1.5">
                            <Gauge className="h-3.5 w-3.5 text-zinc-400" /> Temperature
                          </Label>
                          <Input type="number" step="0.1" min="0" max="2"
                            className="rounded-xl border-zinc-200 h-10 bg-white" {...register("temperature")} />
                          <p className="text-[11px] text-zinc-400">0 = deterministic · 2 = creative</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700 flex items-center gap-1.5">
                            <Activity className="h-3.5 w-3.5 text-zinc-400" /> Max Tokens
                          </Label>
                          <Input type="number" min="100" max="32000"
                            className="rounded-xl border-zinc-200 h-10 bg-white" {...register("max_tokens")} />
                          <p className="text-[11px] text-zinc-400">Maximum response length</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1 rounded-xl h-11 font-semibold border-zinc-200">Back</Button>
                      <Button type="button" onClick={() => advance(3)} className="flex-1 rounded-xl h-11 bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                        Continue to Pricing <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step 3 */}
                {step === 3 && (
                  <div className="space-y-4">
                    <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { key: "free",         label: "Free",          sub: "No cost to users" },
                          { key: "per_call",     label: "Pay per Call",  sub: "Charge per execution" },
                          { key: "subscription", label: "Subscription",  sub: "Monthly recurring fee" },
                          { key: "freemium",     label: "Freemium",      sub: "Free tier + paid calls" },
                        ] as const).map(p => (
                          <button key={p.key} type="button"
                            onClick={() => setValue("pricing_model", p.key)}
                            className={cn("p-4 rounded-xl border text-left transition-all",
                              pricingModel === p.key ? "border-zinc-900 bg-zinc-900" : "border-zinc-100 bg-white hover:border-zinc-300")}>
                            <div className={cn("font-bold text-sm mb-0.5", pricingModel === p.key ? "text-white" : "text-zinc-900")}>{p.label}</div>
                            <div className={cn("text-xs", pricingModel === p.key ? "text-zinc-400" : "text-zinc-500")}>{p.sub}</div>
                          </button>
                        ))}
                      </div>
                      {pricingModel === "free" && (
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Free agents are publicly accessible. Starts as a <strong className="text-zinc-600">draft</strong> — submit for review when ready.
                        </p>
                      )}
                      {(pricingModel === "per_call" || pricingModel === "freemium") && (
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                          <Input type="number" step="0.001" min="0" placeholder="0.010"
                            className="rounded-xl border-zinc-200 h-10 bg-white" {...register("price_per_call")} />
                          <p className="text-xs text-zinc-400">You earn 80% — AgentDyne takes 20%</p>
                        </div>
                      )}
                      {pricingModel === "subscription" && (
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                          <Input type="number" step="0.01" min="0" placeholder="9.99"
                            className="rounded-xl border-zinc-200 h-10 bg-white" {...register("subscription_price_monthly")} />
                          <p className="text-xs text-zinc-400">You earn 80% — AgentDyne takes 20%</p>
                        </div>
                      )}
                      <div className="pt-3 border-t border-zinc-50 space-y-2">
                        <p className="text-xs font-semibold text-zinc-500">After creation you can also:</p>
                        <div className="grid grid-cols-1 gap-1.5">
                          {[
                            { icon: Database, color: "text-blue-500",   text: "Attach a knowledge base (RAG) in the Knowledge tab" },
                            { icon: Layers,   color: "text-violet-500", text: "Add MCP tools — Slack, GitHub, Supabase, and 40+ more" },
                            { icon: GitMerge, color: "text-green-500",  text: "Chain into a pipeline in Pipeline Studio" },
                          ].map(h => (
                            <div key={h.text} className="flex items-center gap-2 text-xs text-zinc-500">
                              <h.icon className={cn("h-3.5 w-3.5 flex-shrink-0", h.color)} />
                              {h.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setStep(2)} className="flex-1 rounded-xl h-11 font-semibold border-zinc-200">Back</Button>
                      <Button type="submit" disabled={loading} className="flex-1 rounded-xl h-11 bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                        {loading
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating agent…</>
                          : <><Zap className="h-4 w-4 mr-1" />Create Agent</>}
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

// ─── Page export — Suspense wraps BuilderInner so useSearchParams() is valid ──

export default function BuilderPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen bg-white">
        <div className="w-60 border-r border-zinc-100 flex-shrink-0" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </div>
    }>
      <BuilderInner />
    </Suspense>
  )
}
