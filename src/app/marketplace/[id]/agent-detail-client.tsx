"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  Star, Zap, CheckCircle, Play, Code2, BookOpen, MessageSquare,
  Tag, Globe, Clock, TrendingUp, ArrowLeft, Copy, Check, Loader2,
  Layers, Sparkles, BarChart3, Users,
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

// ── Sample data by category — enables "Try with sample data" ─────────────────
const SAMPLE_DATA: Record<string, { label: string; json: string }> = {
  customer_support: {
    label: "Customer complaint",
    json:  JSON.stringify({ input: "My order #87234 hasn't arrived after 2 weeks. The tracking page just says 'In Transit'. I need this urgently for a birthday event this weekend. Please help." }, null, 2),
  },
  coding: {
    label: "Code review request",
    json:  JSON.stringify({ input: "Review this Python function for bugs:\n\ndef calculate_discount(price, discount_pct):\n    return price - (price * discount_pct)\n\nprint(calculate_discount(100, 20))" }, null, 2),
  },
  marketing: {
    label: "Social media post request",
    json:  JSON.stringify({ input: "Write a LinkedIn post announcing our new AI-powered analytics dashboard. Target audience: B2B SaaS founders. Tone: professional but approachable. Include a call to action." }, null, 2),
  },
  finance: {
    label: "Financial analysis request",
    json:  JSON.stringify({ input: "Analyze this P&L data: Revenue Q1=$2.1M, Q2=$2.4M, Q3=$2.2M, Q4=$3.1M. COGS: 40% of revenue. Operating expenses: $800K/quarter. Provide key insights and trends." }, null, 2),
  },
  legal: {
    label: "Contract clause review",
    json:  JSON.stringify({ input: "Review this NDA clause: 'The receiving party agrees to keep all disclosed information confidential for a period of 2 years from the date of disclosure, with the exception of information that becomes publicly available through no fault of the receiving party.' Identify any risks." }, null, 2),
  },
  data_analysis: {
    label: "Dataset analysis request",
    json:  JSON.stringify({ input: "Analyze this sales data: Jan=142, Feb=156, Mar=198, Apr=187, May=203, Jun=245. Identify the trend, calculate MoM growth rates, and forecast Jul-Sep assuming current trend continues." }, null, 2),
  },
  content: {
    label: "Blog post request",
    json:  JSON.stringify({ input: "Write a 500-word blog post intro about 'Why microagents are the future of AI automation'. Target audience: startup CTOs. Include a compelling hook, 3 key points, and a CTA." }, null, 2),
  },
  research: {
    label: "Research question",
    json:  JSON.stringify({ input: "Research the current state of autonomous AI agents in 2024-2025. Focus on: key capabilities, main limitations, leading companies, and the 3 most significant recent breakthroughs." }, null, 2),
  },
  hr: {
    label: "Job description request",
    json:  JSON.stringify({ input: "Write a job description for a Senior AI Engineer at a Series B startup. Requirements: 5+ years ML experience, Python, LLM fine-tuning. Salary: $180-220K. Remote-first culture. Include responsibilities, requirements, and a compelling intro." }, null, 2),
  },
  sales: {
    label: "Outreach email request",
    json:  JSON.stringify({ input: "Write a personalized cold outreach email to the VP of Engineering at a fintech company. Our product is an AI code review tool. They recently announced a 50-person engineering hire spree. Keep it under 100 words." }, null, 2),
  },
  devops: {
    label: "Incident analysis",
    json:  JSON.stringify({ input: "Analyze this production incident: Service went down at 14:32 UTC. Error logs show 'connection pool exhausted' repeated 847 times. Database CPU hit 98%. Load balancer showed 3x normal traffic spike. Service recovered after 23 minutes when traffic normalized. Write a root cause analysis and prevention recommendations." }, null, 2),
  },
  security: {
    label: "Security audit request",
    json:  JSON.stringify({ input: "Review this authentication code for security vulnerabilities:\n\ndef login(username, password):\n    query = f\"SELECT * FROM users WHERE username='{username}' AND password='{password}'\"\n    result = db.execute(query)\n    if result:\n        return create_session(result[0]['id'])" }, null, 2),
  },
  productivity: {
    label: "Email triage request",
    json:  JSON.stringify({ input: "Triage this email inbox summary and prioritize:\n1. Meeting invite from CEO for tomorrow 9am (budget review)\n2. Marketing campaign proposal needs approval by EOD\n3. Support ticket: enterprise client can't login (3 hours unresolved)\n4. Vendor invoice for $45,000 due in 30 days\n5. Team lunch poll for next Friday" }, null, 2),
  },
  _default: {
    label: "Sample input",
    json:  JSON.stringify({ input: "Hello! Can you show me what you can do? Please give me a brief demonstration of your capabilities." }, null, 2),
  },
}

function getSampleData(category: string) {
  return SAMPLE_DATA[category] ?? SAMPLE_DATA["_default"]!
}

// ── Grade badge ────────────────────────────────────────────────────────────────
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
      title={`Composite quality score: ${score.toFixed(1)}/100`}>
      {grade}
    </span>
  )
}

// ── Network effects: "Used in X pipelines" widget ─────────────────────────────
function PipelineUsageWidget({ agentId, agentName }: { agentId: string; agentName: string }) {
  const router = useRouter()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    // Query agent_pipeline_usage or pipelines table for usage count
    // This is a lightweight fetch — fails silently
    fetch(`/api/agents/${agentId}/pipeline-usage`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.count != null) setCount(d.count) })
      .catch(() => {})
  }, [agentId])

  if (count === null || count === 0) return null

  return (
    <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
        <Layers className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-zinc-900">
          Used in <span className="text-primary">{formatNumber(count)}</span> pipeline{count !== 1 ? "s" : ""}
        </p>
        <p className="text-[11px] text-zinc-400">
          "{agentName}" is a popular pipeline step
        </p>
      </div>
      <button
        onClick={() => router.push(`/pipelines?add_agent=${agentId}&agent_name=${encodeURIComponent(agentName)}`)}
        className="text-xs font-semibold text-primary hover:underline flex-shrink-0">
        Add →
      </button>
    </div>
  )
}

export function AgentDetailClient({ agent, reviews, user, userSubscription }: Props) {
  const router = useRouter()
  const sampleData = getSampleData(agent.category)

  const [testInput,  setTestInput]  = useState(JSON.stringify({ input: "Hello! What can you do?" }, null, 2))
  const [testOutput, setTestOutput] = useState("")
  const [testing,    setTesting]    = useState(false)
  const [copied,     setCopied]     = useState(false)
  const [traceInfo,  setTraceInfo]  = useState<{ latencyMs: number; cost: number; tokens?: { input: number; output: number } } | null>(null)
  const seller = agent.profiles

  const handleTest = async (inputOverride?: string) => {
    if (!user) { router.push("/login"); return }
    setTesting(true)
    setTestOutput("")
    setTraceInfo(null)
    try {
      const inputToSend = inputOverride ?? testInput
      if (inputOverride) setTestInput(inputOverride)

      let parsedInput: unknown
      try { parsedInput = JSON.parse(inputToSend) } catch { parsedInput = inputToSend }

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
      setTraceInfo({ latencyMs: data.latencyMs, cost: data.cost ?? 0, tokens: data.tokens })
      toast.success(`Done in ${data.latencyMs}ms · $${(data.cost ?? 0).toFixed(5)}`)
    } catch (err: any) {
      toast.error(err.message)
      setTestOutput(`Error: ${err.message}`)
    } finally { setTesting(false) }
  }

  const handleTrySample = () => {
    handleTest(sampleData.json)
    toast(`Loading sample: "${sampleData.label}"`, { icon: "🧪" })
  }

  const handleAddToPipeline = () => {
    if (!user) { router.push("/login"); return }
    router.push(`/pipelines?add_agent=${agent.id}&agent_name=${encodeURIComponent(agent.name)}`)
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
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success("Copied!")
  }

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
            {/* ── Main column ──────────────────────────────────────────────── */}
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
                        <Clock className="h-4 w-4" /> ~{agent.average_latency_ms || 0}ms avg
                      </span>
                      <span className="flex items-center gap-1 text-xs font-medium bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                        <CategoryIcon category={agent.category} className="h-3 w-3" />
                        {categoryLabel(agent.category)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Network effects widget */}
              <PipelineUsageWidget agentId={agent.id} agentName={agent.name} />

              <Tabs defaultValue="playground">
                <TabsList className="bg-zinc-50 border border-zinc-100 p-1 rounded-xl">
                  <TabsTrigger value="playground"
                    className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <Play className="h-3.5 w-3.5" /> Playground
                  </TabsTrigger>
                  <TabsTrigger value="docs"
                    className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" /> Docs
                  </TabsTrigger>
                  <TabsTrigger value="api"
                    className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <Code2 className="h-3.5 w-3.5" /> API
                  </TabsTrigger>
                  <TabsTrigger value="reviews"
                    className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Reviews ({formatNumber(agent.total_reviews)})
                  </TabsTrigger>
                </TabsList>

                {/* ── Playground ─────────────────────────────────────────── */}
                <TabsContent value="playground" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Input</label>
                        {/* "Try with sample data" button — the #1 missing feature */}
                        <button
                          onClick={handleTrySample}
                          disabled={testing || !user}
                          className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary/80 bg-primary/8 px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          <Sparkles className="h-3 w-3" />
                          Try sample: {sampleData.label}
                        </button>
                      </div>
                      <Textarea
                        value={testInput}
                        onChange={e => setTestInput(e.target.value)}
                        className="font-mono text-xs h-48 resize-none rounded-xl border-zinc-200"
                        placeholder={'{"input": "Your input here"}'}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Output</label>
                      <div className={cn(
                        "h-48 rounded-xl border border-zinc-100 bg-zinc-50 p-3 font-mono text-xs overflow-auto whitespace-pre-wrap text-zinc-500",
                        testing && "animate-pulse"
                      )}>
                        {testing ? "Running…" : testOutput || "Output will appear here…"}
                      </div>
                    </div>
                  </div>

                  {/* Trace info */}
                  {traceInfo && (
                    <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-2.5 flex items-center gap-4 text-xs text-zinc-500">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {traceInfo.latencyMs}ms</span>
                      {traceInfo.tokens && (
                        <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> {traceInfo.tokens.input}↑ {traceInfo.tokens.output}↓ tokens</span>
                      )}
                      <span className="flex items-center gap-1 nums">💰 ${traceInfo.cost.toFixed(6)}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      onClick={() => handleTest()}
                      disabled={testing}
                      className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                      {testing
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Play className="h-4 w-4" />}
                      {testing ? "Running…" : "Run Agent"}
                    </Button>
                    {!user && (
                      <p className="text-xs text-zinc-400">
                        <Link href="/login" className="text-primary hover:underline">Sign in</Link> to test this agent
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Docs ───────────────────────────────────────────────── */}
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

                {/* ── API ────────────────────────────────────────────────── */}
                <TabsContent value="api" className="mt-4 space-y-4">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">TypeScript / JavaScript</span>
                      <button onClick={copySnippet}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors">
                        {copied
                          ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied!</>
                          : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-zinc-500 overflow-auto leading-relaxed">{
                      `const res = await fetch("https://agentdyne.com/api/agents/${agent.id}/execute", {\n` +
                      `  method: "POST",\n` +
                      `  headers: {\n` +
                      `    "Authorization": "Bearer YOUR_API_KEY",\n` +
                      `    "Content-Type": "application/json"\n` +
                      `  },\n` +
                      `  body: JSON.stringify({ input: "your input" })\n` +
                      `});\n` +
                      `const { executionId, output, latencyMs, cost } = await res.json();`
                    }</pre>
                  </div>

                  {agent.capability_tags?.length > 0 && (
                    <div className="bg-white border border-zinc-100 rounded-2xl p-4">
                      <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2">Capability Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {agent.capability_tags.map((tag: string) => (
                          <span key={tag} className="text-[11px] font-mono bg-zinc-50 border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pipeline integration hint */}
                  <div className="bg-primary/[0.03] border border-primary/20 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-zinc-700 mb-1 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-primary" /> Use in a multi-agent pipeline
                    </p>
                    <p className="text-xs text-zinc-500 mb-3">
                      Chain this agent with others to build automated workflows. Output of each agent becomes the input to the next.
                    </p>
                    <button onClick={handleAddToPipeline}
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                      Add to Pipeline →
                    </button>
                  </div>
                </TabsContent>

                {/* ── Reviews ────────────────────────────────────────────── */}
                <TabsContent value="reviews" className="mt-4 space-y-3">
                  {reviews.length === 0 ? (
                    <div className="text-center py-10 text-zinc-400 text-sm">
                      No reviews yet. Execute this agent and be the first to review!
                    </div>
                  ) : (
                    reviews.map(r => (
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
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </div>

            {/* ── Sidebar ──────────────────────────────────────────────────── */}
            <div className="space-y-4">
              {/* Pricing / CTA card */}
              <div className="bg-white border border-zinc-100 rounded-2xl p-5 sticky top-20"
                style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <div className="text-center mb-5">
                  {agent.pricing_model === "free" && (
                    <><div className="text-3xl font-black text-zinc-900">Free</div>
                    <div className="text-xs text-zinc-400 mt-1">Always free</div></>
                  )}
                  {agent.pricing_model === "per_call" && (
                    <><div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.price_per_call)}</div>
                    <div className="text-xs text-zinc-400 mt-1">per call</div></>
                  )}
                  {agent.pricing_model === "subscription" && (
                    <><div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.subscription_price_monthly)}</div>
                    <div className="text-xs text-zinc-400 mt-1">/month</div></>
                  )}
                  {agent.pricing_model === "freemium" && (
                    <><div className="text-3xl font-black text-zinc-900">Free</div>
                    <div className="text-xs text-zinc-400 mt-1">then {formatCurrency(agent.price_per_call)}/call</div></>
                  )}
                </div>

                {/* Primary CTA */}
                <Button
                  className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold mb-2"
                  onClick={() => user ? handleTest() : router.push("/signup")}>
                  {user ? <><Play className="h-4 w-4 mr-2" /> Try it now</> : "Sign up to use"}
                </Button>

                {/* Try with sample data — one-click value */}
                {user && (
                  <Button
                    variant="outline"
                    className="w-full rounded-xl border-primary/30 text-primary hover:bg-primary/5 font-semibold gap-2 mb-2"
                    onClick={handleTrySample}
                    disabled={testing}>
                    <Sparkles className="h-4 w-4" />
                    {testing ? "Running sample…" : `Try: ${sampleData.label}`}
                  </Button>
                )}

                {/* Secondary: Use in Pipeline */}
                <Button
                  variant="outline"
                  className="w-full rounded-xl border-zinc-200 font-semibold text-zinc-700 gap-2"
                  onClick={handleAddToPipeline}>
                  <Layers className="h-4 w-4" /> Use in Pipeline
                </Button>

                {agent.free_calls_per_month > 0 && (
                  <p className="text-center text-xs text-zinc-400 mt-2">
                    {agent.free_calls_per_month} free calls/month included
                  </p>
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
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <item.icon className="h-3.5 w-3.5" />{item.label}
                      </span>
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
                    <AvatarFallback className="bg-primary text-white">
                      {getInitials(seller?.full_name || "A")}
                    </AvatarFallback>
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
