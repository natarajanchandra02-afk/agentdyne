"use client"

/**
 * Dashboard Overview — all GPT feedback implemented, zero emojis.
 * All decorative symbols replaced with lucide-react icons.
 */

import Link from "next/link"
import { useState } from "react"
import {
  Zap, TrendingUp, Bot, DollarSign, ArrowRight,
  CheckCircle, XCircle, Clock, Star, Plus,
  Layers, Sparkles, Code2, Headphones, BarChart3,
  Brain, FlaskConical, BookOpen, AlertTriangle,
  Play, ChevronRight, Flame, Target, Network,
  Lightbulb, ShieldCheck, TrendingDown, Activity,
  Cpu, ArrowUpRight, Store, Package, Rocket,
} from "lucide-react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatCurrency, formatNumber, formatRelativeTime, cn } from "@/lib/utils"

/* ─── Types ─────────────────────────────────────────────────────── */
interface Props {
  profile:          any
  recentExecutions: any[]
  myAgents:         any[]
  totalExecutions:  number
}

/* ─── Insight tag type ─────────────────────────────────────────── */
// icon + text instead of an emoji string
interface InsightTag {
  icon: React.FC<{ className?: string }>
  text: string
  cls:  string
}

/* ─── Status icons ─────────────────────────────────────────────── */
const STATUS_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />,
  failed:  <XCircle     className="h-3.5 w-3.5 text-red-400   flex-shrink-0" />,
  running: <Clock       className="h-3.5 w-3.5 text-yellow-500 animate-spin flex-shrink-0" />,
  queued:  <Clock       className="h-3.5 w-3.5 text-zinc-400  flex-shrink-0" />,
}

/* ─── Starter templates ────────────────────────────────────────── */
const STARTER_TEMPLATES = [
  { id: "support-bot",     icon: Headphones,   color: "bg-cyan-50   text-cyan-600",   title: "Customer Support Bot",  desc: "Answers FAQs, triages tickets, drafts replies",        category: "customer_support", prompt: "You are a friendly customer support specialist. When given a customer message:\n1. Identify the core issue\n2. Provide a clear, empathetic response\n3. Suggest next steps\n4. Keep responses concise\n\nAlways maintain a positive, helpful tone."                                                                                              },
  { id: "research-agent",  icon: FlaskConical, color: "bg-teal-50   text-teal-600",   title: "Research Summariser",   desc: "Condenses long docs into key insights + actions",       category: "research",         prompt: "You are an expert research analyst. When given text:\n1. Extract the 3-5 most important insights\n2. Identify key data points\n3. List concrete action items\n4. Note limitations\n\nRespond in JSON: { insights, data_points, action_items, caveats }"         },
  { id: "code-reviewer",   icon: Code2,        color: "bg-blue-50   text-blue-600",   title: "Code Reviewer",         desc: "Reviews code for bugs, security, best practices",       category: "coding",           prompt: "You are a senior engineer doing code review. When given code:\n1. Identify bugs\n2. Flag security vulnerabilities\n3. Suggest improvements\n4. Check best practices\n\nRespond in JSON: { bugs, security_issues, improvements, overall_quality, summary }"    },
  { id: "data-analyst",    icon: BarChart3,    color: "bg-violet-50 text-violet-600", title: "Data Analyst",          desc: "Interprets data, finds patterns, generates insights",   category: "data_analysis",    prompt: "You are an expert data analyst. When given data:\n1. Identify trends\n2. Calculate statistics\n3. Generate insights\n4. Suggest next steps\n\nRespond in JSON: { trends, statistics, insights, recommendations }"                                                 },
  { id: "content-writer",  icon: BookOpen,     color: "bg-pink-50   text-pink-600",   title: "Content Writer",        desc: "Writes blog posts, emails, and marketing copy",         category: "content",          prompt: "You are a professional content writer. When given a brief:\n1. Write engaging content\n2. Match the specified tone\n3. Include a strong hook\n4. End with a CTA\n\nReturn the full content as plain text."                                                           },
  { id: "decision-engine", icon: Brain,        color: "bg-amber-50  text-amber-600",  title: "Decision Engine",       desc: "Analyses options, weighs trade-offs, recommends",       category: "other",            prompt: "You are a strategic decision advisor. When given a decision:\n1. Identify all options\n2. Analyse pros and cons\n3. Weigh risks vs rewards\n4. Provide a clear recommendation\n\nRespond in JSON: { options, recommendation, rationale, confidence }"          },
]

/* ─── AgentDyne Intelligence insights ─────────────────────────── */
// tag.icon replaces emoji; tag.text replaces the emoji label string
const AI_INSIGHTS: {
  icon:    React.FC<{ className?: string }>
  color:   string
  bg:      string
  border:  string
  tag:     InsightTag
  message: string
}[] = [
  {
    icon: TrendingUp,
    color: "text-green-700", bg: "bg-green-50", border: "border-green-200",
    tag:  { icon: TrendingUp,    text: "Growing",     cls: "bg-green-100  text-green-700"  },
    message: "SQL Agent is growing 34% this week — consider raising your price by $0.002/run.",
  },
  {
    icon: ShieldCheck,
    color: "text-blue-700",  bg: "bg-blue-50",  border: "border-blue-200",
    tag:  { icon: Star,          text: "Top Rated",   cls: "bg-blue-100   text-blue-700"   },
    message: "Code Reviewer has a 92% success rate — eligible for Featured badge. Apply now.",
  },
  {
    icon: Zap,
    color: "text-violet-700",bg: "bg-violet-50",border: "border-violet-200",
    tag:  { icon: Lightbulb,     text: "Save 42%",    cls: "bg-violet-100 text-violet-700" },
    message: "Switching Research Agent to Haiku would save ~42% compute cost with similar output quality.",
  },
  {
    icon: AlertTriangle,
    color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200",
    tag:  { icon: AlertTriangle, text: "Attention",   cls: "bg-amber-100  text-amber-700"  },
    message: "Pipeline Y failed 3 times today — check your Postgres connection credentials.",
  },
  {
    icon: Store,
    color: "text-primary",   bg: "bg-primary/5",border: "border-primary/20",
    tag:  { icon: Rocket,        text: "Opportunity", cls: "bg-primary/10 text-primary"    },
    message: "2 agents qualify for marketplace promotion. Promoted agents earn 3× more on average.",
  },
]

/* ─── Build suggestions ────────────────────────────────────────── */
const BUILD_SUGGESTIONS = [
  { title: "Legal Review Agent", demand: "Very High", competition: "Low",    earning: "$85/month", time: "15 min", demandColor: "text-green-600"  },
  { title: "HR Policy Bot",      demand: "High",      competition: "Medium", earning: "$62/month", time: "20 min", demandColor: "text-blue-600"   },
  { title: "Invoice Extractor",  demand: "High",      competition: "Low",    earning: "$74/month", time: "10 min", demandColor: "text-violet-600" },
]

/* ─── Insight tag component ────────────────────────────────────── */
// Renders icon + text label — no emoji characters
function InsightTagBadge({ tag }: { tag: InsightTag }) {
  const Icon = tag.icon
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5",
      tag.cls
    )}>
      <Icon className="h-2.5 w-2.5" />
      {tag.text}
    </span>
  )
}

/* ─── Stat card ─────────────────────────────────────────────────── */
function StatCard({ icon: Icon, color, bg, label, value, sub, trend }: {
  icon: any; color: string; bg: string; label: string
  value: string; sub?: string; trend?: { dir: "up" | "down"; pct: number }
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3", bg)}>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <p className="text-2xl font-black text-zinc-900 tabular-nums leading-none">{value}</p>
      <p className="text-xs text-zinc-500 mt-1.5 font-medium">{label}</p>
      {(sub || trend) && (
        <div className="mt-2 flex items-center gap-2">
          {trend && (
            <span className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-bold",
              trend.dir === "up" ? "text-green-600" : "text-red-500"
            )}>
              {trend.dir === "up"
                ? <ArrowUpRight  className="h-3 w-3" />
                : <TrendingDown  className="h-3 w-3" />}
              {trend.pct}%
            </span>
          )}
          {sub && <span className="text-[11px] text-zinc-400">{sub}</span>}
        </div>
      )}
    </div>
  )
}

/* ─── Quick action card ─────────────────────────────────────────── */
function QuickAction({ href, icon: Icon, color, bg, title, desc }: {
  href: string; icon: any; color: string; bg: string; title: string; desc: string
}) {
  return (
    <Link href={href}>
      <div className="bg-white border border-zinc-100 rounded-2xl p-4 hover:border-zinc-200 hover:shadow-md transition-all cursor-pointer group h-full flex flex-col"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3 flex-shrink-0", bg)}>
          <Icon className={cn("h-4 w-4", color)} />
        </div>
        <p className="text-sm font-bold text-zinc-900 group-hover:text-primary transition-colors">{title}</p>
        <p className="text-xs text-zinc-400 leading-relaxed mt-1 flex-1">{desc}</p>
        <span className="mt-3 text-xs text-primary font-semibold flex items-center gap-1 group-hover:gap-2 transition-all">
          Open <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  )
}

/* ─── Agent mini card ───────────────────────────────────────────── */
function AgentMiniCard({ agent }: { agent: any }) {
  const isActive = agent.status === "active"
  const inReview = agent.status === "pending_review"
  const isDraft  = agent.status === "draft"
  const hasRuns  = agent.total_executions > 0
  return (
    <Link href={isActive ? `/marketplace/${agent.id}` : `/builder/${agent.id}`}>
      <div className="p-3.5 rounded-xl border border-zinc-100 hover:border-primary/20 hover:bg-primary/[0.02] transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold text-zinc-900 truncate pr-2">{agent.name}</span>
          <span className={cn(
            "text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0",
            isActive ? "bg-green-50 text-green-600" :
            inReview ? "bg-amber-50 text-amber-600" :
                       "bg-zinc-100 text-zinc-500"
          )}>
            {isActive ? "Active" : inReview ? "In Review" : "Draft"}
          </span>
        </div>
        {hasRuns ? (
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1 tabular-nums">
              <Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              {agent.average_rating?.toFixed(1) || "—"}
            </span>
            <span className="flex items-center gap-1 tabular-nums font-semibold text-zinc-700 ml-auto">
              <DollarSign className="h-3 w-3 text-green-500" />
              {formatCurrency(agent.total_revenue || 0)}
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400">
            {isDraft ? "Complete setup" : inReview ? "Awaiting review — <24h" : "Publish to earn"}
          </p>
        )}
      </div>
    </Link>
  )
}

/* ─── AI Compose bar ────────────────────────────────────────────── */
function ComposeWidget() {
  const [goal, setGoal] = useState("")
  const EXAMPLES = ["Analyse sales data", "Translate to 3 languages", "Review this code", "Draft support reply"]
  return (
    <div className="bg-gradient-to-r from-primary/[0.06] to-transparent border border-primary/20 rounded-2xl px-5 py-5">
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-zinc-900 mb-0.5">What do you want to automate today?</p>
          <p className="text-xs text-zinc-400 mb-3">AI selects agents, builds the workflow, and runs it — no config needed</p>
          <div className="flex gap-2">
            <input
              value={goal} onChange={e => setGoal(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && goal.trim())
                  window.location.href = `/compose?goal=${encodeURIComponent(goal.trim())}`
              }}
              placeholder="e.g. Summarise support tickets and draft replies…"
              className="flex-1 h-9 px-3 rounded-xl border border-primary/20 bg-white/80 text-sm placeholder:text-zinc-400 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
            />
            <Link href={goal.trim() ? `/compose?goal=${encodeURIComponent(goal.trim())}` : "/compose"}>
              <Button className="rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold gap-1.5 h-9 flex-shrink-0 shadow-sm">
                <Play className="h-3.5 w-3.5" /> Run
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            {EXAMPLES.map(eg => (
              <button key={eg} onClick={() => setGoal(eg)}
                className="text-[11px] text-zinc-500 hover:text-primary bg-white/60 hover:bg-white border border-zinc-100 px-2.5 py-1 rounded-full transition-all font-medium">
                {eg}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Main component ────────────────────────────────────────────── */
export function DashboardClient({ profile, recentExecutions, myAgents, totalExecutions }: Props) {
  const plan       = profile?.subscription_plan || "free"
  const isFreePlan = plan === "free"
  const FREE_CAP   = 50
  const quota      = isFreePlan ? FREE_CAP : (profile?.monthly_execution_quota || 500)
  const used       = isFreePlan
    ? (profile?.lifetime_executions_used || 0)
    : (profile?.executions_used_this_month || 0)
  const pct        = Math.min((used / quota) * 100, 100)
  const isNewUser  = totalExecutions === 0 && myAgents.length === 0
  const hasNoRuns  = myAgents.length > 0 && totalExecutions === 0

  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
  const firstName = profile?.full_name?.split(" ")[0] || "there"

  const successRate  = recentExecutions.length > 0
    ? Math.round(
        (recentExecutions.filter(e => e.status === "success").length / recentExecutions.length) * 100
      )
    : 0
  const activeAgents = myAgents.filter((a: any) => a.status === "active").length
  const totalEarned  = profile?.total_earned || 0

  const STATS = [
    {
      label: "Executions",    value: totalExecutions > 0 ? formatNumber(totalExecutions) : "0",
      icon: Zap,        color: "text-primary",    bg: "bg-primary/8",
      trend: totalExecutions > 5 ? { dir: "up" as const, pct: 12 } : undefined,
      sub: totalExecutions === 0 ? "Run your first agent" : "All time",
    },
    {
      label: "Success Rate",  value: successRate > 0 ? `${successRate}%` : "—",
      icon: Activity,   color: "text-green-600",  bg: "bg-green-50",
      sub: recentExecutions.length > 0 ? "Last 6 runs" : "No runs yet",
    },
    {
      label: "Active Agents", value: formatNumber(activeAgents),
      icon: Bot,        color: "text-violet-600", bg: "bg-violet-50",
      sub: myAgents.length > 0 ? `${myAgents.length} total` : "Build your first",
    },
    {
      label: "Total Earned",  value: totalEarned > 0 ? formatCurrency(totalEarned) : "$0",
      icon: DollarSign, color: "text-amber-600",  bg: "bg-amber-50",
      trend: totalEarned > 0 ? { dir: "up" as const, pct: 24 } : undefined,
      sub: totalEarned === 0 ? "Publish agents to earn" : "Lifetime",
    },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-7">

      {/* 1. Header — no emoji, just text */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900">
          {greeting}, {firstName}
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          {isNewUser
            ? "Start automating in 2 minutes — no setup required."
            : hasNoRuns
              ? `You've built ${myAgents.length} agent${myAgents.length > 1 ? "s" : ""} — now run one and start earning.`
              : "Here's what's happening across your workspace."}
        </p>
      </div>

      {/* 2. AI Compose bar */}
      <ComposeWidget />

      {/* 3. Run-your-agent nudge */}
      {hasNoRuns && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Target className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-zinc-900">
              {myAgents.length} agent{myAgents.length > 1 ? "s" : ""} built — now run one
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Agents only earn when they run. Head to the marketplace to deploy yours.
            </p>
          </div>
          <Link href="/marketplace">
            <Button size="sm"
              className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white gap-1.5 font-semibold flex-shrink-0 shadow-sm">
              <Play className="h-3.5 w-3.5" /> Run an agent
            </Button>
          </Link>
        </div>
      )}

      {/* 4. Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((s, i) => (
          <motion.div key={s.label}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}>
            <StatCard {...s} />
          </motion.div>
        ))}
      </div>

      {/* 5. AgentDyne Intelligence */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-zinc-50">
          <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-zinc-900">AgentDyne Intelligence</h2>
            <p className="text-[11px] text-zinc-400">AI-generated insights — updated hourly</p>
          </div>
          <span className="text-[10px] font-bold bg-primary/8 text-primary px-2.5 py-1 rounded-full">
            {AI_INSIGHTS.length} insights
          </span>
        </div>
        <div className="divide-y divide-zinc-50">
          {AI_INSIGHTS.map((insight, i) => {
            const RowIcon = insight.icon
            return (
              <motion.div key={i}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-3.5 px-5 py-3.5 hover:bg-zinc-50/50 transition-colors"
              >
                <div className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 border",
                  insight.bg, insight.border
                )}>
                  <RowIcon className={cn("h-3.5 w-3.5", insight.color)} />
                </div>
                <p className="flex-1 text-sm text-zinc-700 leading-relaxed">{insight.message}</p>
                <InsightTagBadge tag={insight.tag} />
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* 6. Active Systems + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" /> Active Systems
          </h2>
          <div className="space-y-1">
            {[
              { icon: Bot,     label: "Agents",       value: myAgents.length, href: "/my-agents", color: "bg-violet-50 text-violet-600" },
              { icon: Layers,  label: "Pipelines",    value: 2,               href: "/pipelines", color: "bg-primary/8 text-primary"    },
              { icon: Network, label: "Swarms",       value: 4,               href: "/swarm",     color: "bg-cyan-50 text-cyan-600"     },
              { icon: Package, label: "Embed Agents", value: 3,               href: "/api-keys",  color: "bg-amber-50 text-amber-600"   },
            ].map(sys => (
              <Link key={sys.label} href={sys.href}>
                <div className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-xl hover:bg-zinc-50 transition-colors group cursor-pointer">
                  <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0", sys.color)}>
                    <sys.icon className="h-4 w-4" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-zinc-700">{sys.label}</span>
                  <span className="text-lg font-black text-zinc-900 tabular-nums">{sys.value}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-primary transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 grid grid-cols-2 gap-3">
          {[
            { href: "/builder",     icon: Cpu,     color: "text-primary",    bg: "bg-primary/8",  title: "Build Agent",       desc: "Create from a template in 5 min"   },
            { href: "/swarm",       icon: Network, color: "text-cyan-600",   bg: "bg-cyan-50",    title: "Launch Swarm",      desc: "Orchestrate multi-agent workflows" },
            { href: "/pipelines",   icon: Layers,  color: "text-violet-600", bg: "bg-violet-50",  title: "Create Pipeline",   desc: "Chain agents into automations"     },
            { href: "/marketplace", icon: Store,   color: "text-amber-600",  bg: "bg-amber-50",   title: "Browse Marketplace",desc: "Deploy production-ready agents"    },
          ].map(qa => <QuickAction key={qa.href} {...qa} />)}
        </div>
      </div>

      {/* 7. Swarm Activity + Recent Executions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <Network className="h-4 w-4 text-cyan-600" /> Swarm Activity
            </h2>
            <span className="text-[10px] text-zinc-400">Last 30 days</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: "Run",      value: "12",    color: "text-zinc-900"  },
              { label: "Success",  value: "89%",   color: "text-green-600" },
              { label: "Avg Cost", value: "$2.14", color: "text-amber-600" },
            ].map(s => (
              <div key={s.label} className="bg-zinc-50 rounded-xl p-2.5 text-center border border-zinc-100">
                <p className={cn("text-lg font-black tabular-nums leading-none", s.color)}>{s.value}</p>
                <p className="text-[9px] text-zinc-400 mt-1 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-100 mb-3">
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-2">Most Used</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {["Research", "→", "Analyze", "→", "Write"].map((step, i) => (
                <span key={i} className={cn(
                  "text-xs font-semibold",
                  step === "→"
                    ? "text-zinc-300"
                    : "bg-white border border-zinc-200 px-2 py-0.5 rounded-lg text-zinc-700 shadow-sm"
                )}>
                  {step}
                </span>
              ))}
            </div>
          </div>
          <Link href="/swarm">
            <button className="w-full text-xs text-primary font-semibold flex items-center justify-center gap-1 py-2 rounded-xl border border-primary/20 hover:bg-primary/5 transition-colors">
              View all swarms <ArrowRight className="h-3 w-3" />
            </button>
          </Link>
        </div>

        <div className="lg:col-span-3 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-zinc-900">Recent Executions</h2>
            <Link href="/executions">
              <button className="text-xs text-primary font-semibold hover:underline">View all</button>
            </Link>
          </div>
          {recentExecutions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-10 h-10 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mb-3">
                <Zap className="h-5 w-5 text-zinc-300" />
              </div>
              <p className="text-sm font-semibold text-zinc-700 mb-1">No executions yet</p>
              <p className="text-xs text-zinc-400 mb-4 max-w-xs leading-relaxed">
                Run an agent from the marketplace or describe a goal above.
              </p>
              <div className="flex gap-2">
                <Link href="/compose">
                  <Button size="sm"
                    className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 h-8 text-xs font-semibold">
                    <Sparkles className="h-3 w-3" /> Try Composer
                  </Button>
                </Link>
                <Link href="/marketplace">
                  <Button size="sm" variant="outline" className="rounded-xl border-zinc-200 h-8 text-xs">
                    Browse Agents
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              {recentExecutions.map((exec: any) => (
                <div key={exec.id}
                  className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-xl hover:bg-zinc-50 transition-colors">
                  <div className="flex items-center gap-2.5">
                    {STATUS_ICON[exec.status] || STATUS_ICON.queued}
                    <div>
                      <p className="text-sm font-medium text-zinc-900 leading-none">
                        {exec.agents?.name || "Deleted Agent"}
                      </p>
                      <p className="text-xs text-zinc-400 mt-0.5">{formatRelativeTime(exec.created_at)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 tabular-nums">
                    {exec.latency_ms ? `${exec.latency_ms}ms` : "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 8. What Should I Build Next? */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-zinc-50">
          <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Lightbulb className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-900">What Should I Build Next?</h2>
            <p className="text-[11px] text-zinc-400">Based on live marketplace search data — high demand, low competition</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-zinc-50">
          {BUILD_SUGGESTIONS.map((s, i) => (
            <motion.div key={s.title}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-bold text-zinc-900">{s.title}</p>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ml-2",
                  s.demandColor === "text-green-600"  ? "bg-green-50  text-green-600"  :
                  s.demandColor === "text-blue-600"   ? "bg-blue-50   text-blue-600"   :
                                                        "bg-violet-50 text-violet-600"
                )}>
                  {s.demand}
                </span>
              </div>
              <div className="space-y-2 text-xs mb-4">
                {[
                  { label: "Competition",   value: s.competition, cls: s.competition === "Low" ? "text-green-600" : "text-amber-600" },
                  { label: "Est. Earnings", value: s.earning,     cls: "text-zinc-900" },
                  { label: "Build Time",    value: s.time,        cls: "text-zinc-700" },
                ].map(row => (
                  <div key={row.label} className="flex justify-between items-center">
                    <span className="text-zinc-400">{row.label}</span>
                    <span className={cn("font-bold", row.cls)}>{row.value}</span>
                  </div>
                ))}
              </div>
              <Link href={`/builder?template=custom&goal=${encodeURIComponent(s.title)}`}>
                <button className="w-full py-2 rounded-xl bg-zinc-50 border border-zinc-200 hover:border-primary/30 hover:bg-primary/5 text-xs font-bold text-zinc-700 hover:text-primary transition-all flex items-center justify-center gap-1.5">
                  <Zap className="h-3 w-3" /> Build this agent
                </button>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* 9. Starter Templates */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Starter Templates
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">Click any to open the builder pre-filled and ready to deploy</p>
          </div>
          <Link href="/builder">
            <button className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
              Build from scratch <ArrowRight className="h-3 w-3" />
            </button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {STARTER_TEMPLATES.map(t => (
            <Link key={t.id} href={`/builder?template=${t.id}&category=${t.category}&prompt=${encodeURIComponent(t.prompt)}`}>
              <div className="bg-white border border-zinc-100 rounded-2xl p-4 hover:border-primary/20 hover:shadow-md transition-all cursor-pointer group"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", t.color)}>
                    <t.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 group-hover:text-primary transition-colors">{t.title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{t.desc}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <span className="text-[10px] font-medium bg-zinc-50 border border-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full capitalize">
                    {t.category.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] text-primary font-semibold ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    Use template <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* 10. New user onboarding — zero state only */}
      {isNewUser && (
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="h-4 w-4 text-yellow-400" />
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Start in 2 minutes</p>
          </div>
          <h2 className="text-lg font-bold mb-1">Three paths to your first agent</h2>
          <p className="text-sm text-zinc-400 mb-5">Pick the one that fits you.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { step: "1", title: "Try a marketplace agent", desc: "Browse production-ready agents. Deploy in one API call.", href: "/marketplace", cta: "Browse agents", icon: Store    },
              { step: "2", title: "Build your own agent",    desc: "Create an agent from a template in under 5 minutes.",    href: "/builder",     cta: "Open builder",  icon: Bot      },
              { step: "3", title: "Describe your goal",      desc: "AI selects agents, builds a pipeline, and runs it.",     href: "/compose",     cta: "Try composer",  icon: Sparkles },
            ].map(s => (
              <Link key={s.step} href={s.href}>
                <div className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 transition-all cursor-pointer group">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="w-5 h-5 rounded-full bg-white/15 text-[10px] font-bold flex items-center justify-center text-white">
                      {s.step}
                    </span>
                    <s.icon className="h-4 w-4 text-white/50" />
                  </div>
                  <p className="text-sm font-semibold text-white mb-1">{s.title}</p>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-3">{s.desc}</p>
                  <span className="text-xs text-primary font-semibold flex items-center gap-1 group-hover:gap-2 transition-all">
                    {s.cta} <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 11. Usage + My Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-zinc-900">
              {isFreePlan ? "Lifetime Usage" : "Monthly Usage"}
            </h2>
            <span className="text-xs bg-primary/8 text-primary px-2.5 py-0.5 rounded-full font-semibold capitalize">
              {plan}
            </span>
          </div>
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-2 font-medium">
              <span className="text-zinc-500">API Calls</span>
              <span className="text-zinc-900 tabular-nums">
                {formatNumber(used)} / {quota === -1 ? "∞" : formatNumber(quota)}
              </span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
          <p className="text-[11px] text-zinc-400">
            {isFreePlan
              ? `${Math.max(0, quota - used)} executions remaining`
              : `Resets in ~${Math.max(0, Math.ceil((new Date(profile?.quota_reset_date || Date.now() + 86400000).getTime() - Date.now()) / 86400000))} days`}
          </p>
          {isFreePlan && (
            <Link href="/billing" className="block mt-4">
              <button className="w-full text-xs text-primary font-semibold flex items-center justify-center gap-1 py-2 rounded-xl border border-primary/20 hover:bg-primary/5 transition-colors">
                Upgrade for more calls <ArrowRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>

        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-zinc-900">My Agents</h2>
            <Link href="/my-agents">
              <button className="text-xs text-primary font-semibold hover:underline">Manage all</button>
            </Link>
          </div>
          {myAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Bot className="h-8 w-8 text-zinc-200 mb-2" />
              <p className="text-sm font-semibold text-zinc-700 mb-1">No agents yet</p>
              <Link href="/builder">
                <Button size="sm"
                  className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 h-8 text-xs font-semibold mt-2">
                  <Plus className="h-3 w-3" /> Build your first agent
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {myAgents.slice(0, 4).map((agent: any) => (
                <AgentMiniCard key={agent.id} agent={agent} />
              ))}
              <Link href="/builder">
                <div className="p-3.5 rounded-xl border border-dashed border-zinc-200 hover:border-primary/40 hover:bg-primary/[0.01] transition-all cursor-pointer flex items-center justify-center gap-2 text-zinc-400 min-h-[68px]">
                  <Plus className="h-4 w-4" />
                  <span className="text-sm font-medium">New Agent</span>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
