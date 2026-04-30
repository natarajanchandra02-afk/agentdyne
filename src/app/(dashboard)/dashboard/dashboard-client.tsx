"use client"

import Link from "next/link"
import { useState } from "react"
import {
  Zap, TrendingUp, Bot, DollarSign, ArrowRight,
  CheckCircle, XCircle, Clock, Star, Plus,
  Layers, Sparkles, Code2, Headphones, BarChart3,
  Brain, FlaskConical, BookOpen, AlertTriangle,
  Play, ChevronRight, Flame, Target,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatCurrency, formatNumber, formatRelativeTime, cn } from "@/lib/utils"

interface Props {
  profile:          any
  recentExecutions: any[]
  myAgents:         any[]
  totalExecutions:  number
}

const STATUS_ICON: Record<string, any> = {
  success: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
  failed:  <XCircle    className="h-3.5 w-3.5 text-red-400"   />,
  running: <Clock      className="h-3.5 w-3.5 text-yellow-500 animate-spin" />,
  queued:  <Clock      className="h-3.5 w-3.5 text-zinc-400"  />,
}

const STARTER_TEMPLATES = [
  { id: "support-bot",     icon: Headphones, color: "bg-cyan-50 text-cyan-600",     title: "Customer Support Bot",   desc: "Answers FAQs, triages tickets, drafts replies",         category: "customer_support", prompt: "You are a friendly customer support specialist. When given a customer message:\n1. Identify the core issue\n2. Provide a clear, empathetic response\n3. Suggest next steps\n4. Keep responses concise\n\nAlways maintain a positive, helpful tone." },
  { id: "research-agent",  icon: FlaskConical, color: "bg-teal-50 text-teal-600",   title: "Research Summariser",    desc: "Condenses long docs into key insights + actions",       category: "research",         prompt: "You are an expert research analyst. When given text:\n1. Extract the 3-5 most important insights\n2. Identify key data points\n3. List concrete action items\n4. Note limitations\n\nRespond in JSON: { insights, data_points, action_items, caveats }" },
  { id: "code-reviewer",   icon: Code2,        color: "bg-blue-50 text-blue-600",   title: "Code Reviewer",          desc: "Reviews code for bugs, security, best practices",       category: "coding",           prompt: "You are a senior engineer doing code review. When given code:\n1. Identify bugs\n2. Flag security vulnerabilities\n3. Suggest improvements\n4. Check best practices\n\nRespond in JSON: { bugs, security_issues, improvements, overall_quality, summary }" },
  { id: "data-analyst",    icon: BarChart3,    color: "bg-violet-50 text-violet-600",title: "Data Analyst",          desc: "Interprets data, finds patterns, generates insights",   category: "data_analysis",    prompt: "You are an expert data analyst. When given data:\n1. Identify trends\n2. Calculate statistics\n3. Generate insights\n4. Suggest next steps\n\nRespond in JSON: { trends, statistics, insights, recommendations }" },
  { id: "content-writer",  icon: BookOpen,     color: "bg-pink-50 text-pink-600",   title: "Content Writer",         desc: "Writes blog posts, emails, and marketing copy",         category: "content",          prompt: "You are a professional content writer. When given a brief:\n1. Write engaging content\n2. Match the specified tone\n3. Include a strong hook\n4. End with a CTA\n\nReturn the full content as plain text." },
  { id: "decision-engine", icon: Brain,        color: "bg-amber-50 text-amber-600", title: "Decision Engine",        desc: "Analyses options, weighs trade-offs, recommends",       category: "other",            prompt: "You are a strategic decision advisor. When given a decision:\n1. Identify all options\n2. Analyse pros and cons\n3. Weigh risks vs rewards\n4. Provide a clear recommendation\n\nRespond in JSON: { options, recommendation, rationale, confidence }" },
]

// ── Contextual stat card ──────────────────────────────────────────────────────

function StatCard({ icon: Icon, color, bg, label, value, context, href }: {
  icon: any; color: string; bg: string; label: string
  value: string; context?: { message: string; cta?: string; ctaHref?: string }; href?: string
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="text-2xl font-bold text-zinc-900 nums">{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5 font-medium">{label}</p>
      {context && (
        <div className="mt-2 pt-2 border-t border-zinc-50">
          <p className="text-[11px] text-zinc-400 leading-relaxed">{context.message}</p>
          {context.cta && context.ctaHref && (
            <Link href={context.ctaHref}>
              <span className="text-[11px] text-primary font-semibold flex items-center gap-0.5 mt-1 hover:underline">
                {context.cta} <ChevronRight className="h-3 w-3" />
              </span>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// ── Agent card (dashboard preview) ───────────────────────────────────────────

function AgentMiniCard({ agent }: { agent: any }) {
  const hasRuns   = agent.total_executions > 0
  const isActive  = agent.status === "active"
  const isDraft   = agent.status === "draft"
  const inReview  = agent.status === "pending_review"

  return (
    <Link href={isActive ? `/marketplace/${agent.id}` : `/builder/${agent.id}`}>
      <div className="p-3.5 rounded-xl border border-zinc-100 hover:border-primary/20 hover:bg-primary/[0.02] transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold text-zinc-900 truncate pr-2">{agent.name}</span>
          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0",
            isActive  ? "bg-green-50 text-green-600" :
            inReview  ? "bg-amber-50 text-amber-600" :
                        "bg-zinc-100 text-zinc-500")}>
            {isActive ? "Active" : inReview ? "In Review" : "Draft"}
          </span>
        </div>

        {hasRuns ? (
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1 nums"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
            <span className="flex items-center gap-1 nums"><Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{agent.average_rating?.toFixed(1) || "—"}</span>
            <span className="flex items-center gap-1 nums font-semibold text-zinc-700 ml-auto">
              <DollarSign className="h-3 w-3 text-green-500" />{formatCurrency(agent.total_revenue || 0)}
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400">
            {isDraft   ? "Complete setup to start earning →" :
             inReview  ? "Awaiting review — est. <24h" :
                         "Publish to start earning"}
          </p>
        )}
      </div>
    </Link>
  )
}

// ─── Dashboard Client ─────────────────────────────────────────────────────────

export function DashboardClient({ profile, recentExecutions, myAgents, totalExecutions }: Props) {
  const plan       = profile?.subscription_plan || "free"
  const isFreePlan = plan === "free"
  // Free plan: 50 LIFETIME executions — mirrors PLAN_QUOTAS.free in constants.ts
  // Paid plans: monthly_execution_quota from profile row
  const FREE_LIFETIME_CAP = 50
  const quota = isFreePlan
    ? FREE_LIFETIME_CAP
    : (profile?.monthly_execution_quota || 500)
  const used = isFreePlan
    ? (profile?.lifetime_executions_used || 0)
    : (profile?.executions_used_this_month || 0)
  const pct = Math.min((used / quota) * 100, 100)

  const isNewUser      = totalExecutions === 0 && myAgents.length === 0
  const hasAgentsNoRuns = myAgents.length > 0 && totalExecutions === 0

  const hour     = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  const STATS = [
    {
      label: "Total Executions", value: formatNumber(totalExecutions),
      icon: Zap, color: "text-primary", bg: "bg-primary/6",
      context: totalExecutions === 0
        ? { message: "No executions yet.", cta: "Run your first agent", ctaHref: "/marketplace" }
        : undefined,
    },
    {
      label: isFreePlan ? "Lifetime Used" : "This Month", value: formatNumber(used),
      icon: TrendingUp, color: "text-green-600", bg: "bg-green-50",
      context: used === 0
        ? { message: isFreePlan ? `${quota} lifetime calls available. Start executing.` : `${quota} calls available this month. Start executing.` }
        : undefined,
    },
    {
      label: "My Agents", value: formatNumber(myAgents.length),
      icon: Bot, color: "text-violet-600", bg: "bg-violet-50",
      context: myAgents.length === 0
        ? { message: "Build an agent in 5 min.", cta: "Open builder", ctaHref: "/builder" }
        : hasAgentsNoRuns
          ? { message: `${myAgents.length} agent${myAgents.length > 1 ? "s" : ""} ready — run one now.`, cta: "Go to marketplace", ctaHref: "/marketplace" }
          : undefined,
    },
    {
      label: "Total Earned", value: formatCurrency(profile?.total_earned || 0),
      icon: DollarSign, color: "text-amber-600", bg: "bg-amber-50",
      context: (profile?.total_earned || 0) === 0
        ? { message: "Publish agents to start earning.", cta: "Publish an agent", ctaHref: "/my-agents" }
        : undefined,
    },
  ]

  return (
    <div className="space-y-8">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {greeting}, {profile?.full_name?.split(" ")[0] || "there"} 👋
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            {isNewUser        ? "Start automating in 2 minutes — no setup required." :
             hasAgentsNoRuns  ? `You've built ${myAgents.length} agent${myAgents.length > 1 ? "s" : ""} — now run one and start earning.` :
                                "Here's what's happening with your workspace."}
          </p>
        </div>
      </div>

      {/* ── HERO: Compose widget (primary action — always first) ─────────── */}
      <ComposeWidget />

      {/* ── PROGRESSION: has agents, zero runs ───────────────────────────── */}
      {hasAgentsNoRuns && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Target className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-900 mb-0.5">
              You've built {myAgents.length} agent{myAgents.length > 1 ? "s" : ""} — now run one
            </p>
            <p className="text-xs text-zinc-500">
              Agents only earn when they run. Head to the marketplace to execute yours.
            </p>
          </div>
          <Link href="/marketplace">
            <Button size="sm" className="rounded-xl bg-amber-500 text-white hover:bg-amber-600 gap-1.5 font-semibold flex-shrink-0">
              <Play className="h-3.5 w-3.5" /> Run an agent
            </Button>
          </Link>
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map(s => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* ── Templates (top priority for new users) ────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Starter Templates
            </h2>
            <p className="text-sm text-zinc-400 mt-0.5">Click any to open the builder pre-filled and ready to deploy</p>
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
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${t.color}`}>
                    <t.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 group-hover:text-primary transition-colors">{t.title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{t.desc}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <span className="text-[10px] font-medium bg-zinc-50 border border-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full capitalize">
                    {t.category.replace("_", " ")}
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

      {/* ── NEW USER quick-start ───────────────────────────────────────────── */}
      {isNewUser && (
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Flame className="h-4 w-4 text-yellow-400" />
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Start in 2 minutes</p>
          </div>
          <h2 className="text-lg font-bold mb-1">Three paths to your first agent</h2>
          <p className="text-sm text-zinc-400 mb-6">Pick the path that fits you best.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { step: "1", title: "Try a marketplace agent",  desc: "Browse production-ready agents. Deploy in one API call.",            href: "/marketplace",  cta: "Browse agents", icon: Zap },
              { step: "2", title: "Build your own agent",     desc: "Create an agent from a template in under 5 minutes.",               href: "/builder",       cta: "Open builder",  icon: Bot },
              { step: "3", title: "Describe your goal",       desc: "AI selects agents, builds a pipeline, and runs it for you.",         href: "/compose",       cta: "Try composer",  icon: Sparkles },
            ].map(s => (
              <Link key={s.step} href={s.href}>
                <div className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 transition-all cursor-pointer group">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-full bg-white/15 text-white text-[10px] font-bold flex items-center justify-center">{s.step}</span>
                    <s.icon className="h-4 w-4 text-white/60" />
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

      {/* ── Usage + Recent executions ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Usage */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">{isFreePlan ? "Lifetime Usage" : "Monthly Usage"}</h2>
            <span className="text-xs bg-primary/8 text-primary px-2.5 py-0.5 rounded-full font-semibold capitalize">{plan}</span>
          </div>
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-2 font-medium">
              <span className="text-zinc-500">API Calls</span>
              <span className="text-zinc-900 nums">{formatNumber(used)} / {quota === -1 ? "∞" : formatNumber(quota)}</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
          <p className="text-[11px] text-zinc-400">
            {isFreePlan
              ? `${Math.max(0, quota - used)} lifetime executions remaining`
              : `Resets in ~${Math.max(0, Math.ceil((new Date(profile?.quota_reset_date || Date.now() + 86400000).getTime() - Date.now()) / 86400000))} days`}
          </p>
          {plan === "free" && (
            <Link href="/billing" className="block mt-4">
              <button className="w-full text-xs text-primary font-semibold flex items-center justify-center gap-1 py-2 rounded-xl border border-primary/20 hover:bg-primary/5 transition-colors">
                Upgrade for more calls <ArrowRight className="h-3 w-3" />
              </button>
            </Link>
          )}
        </div>

        {/* Recent executions */}
        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Recent Executions</h2>
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
              <p className="text-xs text-zinc-400 mb-3 max-w-xs">
                Run an agent from the marketplace or describe a goal in the Composer to get started.
              </p>
              <div className="flex gap-2">
                <Link href="/compose">
                  <Button size="sm" className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 h-7 text-xs">
                    <Sparkles className="h-3 w-3" /> Try Composer
                  </Button>
                </Link>
                <Link href="/marketplace">
                  <Button size="sm" variant="outline" className="rounded-xl border-zinc-200 h-7 text-xs">
                    Browse Agents
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {recentExecutions.map((exec: any) => (
                <div key={exec.id} className="flex items-center justify-between py-2.5 border-b border-zinc-50 last:border-0">
                  <div className="flex items-center gap-2.5">
                    {STATUS_ICON[exec.status] || STATUS_ICON.queued}
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{exec.agents?.name || "Deleted Agent"}</p>
                      <p className="text-xs text-zinc-400">{formatRelativeTime(exec.created_at)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 nums">{exec.latency_ms ? `${exec.latency_ms}ms` : "—"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── My Agents ─────────────────────────────────────────────────────── */}
      {myAgents.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">My Agents</h2>
            <Link href="/my-agents">
              <button className="text-xs text-primary font-semibold hover:underline">Manage all</button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {myAgents.slice(0, 5).map((agent: any) => (
              <AgentMiniCard key={agent.id} agent={agent} />
            ))}
            <Link href="/builder">
              <div className="p-3.5 rounded-xl border border-dashed border-zinc-200 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.01] transition-all cursor-pointer flex items-center justify-center gap-2 text-zinc-400 min-h-[70px]">
                <Plus className="h-4 w-4" />
                <span className="text-sm font-medium">New Agent</span>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* ── Actionable bottom cards (returning users only) ─────────────────── */}
      {!isNewUser && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { href: "/pipelines/new", icon: Layers,    color: "bg-primary/8 text-primary",   title: "Build a Pipeline", desc: "Chain agents into multi-step workflows.",    cta: "Create pipeline" },
            { href: "/marketplace",   icon: Zap,       color: "bg-amber-50 text-amber-600",   title: "Explore Marketplace", desc: "12,400+ production-ready agents.",         cta: "Browse agents"   },
            { href: "/analytics",     icon: TrendingUp, color: "bg-green-50 text-green-600",  title: "View Analytics",   desc: "Track executions, costs, and earnings.",     cta: "Open analytics"  },
          ].map(card => (
            <Link key={card.href} href={card.href}>
              <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-sm transition-all cursor-pointer group"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className={`w-9 h-9 rounded-xl ${card.color} flex items-center justify-center mb-3`}>
                  <card.icon className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-zinc-900 mb-1 group-hover:text-primary transition-colors">{card.title}</p>
                <p className="text-xs text-zinc-400 leading-relaxed mb-3">{card.desc}</p>
                <span className="text-xs text-primary font-semibold flex items-center gap-1 group-hover:gap-2 transition-all">
                  {card.cta} <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Inline compose widget ─────────────────────────────────────────────────────

function ComposeWidget() {
  const [goal, setGoal] = useState("")

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
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => {
                if (e.key === "Enter" && goal.trim()) {
                  window.location.href = `/compose?goal=${encodeURIComponent(goal.trim())}`
                }
              }}
              placeholder="e.g. Summarise support tickets and draft replies…"
              className="flex-1 h-9 px-3 rounded-xl border border-primary/20 bg-white/80 text-sm placeholder:text-zinc-400 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
            />
            <Link href={goal.trim() ? `/compose?goal=${encodeURIComponent(goal.trim())}` : "/compose"}>
              <Button className="rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold gap-1.5 h-9 flex-shrink-0">
                <Play className="h-3.5 w-3.5" /> Run
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            {["Analyse sales data", "Translate to 3 languages", "Review this code", "Draft support reply"].map(eg => (
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
