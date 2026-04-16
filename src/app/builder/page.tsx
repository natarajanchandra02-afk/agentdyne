"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Bot, Loader2, ArrowRight, Wand2, Cpu, DollarSign,
  Zap, Activity, Gauge, Info, AlertCircle, Layers, Database,
  GitMerge, CheckCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CategoryIcon } from "@/components/ui/category-icon"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { categoryLabel, cn } from "@/lib/utils"
import { MAX_SYSTEM_PROMPT_LENGTH } from "@/lib/constants"
import toast from "react-hot-toast"
import Link from "next/link"

const CATEGORIES = [
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]

const MODELS = [
  { value: "claude-sonnet-4-20250514",  label: "Claude Sonnet 4",   sub: "Balanced — recommended", badge: "Popular" },
  { value: "claude-opus-4-6",           label: "Claude Opus 4.6",   sub: "Most powerful",          badge: "Best"    },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  sub: "Fastest / lowest cost",  badge: "Fast"    },
  { value: "gpt-4o",                    label: "GPT-4o",            sub: "OpenAI flagship",         badge: null      },
  { value: "gpt-4o-mini",              label: "GPT-4o Mini",       sub: "OpenAI lightweight",      badge: null      },
  { value: "gemini-1.5-pro",           label: "Gemini 1.5 Pro",    sub: "Google flagship",         badge: null      },
]

const schema = z.object({
  name:                       z.string().min(3, "Name must be at least 3 characters").max(60),
  description:                z.string().min(20, "Description must be at least 20 characters").max(300),
  category:                   z.string().min(1, "Please select a category"),
  pricing_model:              z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  system_prompt:              z
    .string()
    .min(20, "System prompt must be at least 20 characters")
    .max(MAX_SYSTEM_PROMPT_LENGTH, `System prompt must be under ${MAX_SYSTEM_PROMPT_LENGTH} characters`)
    .refine(s => !s.includes("\x00"), "System prompt contains invalid characters"),
  model_name:  z.string(),
  temperature: z.coerce.number().min(0).max(2),
  max_tokens:  z.coerce.number().min(100).max(32000),
})
type FormData = z.infer<typeof schema>

const STEP_FIELDS: Record<number, (keyof FormData)[]> = {
  1: ["name", "description", "category"],
  2: ["system_prompt", "model_name", "temperature", "max_tokens"],
  3: ["pricing_model", "price_per_call", "subscription_price_monthly"],
}

const STEPS = [
  { n: 1, label: "Details",   icon: Wand2      },
  { n: 2, label: "AI Config", icon: Cpu        },
  { n: 3, label: "Pricing",   icon: DollarSign },
]

// ── Entry cards shown above the wizard ────────────────────────────────────────
const AGENT_TYPES = [
  {
    href:  null,       // this page = single agent
    icon:  Bot,
    label: "Single Agent",
    desc:  "A focused AI agent that does one thing exceptionally well. Best for most use cases.",
    active: true,
    color: "bg-primary/8 border-primary/20 text-primary",
  },
  {
    href:  "/pipelines",
    icon:  GitMerge,
    label: "Multi-Agent Pipeline",
    desc:  "Chain multiple agents sequentially — output of agent A feeds input of agent B.",
    active: false,
    color: "bg-violet-50 border-violet-200 text-violet-700",
  },
  {
    href:  "/pipelines",      // RAG is configured post-creation in the editor
    icon:  Database,
    label: "RAG Agent",
    desc:  "Attach a knowledge base to your agent so it can answer questions from your documents.",
    active: false,
    color: "bg-blue-50 border-blue-200 text-blue-700",
  },
]

export default function BuilderPage() {
  const router = useRouter()
  const [loading,     setLoading]     = useState(false)
  const [step,        setStep]        = useState(1)
  const [submitError, setSubmitError] = useState<string | null>(null)

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

  const pricingModel = watch("pricing_model")
  const modelName    = watch("model_name")
  const systemPrompt = watch("system_prompt") || ""

  // ── Step-aware "Continue" — validates current step fields before advancing ──
  const advance = async (nextStep: number) => {
    const valid = await trigger(STEP_FIELDS[step] as any)
    if (!valid) {
      const msg = STEP_FIELDS[step].map(f => errors[f]?.message).find(Boolean)
      toast.error(msg || "Please complete all required fields")
      return
    }
    setStep(nextStep)
  }

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setSubmitError(null)
    try {
      const cleanPrompt = data.system_prompt.replace(/\x00/g, "").trim()
      if (cleanPrompt.length < 20) {
        setStep(2)
        toast.error("System prompt is too short")
        return
      }

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
          system_prompt:              cleanPrompt,
          model_name:                 data.model_name,
          temperature:                data.temperature,
          max_tokens:                 data.max_tokens,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        const msg = json.error || "Failed to create agent"
        setSubmitError(msg)
        toast.error(msg)
        return
      }

      // Guard: ensure we have a valid agent id before redirecting
      if (!json?.id) {
        const msg = "Agent created but ID missing — please check My Agents"
        setSubmitError(msg)
        toast.error(msg)
        router.push("/my-agents")
        return
      }

      toast.success("Agent created! Complete your setup below.")
      router.push(`/builder/${json.id}`)
    } catch (err: any) {
      const msg = err?.message || "Something went wrong. Please try again."
      setSubmitError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const onError = (formErrors: typeof errors) => {
    for (const stepNum of [1, 2, 3] as const) {
      const hasError = STEP_FIELDS[stepNum].some(f => formErrors[f])
      if (hasError) {
        setStep(stepNum)
        setTimeout(() => {
          const msg = STEP_FIELDS[stepNum].map(f => formErrors[f]?.message).find(Boolean)
          toast.error(msg || "Please fix the highlighted fields")
        }, 50)
        return
      }
    }
    toast.error("Please complete all required fields")
  }

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-2xl mx-auto px-6 py-8">

          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900">Builder Studio</h1>
              <p className="text-sm text-zinc-500">Create, configure, and publish AI agents</p>
            </div>
          </div>

          {/* Agent type selector — shown above the wizard */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {AGENT_TYPES.map(t => (
              t.href
                ? (
                  <Link key={t.label} href={t.href}>
                    <div className={cn(
                      "rounded-xl border-2 p-3 cursor-pointer transition-all hover:shadow-sm",
                      "border-zinc-100 bg-white text-zinc-400 hover:border-zinc-200"
                    )}>
                      <t.icon className="h-5 w-5 mb-1.5" />
                      <p className="text-xs font-bold text-zinc-700">{t.label}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">{t.desc}</p>
                    </div>
                  </Link>
                )
                : (
                  <div key={t.label} className={cn(
                    "rounded-xl border-2 p-3 transition-all",
                    "border-primary/30 bg-primary/4"
                  )}>
                    <div className="flex items-center gap-1 mb-1">
                      <t.icon className="h-5 w-5 text-primary" />
                      <CheckCircle className="h-3 w-3 text-primary" />
                    </div>
                    <p className="text-xs font-bold text-zinc-900">{t.label}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">{t.desc}</p>
                  </div>
                )
            ))}
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {STEPS.map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => step > s.n && setStep(s.n)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                    step === s.n  ? "bg-zinc-900 text-white" :
                    step >  s.n  ? "bg-green-50 text-green-700 border border-green-100 cursor-pointer hover:bg-green-100" :
                                   "bg-zinc-50 text-zinc-400 border border-zinc-100 cursor-default"
                  )}
                >
                  <s.icon className="h-3 w-3" />
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <div className="h-px w-5 bg-zinc-200" />}
              </div>
            ))}
          </div>

          {/* Submit error */}
          {submitError && (
            <div className="mb-4 flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-5">

            {/* ── STEP 1 — Details ──────────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary" /> Basic Information
                  </h2>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">Agent Name <span className="text-red-500">*</span></Label>
                    <Input
                      placeholder="e.g. Email Summarizer Pro"
                      className={cn("rounded-xl h-10", errors.name ? "border-red-300" : "border-zinc-200")}
                      {...register("name")}
                    />
                    {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">
                      Description <span className="text-red-500">*</span>
                      <span className="text-zinc-400 font-normal ml-1">(shown on marketplace)</span>
                    </Label>
                    <Textarea
                      placeholder="Describe what your agent does, who it's for, and what makes it unique."
                      rows={3}
                      className={cn("rounded-xl resize-none text-sm", errors.description ? "border-red-300" : "border-zinc-200")}
                      {...register("description")}
                    />
                    {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">Category <span className="text-red-500">*</span></Label>
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
                </div>
                <Button type="button" onClick={() => advance(2)}
                  className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                  Continue to AI Config <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}

            {/* ── STEP 2 — AI Config ───────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" /> AI Configuration
                  </h2>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
                    <div className="flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong>How it works:</strong> Your system prompt defines everything your agent does.
                        Users send input, the AI model receives your prompt + their input and generates a response.
                        Be specific. E.g. "You are a JSON formatter. Take raw text and return valid JSON."
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">AI Model <span className="text-red-500">*</span></Label>
                    <div className="grid grid-cols-1 gap-2">
                      {MODELS.map(m => (
                        <button key={m.value} type="button"
                          onClick={() => setValue("model_name", m.value)}
                          className={cn(
                            "flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all",
                            modelName === m.value
                              ? "border-zinc-900 bg-zinc-900"
                              : "border-zinc-200 bg-white hover:border-zinc-400"
                          )}>
                          <div>
                            <span className={cn("text-sm font-semibold", modelName === m.value ? "text-white" : "text-zinc-900")}>{m.label}</span>
                            <span className={cn("text-xs ml-2 text-zinc-400")}>{m.sub}</span>
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
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-zinc-700">System Prompt <span className="text-red-500">*</span></Label>
                      <span className={cn("text-xs", systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH * 0.9 ? "text-red-500" : "text-zinc-400")}>
                        {systemPrompt.length}/{MAX_SYSTEM_PROMPT_LENGTH}
                      </span>
                    </div>
                    <Textarea
                      placeholder={`You are an expert email analyst. When given an email thread:\n1. Summarize key points in 3 bullets\n2. Extract action items with owners\n3. Flag urgent requests\n\nRespond in JSON: { summary, action_items, urgent }`}
                      rows={10}
                      className={cn("rounded-xl font-mono text-xs resize-none leading-relaxed", errors.system_prompt ? "border-red-300" : "border-zinc-200")}
                      {...register("system_prompt")}
                    />
                    {errors.system_prompt
                      ? <p className="text-xs text-red-500">{errors.system_prompt.message}</p>
                      : <p className="text-xs text-zinc-400">Be specific — the more detailed your prompt, the better your agent performs.</p>}
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
                      <p className="text-[11px] text-zinc-400">Max response length</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}
                    className="flex-1 rounded-xl border-zinc-200 h-10">Back</Button>
                  <Button type="button" onClick={() => advance(3)}
                    className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                    Continue to Pricing <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── STEP 3 — Pricing ─────────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" /> Pricing Model
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { key: "free",         label: "Free",         sub: "No cost to users"       },
                      { key: "per_call",     label: "Pay per Call", sub: "Charge per execution"   },
                      { key: "subscription", label: "Subscription", sub: "Monthly recurring fee"  },
                      { key: "freemium",     label: "Freemium",     sub: "Free tier + paid calls" },
                    ] as const).map(p => (
                      <button key={p.key} type="button"
                        onClick={() => setValue("pricing_model", p.key)}
                        className={cn("p-4 rounded-xl border text-left transition-all",
                          pricingModel === p.key ? "border-zinc-900 bg-zinc-900" : "border-zinc-200 bg-white hover:border-zinc-400")}>
                        <div className={cn("font-bold text-sm mb-0.5", pricingModel === p.key ? "text-white" : "text-zinc-900")}>{p.label}</div>
                        <div className={cn("text-xs", pricingModel === p.key ? "text-zinc-400" : "text-zinc-500")}>{p.sub}</div>
                      </button>
                    ))}
                  </div>
                  {(pricingModel === "per_call" || pricingModel === "freemium") && (
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                      <Input type="number" step="0.001" min="0" placeholder="0.010"
                        className="rounded-xl border-zinc-200 h-10" {...register("price_per_call")} />
                      <p className="text-xs text-zinc-400">You earn 80%, AgentDyne keeps 20%</p>
                    </div>
                  )}
                  {pricingModel === "subscription" && (
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                      <Input type="number" step="0.01" min="0" placeholder="9.99"
                        className="rounded-xl border-zinc-200 h-10" {...register("subscription_price_monthly")} />
                      <p className="text-xs text-zinc-400">You earn 80%, AgentDyne keeps 20%</p>
                    </div>
                  )}
                  {/* After-creation hints */}
                  <div className="pt-3 border-t border-zinc-50 space-y-2">
                    <p className="text-xs font-semibold text-zinc-600">After creation, you can also:</p>
                    <div className="flex items-start gap-2 text-xs text-zinc-500">
                      <Database className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <span><strong className="text-zinc-700">Attach a knowledge base</strong> to make this a RAG agent — available in the AI Config tab after creation.</span>
                    </div>
                    <div className="flex items-start gap-2 text-xs text-zinc-500">
                      <Layers className="h-3.5 w-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
                      <span><strong className="text-zinc-700">Add MCP tools</strong> (Slack, GitHub, Supabase, etc.) — in the MCP tab after creation.</span>
                    </div>
                    <div className="flex items-start gap-2 text-xs text-zinc-500">
                      <GitMerge className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span><strong className="text-zinc-700">Chain into a pipeline</strong> — go to <Link href="/pipelines" className="text-primary hover:underline">Pipelines</Link> to build multi-agent workflows.</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(2)}
                    className="flex-1 rounded-xl border-zinc-200 h-10">Back</Button>
                  <Button type="submit" disabled={loading}
                    className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10 disabled:opacity-60">
                    {loading
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating agent…</>
                      : <>Create Agent <ArrowRight className="h-4 w-4 ml-1" /></>}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  )
}
