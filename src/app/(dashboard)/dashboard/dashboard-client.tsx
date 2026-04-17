"use client"

import Link from "next/link"
import {
  Zap, TrendingUp, Bot, DollarSign, ArrowRight,
  CheckCircle, XCircle, Clock, Star, Plus,
  Layers, BookOpen, Sparkles, Code2, Headphones, BarChart3,
  Brain, FlaskConical,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatCurrency, formatNumber, formatRelativeTime } from "@/lib/utils"

interface Props {
  profile: any
  recentExecutions: any[]
  myAgents: any[]
  totalExecutions: number
}

const STATUS_ICON: Record<string, any> = {
  success: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
  failed:  <XCircle    className="h-3.5 w-3.5 text-red-400"   />,
  running: <Clock      className="h-3.5 w-3.5 text-yellow-500 animate-spin" />,
  queued:  <Clock      className="h-3.5 w-3.5 text-zinc-400"  />,
}

// ── Starter templates — the "10-second wow" moment ────────────────────────────
// Each card pre-fills the builder with a ready-to-use system prompt.
const STARTER_TEMPLATES = [
  {
    id:         "support-bot",
    icon:       Headphones,
    color:      "bg-cyan-50 text-cyan-600",
    title:      "Customer Support Bot",
    desc:       "Answers FAQs, triages tickets, and drafts polite responses",
    category:   "customer_support",
    prompt:     "You are a friendly customer support specialist. When given a customer message:\n1. Identify the core issue or question\n2. Provide a clear, empathetic response\n3. Suggest next steps if needed\n4. Keep responses concise and professional\n\nAlways maintain a positive, helpful tone.",
  },
  {
    id:         "research-agent",
    icon:       FlaskConical,
    color:      "bg-teal-50 text-teal-600",
    title:      "Research Summariser",
    desc:       "Condenses long documents into key insights and action items",
    category:   "research",
    prompt:     "You are an expert research analyst. When given text or a topic:\n1. Extract the 3-5 most important insights\n2. Identify key data points and statistics\n3. List concrete action items or recommendations\n4. Note any limitations or caveats\n\nRespond in structured JSON: { insights, data_points, action_items, caveats }",
  },
  {
    id:         "code-reviewer",
    icon:       Code2,
    color:      "bg-blue-50 text-blue-600",
    title:      "Code Reviewer",
    desc:       "Reviews code for bugs, security issues, and best practices",
    category:   "coding",
    prompt:     "You are a senior software engineer performing code review. When given code:\n1. Identify bugs or logical errors\n2. Flag security vulnerabilities\n3. Suggest performance improvements\n4. Check for best practices and code style\n\nRespond in JSON: { bugs: [], security_issues: [], improvements: [], overall_quality: 'good|fair|poor', summary: '' }",
  },
  {
    id:         "data-analyst",
    icon:       BarChart3,
    color:      "bg-violet-50 text-violet-600",
    title:      "Data Analyst",
    desc:       "Interprets data, finds patterns, and generates insights",
    category:   "data_analysis",
    prompt:     "You are an expert data analyst. When given data (CSV, JSON, or description):\n1. Identify key trends and patterns\n2. Calculate relevant statistics\n3. Generate actionable insights\n4. Suggest visualisations or next analysis steps\n\nRespond in structured JSON: { trends, statistics, insights, recommendations }",
  },
  {
    id:         "content-writer",
    icon:       BookOpen,
    color:      "bg-pink-50 text-pink-600",
    title:      "Content Writer",
    desc:       "Writes blog posts, emails, and marketing copy in your voice",
    category:   "content",
    prompt:     "You are a professional content writer. When given a topic or brief:\n1. Write engaging, well-structured content\n2. Match the specified tone (professional/casual/technical)\n3. Include a strong opening hook\n4. End with a clear call to action\n\nReturn the full content as plain text, ready to publish.",
  },
  {
    id:         "decision-engine",
    icon:       Brain,
    color:      "bg-amber-50 text-amber-600",
    title:      "Decision Engine",
    desc:       "Analyses options, weighs trade-offs, and recommends decisions",
    category:   "other",
    prompt:     "You are a strategic decision advisor. When given a decision or situation:\n1. Identify all relevant options\n2. Analyse pros and cons of each\n3. Weigh risks vs rewards\n4. Provide a clear recommendation with rationale\n\nRespond in JSON: { options: [{ name, pros, cons, risk_level }], recommendation: '', rationale: '', confidence: 0-100 }",
  },
]

export function DashboardClient({ profile, recentExecutions, myAgents, totalExecutions }: Props) {
  const plan  = profile?.subscription_plan || "free"
  const quota = profile?.monthly_execution_quota || 100
  const used  = profile?.executions_used_this_month || 0
  const pct   = Math.min((used / quota) * 100, 100)

  const isNewUser = totalExecutions === 0 && myAgents.length === 0

  const hour     = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  const STATS = [
    { label: "Total Executions", value: formatNumber(totalExecutions), icon: Zap,         color: "text-primary",    bg: "bg-primary/6" },
    { label: "This Month",       value: formatNumber(used),            icon: TrendingUp,  color: "text-green-600",  bg: "bg-green-50" },
    { label: "My Agents",        value: formatNumber(myAgents.length), icon: Bot,         color: "text-violet-600", bg: "bg-violet-50" },
    { label: "Total Earned",     value: formatCurrency(profile?.total_earned || 0), icon: DollarSign, color: "text-amber-600", bg: "bg-amber-50" },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {greeting}, {profile?.full_name?.split(" ")[0] || "Developer"} 👋
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            {isNewUser
              ? "Welcome to AgentDyne. Build your first AI agent in under 5 minutes."
              : "Here's what's happening with your agents."}
          </p>
        </div>
        <Link href="/marketplace">
          <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
            <Zap className="h-4 w-4" /> Explore Agents
          </Button>
        </Link>
      </div>

      {/* ── NEW USER: Quick-start ─────────────────────────────────────────── */}
      {isNewUser && (
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-2xl p-6 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-yellow-400" />
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Quick Start</p>
          </div>
          <h2 className="text-lg font-bold mb-1">Three ways to get started</h2>
          <p className="text-sm text-zinc-400 mb-6">Pick the path that fits you best.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              {
                step: "1",
                title: "Try a marketplace agent",
                desc: "Browse 12,400+ production-ready agents. Deploy in one API call.",
                href: "/marketplace",
                cta: "Browse agents",
                icon: Zap,
              },
              {
                step: "2",
                title: "Build your own agent",
                desc: "Create an agent from a template in under 5 minutes.",
                href: "/builder",
                cta: "Open builder",
                icon: Bot,
              },
              {
                step: "3",
                title: "Create a pipeline",
                desc: "Chain agents together to build multi-step workflows.",
                href: "/pipelines",
                cta: "New pipeline",
                icon: Layers,
              },
            ].map(s => (
              <Link key={s.step} href={s.href}>
                <div className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-4 transition-all cursor-pointer group">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-full bg-white/15 text-white text-[10px] font-bold flex items-center justify-center">
                      {s.step}
                    </span>
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map(s => (
          <div key={s.label} className="bg-white border border-zinc-100 rounded-2xl p-5"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <p className="text-2xl font-bold text-zinc-900 nums">{s.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Two columns: usage + recent executions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Usage */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Monthly Usage</h2>
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
            Resets in ~{Math.max(0, Math.ceil((new Date(profile?.quota_reset_date || Date.now() + 86400000).getTime() - Date.now()) / 86400000))} days
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
        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">Recent Executions</h2>
            <Link href="/analytics">
              <button className="text-xs text-primary font-semibold hover:underline">View all</button>
            </Link>
          </div>
          {recentExecutions.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-10 h-10 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-3">
                <Zap className="h-5 w-5 text-zinc-400" />
              </div>
              <p className="text-sm text-zinc-500 mb-3">No executions yet</p>
              <Link href="/marketplace">
                <Button size="sm" className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700">
                  Try an Agent
                </Button>
              </Link>
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

      {/* ── STARTER TEMPLATES ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Starter Templates
            </h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              Click any template to open the builder pre-filled and ready to deploy
            </p>
          </div>
          <Link href="/builder">
            <button className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
              Build from scratch <ArrowRight className="h-3 w-3" />
            </button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {STARTER_TEMPLATES.map(t => (
            <Link
              key={t.id}
              href={`/builder?template=${t.id}&category=${t.category}&prompt=${encodeURIComponent(t.prompt)}`}
            >
              <div className="bg-white border border-zinc-100 rounded-2xl p-4 hover:border-primary/20 hover:shadow-md transition-all cursor-pointer group"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${t.color}`}>
                    <t.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 group-hover:text-primary transition-colors">
                      {t.title}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{t.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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

      {/* My Agents */}
      {myAgents.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900">My Published Agents</h2>
            <Link href="/my-agents">
              <button className="text-xs text-primary font-semibold hover:underline">Manage all</button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {myAgents.map((agent: any) => (
              <Link key={agent.id} href={`/builder/${agent.id}`}>
                <div className="p-3.5 rounded-xl border border-zinc-100 hover:border-primary/20 hover:bg-primary/[0.02] transition-all cursor-pointer">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      agent.status === "active" ? "bg-green-50 text-green-600" : "bg-zinc-100 text-zinc-500"
                    }`}>
                      {agent.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span className="flex items-center gap-1 nums"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
                    <span className="flex items-center gap-1 nums"><Star className="h-3 w-3" />{agent.average_rating?.toFixed(1) || "—"}</span>
                    <span className="flex items-center gap-1 nums ml-auto font-medium text-zinc-600">{formatCurrency(agent.total_revenue || 0)}</span>
                  </div>
                </div>
              </Link>
            ))}
            <Link href="/builder">
              <div className="p-3.5 rounded-xl border border-dashed border-zinc-200 hover:border-primary/40 hover:bg-primary/[0.02] transition-all cursor-pointer flex items-center justify-center gap-2 text-zinc-400 hover:text-primary min-h-[70px]">
                <Plus className="h-4 w-4" />
                <span className="text-sm font-medium">New Agent</span>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Platform capabilities overview for returning users */}
      {!isNewUser && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              href:  "/pipelines",
              icon:  Layers,
              color: "bg-primary/8 text-primary",
              title: "Multi-Agent Pipelines",
              desc:  "Chain agents to build automated workflows. Output of each agent feeds the next.",
            },
            {
              href:  "/marketplace",
              icon:  Zap,
              color: "bg-amber-50 text-amber-600",
              title: "Agent Marketplace",
              desc:  "12,400+ production-ready agents. Deploy via API in seconds.",
            },
            {
              href:  "/analytics",
              icon:  TrendingUp,
              color: "bg-green-50 text-green-600",
              title: "Analytics & Earnings",
              desc:  "Track execution volume, latency, costs, and revenue from your published agents.",
            },
          ].map(card => (
            <Link key={card.href} href={card.href}>
              <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-sm transition-all cursor-pointer group"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className={`w-9 h-9 rounded-xl ${card.color} flex items-center justify-center mb-3`}>
                  <card.icon className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-zinc-900 mb-1 group-hover:text-primary transition-colors">
                  {card.title}
                </p>
                <p className="text-xs text-zinc-400 leading-relaxed">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
