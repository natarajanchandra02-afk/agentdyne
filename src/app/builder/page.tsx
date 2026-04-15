"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Bot, Loader2, ArrowRight, Wand2, Cpu, DollarSign, Zap, Activity, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CategoryIcon } from "@/components/ui/category-icon"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { createClient } from "@/lib/supabase/client"
import { slugify, categoryLabel, cn } from "@/lib/utils"
import toast from "react-hot-toast"

const CATEGORIES = [
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]

const MODELS = [
  { value: "claude-sonnet-4-20250514",  label: "Claude Sonnet 4",    sub: "Balanced — recommended",  badge: "Popular" },
  { value: "claude-opus-4-6",           label: "Claude Opus 4.6",    sub: "Most powerful",            badge: "Best" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",   sub: "Fastest / lowest cost",   badge: "Fast" },
  { value: "gpt-4o",                    label: "GPT-4o",             sub: "OpenAI flagship",          badge: null },
  { value: "gpt-4o-mini",               label: "GPT-4o Mini",        sub: "OpenAI lightweight",       badge: null },
  { value: "gemini-1.5-pro",            label: "Gemini 1.5 Pro",     sub: "Google flagship",          badge: null },
]

const schema = z.object({
  name:                       z.string().min(3, "Name must be at least 3 characters").max(60),
  description:                z.string().min(20, "Description must be at least 20 characters").max(300),
  category:                   z.string().min(1, "Please select a category"),
  pricing_model:              z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  system_prompt:              z.string().min(20, "System prompt must be at least 20 characters"),
  model_name:                 z.string(),
  temperature:                z.coerce.number().min(0).max(2),
  max_tokens:                 z.coerce.number().min(100).max(32000),
})
type FormData = z.infer<typeof schema>

// Which fields belong to which step — so we can navigate to the right step on error
const STEP_FIELDS: Record<number, (keyof FormData)[]> = {
  1: ["name", "description", "category"],
  2: ["system_prompt", "model_name", "temperature", "max_tokens"],
  3: ["pricing_model", "price_per_call", "subscription_price_monthly"],
}

export default function BuilderPage() {
  const router   = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [step, setStep]       = useState(1)

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

  // Called by react-hook-form when validation PASSES
  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const { data: agent, error } = await supabase.from("agents").insert({
        ...data,
        seller_id: user.id,
        slug:      slugify(data.name) + "-" + Math.random().toString(36).slice(2, 7),
        status:    "draft",
      }).select().single()
      if (error) throw error
      toast.success("Agent created!")
      router.push(`/builder/${agent.id}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setLoading(false) }
  }

  // Called by react-hook-form when validation FAILS — navigate to the step
  // that has the first invalid field so the user can see the errors
  const onError = (formErrors: typeof errors) => {
    for (const stepNum of [1, 2, 3] as const) {
      const hasError = STEP_FIELDS[stepNum].some(field => formErrors[field])
      if (hasError) {
        setStep(stepNum)
        // Short delay so the step re-renders before toast shows
        setTimeout(() => {
          const firstMsg = STEP_FIELDS[stepNum]
            .map(f => formErrors[f]?.message)
            .find(Boolean)
          toast.error(firstMsg || "Please fix the highlighted fields")
        }, 50)
        return
      }
    }
    toast.error("Please check all fields before submitting")
  }

  const STEPS = [
    { n: 1, label: "Details",   icon: Wand2 },
    { n: 2, label: "AI Config", icon: Cpu },
    { n: 3, label: "Pricing",   icon: DollarSign },
  ]

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
              <h1 className="text-xl font-bold text-zinc-900">Create New Agent</h1>
              <p className="text-sm text-zinc-500">Build and publish your AI microagent</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {STEPS.map((s, i) => (
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
                {i < STEPS.length - 1 && <div className="h-px w-5 bg-zinc-100" />}
              </div>
            ))}
          </div>

          {/* Pass BOTH onSubmit and onError to handleSubmit */}
          <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-5">

            {/* ── STEP 1 — Details ─────────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary" /> Basic Information
                  </h2>

                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">Agent Name *</Label>
                    <Input placeholder="e.g. Email Summarizer Pro"
                      className={cn("rounded-xl h-10", errors.name ? "border-red-300 focus:border-red-400" : "border-zinc-200")}
                      {...register("name")} />
                    {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">
                      Description * <span className="text-zinc-400 font-normal">(shown on marketplace)</span>
                    </Label>
                    <Textarea placeholder="Describe what your agent does, who it's for, and what makes it unique…"
                      rows={3}
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
                </div>

                <Button type="button" onClick={() => setStep(2)}
                  className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                  Continue to AI Config <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}

            {/* ── STEP 2 — AI Config ───────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" /> AI Configuration
                  </h2>

                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">AI Model *</Label>
                    <div className="grid grid-cols-1 gap-2">
                      {MODELS.map(m => (
                        <button key={m.value} type="button"
                          onClick={() => setValue("model_name", m.value)}
                          className={cn(
                            "flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all",
                            modelName === m.value
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white hover:border-zinc-400"
                          )}>
                          <div>
                            <span className={cn("text-sm font-semibold", modelName === m.value ? "text-white" : "text-zinc-900")}>
                              {m.label}
                            </span>
                            <span className={cn("text-xs ml-2", modelName === m.value ? "text-zinc-400" : "text-zinc-400")}>
                              {m.sub}
                            </span>
                          </div>
                          {m.badge && (
                            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                              modelName === m.value
                                ? "bg-white/20 text-white"
                                : "bg-primary/8 text-primary"
                            )}>
                              {m.badge}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">System Prompt *</Label>
                    <Textarea
                      placeholder={`You are an expert email analyst. When given an email thread:\n1. Summarize key points concisely\n2. Identify action items\n3. Flag urgent requests\n\nReturn as structured JSON.`}
                      rows={8}
                      className={cn("rounded-xl font-mono text-sm resize-none", errors.system_prompt ? "border-red-300" : "border-zinc-200")}
                      {...register("system_prompt")}
                    />
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

            {/* ── STEP 3 — Pricing ─────────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" /> Pricing Model
                  </h2>

                  {/* Pricing model note for "free" */}
                  {pricingModel === "free" && (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
                      <strong>Free agents</strong> are available to all users at no cost. AgentDyne covers the
                      LLM inference costs up to the platform quota. The agent will be created as a{" "}
                      <strong>draft</strong> — submit it for review once you're ready to publish.
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { key: "free",         label: "Free",         sub: "No cost to users" },
                      { key: "per_call",     label: "Pay per Call", sub: "Charge per execution" },
                      { key: "subscription", label: "Subscription", sub: "Monthly recurring fee" },
                      { key: "freemium",     label: "Freemium",     sub: "Free tier + paid calls" },
                    ] as const).map(p => (
                      <button key={p.key} type="button"
                        onClick={() => setValue("pricing_model", p.key)}
                        className={cn(
                          "p-4 rounded-xl border text-left transition-all",
                          pricingModel === p.key
                            ? "border-zinc-900 bg-zinc-900 text-white"
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
                    </div>
                  )}
                  {pricingModel === "subscription" && (
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                      <Input type="number" step="0.01" min="0" placeholder="9.99"
                        className="rounded-xl border-zinc-200 h-10" {...register("subscription_price_monthly")} />
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(2)}
                    className="flex-1 rounded-xl border-zinc-200 h-10">Back</Button>
                  {/* type="submit" triggers handleSubmit(onSubmit, onError) */}
                  <Button type="submit" disabled={loading}
                    className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10">
                    {loading
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating…</>
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
