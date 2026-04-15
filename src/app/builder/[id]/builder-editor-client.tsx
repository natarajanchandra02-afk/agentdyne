"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion } from "framer-motion"
import {
  Save, Play, Send, ArrowLeft, Loader2, Check,
  Code2, FileText, TestTube2, Globe, Tag, Info,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { CategoryIcon } from "@/components/ui/category-icon"
import { createClient } from "@/lib/supabase/client"
import { categoryLabel, cn } from "@/lib/utils"
import { MAX_SYSTEM_PROMPT_LENGTH, SUPPORTED_MODELS } from "@/lib/constants"
import toast from "react-hot-toast"
import Link from "next/link"

const CATEGORIES = [
  "productivity","coding","marketing","finance","legal",
  "customer_support","data_analysis","content","research",
  "hr","sales","devops","security","other",
]
const MODELS = [
  { value: "claude-opus-4-6",            label: "Claude Opus 4.6 — Most powerful" },
  { value: "claude-sonnet-4-20250514",   label: "Claude Sonnet 4 — Balanced (recommended)" },
  { value: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5 — Fastest / cheapest" },
  { value: "gpt-4o",                     label: "GPT-4o — OpenAI flagship" },
  { value: "gpt-4o-mini",               label: "GPT-4o Mini — OpenAI lightweight" },
  { value: "gemini-1.5-pro",            label: "Gemini 1.5 Pro — Google flagship" },
]

const VALID_MODELS = new Set(SUPPORTED_MODELS as readonly string[])

// Sanitise text — strip null bytes and invisible Unicode that could corrupt DB / bypass checks
function sanitize(s: string): string {
  return s.replace(/\x00/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim()
}

const schema = z.object({
  name:                       z.string().min(3, "Min 3 chars").max(60),
  description:                z.string().min(20, "Min 20 chars").max(300),
  long_description:           z.string().optional(),
  category:                   z.string().min(1),
  tags:                       z.string().optional(),
  pricing_model:              z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  free_calls_per_month:       z.coerce.number().min(0).optional(),
  system_prompt:              z.string().min(10, "System prompt must be at least 10 characters").max(MAX_SYSTEM_PROMPT_LENGTH),
  model_name:                 z.string().refine(v => VALID_MODELS.has(v), { message: "Invalid model" }),
  temperature:                z.coerce.number().min(0).max(2),
  max_tokens:                 z.coerce.number().min(100).max(32000),
  timeout_seconds:            z.coerce.number().min(5).max(300),
  documentation:              z.string().max(20000).optional(),
})
type FormData = z.infer<typeof schema>

function statusVariant(status: string): "success" | "warning" | "secondary" | "destructive" {
  if (status === "active")         return "success"
  if (status === "pending_review") return "warning"
  if (status === "suspended")      return "destructive"
  return "secondary"
}

export function BuilderEditorClient({ agent }: { agent: any }) {
  const router   = useRouter()
  const supabase = createClient()
  const [saving,     setSaving]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testInput,  setTestInput]  = useState('{"input": "Hello, what can you do?"}')
  const [testOutput, setTestOutput] = useState("")
  const [testing,    setTesting]    = useState(false)
  const [testTrace,  setTestTrace]  = useState<{ latencyMs: number; tokens: { input: number; output: number }; cost: number } | null>(null)

  const { register, handleSubmit, watch, setValue, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:                       agent.name,
      description:                agent.description,
      long_description:           agent.long_description  || "",
      category:                   agent.category,
      tags:                       (agent.tags || []).join(", "),
      pricing_model:              agent.pricing_model,
      price_per_call:             agent.price_per_call || 0,
      subscription_price_monthly: agent.subscription_price_monthly || 0,
      free_calls_per_month:       agent.free_calls_per_month || 0,
      system_prompt:              agent.system_prompt || "",
      model_name:                 agent.model_name || "claude-sonnet-4-20250514",
      temperature:                agent.temperature || 0.7,
      max_tokens:                 agent.max_tokens || 4096,
      timeout_seconds:            agent.timeout_seconds || 30,
      documentation:              agent.documentation || "",
    },
  })

  const pricingModel = watch("pricing_model")

  // ── Save handler — sanitises all text fields before writing ──────────────
  const onSave = async (data: FormData) => {
    setSaving(true)
    try {
      const tagsArray = (data.tags || "")
        .split(",")
        .map(t => sanitize(t))
        .filter(Boolean)
        .slice(0, 30) // cap at 30 tags

      const { error } = await supabase.from("agents").update({
        name:                        sanitize(data.name),
        description:                 sanitize(data.description),
        long_description:            data.long_description ? sanitize(data.long_description) : null,
        category:                    data.category,
        tags:                        tagsArray,
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
      const { error } = await supabase
        .from("agents")
        .update({ status: "pending_review" })
        .eq("id", agent.id)
      if (error) throw error
      toast.success("Submitted for review! We'll review within 24h.")
      router.push("/my-agents")
    } catch (e: any) {
      toast.error(e.message || "Submission failed")
    } finally {
      setSubmitting(false)
    }
  }

  // ── Test runner — correct endpoint: /api/agents/[id]/execute ─────────────
  const runTest = async () => {
    setTesting(true)
    setTestOutput("")
    setTestTrace(null)

    // Client-side input size guard (32 KB)
    if (testInput.length > 32_768) {
      toast.error("Input too large — max 32 KB")
      setTesting(false)
      return
    }

    try {
      let parsedInput: unknown
      try { parsedInput = JSON.parse(testInput) } catch { parsedInput = testInput }

      const res  = await fetch(`/api/agents/${agent.id}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ input: parsedInput }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setTestOutput(
        typeof data.output === "string"
          ? data.output
          : JSON.stringify(data.output, null, 2)
      )
      setTestTrace({
        latencyMs: data.latencyMs ?? 0,
        tokens:    data.tokens    ?? { input: 0, output: 0 },
        cost:      data.cost      ?? 0,
      })
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (e: any) {
      toast.error(e.message)
      setTestOutput(`Error: ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-4xl mx-auto px-6 py-8">

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
                <Button
                  variant="outline" size="sm"
                  className="gap-1.5 rounded-xl border-zinc-200"
                  onClick={handleSubmit(onSave)}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saving ? "Saving…" : "Save"}
                </Button>
              )}
              {agent.status === "draft" && (
                <Button
                  variant="default" size="sm"
                  className="gap-1.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700"
                  onClick={submitForReview}
                  disabled={submitting}
                >
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {submitting ? "Submitting…" : "Submit for Review"}
                </Button>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit(onSave)}>
            <Tabs defaultValue="basics">
              <TabsList className="mb-6 bg-zinc-50 border border-zinc-100 p-1 rounded-xl">
                <TabsTrigger value="basics"  className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><FileText className="h-3.5 w-3.5" /> Basics</TabsTrigger>
                <TabsTrigger value="ai"      className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><Code2    className="h-3.5 w-3.5" /> AI Config</TabsTrigger>
                <TabsTrigger value="pricing" className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><Tag      className="h-3.5 w-3.5" /> Pricing</TabsTrigger>
                <TabsTrigger value="docs"    className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><Globe    className="h-3.5 w-3.5" /> Docs</TabsTrigger>
                <TabsTrigger value="test"    className="rounded-lg text-sm gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm"><TestTube2 className="h-3.5 w-3.5" /> Test</TabsTrigger>
              </TabsList>

              {/* ── BASICS ─────────────────────────────────────────────── */}
              <TabsContent value="basics" className="space-y-4">
                <Card className="border-zinc-100 rounded-2xl shadow-xs">
                  <CardHeader><CardTitle className="text-base text-zinc-900">Agent Details</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">Name *</Label>
                      <Input {...register("name")} className="rounded-xl border-zinc-200 h-10" />
                      {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">
                        Short Description * <span className="text-zinc-400 font-normal">(shown on marketplace cards)</span>
                      </Label>
                      <Textarea {...register("description")} rows={2} className="rounded-xl border-zinc-200 text-sm resize-none" />
                      {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">
                        Long Description <span className="text-zinc-400 font-normal">(optional, shown on detail page)</span>
                      </Label>
                      <Textarea {...register("long_description")} rows={5}
                        className="rounded-xl border-zinc-200 text-sm resize-none"
                        placeholder="Describe features, use cases, example inputs/outputs…" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Category *</Label>
                        <Select defaultValue={agent.category} onValueChange={v => setValue("category", v)}>
                          <SelectTrigger className="rounded-xl border-zinc-200 h-10">
                            <SelectValue />
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
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">
                          Tags <span className="text-zinc-400 font-normal">(comma-separated)</span>
                        </Label>
                        <Input {...register("tags")}
                          className="rounded-xl border-zinc-200 h-10"
                          placeholder="email, summarize, productivity" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── AI CONFIG ──────────────────────────────────────────── */}
              <TabsContent value="ai" className="space-y-4">
                <Card className="border-zinc-100 rounded-2xl shadow-xs">
                  <CardHeader><CardTitle className="text-base text-zinc-900">System Prompt</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">
                        This is the AI&apos;s persona and instructions — defines everything your agent does.
                      </span>
                      <span className={cn("text-xs font-mono flex-shrink-0 ml-2",
                        (watch("system_prompt") || "").length > MAX_SYSTEM_PROMPT_LENGTH * 0.9
                          ? "text-red-500" : "text-zinc-400"
                      )}>
                        {(watch("system_prompt") || "").length}/{MAX_SYSTEM_PROMPT_LENGTH}
                      </span>
                    </div>
                    <Textarea
                      {...register("system_prompt")}
                      rows={12}
                      className="rounded-xl border-zinc-200 font-mono text-xs resize-none leading-relaxed"
                      placeholder="You are an expert at… When given input, you will…"
                    />
                    {errors.system_prompt && <p className="text-xs text-red-500">{errors.system_prompt.message}</p>}
                  </CardContent>
                </Card>

                <Card className="border-zinc-100 rounded-2xl shadow-xs">
                  <CardHeader><CardTitle className="text-base text-zinc-900">Model Parameters</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">AI Model</Label>
                      <Select defaultValue={agent.model_name} onValueChange={v => setValue("model_name", v)}>
                        <SelectTrigger className="rounded-xl border-zinc-200 h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {MODELS.map(m => (
                            <SelectItem key={m.value} value={m.value} className="text-sm">{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Temperature (0–2)</Label>
                        <Input type="number" step="0.1" min="0" max="2"
                          className="rounded-xl border-zinc-200 h-10"
                          {...register("temperature")} />
                        <p className="text-[11px] text-zinc-400">0 = precise · 2 = creative</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Max Tokens</Label>
                        <Input type="number" min="100" max="32000"
                          className="rounded-xl border-zinc-200 h-10"
                          {...register("max_tokens")} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Timeout (s)</Label>
                        <Input type="number" min="5" max="300"
                          className="rounded-xl border-zinc-200 h-10"
                          {...register("timeout_seconds")} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── PRICING ────────────────────────────────────────────── */}
              <TabsContent value="pricing" className="space-y-4">
                <Card className="border-zinc-100 rounded-2xl shadow-xs">
                  <CardHeader><CardTitle className="text-base text-zinc-900">Pricing Model</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { key: "free",         label: "Free",          sub: "No cost to users" },
                        { key: "per_call",     label: "Pay per Call",  sub: "Charge per execution" },
                        { key: "subscription", label: "Subscription",  sub: "Monthly recurring fee" },
                        { key: "freemium",     label: "Freemium",      sub: "Free tier + paid calls" },
                      ] as const).map(p => (
                        <button key={p.key} type="button"
                          onClick={() => setValue("pricing_model", p.key)}
                          className={cn(
                            "p-4 rounded-xl border text-left transition-all",
                            pricingModel === p.key
                              ? "border-zinc-900 bg-zinc-900"
                              : "border-zinc-200 bg-white hover:border-zinc-400"
                          )}
                        >
                          <p className={cn("font-bold text-sm mb-0.5", pricingModel === p.key ? "text-white" : "text-zinc-900")}>{p.label}</p>
                          <p className={cn("text-xs", pricingModel === p.key ? "text-zinc-400" : "text-zinc-500")}>{p.sub}</p>
                        </button>
                      ))}
                    </div>

                    {(pricingModel === "per_call" || pricingModel === "freemium") && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Price per Call (USD)</Label>
                          <Input type="number" step="0.0001" min="0" placeholder="0.0100"
                            className="rounded-xl border-zinc-200 h-10"
                            {...register("price_per_call")} />
                          <p className="text-xs text-zinc-400">You earn 80%, AgentDyne keeps 20%</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Free calls/month</Label>
                          <Input type="number" min="0" placeholder="10"
                            className="rounded-xl border-zinc-200 h-10"
                            {...register("free_calls_per_month")} />
                        </div>
                      </div>
                    )}
                    {pricingModel === "subscription" && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Monthly Price (USD)</Label>
                          <Input type="number" step="0.01" min="0" placeholder="9.99"
                            className="rounded-xl border-zinc-200 h-10"
                            {...register("subscription_price_monthly")} />
                          <p className="text-xs text-zinc-400">You earn 80%, AgentDyne keeps 20%</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Free trial calls/month</Label>
                          <Input type="number" min="0" placeholder="10"
                            className="rounded-xl border-zinc-200 h-10"
                            {...register("free_calls_per_month")} />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── DOCS ───────────────────────────────────────────────── */}
              <TabsContent value="docs" className="space-y-4">
                <Card className="border-zinc-100 rounded-2xl shadow-xs">
                  <CardHeader>
                    <CardTitle className="text-base text-zinc-900">Documentation</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
                      <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      <span>
                        Plain text only. Shown verbatim on your agent&apos;s detail page.
                        Describe inputs, outputs, example usage, and limitations.
                      </span>
                    </div>
                    <Textarea
                      {...register("documentation")}
                      rows={16}
                      className="rounded-xl border-zinc-200 font-mono text-xs resize-none"
                      placeholder={"Overview\n--------\nThis agent takes... and returns...\n\nInput format\n------------\nPass a JSON object with: { input: \"your text\" }\n\nExamples\n--------\nInput: { input: \"Summarize this email\" }\nOutput: { summary: \"...\", action_items: [...] }"}
                    />
                    {errors.documentation && <p className="text-xs text-red-500">{errors.documentation.message}</p>}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── TEST ───────────────────────────────────────────────── */}
              <TabsContent value="test" className="space-y-4">
                <Card className="border-zinc-100 rounded-2xl shadow-xs">
                  <CardHeader>
                    <CardTitle className="text-base text-zinc-900">Live Playground</CardTitle>
                    <p className="text-sm text-zinc-400">Test your agent with real inputs before publishing.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-zinc-700">Input JSON</Label>
                        <Textarea
                          value={testInput}
                          onChange={e => setTestInput(e.target.value)}
                          rows={10}
                          className="rounded-xl border-zinc-200 font-mono text-xs resize-none"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-zinc-700">Output</Label>
                        <div className={cn(
                          "h-[220px] rounded-xl border border-zinc-100 bg-zinc-50 font-mono text-xs p-3 overflow-auto whitespace-pre-wrap text-zinc-500",
                          testing && "animate-pulse"
                        )}>
                          {testing ? "Running…" : testOutput || "Output will appear here…"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        onClick={runTest}
                        disabled={testing}
                        className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold"
                      >
                        {testing
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
                          : <><Play className="h-4 w-4" /> Run Test</>}
                      </Button>
                    </div>

                    {/* Execution trace */}
                    {testTrace && (
                      <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-xs font-mono text-zinc-500 flex flex-wrap gap-x-6 gap-y-1">
                        <span>latency <strong className="text-zinc-700">{testTrace.latencyMs}ms</strong></span>
                        <span>tokens <strong className="text-zinc-700">{testTrace.tokens.input}↑ {testTrace.tokens.output}↓</strong></span>
                        <span>cost <strong className="text-zinc-700">${testTrace.cost.toFixed(6)}</strong></span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Sticky save bar */}
            {isDirty && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
              >
                <div className="bg-white/90 backdrop-blur-xl rounded-2xl border border-zinc-100 shadow-xl px-5 py-3 flex items-center gap-4">
                  <p className="text-sm text-zinc-500">You have unsaved changes</p>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={saving}
                    className="gap-1.5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold"
                  >
                    {saving
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                      : <><Check className="h-3.5 w-3.5" /> Save Changes</>}
                  </Button>
                </div>
              </motion.div>
            )}
          </form>
        </div>
      </main>
    </div>
  )
}
