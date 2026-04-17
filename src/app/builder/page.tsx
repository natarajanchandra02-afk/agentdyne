"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Bot, Loader2, ArrowRight, ArrowLeft, Wand2, Cpu, DollarSign,
  Zap, Activity, Gauge, Info, AlertCircle, Sparkles,
} from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CategoryIcon } from "@/components/ui/category-icon"
import { categoryLabel, cn } from "@/lib/utils"
import { MAX_SYSTEM_PROMPT_LENGTH } from "@/lib/constants"
import toast from "react-hot-toast"

// ─────────────────────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────────────────────

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
  { value: "gpt-4o-mini",               label: "GPT-4o Mini",       sub: "OpenAI lightweight",      badge: null      },
  { value: "gemini-1.5-pro",            label: "Gemini 1.5 Pro",    sub: "Google flagship",         badge: null      },
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
    .max(MAX_SYSTEM_PROMPT_LENGTH)
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
  { n: 1 as const, label: "Details",   icon: Wand2      },
  { n: 2 as const, label: "AI Config", icon: Cpu        },
  { n: 3 as const, label: "Pricing",   icon: DollarSign },
]

// ─────────────────────────────────────────────────────────────────────────────
// Minimal header — keeps the user oriented without the full dashboard sidebar.
// Shows logo + breadcrumb + a back-to-dashboard link so the user is never lost.
// ─────────────────────────────────────────────────────────────────────────────
function BuilderHeader() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 h-14 bg-white/90 backdrop-blur-xl border-b border-zinc-100 shadow-xs flex items-center px-6">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <Image src="/logo.png" alt="AgentDyne" width={120} height={32}
            className="h-7 w-auto object-contain transition-opacity group-hover:opacity-80"
            onError={e => {
              const t = e.target as HTMLImageElement
              t.style.display = "none"
              const fb = t.nextElementSibling as HTMLElement
              if (fb) fb.style.removeProperty("display")
            }}
          />
          <span style={{ display: "none" }} className="font-black text-zinc-900 text-lg">AgentDyne</span>
        </Link>

        {/* Breadcrumb */}
        <div className="hidden sm:flex items-center gap-2 text-sm text-zinc-500">
          <Link href="/my-agents" className="hover:text-zinc-900 transition-colors font-medium">My Agents</Link>
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-900 font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Create New Agent
          </span>
        </div>

        {/* Back link */}
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="rounded-xl text-zinc-500 hover:text-zinc-900 gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Button>
        </Link>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BuilderPage() {
  const router = useRouter()
  const [loading,     setLoading]     = useState(false)
  const [step,        setStep]        = useState(1)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register, handleSubmit, watch, setValue,
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

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setSubmitError(null)
    try {
      const cleanPrompt = data.system_prompt.replace(/\x00/g, "").trim()
      if (cleanPrompt.length < 20) {
        setStep(2)
        toast.error("System prompt is too short — describe what your agent does")
        return
      }

      const res = await fetch("/api/agents/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      if (STEP_FIELDS[stepNum].some(f => formErrors[f])) {
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
    <div className="min-h-screen bg-white">
      <BuilderHeader />

      <div className="pt-14 flex">
        {/* ── Left column: form ─────────────────────────────────────────── */}
        <main className="flex-1 flex items-start justify-center px-4 py-10">
          <div className="w-full max-w-xl">

            {/* Page title */}
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-zinc-900">Create New Agent</h1>
                <p className="text-sm text-zinc-500">Build and publish your AI microagent</p>
              </div>
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
                    )}>
                    <s.icon className="h-3 w-3" /> {s.label}
                  </button>
                  {i < STEPS.length - 1 && <div className="h-px w-5 bg-zinc-200" />}
                </div>
              ))}
            </div>

            {/* Error */}
            {submitError && (
              <div className="mb-4 flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-5">

              {/* ── STEP 1 ────────────────────────────────────────────── */}
              {step === 1 && (
                <div className="space-y-4 animate-fade-up">
                  <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                    style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                      <Wand2 className="h-4 w-4 text-primary" /> Basic Information
                    </h2>

                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">
                        Agent Name <span className="text-red-500">*</span>
                      </Label>
                      <Input placeholder="e.g. Email Summarizer Pro"
                        className={cn("rounded-xl h-10", errors.name ? "border-red-300" : "border-zinc-200")}
                        {...register("name")} />
                      {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">
                        Description <span className="text-red-500">*</span>
                        <span className="text-zinc-400 font-normal ml-1">(shown on marketplace)</span>
                      </Label>
                      <Textarea placeholder="Describe what your agent does, who it's for, and what makes it unique."
                        rows={3}
                        className={cn("rounded-xl resize-none text-sm", errors.description ? "border-red-300" : "border-zinc-200")}
                        {...register("description")} />
                      {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">
                        Category <span className="text-red-500">*</span>
                      </Label>
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

                  <Button type="button" onClick={() => setStep(2)}
                    className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-11">
                    Continue to AI Config <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}

              {/* ── STEP 2 ────────────────────────────────────────────── */}
              {step === 2 && (
                <div className="space-y-4 animate-fade-up">
                  <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                    style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" /> AI Configuration
                    </h2>

                    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
                      <div className="flex items-start gap-2">
                        <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>How it works:</strong> The model receives your system prompt as instructions,
                          plus the user's input. Be specific — describe inputs, outputs, and any constraints.
                          Example: <em>"You are a JSON formatter. Return valid JSON only."</em>
                        </span>
                      </div>
                    </div>

                    {/* Model selection */}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">AI Model *</Label>
                      <div className="space-y-2">
                        {MODELS.map(m => (
                          <button key={m.value} type="button" onClick={() => setValue("model_name", m.value)}
                            className={cn(
                              "flex items-center justify-between w-full px-4 py-3 rounded-xl border text-left transition-all",
                              modelName === m.value ? "border-zinc-900 bg-zinc-900" : "border-zinc-200 bg-white hover:border-zinc-400"
                            )}>
                            <div>
                              <span className={cn("text-sm font-semibold", modelName === m.value ? "text-white" : "text-zinc-900")}>
                                {m.label}
                              </span>
                              <span className={cn("text-xs ml-2 opacity-60", modelName === m.value ? "text-white" : "text-zinc-500")}>
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

                    {/* System prompt */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-zinc-700">
                          System Prompt <span className="text-red-500">*</span>
                        </Label>
                        <span className={cn("text-xs",
                          systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH * 0.9 ? "text-red-500" : "text-zinc-400")}>
                          {systemPrompt.length}/{MAX_SYSTEM_PROMPT_LENGTH}
                        </span>
                      </div>
                      <Textarea
                        placeholder={
                          "You are an expert email analyst. When given an email thread:\n" +
                          "1. Summarize the key points in 3 bullet points\n" +
                          "2. Extract action items with owners and deadlines\n" +
                          "3. Flag any urgent requests\n\n" +
                          "Always respond in valid JSON with keys: summary, action_items, urgent."
                        }
                        rows={10}
                        className={cn("rounded-xl font-mono text-xs resize-none leading-relaxed",
                          errors.system_prompt ? "border-red-300" : "border-zinc-200")}
                        {...register("system_prompt")}
                      />
                      {errors.system_prompt
                        ? <p className="text-xs text-red-500">{errors.system_prompt.message}</p>
                        : <p className="text-xs text-zinc-400">The more specific you are, the better your agent performs.</p>}
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
                      className="flex-1 rounded-xl border-zinc-200 h-11">Back</Button>
                    <Button type="button" onClick={() => setStep(3)}
                      className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-11">
                      Continue to Pricing <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}

              {/* ── STEP 3 ────────────────────────────────────────────── */}
              {step === 3 && (
                <div className="space-y-4 animate-fade-up">
                  <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
                    style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-primary" /> Pricing Model
                    </h2>

                    {pricingModel === "free" && (
                      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
                        <strong>Free agents</strong> are publicly available at no cost. Your agent is saved as a
                        <strong> draft</strong> — review and submit for approval when ready.
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { key: "free",         label: "Free",         sub: "No cost to users" },
                        { key: "per_call",     label: "Pay per Call", sub: "Charge per execution" },
                        { key: "subscription", label: "Subscription", sub: "Monthly recurring fee" },
                        { key: "freemium",     label: "Freemium",     sub: "Free tier + paid calls" },
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
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                        <Input type="number" step="0.001" min="0" placeholder="0.010"
                          className="rounded-xl border-zinc-200 h-10" {...register("price_per_call")} />
                        <p className="text-xs text-zinc-400">AgentDyne keeps 20 %, you earn 80 %</p>
                      </div>
                    )}
                    {pricingModel === "subscription" && (
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                        <Input type="number" step="0.01" min="0" placeholder="9.99"
                          className="rounded-xl border-zinc-200 h-10" {...register("subscription_price_monthly")} />
                        <p className="text-xs text-zinc-400">AgentDyne keeps 20 %, you earn 80 %</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={() => setStep(2)}
                      className="flex-1 rounded-xl border-zinc-200 h-11">Back</Button>
                    <Button type="submit" disabled={loading}
                      className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-11 disabled:opacity-60">
                      {loading
                        ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating agent…</>
                        : <><Zap className="h-4 w-4 mr-2" />Create Agent</>}
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </main>

        {/* ── Right column: explainer panel ─────────────────────────────── */}
        <aside className="hidden lg:flex w-80 flex-shrink-0 flex-col justify-start px-8 pt-10 border-l border-zinc-100 bg-zinc-50/50">
          <div className="sticky top-20 space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4">How agents work</h3>
              <div className="space-y-4">
                {[
                  { n: "01", title: "Define behaviour", desc: "Write a system prompt that tells the AI exactly what to do, what inputs to expect, and what format to return." },
                  { n: "02", title: "Connect tools",    desc: "After creation you can add MCP integrations (GitHub, Notion, Slack…) and a Knowledge Base for RAG-grounded answers." },
                  { n: "03", title: "Test & publish",   desc: "Use the live playground to test your agent, then submit for review to list it on the marketplace." },
                  { n: "04", title: "Earn revenue",     desc: "Set your pricing model and get paid 80 % of every call via Stripe Connect, monthly." },
                ].map(s => (
                  <div key={s.n} className="flex gap-3">
                    <span className="text-xs font-black text-primary/40 mt-0.5 w-5 flex-shrink-0">{s.n}</span>
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">{s.title}</p>
                      <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-zinc-100 rounded-2xl p-4 space-y-3"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <p className="text-xs font-semibold text-zinc-700">Feature checklist</p>
              {[
                "RAG / Knowledge Base",
                "40+ MCP integrations",
                "Multi-provider models",
                "Streaming output",
                "Usage analytics",
                "80 % revenue share",
              ].map(f => (
                <div key={f} className="flex items-center gap-2 text-xs text-zinc-600">
                  <span className="text-green-500 font-bold">✓</span> {f}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
