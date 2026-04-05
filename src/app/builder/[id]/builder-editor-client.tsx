"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { motion } from "framer-motion"
import {
  Save, Play, Send, ArrowLeft, Loader2, Check,
  Settings2, Code2, FileText, TestTube2, Globe, Tag,
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
import { createClient } from "@/lib/supabase/client"
import { CATEGORY_ICONS, categoryLabel, slugify } from "@/lib/utils"
import toast from "react-hot-toast"
import Link from "next/link"

const CATEGORIES = ["productivity","coding","marketing","finance","legal","customer_support","data_analysis","content","research","hr","sales","devops","security","other"]
const MODELS = [
  { value: "claude-opus-4-6",            label: "Claude Opus 4.6 — Most powerful" },
  { value: "claude-sonnet-4-20250514",   label: "Claude Sonnet 4 — Balanced" },
  { value: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5 — Fastest" },
  { value: "gpt-4o",                     label: "GPT-4o" },
  { value: "gpt-4o-mini",                label: "GPT-4o Mini" },
  { value: "gemini-1.5-pro",             label: "Gemini 1.5 Pro" },
]

const schema = z.object({
  name:                       z.string().min(3).max(60),
  description:                z.string().min(20).max(300),
  long_description:           z.string().optional(),
  category:                   z.string(),
  tags:                       z.string().optional(),
  pricing_model:              z.enum(["free","per_call","subscription","freemium"]),
  price_per_call:             z.coerce.number().min(0).optional(),
  subscription_price_monthly: z.coerce.number().min(0).optional(),
  free_calls_per_month:       z.coerce.number().min(0).optional(),
  system_prompt:              z.string().min(10),
  model_name:                 z.string(),
  temperature:                z.coerce.number().min(0).max(2),
  max_tokens:                 z.coerce.number().min(100).max(32000),
  timeout_seconds:            z.coerce.number().min(5).max(120),
  documentation:              z.string().optional(),
})
type FormData = z.infer<typeof schema>

export function BuilderEditorClient({ agent }: { agent: any }) {
  const router   = useRouter()
  const supabase = createClient()
  const [saving,     setSaving]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testInput,  setTestInput]  = useState('{"input": "Hello, what can you do?"}')
  const [testOutput, setTestOutput] = useState("")
  const [testing,    setTesting]    = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:                       agent.name,
      description:                agent.description,
      long_description:           agent.long_description || "",
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

  const onSave = async (data: FormData) => {
    setSaving(true)
    try {
      const tagsArray = (data.tags || "").split(",").map(t => t.trim()).filter(Boolean)
      const { error } = await supabase.from("agents").update({
        ...data,
        tags: tagsArray,
        slug: slugify(data.name) + "-" + agent.slug.split("-").pop(),
        updated_at: new Date().toISOString(),
      }).eq("id", agent.id)
      if (error) throw error
      toast.success("Saved!")
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const submitForReview = async () => {
    setSubmitting(true)
    try {
      const { error } = await supabase.from("agents").update({ status: "pending_review" }).eq("id", agent.id)
      if (error) throw error
      toast.success("Submitted for review! We'll review within 24h.")
      router.push("/my-agents")
    } catch (e: any) { toast.error(e.message) }
    finally { setSubmitting(false) }
  }

  const runTest = async () => {
    setTesting(true)
    setTestOutput("")
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, input: JSON.parse(testInput) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTestOutput(JSON.stringify(data.output, null, 2))
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (e: any) { toast.error(e.message); setTestOutput(`Error: ${e.message}`) }
    finally { setTesting(false) }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto">
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
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight">{agent.name}</h1>
                  <Badge variant={
                    agent.status === "active" ? "success" :
                    agent.status === "pending_review" ? "warning" : "secondary"
                  } className="text-[10px]">{agent.status.replace("_"," ")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">ID: {agent.id}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isDirty && (
                <Button variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={handleSubmit(onSave)} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saving ? "Saving…" : "Save"}
                </Button>
              )}
              {agent.status === "draft" && (
                <Button variant="brand" size="sm" className="gap-1.5 rounded-xl" onClick={submitForReview} disabled={submitting}>
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {submitting ? "Submitting…" : "Submit for Review"}
                </Button>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmit(onSave)}>
            <Tabs defaultValue="basics">
              <TabsList className="mb-6">
                <TabsTrigger value="basics"    className="gap-1.5"><FileText className="h-3.5 w-3.5" />Basics</TabsTrigger>
                <TabsTrigger value="ai"        className="gap-1.5"><Code2 className="h-3.5 w-3.5" />AI Config</TabsTrigger>
                <TabsTrigger value="pricing"   className="gap-1.5"><Tag className="h-3.5 w-3.5" />Pricing</TabsTrigger>
                <TabsTrigger value="docs"      className="gap-1.5"><Globe className="h-3.5 w-3.5" />Docs</TabsTrigger>
                <TabsTrigger value="test"      className="gap-1.5"><TestTube2 className="h-3.5 w-3.5" />Test</TabsTrigger>
              </TabsList>

              {/* BASICS */}
              <TabsContent value="basics" className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Agent Details</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2 space-y-1.5">
                        <Label>Name *</Label>
                        <Input {...register("name")} />
                        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>Short Description * <span className="text-muted-foreground font-normal">(shown on marketplace cards)</span></Label>
                        <Textarea {...register("description")} rows={2} />
                        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>Long Description <span className="text-muted-foreground font-normal">(optional, shown on detail page)</span></Label>
                        <Textarea {...register("long_description")} rows={5} placeholder="Describe features, use cases, examples…" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Category *</Label>
                        <Select defaultValue={agent.category} onValueChange={v => setValue("category", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map(c => (
                              <SelectItem key={c} value={c}>{CATEGORY_ICONS[c]} {categoryLabel(c)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Tags <span className="text-muted-foreground font-normal">(comma-separated)</span></Label>
                        <Input {...register("tags")} placeholder="email, summarize, productivity" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* AI CONFIG */}
              <TabsContent value="ai" className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">System Prompt</CardTitle></CardHeader>
                  <CardContent>
                    <Textarea {...register("system_prompt")} rows={10} className="font-mono text-sm" placeholder="You are an expert…" />
                    {errors.system_prompt && <p className="text-xs text-destructive mt-1">{errors.system_prompt.message}</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Model Parameters</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 space-y-1.5">
                      <Label>AI Model</Label>
                      <Select defaultValue={agent.model_name} onValueChange={v => setValue("model_name", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{MODELS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Temperature (0–2)</Label>
                      <Input type="number" step="0.1" min="0" max="2" {...register("temperature")} />
                      <p className="text-xs text-muted-foreground">0 = precise, 2 = creative</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Max Tokens</Label>
                      <Input type="number" min="100" max="32000" {...register("max_tokens")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Timeout (seconds)</Label>
                      <Input type="number" min="5" max="120" {...register("timeout_seconds")} />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* PRICING */}
              <TabsContent value="pricing" className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Pricing Model</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {(["free","per_call","subscription","freemium"] as const).map(p => (
                        <button key={p} type="button" onClick={() => setValue("pricing_model", p)}
                          className={`p-4 rounded-xl border text-left transition-all ${pricingModel === p ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                          <p className="font-semibold text-sm capitalize">{p.replace("_"," ")}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p === "free" && "Free to use, unlimited"} {p === "per_call" && "Charge per execution"} {p === "subscription" && "Monthly recurring fee"} {p === "freemium" && "Free tier + paid calls"}
                          </p>
                        </button>
                      ))}
                    </div>
                    {(pricingModel === "per_call" || pricingModel === "freemium") && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Price per Call (USD)</Label>
                          <Input type="number" step="0.0001" min="0" placeholder="0.0100" {...register("price_per_call")} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Free calls/month</Label>
                          <Input type="number" min="0" placeholder="10" {...register("free_calls_per_month")} />
                        </div>
                      </div>
                    )}
                    {pricingModel === "subscription" && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Monthly Price (USD)</Label>
                          <Input type="number" step="0.01" min="0" placeholder="9.99" {...register("subscription_price_monthly")} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Free calls/month (trial)</Label>
                          <Input type="number" min="0" placeholder="10" {...register("free_calls_per_month")} />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* DOCS */}
              <TabsContent value="docs" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Documentation</CardTitle>
                    <p className="text-sm text-muted-foreground">Write documentation shown on your agent's detail page. HTML supported.</p>
                  </CardHeader>
                  <CardContent>
                    <Textarea {...register("documentation")} rows={16} className="font-mono text-sm"
                      placeholder="<h2>Overview</h2><p>This agent...</p><h2>Input Format</h2>..." />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TEST */}
              <TabsContent value="test" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Live Playground</CardTitle>
                    <p className="text-sm text-muted-foreground">Test your agent with real inputs before publishing.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Input JSON</Label>
                        <Textarea value={testInput} onChange={e => setTestInput(e.target.value)} rows={10} className="font-mono text-xs" />
                      </div>
                      <div className="space-y-2">
                        <Label>Output</Label>
                        <div className={`h-[220px] rounded-xl border font-mono text-xs p-3 overflow-auto whitespace-pre-wrap transition-colors ${testing ? "bg-muted/50 animate-pulse" : "bg-muted/20"}`}>
                          {testing ? "Running…" : testOutput || "Output will appear here…"}
                        </div>
                      </div>
                    </div>
                    <Button type="button" onClick={runTest} disabled={testing} variant="brand" className="gap-2">
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {testing ? "Running…" : "Run Test"}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Sticky save bar */}
            {isDirty && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                <div className="glass rounded-2xl border border-border px-5 py-3 flex items-center gap-4 shadow-xl">
                  <p className="text-sm text-muted-foreground">You have unsaved changes</p>
                  <Button type="submit" variant="brand" size="sm" className="gap-1.5 rounded-xl" disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {saving ? "Saving…" : "Save Changes"}
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
