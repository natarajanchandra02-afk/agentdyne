"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { Star, Zap, CheckCircle, Play, Code2, BookOpen, MessageSquare, Tag, Globe, Clock, TrendingUp, ArrowLeft, Copy, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { formatNumber, formatCurrency, formatDate, getInitials, categoryLabel, CATEGORY_ICONS } from "@/lib/utils"
import toast from "react-hot-toast"

interface Props {
  agent: any; reviews: any[]; user: any; userSubscription: any
}

export function AgentDetailClient({ agent, reviews, user, userSubscription }: Props) {
  const router = useRouter()
  const [testInput,  setTestInput]  = useState('{"input": "Hello! What can you do?"}')
  const [testOutput, setTestOutput] = useState("")
  const [testing,    setTesting]    = useState(false)
  const [copied,     setCopied]     = useState(false)
  const seller = agent.profiles

  const handleTest = async () => {
    if (!user) { router.push("/login"); return }
    setTesting(true)
    try {
      const res  = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, input: JSON.parse(testInput) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTestOutput(JSON.stringify(data.output, null, 2))
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setTesting(false) }
  }

  const copySnippet = () => {
    navigator.clipboard.writeText(
`const res = await fetch("https://api.agentdyne.com/v1/agents/${agent.id}/execute", {
  method: "POST",
  headers: { "Authorization": "Bearer YOUR_API_KEY", "Content-Type": "application/json" },
  body: JSON.stringify({ input: ${testInput} })
});
const data = await res.json();`
    )
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
            <Button variant="ghost" size="sm" className="mb-6 text-zinc-500 hover:text-zinc-900 gap-1.5 -ml-2 rounded-xl">
              <ArrowLeft className="h-4 w-4" /> Back to Marketplace
            </Button>
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main */}
            <div className="lg:col-span-2 space-y-6">
              {/* Header */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center text-3xl flex-shrink-0">
                    {CATEGORY_ICONS[agent.category] || "🤖"}
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
                        <span className="text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded-full">
                          ⭐ Featured
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-500 text-sm">{agent.description}</p>
                    <div className="flex items-center gap-4 mt-3 flex-wrap text-sm">
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-bold text-zinc-900 nums">{agent.average_rating?.toFixed(1) || "—"}</span>
                        <span className="text-zinc-400 nums">({formatNumber(agent.total_reviews)})</span>
                      </div>
                      <div className="flex items-center gap-1 text-zinc-400 nums">
                        <Zap className="h-4 w-4" /> {formatNumber(agent.total_executions)} runs
                      </div>
                      <div className="flex items-center gap-1 text-zinc-400 nums">
                        <Clock className="h-4 w-4" /> ~{agent.average_latency_ms}ms avg
                      </div>
                      <span className="text-xs font-medium bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                        {CATEGORY_ICONS[agent.category]} {categoryLabel(agent.category)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Tabs */}
              <Tabs defaultValue="playground">
                <TabsList className="bg-zinc-50 border border-zinc-100 p-1 rounded-xl">
                  <TabsTrigger value="playground"  className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5"><Play className="h-3.5 w-3.5" />Playground</TabsTrigger>
                  <TabsTrigger value="docs"        className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5"><BookOpen className="h-3.5 w-3.5" />Docs</TabsTrigger>
                  <TabsTrigger value="api"         className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5"><Code2 className="h-3.5 w-3.5" />API</TabsTrigger>
                  <TabsTrigger value="reviews"     className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Reviews</TabsTrigger>
                </TabsList>

                {/* Playground */}
                <TabsContent value="playground" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Input (JSON)</label>
                      <Textarea value={testInput} onChange={e => setTestInput(e.target.value)}
                        className="font-mono text-xs h-48 resize-none rounded-xl border-zinc-200" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Output</label>
                      <div className={`h-48 rounded-xl border border-zinc-100 bg-zinc-50 p-3 font-mono text-xs overflow-auto whitespace-pre-wrap text-zinc-500 transition-all ${testing ? "animate-pulse" : ""}`}>
                        {testing ? "Running…" : testOutput || "Output will appear here…"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={handleTest} disabled={testing}
                      className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                      {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {testing ? "Running…" : "Run Agent"}
                    </Button>
                    {!user && <p className="text-xs text-zinc-400">Sign in to test this agent</p>}
                  </div>
                </TabsContent>

                {/* Docs */}
                <TabsContent value="docs" className="mt-4">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5 text-sm text-zinc-600 leading-relaxed">
                    {agent.documentation
                      ? <div dangerouslySetInnerHTML={{ __html: agent.documentation }} />
                      : <p className="text-zinc-400">No documentation provided yet.</p>
                    }
                  </div>
                </TabsContent>

                {/* API */}
                <TabsContent value="api" className="mt-4 space-y-4">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Quick Integration</span>
                      <button onClick={copySnippet}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors">
                        {copied ? <><Check className="h-3.5 w-3.5 text-green-500" />Copied!</> : <><Copy className="h-3.5 w-3.5" />Copy</>}
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-zinc-500 overflow-auto">{`const res = await fetch("https://api.agentdyne.com/v1/agents/${agent.id}/execute", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ input: "your input" })
});
const data = await res.json();`}</pre>
                  </div>
                </TabsContent>

                {/* Reviews */}
                <TabsContent value="reviews" className="mt-4 space-y-3">
                  {reviews.length === 0
                    ? <p className="text-zinc-400 text-sm">No reviews yet. Be the first!</p>
                    : reviews.map(r => (
                        <div key={r.id} className="bg-white border border-zinc-100 rounded-2xl p-4">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarImage src={r.profiles?.avatar_url} />
                              <AvatarFallback className="text-xs bg-primary text-white">
                                {getInitials(r.profiles?.full_name || "A")}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-zinc-900">{r.profiles?.full_name || "Anonymous"}</span>
                                <span className="text-xs text-zinc-400">{formatDate(r.created_at)}</span>
                              </div>
                              <div className="flex gap-0.5 my-1.5">
                                {[...Array(r.rating)].map((_, i) => <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />)}
                              </div>
                              {r.title && <p className="text-sm font-medium text-zinc-900 mb-1">{r.title}</p>}
                              <p className="text-sm text-zinc-500 leading-relaxed">{r.body}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                </TabsContent>
              </Tabs>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Pricing card */}
              <div className="bg-white border border-zinc-100 rounded-2xl p-5 sticky top-20" style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <div className="text-center mb-5">
                  {agent.pricing_model === "free" && <div className="text-3xl font-black text-zinc-900">Free</div>}
                  {agent.pricing_model === "per_call" && <>
                    <div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.price_per_call)}</div>
                    <div className="text-xs text-zinc-400 mt-1">per call</div>
                  </>}
                  {agent.pricing_model === "subscription" && <>
                    <div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.subscription_price_monthly)}</div>
                    <div className="text-xs text-zinc-400 mt-1">/month</div>
                  </>}
                  {agent.pricing_model === "freemium" && <>
                    <div className="text-3xl font-black text-zinc-900">Free</div>
                    <div className="text-xs text-zinc-400 mt-1">then {formatCurrency(agent.price_per_call)}/call</div>
                  </>}
                </div>
                <Button
                  className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold"
                  onClick={() => user ? handleTest() : router.push("/signup")}
                >
                  {user ? <><Play className="h-4 w-4 mr-2" />Try it now</> : "Sign up to use"}
                </Button>
                {agent.free_calls_per_month > 0 && (
                  <p className="text-center text-xs text-zinc-400 mt-2">{agent.free_calls_per_month} free calls/month</p>
                )}

                <div className="mt-5 space-y-2.5">
                  {[
                    { icon: Globe,       label: "Provider",    value: agent.model_provider },
                    { icon: Zap,         label: "Model",       value: agent.model_name?.replace("claude-", "Claude ") },
                    { icon: Clock,       label: "Avg latency", value: `~${agent.average_latency_ms}ms` },
                    { icon: TrendingUp,  label: "Success rate", value: agent.total_executions > 0 ? `${Math.round((agent.successful_executions / agent.total_executions) * 100)}%` : "—" },
                    { icon: Tag,         label: "Version",     value: agent.version },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-zinc-400"><item.icon className="h-3.5 w-3.5" />{item.label}</div>
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
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-zinc-900 text-sm">{seller?.full_name}</span>
                      {seller?.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500" />}
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
