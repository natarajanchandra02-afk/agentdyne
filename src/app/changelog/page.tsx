import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Badge } from "@/components/ui/badge"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Changelog — AgentDyne" }

const RELEASES = [
  {
    version: "1.5.0",
    date: "March 31, 2026",
    type: "major",
    highlights: "MCP Server Marketplace + Builder Studio v2",
    changes: [
      { emoji: "🚀", text: "Launched MCP Server Marketplace — 40+ verified integrations across 12 categories" },
      { emoji: "⚡", text: "Builder Studio v2 — live playground, MCP server picker, version history" },
      { emoji: "💰", text: "Stripe Connect payouts — automated monthly seller payouts with 80/20 revenue split" },
      { emoji: "🌍", text: "Multi-region execution — iad1 (Virginia), sin1 (Singapore), syd1 (Sydney), lhr1 (London), bom1 (Mumbai)" },
      { emoji: "📊", text: "Advanced analytics — daily execution charts, category breakdown, seller revenue graphs" },
      { emoji: "🎨", text: "Apple-grade UI redesign — new design system, glassmorphism, smooth animations" },
      { emoji: "🔑", text: "API key management with SHA-256 hashing, usage tracking, and rate limiting" },
    ],
  },
  {
    version: "1.4.0",
    date: "March 1, 2026",
    type: "minor",
    highlights: "Admin Panel + Review System",
    changes: [
      { emoji: "🛡️", text: "Admin panel — agent moderation queue, user management, platform revenue dashboard" },
      { emoji: "⭐", text: "Review & rating system for marketplace agents with spam protection" },
      { emoji: "🔔", text: "Notification system — billing alerts, review notifications, agent approval status" },
      { emoji: "📧", text: "Transactional email via Resend — payment confirmations, payout notices" },
      { emoji: "🗂️", text: "Agent collections — curate and share public lists of favourite agents" },
    ],
  },
  {
    version: "1.3.0",
    date: "February 10, 2026",
    type: "minor",
    highlights: "Billing + OAuth",
    changes: [
      { emoji: "💳", text: "Stripe billing — Free, Starter ($19/mo), Pro ($79/mo), Enterprise plans" },
      { emoji: "🔐", text: "OAuth login — Google and GitHub single sign-on" },
      { emoji: "📈", text: "Seller portal — revenue dashboard, payout history, agent performance metrics" },
      { emoji: "🔒", text: "Row-level security across all database tables" },
      { emoji: "📱", text: "Fully responsive mobile layout" },
    ],
  },
  {
    version: "1.2.0",
    date: "January 20, 2026",
    type: "minor",
    highlights: "Marketplace Search + Filtering",
    changes: [
      { emoji: "🔍", text: "Full-text search across agent name, description, and documentation" },
      { emoji: "🏷️", text: "Category and pricing filters with URL-persistent state" },
      { emoji: "🎯", text: "Featured agents section with curated banners" },
      { emoji: "📊", text: "Agent detail page with playground, API docs, and reviews tab" },
      { emoji: "🚦", text: "Real-time execution status with latency and token tracking" },
    ],
  },
  {
    version: "1.1.0",
    date: "January 10, 2026",
    type: "patch",
    highlights: "Performance + Security",
    changes: [
      { emoji: "⚡", text: "50% reduction in cold start time for agent execution" },
      { emoji: "🛡️", text: "Rate limiting on all API endpoints — 100 req/min by default" },
      { emoji: "🔑", text: "API key authentication for programmatic access" },
      { emoji: "📉", text: "Reduced database query count by 60% via query optimisation" },
    ],
  },
  {
    version: "1.0.0",
    date: "January 1, 2026",
    type: "major",
    highlights: "Public Launch 🎉",
    changes: [
      { emoji: "🎉", text: "AgentDyne public launch — the world's first MCP-native agent marketplace" },
      { emoji: "🛒", text: "Marketplace with 500+ seed agents across 14 categories" },
      { emoji: "🏗️", text: "Agent builder with system prompt editor and model configuration" },
      { emoji: "🔌", text: "REST API v1 with OpenAPI documentation" },
      { emoji: "🤖", text: "Claude Sonnet 4, GPT-4o, and Gemini 1.5 Pro support" },
    ],
  },
]

const TYPE_CONFIG: Record<string, { label: string; class: string }> = {
  major: { label: "Major", class: "bg-primary/10 text-primary border-primary/20" },
  minor: { label: "Minor", class: "bg-green-500/10 text-green-500 border-green-500/20" },
  patch: { label: "Patch", class: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
}

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <div className="mb-12">
            <h1 className="text-4xl font-black tracking-tight mb-2">Changelog</h1>
            <p className="text-muted-foreground">Every update to AgentDyne, documented.</p>
          </div>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-0 top-0 bottom-0 w-px bg-border ml-4" />

            <div className="space-y-12">
              {RELEASES.map((release) => {
                const typeConfig = TYPE_CONFIG[release.type]
                return (
                  <div key={release.version} className="relative pl-14">
                    {/* Dot */}
                    <div className={`absolute left-0 w-9 h-9 rounded-xl border-2 flex items-center justify-center text-xs font-black ${
                      release.type === "major"
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-card text-foreground"
                    }`}>
                      {release.version.split(".")[0]}
                    </div>

                    {/* Header */}
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-xl font-black tracking-tight">v{release.version}</span>
                      <Badge className={`text-xs border ${typeConfig.class}`}>{typeConfig.label}</Badge>
                      <span className="text-sm text-muted-foreground">{release.date}</span>
                    </div>
                    <p className="text-sm font-semibold text-foreground mb-4">{release.highlights}</p>

                    {/* Changes */}
                    <div className="bg-card border border-border rounded-2xl p-5 space-y-2.5">
                      {release.changes.map((change) => (
                        <div key={change.text} className="flex items-start gap-3">
                          <span className="text-base flex-shrink-0 mt-0.5">{change.emoji}</span>
                          <p className="text-sm text-muted-foreground leading-relaxed">{change.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Subscribe */}
          <div className="mt-16 p-6 bg-primary/5 border border-primary/20 rounded-2xl text-center">
            <h3 className="font-bold mb-2">Stay up to date</h3>
            <p className="text-sm text-muted-foreground mb-4">Get notified about new features and releases.</p>
            <a href="https://twitter.com/agentdyne" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline font-medium">
              Follow @agentdyne on X →
            </a>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
