"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Bot, Loader2, ArrowRight, Wand2, Tag, Cpu, DollarSign } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { createClient } from "@/lib/supabase/client"
import { slugify, CATEGORY_ICONS, categoryLabel, cn } from "@/lib/utils"
import toast from "react-hot-toast"

const CATEGORIES = ["productivity","coding","marketing","finance","legal","customer_support","data_analysis","content","research","hr","sales","devops","security","other"]

const MODELS = [
  { value: "claude-sonnet-4-20250514",  label: "Claude Sonnet 4 — Balanced ⚡" },
  { value: "claude-opus-4-6",           label: "Claude Opus 4.6 — Most Powerful 🔥" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — Fastest 💨" },
  { value: "gpt-4o",                    label: "GPT-4o" },
  { value: "gpt-4o-mini",              label: "GPT-4o Mini" },
  { value: "gemini-1.5-pro",           label: "Gemini 1.5 Pro" },
]

const schema = z.object({
  name:                       z.string().min(3).max(60),
  description:                z.string().min(20).max(300),
  category:                   z.string(),
  pricing_model:              z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  system_prompt:              z.string().min(20, "System prompt must be at least 20 characters"),
  model_name:                 z.string(),
  temperature:                z.coerce.number().min(0).max(2),
  max_tokens:                 z.coerce.number().min(100).max(32000),
})
type FormData = z.infer<typeof schema>

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
      toast.success("Agent created! Opening editor…")
      router.push(`/builder/${agent.id}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setLoading(false) }
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
                <button
                  type="button"
                  onClick={() => setStep(s.n)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                    step === s.n
                      ? "bg-zinc-900 text-white"
                      : step > s.n
                      ? "bg-green-50 text-green-700 border border-green-100"
                      : "bg-zinc-50 text-zinc-400 border border-zinc-100"
                  )}
                >
                  <s.icon className="h-3 w-3" />
                  {s.label}
                </button>
                {i < STEPS.length - 1 && <div className="h-px w-4 bg-zinc-100" />}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Step 1 — Details */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4">
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary" /> Basic Information
                  </h2>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">Agent Name *</Label>
                    <Input placeholder="e.g. Email Summarizer Pro"
                      className="rounded-xl border-zinc-200" {...register("name")} />
                    {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">Description * <span className="text-zinc-400 font-normal">(shown on marketplace)</span></Label>
                    <Textarea placeholder="Describe what your agent does, who it's for, and what makes it unique…"
                      rows={3} className="rounded-xl border-zinc-200 resize-none" {...register("description")} />
                    {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">Category *</Label>
                    <Select onValueChange={v => setValue("category", v)}>
                      <SelectTrigger className="rounded-xl border-zinc-200 h-10">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {CATEGORIES.map(c => (
                          <SelectItem key={c} value={c} className="text-sm">
                            {CATEGORY_ICONS[c]} {categoryLabel(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.category && <p className="text-xs text-red-500">{errors.category.message}</p>}
                  </div>
                </div>
                <Button type="button" onClick={() => setStep(2)}
                  className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                  Continue to AI Config <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}

            {/* Step 2 — AI Config */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4">
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" /> AI Configuration
                  </h2>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">AI Model *</Label>
                    <Select defaultValue="claude-sonnet-4-20250514" onValueChange={v => setValue("model_name", v)}>
                      <SelectTrigger className="rounded-xl border-zinc-200 h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {MODELS.map(m => <SelectItem key={m.value} value={m.value} className="text-sm">{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-zinc-700">System Prompt *</Label>
                    <Textarea
                      placeholder={`You are an expert email analyst. When given an email thread:\n1. Summarize key points concisely\n2. Identify action items\n3. Flag urgent requests\n\nReturn as structured JSON.`}
                      rows={9}
                      className="rounded-xl border-zinc-200 font-mono text-sm resize-none"
                      {...register("system_prompt")}
                    />
                    {errors.system_prompt && <p className="text-xs text-red-500">{errors.system_prompt.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Temperature</Label>
                      <Input type="number" step="0.1" min="0" max="2" className="rounded-xl border-zinc-200" {...register("temperature")} />
                      <p className="text-[11px] text-zinc-400">0 = precise, 2 = creative</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Max Tokens</Label>
                      <Input type="number" min="100" max="32000" className="rounded-xl border-zinc-200" {...register("max_tokens")} />
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}
                    className="flex-1 rounded-xl border-zinc-200">
                    Back
                  </Button>
                  <Button type="button" onClick={() => setStep(3)}
                    className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                    Continue to Pricing <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3 — Pricing */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-4">
                  <h2 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" /> Pricing Model
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    {(["free","per_call","subscription","freemium"] as const).map(p => (
                      <button
                        key={p} type="button"
                        onClick={() => setValue("pricing_model", p)}
                        className={cn(
                          "p-4 rounded-xl border text-sm font-medium text-left transition-all",
                          pricingModel === p
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 text-zinc-700 hover:border-zinc-400 bg-white"
                        )}
                      >
                        <div className="font-bold capitalize mb-0.5">{p.replace("_"," ")}</div>
                        <div className={cn("text-xs font-normal", pricingModel === p ? "opacity-70" : "text-zinc-400")}>
                          {p === "free"         && "No cost to users"}
                          {p === "per_call"     && "Charge per execution"}
                          {p === "subscription" && "Monthly recurring fee"}
                          {p === "freemium"     && "Free tier + paid calls"}
                        </div>
                      </button>
                    ))}
                  </div>
                  {(pricingModel === "per_call" || pricingModel === "freemium") && (
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                      <Input type="number" step="0.001" min="0" placeholder="0.010"
                        className="rounded-xl border-zinc-200" {...register("price_per_call")} />
                    </div>
                  )}
                  {pricingModel === "subscription" && (
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                      <Input type="number" step="0.01" min="0" placeholder="9.99"
                        className="rounded-xl border-zinc-200" {...register("subscription_price_monthly")} />
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(2)}
                    className="flex-1 rounded-xl border-zinc-200">
                    Back
                  </Button>
                  <Button type="submit"
                    className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold"
                    disabled={loading}>
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating…</> : <>Create Agent <ArrowRight className="h-4 w-4 ml-1" /></>}
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
