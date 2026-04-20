"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  Star, Zap, CheckCircle, Play, Code2, BookOpen, MessageSquare,
  Tag, Globe, Clock, TrendingUp, ArrowLeft, Copy, Check, Loader2,
  Layers, GitFork, Shield, ShieldCheck, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { CategoryIcon } from "@/components/ui/category-icon"
import { formatNumber, formatCurrency, formatDate, getInitials, categoryLabel, cn } from "@/lib/utils"
import toast from "react-hot-toast"

interface Props {
  agent: any; reviews: any[]; user: any; userSubscription: any
}

function GradeBadge({ score }: { score?: number }) {
  if (!score || score <= 0) return null
  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D"
  const color = {
    S: "bg-violet-50 text-violet-700 border-violet-200",
    A: "bg-green-50  text-green-700  border-green-200",
    B: "bg-blue-50   text-blue-700   border-blue-200",
    C: "bg-amber-50  text-amber-700  border-amber-200",
    D: "bg-zinc-100  text-zinc-600   border-zinc-200",
  }[grade]
  return (
    <span className={cn("text-sm font-black px-2 py-0.5 rounded-lg border", color)}
      title={`Quality score: ${score.toFixed(1)}/100`}>{grade}</span>
  )
}

// ── Schema viewer ──────────────────────────────────────────────────────────

function SchemaBlock({ title, schema }: { title: string; schema: any }) {
  if (!schema || Object.keys(schema).length === 0) return null
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{title}</p>
      <pre className="text-xs font-mono bg-zinc-50 border border-zinc-100 rounded-xl p-3 overflow-auto text-zinc-600 leading-relaxed">
        {JSON.stringify(schema, null, 2)}
      </pre>
    </div>
  )
}

export function AgentDetailClient({ agent, reviews, user, userSubscription }: Props) {
  const router = useRouter()
  const [testInput,  setTestInput]  = useState('{"input": "Hello! What can you do?"}')
  const [testOutput, setTestOutput] = useState("")
  const [testing,    setTesting]    = useState(false)
  const [copied,     setCopied]     = useState(false)
  const [forking,    setForking]    = useState(false)
  const seller = agent.profiles

  const handleTest = async () => {
    if (!user) { router.push("/login"); return }
    setTesting(true); setTestOutput("")
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
      toast.success(`Done in ${data.latencyMs}ms · $${data.cost?.toFixed(5) ?? "0"}`)
    } catch (err: any) {
      toast.error(err.message); setTestOutput(`Error: ${err.message}`)
    } finally { setTesting(false) }
  }

  // "Use in Pipeline" — redirect to /pipelines?add_agent=<id>
  const handleAddToPipeline = () => {
    if (!user) { router.push("/login"); return }
    router.push(`/pipelines?add_agent=${agent.id}&agent_name=${encodeURIComponent(agent.name)}`)
  }

  // Fork / Clone — creates a draft copy in the user's account
  const handleFork = async () => {
    if (!user) { router.push("/login"); return }
    setForking(true)
    try {
      const res  = await fetch("/api/agents/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({
          name:          `${agent.name} (fork)`,
          description:   agent.description,
          long_description: agent.long_description,
          category:      agent.category,
          tags:          agent.tags ?? [],
          pricing_model: "free",
          system_prompt: agent.system_prompt,
          model_name:    agent.model_name,
          temperature:   agent.temperature,
          max_tokens:    agent.max_tokens,
          is_public:     false,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Fork failed")
      toast.success("Agent forked! Opening editor…")
      router.push(`/builder/${data.id}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setForking(false) }
  }

  const copySnippet = () => {
    const snippet = [
      `const res = await fetch("https://agentdyne.com/api/agents/${agent.id}/execute", {`,
      `  method: "POST",`,
      `  headers: {`,
      `    "Authorization": "Bearer YOUR_API_KEY",`,
      `    "Content-Type": "application/json"`,
      `  },`,
      `  body: JSON.stringify({ input: "your input" })`,
      `});`,
      `const { executionId, output, latencyMs, cost } = await res.json();`,
    ].join("\n")
    navigator.clipboard.writeText(snippet)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
    toast.success("Copied!")
  }

  // Guardrail summary from security_config
  const guardrails = agent.security_config
  const guardrailBadge = guardrails
    ? (guardrails.strictMode || guardrails.blockPII)
      ? { label: "Maximum security", color: "bg-green-50 text-green-700 border-green-200", icon: ShieldCheck }
      : (guardrails.blockHarmful)
      ? { label: "Standard security", color: "bg-blue-50 text-blue-700 border-blue-200",   icon: ShieldCheck }
      : { label: "Basic security",    color: "bg-zinc-50 text-zinc-500 border-zinc-200",   icon: Shield }
    : null

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/marketplace">
            <Button variant="ghost" size="sm"
              className="mb-6 text-zinc-500 hover:text-zinc-900 gap-1.5 -ml-2 rounded-xl">
              <ArrowLeft className="h-4 w-4" /> Back to Marketplace
            </Button>
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* ── Main column ─────────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                    <CategoryIcon category={agent.category} colored className="h-8 w-8" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h1 className="text-2xl font-bold text-zinc-900">{agent.name}</h1>
                      {agent.is_verified && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">
                          <CheckCircle className="h-3 w-3" /> Verified
                        </span>
                      )}
                      {agent.is_featured && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded-full">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Featured
                        </span>
                      )}
                      <GradeBadge score={agent.composite_score} />
                      {guardrailBadge && (
                        <span className={cn("flex items-center gap-1 text-xs font-semibold border px-2 py-0.5 rounded-full", guardrailBadge.color)}>
                          <guardrailBadge.icon className="h-3 w-3" /> {guardrailBadge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-500 text-sm">{agent.description}</p>
                    <div className="flex items-center gap-4 mt-3 flex-wrap text-sm">
                      <span className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-bold text-zinc-900 nums">{agent.average_rating?.toFixed(1) || "—"}</span>
                        <span className="text-zinc-400 nums">({formatNumber(agent.total_reviews)})</span>
                      </span>
                      <span className="flex items-center gap-1 text-zinc-400 nums">
                        <Zap className="h-4 w-4" /> {formatNumber(agent.total_executions)} runs
                      </span>
                      <span className="flex items-center gap-1 text-zinc-400 nums">
                        <Clock className="h-4 w-4" /> ~{agent.average_latency_ms}ms avg
                      </span>
                      <span className="flex items-center gap-1 text-xs font-medium bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                        <CategoryIcon category={agent.category} className="h-3 w-3" />
                        {categoryLabel(agent.category)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>

              <Tabs defaultValue="playground">
                <TabsList className="bg-zinc-50 border border-zinc-100 p-1 rounded-xl flex-wrap h-auto gap-1">
                  <TabsTrigger value="playground" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <Play className="h-3.5 w-3.5" /> Playground
                  </TabsTrigger>
                  <TabsTrigger value="schema" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <Code2 className="h-3.5 w-3.5" /> Schema
                  </TabsTrigger>
                  <TabsTrigger value="docs" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" /> Docs
                  </TabsTrigger>
                  <TabsTrigger value="api" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <Code2 className="h-3.5 w-3.5" /> API
                  </TabsTrigger>
                  <TabsTrigger value="reviews" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Reviews ({formatNumber(agent.total_reviews)})
                  </TabsTrigger>
                </TabsList>

                {/* ── Playground ────────────────────────────────────── */}
                <TabsContent value="playground" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Input</label>
                      <Textarea value={testInput} onChange={e => setTestInput(e.target.value)}
                        className="font-mono text-xs h-48 resize-none rounded-xl border-zinc-200"
                        placeholder={'{"input": "Your input here"}'}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Output</label>
                      <div className={cn("h-48 rounded-xl border border-zinc-100 bg-zinc-50 p-3 font-mono text-xs overflow-auto whitespace-pre-wrap text-zinc-500",
                        testing && "animate-pulse")}>
                        {testing ? "Running…" : testOutput || "Output will appear here…"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={handleTest} disabled={testing}
                      className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {testing ? "Running…" : "Run Agent"}
                    </Button>
                    {!user && (
                      <p className="text-xs text-zinc-400">
                        <Link href="/login" className="text-primary hover:underline">Sign in</Link> to test this agent
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Schema (NEW) ──────────────────────────────────── */}
                <TabsContent value="schema" className="mt-4 space-y-5">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
                      Input / Output Contract
                    </p>
                    <div className="space-y-4">
                      {/* Input schema */}
                      {agent.input_schema && Object.keys(agent.input_schema).length > 0 ? (
                        <SchemaBlock title="Input Schema" schema={agent.input_schema} />
                      ) : (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Default Input</p>
                          <div className="bg-white border border-zinc-100 rounded-xl p-3 font-mono text-xs text-zinc-500">
                            {`{ "input": "string" }`}
                          </div>
                          <p className="text-[11px] text-zinc-400">Pass any string or JSON object as <code className="font-mono">input</code>.</p>
                        </div>
                      )}
                      {/* Output schema */}
                      {agent.output_schema && Object.keys(agent.output_schema).length > 0 ? (
                        <SchemaBlock title="Output Schema" schema={agent.output_schema} />
                      ) : (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Default Output</p>
                          <div className="bg-white border border-zinc-100 rounded-xl p-3 font-mono text-xs text-zinc-500">
                            {`{ "output": "string" }`}
                          </div>
                          <p className="text-[11px] text-zinc-400">Returns the agent's response as a plain string.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Capability tags */}
                  {agent.capability_tags?.length > 0 && (
                    <div className="bg-white border border-zinc-100 rounded-2xl p-5">
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Capability Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {agent.capability_tags.map((tag: string) => (
                          <span key={tag} className="text-[11px] font-mono bg-zinc-50 border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pipeline compatibility hint */}
                  <div className="bg-primary/[0.03] border border-primary/20 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-zinc-700 mb-1 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-primary" /> Pipeline compatibility
                    </p>
                    <p className="text-xs text-zinc-500 mb-2">
                      Input types: <strong>{(agent.input_types ?? ["text"]).join(", ")}</strong> ·
                      Output types: <strong>{(agent.output_types ?? ["text"]).join(", ")}</strong>
                    </p>
                    <p className="text-xs text-zinc-400">
                      Connect this agent in a pipeline — its output becomes the next agent's input automatically.
                    </p>
                  </div>
                </TabsContent>

                {/* ── Docs ──────────────────────────────────────────── */}
                <TabsContent value="docs" className="mt-4">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5 text-sm text-zinc-600 leading-relaxed min-h-32">
                    {agent.documentation ? (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-600">
                        {agent.documentation}
                      </pre>
                    ) : (
                      <p className="text-zinc-400">No documentation provided for this agent yet.</p>
                    )}
                  </div>
                </TabsContent>

                {/* ── API ───────────────────────────────────────────── */}
                <TabsContent value="api" className="mt-4 space-y-4">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">TypeScript / JavaScript</span>
                      <button onClick={copySnippet}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors">
                        {copied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-zinc-500 overflow-auto leading-relaxed">{
                      `const res = await fetch("https://agentdyne.com/api/agents/${agent.id}/execute", {\n` +
                      `  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json"\n  },\n` +
                      `  body: JSON.stringify({ input: "your input" })\n});\n` +
                      `const { executionId, output, latencyMs, cost } = await res.json();`
                    }</pre>
                  </div>

                  {/* Pipeline integration hint */}
                  <div className="bg-primary/[0.03] border border-primary/20 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-zinc-700 mb-1 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-primary" /> Use in a multi-agent pipeline
                    </p>
                    <p className="text-xs text-zinc-500 mb-3">
                      Chain this agent with others to build automated workflows.
                    </p>
                    <button onClick={handleAddToPipeline}
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                      Add to Pipeline →
                    </button>
                  </div>
                </TabsContent>

                {/* ── Reviews ───────────────────────────────────────── */}
                <TabsContent value="reviews" className="mt-4 space-y-3">
                  {reviews.length === 0 ? (
                    <div className="text-center py-10 text-zinc-400 text-sm">No reviews yet. Execute this agent and be the first to review!</div>
                  ) : reviews.map(r => (
                    <div key={r.id} className="bg-white border border-zinc-100 rounded-2xl p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          <AvatarImage src={r.profiles?.avatar_url} />
                          <AvatarFallback className="text-xs bg-primary text-white">
                            {getInitials(r.profiles?.full_name || "A")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-semibold text-zinc-900">{r.profiles?.full_name || "Anonymous"}</span>
                            <span className="text-xs text-zinc-400 flex-shrink-0">{formatDate(r.created_at)}</span>
                          </div>
                          <div className="flex gap-0.5 mb-2">
                            {[...Array(Math.min(5, Math.max(1, r.rating)))].map((_, i) => (
                              <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            ))}
                          </div>
                          {r.title && <p className="text-sm font-medium text-zinc-900 mb-1">{r.title}</p>}
                          {r.body  && <p className="text-sm text-zinc-500 leading-relaxed">{r.body}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </div>

            {/* ── Sidebar ─────────────────────────────────────────────── */}
            <div className="space-y-4">
              {/* Pricing / CTA card */}
              <div className="bg-white border border-zinc-100 rounded-2xl p-5 sticky top-20"
                style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <div className="text-center mb-5">
                  {agent.pricing_model === "free" && (
                    <><div className="text-3xl font-black text-zinc-900">Free</div><div className="text-xs text-zinc-400 mt-1">Always free</div></>
                  )}
                  {agent.pricing_model === "per_call" && (
                    <><div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.price_per_call)}</div><div className="text-xs text-zinc-400 mt-1">per call</div></>
                  )}
                  {agent.pricing_model === "subscription" && (
                    <><div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.subscription_price_monthly)}</div><div className="text-xs text-zinc-400 mt-1">/month</div></>
                  )}
                  {agent.pricing_model === "freemium" && (
                    <><div className="text-3xl font-black text-zinc-900">Free</div><div className="text-xs text-zinc-400 mt-1">then {formatCurrency(agent.price_per_call)}/call</div></>
                  )}
                </div>

                <Button className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold mb-2"
                  onClick={() => user ? handleTest() : router.push("/signup")}>
                  {user ? <><Play className="h-4 w-4 mr-2" /> Try it now</> : "Sign up to use"}
                </Button>

                <Button variant="outline" className="w-full rounded-xl border-zinc-200 font-semibold text-zinc-700 gap-2 mb-2"
                  onClick={handleAddToPipeline}>
                  <Layers className="h-4 w-4" /> Use in Pipeline
                </Button>

                {/* Fork / Clone */}
                <Button variant="ghost" className="w-full rounded-xl text-zinc-500 hover:text-zinc-900 font-semibold gap-2 text-sm"
                  onClick={handleFork} disabled={forking}>
                  {forking ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitFork className="h-4 w-4" />}
                  {forking ? "Forking…" : "Fork this agent"}
                </Button>

                {agent.free_calls_per_month > 0 && (
                  <p className="text-center text-xs text-zinc-400 mt-2">{agent.free_calls_per_month} free calls/month included</p>
                )}

                <div className="mt-5 space-y-2.5 pt-4 border-t border-zinc-50">
                  {([
                    { icon: Globe,      label: "Model",        value: agent.model_name?.replace("claude-", "Claude ") ?? "—" },
                    { icon: Clock,      label: "Avg latency",  value: `~${agent.average_latency_ms || 0}ms` },
                    { icon: TrendingUp, label: "Success rate",
                      value: (agent.total_executions ?? 0) > 0
                        ? `${Math.round(((agent.successful_executions ?? 0) / (agent.total_executions ?? 1)) * 100)}%`
                        : "—" },
                    { icon: Tag,        label: "Version",      value: agent.version ?? "1.0.0" },
                  ] as const).map(item => (
                    <div key={item.label} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-zinc-400"><item.icon className="h-3.5 w-3.5" />{item.label}</span>
                      <span className="font-medium text-zinc-700 nums">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Seller card */}
              <div className="bg-white border border-zinc-100 rounded-2xl p-5">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">About the Builder</h3>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={seller?.avatar_url} />
                    <AvatarFallback className="bg-primary text-white">{getInitials(seller?.full_name || "A")}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-zinc-900 text-sm">{seller?.full_name ?? "Anonymous"}</span>
                      {seller?.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                    </div>
                    <span className="text-xs text-zinc-400 nums">{formatCurrency(seller?.total_earned || 0)} earned</span>
                  </div>
                </div>
                {seller?.bio && <p className="text-xs text-zinc-500 mt-3 leading-relaxed">{seller.bio}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
