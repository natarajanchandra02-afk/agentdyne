import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Badge } from "@/components/ui/badge"
import {
  Rocket, Zap, DollarSign, Globe, BarChart3, Palette, Key,
  ShieldCheck, Star, Bell, Mail, LayoutGrid,
  Search, Filter, CreditCard, Github,
  Layers, Clock, TrendingUp, CheckCircle, Lock, Database,
} from "lucide-react"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Changelog — AgentDyne" }

const RELEASES = [
  {
    version: "1.5.0",
    date: "March 31, 2026",
    type: "major",
    highlights: "MCP Server Marketplace + Builder Studio v2",
    changes: [
      { icon: Rocket,    text: "Launched MCP Server Marketplace — 40+ verified integrations across 12 categories" },
      { icon: Zap,       text: "Builder Studio v2 — live playground, MCP server picker, version history" },
      { icon: DollarSign,text: "Stripe Connect payouts — automated monthly seller payouts with 80/20 revenue split" },
      { icon: Globe,     text: "Multi-region execution — iad1 (Virginia), sin1 (Singapore), syd1 (Sydney), lhr1 (London), bom1 (Mumbai)" },
      { icon: BarChart3, text: "Advanced analytics — daily execution charts, category breakdown, seller revenue graphs" },
      { icon: Palette,   text: "Apple-grade UI redesign — new design system, glassmorphism, smooth animations" },
      { icon: Key,       text: "API key management with SHA-256 hashing, usage tracking, and rate limiting" },
    ],
  },
  {
    version: "1.4.0",
    date: "March 1, 2026",
    type: "minor",
    highlights: "Admin Panel + Review System",
    changes: [
      { icon: ShieldCheck, text: "Admin panel — agent moderation queue, user management, platform revenue dashboard" },
      { icon: Star,        text: "Review & rating system for marketplace agents with spam protection" },
      { icon: Bell,        text: "Notification system — billing alerts, review notifications, agent approval status" },
      { icon: Mail,        text: "Transactional email via Resend — payment confirmations, payout notices" },
      { icon: LayoutGrid,  text: "Agent collections — curate and share public lists of favourite agents" },
    ],
  },
  {
    version: "1.3.0",
    date: "February 10, 2026",
    type: "minor",
    highlights: "Billing + OAuth",
    changes: [
      { icon: CreditCard, text: "Stripe billing — Free, Starter ($19/mo), Pro ($79/mo), Enterprise plans" },
      { icon: Github,     text: "OAuth login — Google and GitHub single sign-on" },
      { icon: TrendingUp, text: "Seller portal — revenue dashboard, payout history, agent performance metrics" },
      { icon: Lock,       text: "Row-level security across all database tables" },
      { icon: Layers,     text: "Fully responsive mobile layout" },
    ],
  },
  {
    version: "1.2.0",
    date: "January 20, 2026",
    type: "minor",
    highlights: "Marketplace Search + Filtering",
    changes: [
      { icon: Search,     text: "Full-text search across agent name, description, and documentation" },
      { icon: Filter,     text: "Category and pricing filters with URL-persistent state" },
      { icon: Star,       text: "Featured agents section with curated banners" },
      { icon: BarChart3,  text: "Agent detail page with playground, API docs, and reviews tab" },
      { icon: Zap,        text: "Real-time execution status with latency and token tracking" },
    ],
  },
  {
    version: "1.1.0",
    date: "January 10, 2026",
    type: "patch",
    highlights: "Performance + Security",
    changes: [
      { icon: Zap,       text: "50% reduction in cold start time for agent execution" },
      { icon: ShieldCheck,text:"Rate limiting on all API endpoints — 100 req/min by default" },
      { icon: Key,       text: "API key authentication for programmatic access" },
      { icon: Database,  text: "Reduced database query count by 60% via query optimisation" },
    ],
  },
  {
    version: "1.0.0",
    date: "January 1, 2026",
    type: "major",
    highlights: "Public Launch",
    changes: [
      { icon: Rocket,    text: "AgentDyne public launch — the world's first MCP-native agent marketplace" },
      { icon: LayoutGrid,text: "Marketplace with 500+ seed agents across 14 categories" },
      { icon: Zap,       text: "Agent builder with system prompt editor and model configuration" },
      { icon: Globe,     text: "REST API v1 with OpenAPI documentation" },
      { icon: CheckCircle,text:"Claude Sonnet 4, GPT-4o, and Gemini 1.5 Pro support" },
    ],
  },
]

const TYPE_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  major: { label: "Major", dot: "bg-primary",    text: "bg-primary/8 text-primary border-primary/20" },
  minor: { label: "Minor", dot: "bg-green-500",  text: "bg-green-50 text-green-600 border-green-100" },
  patch: { label: "Patch", dot: "bg-amber-400",  text: "bg-amber-50 text-amber-600 border-amber-100" },
}

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <div className="mb-12">
            <h1 className="text-4xl font-black tracking-tight text-zinc-900 mb-2">Changelog</h1>
            <p className="text-zinc-500">Every update to AgentDyne, documented.</p>
          </div>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[17px] top-0 bottom-0 w-px bg-zinc-100" />

            <div className="space-y-12">
              {RELEASES.map((release) => {
                const tc = TYPE_CONFIG[release.type]
                return (
                  <div key={release.version} className="relative pl-12">
                    {/* Circle dot */}
                    <div className={`absolute left-0 w-9 h-9 rounded-xl border-2 flex items-center justify-center text-xs font-black ${
                      release.type === "major"
                        ? "border-primary bg-primary text-white"
                        : "border-zinc-200 bg-white text-zinc-600"
                    }`}>
                      {release.version.split(".")[0]}
                    </div>

                    {/* Header */}
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-xl font-black tracking-tight text-zinc-900">v{release.version}</span>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${tc.text}`}>{tc.label}</span>
                      <span className="text-sm text-zinc-400">{release.date}</span>
                    </div>
                    <p className="text-sm font-semibold text-zinc-700 mb-4">{release.highlights}</p>

                    <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-3"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      {release.changes.map((change) => (
                        <div key={change.text} className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <change.icon className="h-3.5 w-3.5 text-zinc-500" />
                          </div>
                          <p className="text-sm text-zinc-600 leading-relaxed">{change.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-16 p-6 bg-zinc-50 border border-zinc-100 rounded-2xl text-center">
            <h3 className="font-bold text-zinc-900 mb-2">Stay up to date</h3>
            <p className="text-sm text-zinc-500 mb-4">Get notified about new features and releases.</p>
            <a href="https://twitter.com/agentdyne" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-semibold">
              Follow @agentdyne on X
            </a>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
