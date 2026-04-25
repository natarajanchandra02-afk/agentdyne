"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion, AnimatePresence }                  from "framer-motion"
import {
  Star, Zap, CheckCircle, Play, Code2, BookOpen, MessageSquare,
  Tag, Globe, Clock, TrendingUp, ArrowLeft, Copy, Check, Loader2,
  Layers, Sparkles, BarChart3, Flag, FolderPlus,
  AlertTriangle, ChevronDown, Send, X,
} from "lucide-react"
import { Button }                                    from "@/components/ui/button"
import { SlidingTabs }                               from "@/components/ui/sliding-tabs"
import { Avatar, AvatarFallback, AvatarImage }       from "@/components/ui/avatar"
import { Textarea }                                  from "@/components/ui/textarea"
import { Navbar }                                    from "@/components/layout/navbar"
import { Footer }                                    from "@/components/layout/footer"
import { CategoryIcon } from "@/components/ui/category-icon"
import { formatNumber, formatCurrency, formatDate, getInitials, categoryLabel, cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

interface Props {
  agent:           any
  reviews:         any[]
  user:            any
  userSubscription: any
  isOwner:         boolean   // Bug 10: passed from page
}

// ── Sample data by category ───────────────────────────────────────────────────
const SAMPLE_DATA: Record<string, { label: string; json: string }> = {
  customer_support: { label: "Customer complaint",       json: JSON.stringify({ input: "My order #87234 hasn't arrived after 2 weeks. The tracking page just says 'In Transit'. I need this urgently for a birthday event this weekend. Please help." }, null, 2) },
  coding:           { label: "Code review request",      json: JSON.stringify({ input: "Review this Python function for bugs:\n\ndef calculate_discount(price, discount_pct):\n    return price - (price * discount_pct)\n\nprint(calculate_discount(100, 20))" }, null, 2) },
  marketing:        { label: "Social media post",        json: JSON.stringify({ input: "Write a LinkedIn post announcing our new AI-powered analytics dashboard. Target: B2B SaaS founders. Tone: professional but approachable. Include a CTA." }, null, 2) },
  finance:          { label: "P&L analysis",             json: JSON.stringify({ input: "Analyze: Revenue Q1=$2.1M, Q2=$2.4M, Q3=$2.2M, Q4=$3.1M. COGS: 40% of revenue. OpEx: $800K/quarter. Provide key insights." }, null, 2) },
  legal:            { label: "Contract clause review",   json: JSON.stringify({ input: "Review this NDA clause: 'The receiving party agrees to keep all disclosed information confidential for 2 years from disclosure.' Identify risks." }, null, 2) },
  data_analysis:    { label: "Sales trend analysis",     json: JSON.stringify({ input: "Analyze: Jan=142, Feb=156, Mar=198, Apr=187, May=203, Jun=245. Identify trend, calculate MoM growth, forecast Jul-Sep." }, null, 2) },
  content:          { label: "Blog post request",        json: JSON.stringify({ input: "Write a 500-word blog post intro about 'Why microagents are the future of AI automation'. Target audience: startup CTOs." }, null, 2) },
  research:         { label: "Research question",        json: JSON.stringify({ input: "Research the current state of autonomous AI agents in 2025. Focus on key capabilities, limitations, and 3 most significant breakthroughs." }, null, 2) },
  security:         { label: "Security audit",           json: JSON.stringify({ input: "Review for security vulnerabilities:\n\ndef login(username, password):\n    query = f\"SELECT * FROM users WHERE username='{username}' AND password='{password}'\"\n    result = db.execute(query)\n    if result: return create_session(result[0]['id'])" }, null, 2) },
  _default:         { label: "Sample input",             json: JSON.stringify({ input: "Hello! Can you show me what you can do? Please give me a brief demonstration of your capabilities." }, null, 2) },
}
const getSampleData = (cat: string) => SAMPLE_DATA[cat] ?? SAMPLE_DATA["_default"]!

// ── Grade badge ───────────────────────────────────────────────────────────────
function GradeBadge({ score }: { score?: number }) {
  if (!score || score <= 0) return null
  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D"
  const color = { S: "bg-violet-50 text-violet-700 border-violet-200", A: "bg-green-50 text-green-700 border-green-200", B: "bg-blue-50 text-blue-700 border-blue-200", C: "bg-amber-50 text-amber-700 border-amber-200", D: "bg-zinc-100 text-zinc-600 border-zinc-200" }[grade]
  return <span className={cn("text-sm font-black px-2 py-0.5 rounded-lg border", color)} title={`Score: ${score.toFixed(1)}/100`}>{grade}</span>
}

// ── Related agents (Gap 3) ────────────────────────────────────────────────────
function RelatedAgents({ category, currentId }: { category: string; currentId: string }) {
  const [related, setRelated] = useState<any[]>([])

  useEffect(() => {
    const client = createClient()
    client.from("agents").select("id, name, description, total_executions, average_rating, pricing_model, price_per_call, category")
      .eq("status", "active").eq("category", category).neq("id", currentId)
      .order("total_executions", { ascending: false }).limit(3)
      .then(({ data }) => setRelated(data ?? []))
  }, [category, currentId])

  if (!related.length) return null

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
        More in {categoryLabel(category)}
      </h3>
      <div className="space-y-2">
        {related.map(a => (
          <Link key={a.id} href={`/marketplace/${a.id}`}>
            <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-zinc-50 transition-colors cursor-pointer group">
              <div className="w-8 h-8 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                <CategoryIcon category={a.category} colored className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 truncate group-hover:text-primary transition-colors">{a.name}</p>
                <p className="text-[11px] text-zinc-400 truncate">{a.description?.slice(0, 50)}</p>
              </div>
              <span className="text-[10px] text-zinc-400 nums flex-shrink-0">
                {formatNumber(a.total_executions || 0)} runs
              </span>
            </div>
          </Link>
        ))}
      </div>
      <Link href={`/marketplace?category=${category}`}>
        <p className="text-xs text-primary font-semibold mt-3 hover:underline flex items-center gap-1">
          See all {categoryLabel(category)} agents →
        </p>
      </Link>
    </div>
  )
}

// ── Add to collection modal (Gap 2) ──────────────────────────────────────────
function AddToCollectionModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [collections, setCollections] = useState<any[]>([])
  const [loading,     setLoading]     = useState(true)
  const [adding,      setAdding]      = useState<string | null>(null)
  const supabase = useRef(createClient()).current

  useEffect(() => {
    supabase.from("collections").select("id, name, agent_ids").order("created_at", { ascending: false })
      .then(({ data }) => { setCollections(data ?? []); setLoading(false) })
  }, [])

  const addToCollection = async (collectionId: string, currentIds: string[]) => {
    if (currentIds.includes(agentId)) { toast.error("Already in this collection"); return }
    setAdding(collectionId)
    const { error } = await supabase.from("collections").update({ agent_ids: [...currentIds, agentId] }).eq("id", collectionId)
    if (error) { toast.error(error.message) } else { toast.success("Added to collection!"); onClose() }
    setAdding(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-sm z-10 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-primary" /> Add to Collection
          </p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-zinc-300" /></div>
          ) : collections.length === 0 ? (
            <div className="text-center py-6 text-sm text-zinc-400">No collections yet.<br />
              <Link href="/collections" className="text-primary hover:underline text-xs mt-1 block">Create one →</Link>
            </div>
          ) : collections.map(c => {
            const alreadyIn = (c.agent_ids || []).includes(agentId)
            return (
              <button key={c.id} disabled={alreadyIn || adding === c.id}
                onClick={() => addToCollection(c.id, c.agent_ids || [])}
                className={cn("w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm border transition-all text-left",
                  alreadyIn ? "border-zinc-100 bg-zinc-50 opacity-60 cursor-default" :
                    "border-zinc-100 hover:border-primary/30 hover:bg-primary/[0.02] cursor-pointer")}>
                <span className="font-medium text-zinc-900">{c.name}</span>
                {alreadyIn ? <Check className="h-4 w-4 text-green-500" /> :
                  adding === c.id ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> :
                    <span className="text-[11px] text-zinc-400">{(c.agent_ids || []).length} agents</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Report modal (Gap 1) ──────────────────────────────────────────────────────
function ReportModal({ agentId, agentName, userId, onClose }: { agentId: string; agentName: string; userId: string; onClose: () => void }) {
  const REASONS = ["Broken / not working", "Inaccurate or misleading description", "Harmful or unsafe output", "Spam or low quality", "Other"]
  const [reason,  setReason]  = useState("")
  const [details, setDetails] = useState("")
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)

  const submit = async () => {
    if (!reason) { toast.error("Select a reason"); return }
    setSending(true)
    try {
      await fetch("/api/feedback", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ agent_id: agentId, type: "report", reason, details: details.slice(0, 500) }),
      })
      setSent(true)
    } catch { toast.error("Failed to send report") }
    finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-sm z-10 p-5">
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3">
              <Check className="h-6 w-6 text-green-500" />
            </div>
            <p className="font-semibold text-zinc-900 mb-1">Report submitted</p>
            <p className="text-sm text-zinc-400 mb-4">Thanks — our team will review this agent.</p>
            <Button onClick={onClose} variant="outline" className="rounded-xl border-zinc-200">Close</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2"><Flag className="h-4 w-4 text-red-500" /> Report Agent</p>
              <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-zinc-500 mb-3">Reporting: <strong>{agentName}</strong></p>
            <div className="space-y-2 mb-3">
              {REASONS.map(r => (
                <button key={r} onClick={() => setReason(r)}
                  className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm border text-left transition-all",
                    reason === r ? "border-red-300 bg-red-50 text-red-800" : "border-zinc-100 hover:border-zinc-200 text-zinc-700")}>
                  <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    reason === r ? "border-red-400 bg-red-400" : "border-zinc-300")}>
                    {reason === r && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  {r}
                </button>
              ))}
            </div>
            <Textarea value={details} onChange={e => setDetails(e.target.value)} rows={2}
              placeholder="Additional details (optional)…"
              className="text-xs rounded-xl border-zinc-200 resize-none mb-3" />
            <Button onClick={submit} disabled={!reason || sending}
              className="w-full rounded-xl bg-red-500 text-white hover:bg-red-600 font-semibold gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Sending…" : "Submit Report"}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Review form (Bug 5) ───────────────────────────────────────────────────────
function ReviewForm({ agentId, userId, onReviewSubmitted }: { agentId: string; userId: string; onReviewSubmitted: (r: any) => void }) {
  const [rating,   setRating]   = useState(0)
  const [hover,    setHover]    = useState(0)
  const [title,    setTitle]    = useState("")
  const [body,     setBody]     = useState("")
  const [submitting, setSub]    = useState(false)

  const submit = async () => {
    if (rating === 0) { toast.error("Select a star rating"); return }
    setSub(true)
    try {
      const res  = await fetch(`/api/agents/${agentId}/reviews`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rating, title: title.trim() || undefined, body: body.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to submit review")
      toast.success("Review submitted — it will appear after moderation")
      setRating(0); setTitle(""); setBody("")
      onReviewSubmitted(data)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setSub(false) }
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-4">
      <p className="text-sm font-semibold text-zinc-900">Leave a review</p>

      {/* Star picker */}
      <div className="flex gap-1">
        {[1,2,3,4,5].map(n => (
          <button key={n} onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
            className="transition-transform hover:scale-110">
            <Star className={cn("h-6 w-6 transition-colors",
              n <= (hover || rating) ? "fill-yellow-400 text-yellow-400" : "text-zinc-200")} />
          </button>
        ))}
        {rating > 0 && <span className="text-xs text-zinc-400 self-center ml-2">{["", "Poor", "Fair", "Good", "Very good", "Excellent"][rating]}</span>}
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
        placeholder="Review title (optional)"
        className="w-full h-9 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400 transition-all" />

      <Textarea value={body} onChange={e => setBody(e.target.value)} rows={3} maxLength={2000}
        placeholder="Describe your experience with this agent…"
        className="rounded-xl border-zinc-200 text-sm resize-none" />

      <p className="text-[11px] text-zinc-400">
        You can review this agent after running it at least once. Reviews are moderated before appearing publicly.
      </p>

      <Button onClick={submit} disabled={submitting || rating === 0}
        className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {submitting ? "Submitting…" : "Submit Review"}
      </Button>
    </div>
  )
}

// ─── Main client ──────────────────────────────────────────────────────────────

export function AgentDetailClient({ agent, reviews: initReviews, user, userSubscription, isOwner }: Props) {
  const router     = useRouter()
  const sampleData = getSampleData(agent.category)

  const [testInput,   setTestInput]   = useState(JSON.stringify({ input: "Hello! What can you do?" }, null, 2))
  const [testOutput,  setTestOutput]  = useState("")
  const [testing,     setTesting]     = useState(false)
  const [copied,      setCopied]      = useState(false)
  const [traceInfo,   setTraceInfo]   = useState<{ latencyMs: number; cost: number; tokens?: { input: number; output: number } } | null>(null)
  const [reviews,     setReviews]     = useState(initReviews)
  const [reviewPage,  setReviewPage]  = useState(1)
  const [moreLoading, setMoreLoading] = useState(false)
  const [hasMore,     setHasMore]     = useState(initReviews.length === 10)
  const [showReport,  setShowReport]  = useState(false)
  const [showCollect, setShowCollect] = useState(false)
  const [activeDetailTab, setActiveDetailTab] = useState("playground")

  // Bug 12 FIX: count approved reviews from actual query, not denormalized counter
  const approvedReviewCount = reviews.length

  // Bug 11 FIX: ref guard prevents double-fire on fast double-click
  const testInFlightRef = useRef(false)

  const handleTest = async (inputOverride?: string) => {
    if (!user) { router.push("/login"); return }
    if (testInFlightRef.current) return    // Bug 11: deduplicate concurrent calls
    testInFlightRef.current = true
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
      setTestOutput(typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2))
      setTraceInfo({ latencyMs: data.latencyMs, cost: data.cost ?? 0, tokens: data.tokens })
      toast.success(`Done in ${data.latencyMs}ms · $${(data.cost ?? 0).toFixed(5)}`)
    } catch (err: any) {
      toast.error(err.message)
      setTestOutput(`Error: ${err.message}`)
    } finally {
      setTesting(false)
      testInFlightRef.current = false    // Bug 11: release lock
    }
  }

  const handleTrySample = () => {
    if (testInFlightRef.current) return
    handleTest(sampleData.json)
    toast(`Loading sample: "${sampleData.label}"`, { icon: "🧪" })
  }

  // Bug 6 FIX: use window.location.origin, never hardcode agentdyne.com
  const copySnippet = () => {
    const origin  = typeof window !== "undefined" ? window.location.origin : "https://agentdyne.com"
    const snippet = [
      `const res = await fetch("${origin}/api/agents/${agent.id}/execute", {`,
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

  // Bug 14 FIX: load more reviews
  const loadMoreReviews = async () => {
    setMoreLoading(true)
    const nextPage = reviewPage + 1
    try {
      const res  = await fetch(`/api/agents/${agent.id}/reviews?page=${nextPage}&limit=10`)
      const data = await res.json()
      const newReviews = data.data ?? []
      setReviews(prev => [...prev, ...newReviews])
      setReviewPage(nextPage)
      setHasMore(newReviews.length === 10)
    } catch { toast.error("Failed to load more reviews") }
    finally { setMoreLoading(false) }
  }

  const seller = agent.profiles

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      {showReport && user && <ReportModal agentId={agent.id} agentName={agent.name} userId={user.id} onClose={() => setShowReport(false)} />}
      {showCollect && user && <AddToCollectionModal agentId={agent.id} onClose={() => setShowCollect(false)} />}

      <div className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/marketplace">
            <Button variant="ghost" size="sm" className="mb-6 text-zinc-500 hover:text-zinc-900 gap-1.5 -ml-2 rounded-xl">
              <ArrowLeft className="h-4 w-4" /> Back to Marketplace
            </Button>
          </Link>

          {/* Bug 10 FIX: Draft/pending banner for sellers viewing own non-active agents */}
          {isOwner && agent.status !== "active" && (
            <div className={cn(
              "rounded-xl px-4 py-3 flex items-center gap-3 mb-6 border",
              agent.status === "pending_review" ? "bg-amber-50 border-amber-100" : "bg-zinc-50 border-zinc-200"
            )}>
              <AlertTriangle className={cn("h-4 w-4 flex-shrink-0", agent.status === "pending_review" ? "text-amber-500" : "text-zinc-400")} />
              <div className="flex-1">
                <p className={cn("text-sm font-semibold", agent.status === "pending_review" ? "text-amber-800" : "text-zinc-700")}>
                  {agent.status === "pending_review" ? "This agent is under review" : "This agent is a draft"}
                </p>
                <p className={cn("text-xs mt-0.5", agent.status === "pending_review" ? "text-amber-600" : "text-zinc-500")}>
                  {agent.status === "pending_review"
                    ? "It is not visible to other users yet. Our team typically reviews submissions within 24 hours."
                    : "This page is only visible to you. Complete the setup and submit for review to make it public."}
                </p>
              </div>
              <Link href={`/builder/${agent.id}`}>
                <Button size="sm" variant="outline" className={cn("rounded-xl flex-shrink-0 text-xs",
                  agent.status === "pending_review" ? "border-amber-200 text-amber-700 hover:bg-amber-50" : "border-zinc-200")}>
                  {agent.status === "pending_review" ? "Edit agent" : "Continue editing →"}
                </Button>
              </Link>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* ── Main column ─────────────────────────────────────────────── */}
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

                    {/* Bug 13 FIX: render long_description if present */}
                    {agent.long_description && (
                      <p className="text-zinc-400 text-xs leading-relaxed mt-2 line-clamp-3">
                        {agent.long_description}
                      </p>
                    )}

                    <div className="flex items-center gap-4 mt-3 flex-wrap text-sm">
                      <span className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-bold text-zinc-900 nums">{agent.average_rating?.toFixed(1) || "—"}</span>
                        {/* Bug 12 FIX: show approved count, not total (includes pending) */}
                        <span className="text-zinc-400 nums">({formatNumber(approvedReviewCount)})</span>
                      </span>
                      <span className="flex items-center gap-1 text-zinc-400 nums"><Zap className="h-4 w-4" /> {formatNumber(agent.total_executions)} runs</span>
                      <span className="flex items-center gap-1 text-zinc-400 nums"><Clock className="h-4 w-4" /> ~{agent.average_latency_ms || 0}ms avg</span>
                      <span className="flex items-center gap-1 text-xs font-medium bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                        <CategoryIcon category={agent.category} className="h-3 w-3" />
                        {categoryLabel(agent.category)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* SlidingTabs — Apple-smooth AnimatePresence */}
              <div>
                <SlidingTabs
                  variant="card"
                  bg="bg-zinc-50 border border-zinc-100"
                  tabs={[
                    { id: "playground", label: "Playground", icon: Play },
                    { id: "docs",       label: "Docs",        icon: BookOpen },
                    { id: "api",        label: "API",          icon: Code2 },
                    { id: "reviews",    label: `Reviews (${formatNumber(approvedReviewCount)})`, icon: MessageSquare },
                  ]}
                  active={activeDetailTab}
                  onChange={setActiveDetailTab}
                />

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activeDetailTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.20, ease: [0.25, 0.46, 0.45, 0.94] } }}
                    exit={{ opacity: 0, y: -5,  transition: { duration: 0.14, ease: [0.55, 0.06, 0.68, 0.19] } }}
                    className="mt-4"
                  >

                  {/* Playground */}
                  {activeDetailTab === "playground" && (
                    <div className="space-y-4">
                      <div className="flex flex-col md:grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Input</label>
                            <button onClick={handleTrySample} disabled={testing || !user}
                              className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary/80 bg-primary/8 px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                              <Sparkles className="h-3 w-3" /><span className="hidden sm:inline">Try sample: </span>{sampleData.label}
                            </button>
                          </div>
                          <Textarea value={testInput} onChange={e => setTestInput(e.target.value)}
                            className="font-mono text-xs h-40 md:h-48 resize-none rounded-xl border-zinc-200"
                            placeholder='{"input": "Your input here"}' />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Output</label>
                          <div className={cn("h-40 md:h-48 rounded-xl border border-zinc-100 bg-zinc-50 p-3 font-mono text-xs overflow-auto whitespace-pre-wrap text-zinc-500", testing && "animate-pulse")}>
                            {testing ? "Running…" : testOutput || "Output will appear here…"}
                          </div>
                        </div>
                      </div>
                      {traceInfo && (
                        <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {traceInfo.latencyMs}ms</span>
                          {traceInfo.tokens && <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> {traceInfo.tokens.input}↑ {traceInfo.tokens.output}↓ tokens</span>}
                          <span className="nums">💰 ${traceInfo.cost.toFixed(6)}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <Button onClick={() => handleTest()} disabled={testing} className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          {testing ? "Running…" : "Run Agent"}
                        </Button>
                        {!user && <p className="text-xs text-zinc-400"><Link href="/login" className="text-primary hover:underline">Sign in</Link> to test</p>}
                      </div>
                    </div>
                  )}

                  {/* Docs */}
                  {activeDetailTab === "docs" && (
                    <div className="space-y-4">
                      {agent.long_description && (
                        <div className="bg-white border border-zinc-100 rounded-2xl p-5">
                          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Overview</p>
                          <p className="text-sm text-zinc-600 leading-relaxed whitespace-pre-wrap">{agent.long_description}</p>
                        </div>
                      )}
                      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5 min-h-32">
                        {agent.documentation
                          ? <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-600">{agent.documentation}</pre>
                          : <p className="text-zinc-400 text-sm">No documentation provided for this agent yet.</p>}
                      </div>
                    </div>
                  )}

                  {/* API */}
                  {activeDetailTab === "api" && (
                    <div className="space-y-4">
                      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">TypeScript / JavaScript</span>
                          <button onClick={copySnippet} className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors">
                            {copied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                          </button>
                        </div>
                        <pre className="text-xs font-mono text-zinc-500 overflow-auto leading-relaxed whitespace-pre">{[
                          `const res = await fetch(\`\${window.location.origin}/api/agents/${agent.id}/execute\`, {`,
                          `  method: "POST",`,
                          `  headers: { "Authorization": "Bearer YOUR_API_KEY", "Content-Type": "application/json" },`,
                          `  body: JSON.stringify({ input: "your input" })`,
                          `});`,
                          `const { executionId, output, latencyMs, cost } = await res.json();`,
                        ].join("\n")}</pre>
                      </div>
                      {agent.capability_tags?.length > 0 && (
                        <div className="bg-white border border-zinc-100 rounded-2xl p-4">
                          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2">Capability Tags</p>
                          <div className="flex flex-wrap gap-1.5">
                            {agent.capability_tags.map((tag: string) => <span key={tag} className="text-[11px] font-mono bg-zinc-50 border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full">{tag}</span>)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Reviews */}
                  {activeDetailTab === "reviews" && (
                    <div className="space-y-4">
                      {user && <ReviewForm agentId={agent.id} userId={user.id} onReviewSubmitted={() => {}} />}
                      {reviews.length === 0 ? (
                        <div className="text-center py-10 text-zinc-400 text-sm bg-white border border-zinc-100 rounded-2xl">
                          No approved reviews yet.
                          {!user && <> <Link href="/login" className="text-primary hover:underline">Sign in</Link> to be the first.</>}
                          {user && " Run this agent and leave the first review!"}
                        </div>
                      ) : (
                        <>
                          {reviews.map(r => (
                            <div key={r.id} className="bg-white border border-zinc-100 rounded-2xl p-4">
                              <div className="flex items-start gap-3">
                                <Avatar className="h-8 w-8 flex-shrink-0">
                                  <AvatarImage src={r.profiles?.avatar_url} />
                                  <AvatarFallback className="text-xs bg-primary text-white">{getInitials(r.profiles?.full_name || "A")}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-semibold text-zinc-900">{r.profiles?.full_name || "Anonymous"}</span>
                                    <span className="text-xs text-zinc-400 flex-shrink-0">{formatDate(r.created_at)}</span>
                                  </div>
                                  <div className="flex gap-0.5 mb-2">
                                    {[...Array(5)].map((_, i) => <Star key={i} className={cn("h-3 w-3", i < r.rating ? "fill-yellow-400 text-yellow-400" : "text-zinc-200")} />)}
                                  </div>
                                  {r.title && <p className="text-sm font-medium text-zinc-900 mb-1">{r.title}</p>}
                                  {r.body  && <p className="text-sm text-zinc-500 leading-relaxed">{r.body}</p>}
                                </div>
                              </div>
                            </div>
                          ))}
                          {hasMore && (
                            <div className="text-center">
                              <Button variant="outline" onClick={loadMoreReviews} disabled={moreLoading} className="rounded-xl border-zinc-200 text-sm gap-2">
                                {moreLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                                {moreLoading ? "Loading…" : "Load more reviews"}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  </motion.div>
                </AnimatePresence>
              </div>


                {/* ── Playground — Bug 16 FIX: responsive layout ─────────── */}
                <TabsContent value="playground" className="mt-4 space-y-4">
                  {/* Stacked on mobile, side-by-side on md+ */}
                  <div className="flex flex-col md:grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Input</label>
                        <button onClick={handleTrySample} disabled={testing || !user}
                          className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary/80 bg-primary/8 px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          <Sparkles className="h-3 w-3" />
                          <span className="hidden sm:inline">Try sample: </span>{sampleData.label}
                        </button>
                      </div>
                      <Textarea
                        value={testInput} onChange={e => setTestInput(e.target.value)}
                        className="font-mono text-xs h-40 md:h-48 resize-none rounded-xl border-zinc-200"
                        placeholder={'{"input": "Your input here"}'}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Output</label>
                      <div className={cn(
                        "h-40 md:h-48 rounded-xl border border-zinc-100 bg-zinc-50 p-3 font-mono text-xs overflow-auto whitespace-pre-wrap text-zinc-500",
                        testing && "animate-pulse"
                      )}>
                        {testing ? "Running…" : testOutput || "Output will appear here…"}
                      </div>
                    </div>
                  </div>

                  {traceInfo && (
                    <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {traceInfo.latencyMs}ms</span>
                      {traceInfo.tokens && <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> {traceInfo.tokens.input}↑ {traceInfo.tokens.output}↓ tokens</span>}
                      <span className="flex items-center gap-1 nums">💰 ${traceInfo.cost.toFixed(6)}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    <Button onClick={() => handleTest()} disabled={testing}
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

                {/* ── Docs — Bug 13 FIX: render long_description ─────────── */}
                <TabsContent value="docs" className="mt-4 space-y-4">
                  {agent.long_description && (
                    <div className="bg-white border border-zinc-100 rounded-2xl p-5">
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Overview</p>
                      <p className="text-sm text-zinc-600 leading-relaxed whitespace-pre-wrap">{agent.long_description}</p>
                    </div>
                  )}
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5 min-h-32">
                    {agent.documentation ? (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-600">{agent.documentation}</pre>
                    ) : (
                      <p className="text-zinc-400 text-sm">No documentation provided for this agent yet.</p>
                    )}
                  </div>
                </TabsContent>

                {/* ── API — Bug 6 FIX: dynamic origin ────────────────────── */}
                <TabsContent value="api" className="mt-4 space-y-4">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">TypeScript / JavaScript</span>
                      <button onClick={copySnippet}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors">
                        {copied ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-zinc-500 overflow-auto leading-relaxed whitespace-pre">{
                      `// Using window.location.origin makes this portable\n` +
                      `const origin = window.location.origin; // e.g. https://agentdyne.com\n` +
                      `const res = await fetch(\`\${origin}/api/agents/${agent.id}/execute\`, {\n` +
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
                          <span key={tag} className="text-[11px] font-mono bg-zinc-50 border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ── Reviews — Bug 5, 12, 14 ─────────────────────────────── */}
                <TabsContent value="reviews" className="mt-4 space-y-4">

                  {/* Bug 5 FIX: review submission form for authenticated users */}
                  {user && (
                    <ReviewForm
                      agentId={agent.id}
                      userId={user.id}
                      onReviewSubmitted={r => { /* submitted review goes to moderation — no UI update needed */ }}
                    />
                  )}

                  {reviews.length === 0 ? (
                    <div className="text-center py-10 text-zinc-400 text-sm bg-white border border-zinc-100 rounded-2xl">
                      No approved reviews yet.
                      {!user && <> <Link href="/login" className="text-primary hover:underline">Sign in</Link> to be the first to review.</>}
                      {user && " Execute this agent and leave the first review!"}
                    </div>
                  ) : (
                    <>
                      {reviews.map(r => (
                        <div key={r.id} className="bg-white border border-zinc-100 rounded-2xl p-4">
                          <div className="flex items-start gap-3">
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarImage src={r.profiles?.avatar_url} />
                              <AvatarFallback className="text-xs bg-primary text-white">{getInitials(r.profiles?.full_name || "A")}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-semibold text-zinc-900">{r.profiles?.full_name || "Anonymous"}</span>
                                <span className="text-xs text-zinc-400 flex-shrink-0">{formatDate(r.created_at)}</span>
                              </div>
                              <div className="flex gap-0.5 mb-2">
                                {[...Array(5)].map((_, i) => (
                                  <Star key={i} className={cn("h-3 w-3", i < r.rating ? "fill-yellow-400 text-yellow-400" : "text-zinc-200")} />
                                ))}
                              </div>
                              {r.title && <p className="text-sm font-medium text-zinc-900 mb-1">{r.title}</p>}
                              {r.body  && <p className="text-sm text-zinc-500 leading-relaxed">{r.body}</p>}
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Bug 14 FIX: load more reviews button */}
                      {hasMore && (
                        <div className="text-center">
                          <Button variant="outline" onClick={loadMoreReviews} disabled={moreLoading}
                            className="rounded-xl border-zinc-200 text-sm gap-2">
                            {moreLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                            {moreLoading ? "Loading…" : "Load more reviews"}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>
              </div>
            </div>

            {/* ── Sidebar ─────────────────────────────────────────────────── */}
            <div className="space-y-4">
              <div className="bg-white border border-zinc-100 rounded-2xl p-5 sticky top-20"
                style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <div className="text-center mb-5">
                  {agent.pricing_model === "free"         && <><div className="text-3xl font-black text-zinc-900">Free</div><div className="text-xs text-zinc-400 mt-1">Always free</div></>}
                  {agent.pricing_model === "per_call"     && <><div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.price_per_call)}</div><div className="text-xs text-zinc-400 mt-1">per call</div></>}
                  {agent.pricing_model === "subscription" && <><div className="text-3xl font-black text-zinc-900 nums">{formatCurrency(agent.subscription_price_monthly)}</div><div className="text-xs text-zinc-400 mt-1">/month</div></>}
                  {agent.pricing_model === "freemium"     && <><div className="text-3xl font-black text-zinc-900">Free</div><div className="text-xs text-zinc-400 mt-1">then {formatCurrency(agent.price_per_call)}/call</div></>}
                </div>

                <Button className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold mb-2"
                  onClick={() => user ? handleTest() : router.push("/signup")}>
                  {user ? <><Play className="h-4 w-4 mr-2" /> Try it now</> : "Sign up to use"}
                </Button>

                {user && (
                  <Button variant="outline" className="w-full rounded-xl border-primary/30 text-primary hover:bg-primary/5 font-semibold gap-2 mb-2"
                    onClick={handleTrySample} disabled={testing}>
                    <Sparkles className="h-4 w-4" />
                    {testing ? "Running…" : `Try: ${sampleData.label}`}
                  </Button>
                )}

                <Button variant="outline" className="w-full rounded-xl border-zinc-200 font-semibold text-zinc-700 gap-2 mb-3"
                  onClick={() => user ? router.push(`/pipelines?add_agent=${agent.id}&agent_name=${encodeURIComponent(agent.name)}`) : router.push("/login")}>
                  <Layers className="h-4 w-4" /> Use in Pipeline
                </Button>

                {/* Gap 2 FIX: Add to collection */}
                {user && (
                  <Button variant="outline" className="w-full rounded-xl border-zinc-200 font-semibold text-zinc-600 gap-2 mb-2 text-sm"
                    onClick={() => setShowCollect(true)}>
                    <FolderPlus className="h-4 w-4" /> Add to Collection
                  </Button>
                )}

                {agent.free_calls_per_month > 0 && (
                  <p className="text-center text-xs text-zinc-400 mt-1 mb-3">{agent.free_calls_per_month} free calls/month included</p>
                )}

                <div className="mt-4 space-y-2.5 pt-4 border-t border-zinc-50">
                  {[
                    { icon: Globe,      label: "Model",       value: agent.model_name?.replace("claude-", "Claude ") ?? "—" },
                    { icon: Clock,      label: "Avg latency", value: `~${agent.average_latency_ms || 0}ms` },
                    { icon: TrendingUp, label: "Success rate", value: (agent.total_executions ?? 0) > 0 ? `${Math.round(((agent.successful_executions ?? 0) / (agent.total_executions ?? 1)) * 100)}%` : "—" },
                    { icon: Tag,        label: "Version",     value: agent.version ?? "1.0.0" },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-zinc-400"><item.icon className="h-3.5 w-3.5" />{item.label}</span>
                      <span className="font-medium text-zinc-700 nums">{item.value}</span>
                    </div>
                  ))}
                </div>

                {/* Gap 1 FIX: report agent */}
                {user && (
                  <button onClick={() => setShowReport(true)}
                    className="mt-4 w-full text-[11px] text-zinc-300 hover:text-red-400 transition-colors flex items-center justify-center gap-1.5">
                    <Flag className="h-3 w-3" /> Report this agent
                  </button>
                )}
              </div>

              {/* Seller card — Bug 9 FIX: total_earned removed from query */}
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
                    {/* Bug 9 FIX: never show total_earned to other users */}
                    <span className="text-xs text-zinc-400">Verified Builder</span>
                  </div>
                </div>
                {seller?.bio && <p className="text-xs text-zinc-500 mt-3 leading-relaxed">{seller.bio}</p>}
              </div>

              {/* Gap 3 FIX: related agents */}
              <RelatedAgents category={agent.category} currentId={agent.id} />
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
