import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import {
  Rocket, Zap, DollarSign, Globe, BarChart3, Palette, Key,
  ShieldCheck, Star, Bell, Mail, LayoutGrid,
  Search, Filter, CreditCard, Github,
  Layers, Clock, TrendingUp, CheckCircle, Lock, Database,
  Network, Brain, GitBranch, Cpu, Shield, BookOpen,
} from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = { title: "Changelog — AgentDyne" }

const RELEASES = [
  // ─── v2.3.0 ──────────────────────────────────────────────────────────────
  {
    version:    "2.3.0",
    date:       "May 2026",
    type:       "major",
    highlights: "Cognitive Routing · WAL Replay · Security Hardening · Try Without Login · Referrals",
    changes: [
      {
        icon: Brain,
        text: "Cognitive Depth Routing — model-router.ts now auto-selects Haiku, Sonnet, or Opus based on prompt complexity, tool count, context size, and remaining credit budget. 70% of simple executions route to Haiku (12× cheaper than Sonnet). Cost savings percentage and routing reason returned in every execution response. Routing metadata stored in execution_traces.depth_assessment and executions.routing_reason for analytics.",
      },
      {
        icon: Database,
        text: "WAL-lite Replay Engine — every execution now writes a sequenced record to execution_wal (event type, model, tokens, cost, latency, routing payload). POST /api/executions/[id]/replay re-runs any past execution with optional model and temperature overrides, compares output hashes, and returns a structured diff with cost delta and latency delta. replay_sessions table tracks all replays for audit.",
      },
      {
        icon: Globe,
        text: "Try Without Login — anonymous users can now run any free agent directly from the marketplace without creating an account. Limit: 2 tries per IP per day (stored as SHA-256 hash, never raw IP). anonymous_usage table tracks daily counts. Sign-up CTA appears inline after limit is reached. X-RateLimit headers returned on every response.",
      },
      {
        icon: TrendingUp,
        text: "Referral System — every profile gets a unique ref_code (agd_XXXXXXXX). Sharing ?ref=CODE credit $5 to the referrer on the referred user's first paid execution. process_referral_signup() and process_referral_reward() RPCs handle the full lifecycle. Referrer notified via in-app notification. Expired referrals auto-cleaned by pg_cron.",
      },
      {
        icon: Key,
        text: "API Key Security Hardening — keys now hashed with HMAC-SHA256 (server secret) instead of plain SHA-256. Legacy keys auto-migrated to HMAC on next use. New columns: environment (production/test), allowed_agent_ids (scope to specific agents), ip_allowlist, last_used_ip, calls_today, errors_today, cost_total_usd, rate_limit_per_day. Key rotation: creates new key, old stays active 5 minutes then auto-revokes.",
      },
      {
        icon: ShieldCheck,
        text: "Security fixes — auth callback isSafePath() now blocks /@attacker open-redirect via @ character check. Admin reject action correctly sets agent status to rejected (was incorrectly setting draft, hiding the rejection banner from sellers). Stripe invoice webhook userId lookup now checks invoice.metadata as fallback preventing silent renewal failures. x-internal-service header replaced with HMAC signature on share-key pipeline calls.",
      },
      {
        icon: Shield,
        text: "Database security hardening — all 8 SECURITY DEFINER views replaced with security_invoker = on (fixes Supabase Advisor CRITICAL errors). All 44+ functions now include SET search_path = public (fixes search path injection warnings). System-only tables (injection_attempts, governance_events, processed_stripe_events, rate_limit_counters) RLS policies scoped to service_role only. anon role excess grants revoked from sensitive tables.",
      },
      {
        icon: Zap,
        text: "Pipeline execution fixes — HMAC verification was using undefined variable id instead of pipelineId causing ReferenceError on every share-key execution. nodeOutputs now correctly declared before the WAL resume block. pipeline_step_checkpoints table created with idempotent upsert on (execution_id, node_id). get_resumable_execution() RPC created. Status CHECK constraint accepts both completed and success naming conventions across migration versions.",
      },
      {
        icon: DollarSign,
        text: "Cost visibility — execution response now includes costSavedPct (e.g. Saved 83% using Haiku instead of Sonnet), routingReason, and complexity. X-Execution-Cost-USD and X-Model-Used headers added to all execute responses. X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Policy headers on all API responses. Free agent executions display Free · 0 credits used instead of $0.00.",
      },
      {
        icon: Rocket,
        text: "Support chat fixed — replaced @anthropic-ai/sdk (Node.js only, incompatible with Cloudflare Workers) with native fetch() calls to Anthropic API. Support agent now works correctly on edge runtime. Pipeline editor tabs now use spring-animated sliding pill (same as Builder settings page) via framer-motion layoutId.",
      },
      {
        icon: Star,
        text: "Builder improvements — Cmd+S saves agent, Cmd+Enter runs test, Cmd+1–4 switches tabs. Rejected agents now show red rejection banner and Resubmit for Review button. Test Run button disabled when agent status is not active. API key management page: key rotation, usage stats (calls today, errors today, cost total), last-used IP display, environment badges, expiry control, agent scope display.",
      },
      {
        icon: Globe,
        text: "Homepage rewrite — hero copy changed from The World's Premier Microagent Marketplace to Ship AI Agents That Actually Work in Production. Fake stats (12,400 agents / 89,000 developers / 4.2M API calls) replaced with honest numbers. Fake $12K testimonial and 89,000+ developers bullet in signup page replaced with honest copy. Category counts removed from homepage grid.",
      },
      {
        icon: Search,
        text: "Marketplace carousel — category filter row now has left and right arrow buttons with spring animation, gradient edge fades, and auto-hide when scroll is at start or end. Arrows appear/disappear based on scroll position tracked via ResizeObserver.",
      },
      {
        icon: Database,
        text: "Migrations 029–035 — API key hardening columns (029), observability routing schema (034), WAL replay tables (032), referral system (032), anonymous usage tracking (033), pipeline step checkpoints with resume RPC (035 fix). All migrations idempotent and safe to re-run.",
      },
    ],
  },
  // ─── v2.1.0 ──────────────────────────────────────────────────────────────
  {
    version:    "2.1.0",
    date:       "May 2026",
    type:       "major",
    highlights: "SDK GA · A2A Protocol · Agent Swarm Parallelism · SEO & Mobile",
    changes: [
      {
        icon: Zap,
        text: "SDK General Availability — Python (PyPI), TypeScript/JavaScript (npm), Ruby (RubyGems), and Go (pkg.go.dev) SDKs all reach v1.0.0 production status. Zero required dependencies for sync clients. Async variants via httpx (Python) and native Promises (TypeScript). Webhook signature verification included in all four SDKs.",
      },
      {
        icon: Network,
        text: "A2A (Agent-to-Agent) Protocol support — AgentDyne agents can now publish an Agent Card at /.well-known/agent.json and accept inbound task requests from other A2A-compliant agents. Outbound A2A calls are dispatched via the MCP tool-use loop, enabling cross-platform multi-agent workflows without a central orchestrator.",
      },
      {
        icon: Cpu,
        text: "Agent Swarm: parallel pipeline branches — Pipeline DAG engine now detects branch nodes (in-degree = 0 after root) and runs them concurrently via Promise.allSettled(). Reduces multi-step pipeline wall-clock time by up to 60% on branching graphs. continue_on_failure preserved per-node.",
      },
      {
        icon: Globe,
        text: "SEO metadata pass — generateMetadata() added to /marketplace, /pricing, /docs, /integrations, and /blog/[slug] pages. Structured data (JSON-LD) added to agent detail pages. sitemap.xml auto-generated from Supabase agent catalog on build.",
      },
      {
        icon: Brain,
        text: "Background RAG auto-embedding — knowledge sources saved via Builder → Behavior tab are now automatically ingested via a Supabase Edge Function cron triggered on agent upsert. No manual POST /api/rag/ingest step required after saving an agent.",
      },
      {
        icon: Bell,
        text: "Notification bell in Navbar — unread count badge and dropdown wired to /api/notifications. Execution completed, payout processed, and agent approved events surface as real-time toasts via Supabase Realtime channel subscriptions.",
      },
      {
        icon: ShieldCheck,
        text: "env.ts runtime validation — src/lib/env.ts checks all required environment variables (ANTHROPIC_API_KEY, SUPABASE_*, STRIPE_*) on cold start and throws a structured error listing every missing var. Cloudflare build fails fast rather than deploying a broken config.",
      },
      {
        icon: DollarSign,
        text: "Stripe webhook registration guide added to docs — checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, and invoice.payment_failed events are now documented with payload shapes and handler stubs. Supabase cron jobs for monthly quota reset, daily analytics aggregation, and agent score computation are now configured via pg_cron.",
      },
      {
        icon: Database,
        text: "Contact form wired to Resend — /contact POST now delivers messages to hello@agentdyne.com via Resend SDK. Form validation with Zod. Rate-limited to 5 submissions per IP per hour.",
      },
      {
        icon: Layers,
        text: "Mobile responsiveness audit complete — Builder wizard, Pipeline editor, and Executions list reviewed and patched for viewports < 640px. Sticky bottom CTA added to Builder wizard on mobile. Horizontal scroll replaced with collapsible sections on Pipeline editor.",
      },
    ],
  },
  // ─── v2.0.0 ──────────────────────────────────────────────────────────────
  {
    version:    "2.0.0",
    date:       "April 2026",
    type:       "major",
    highlights: "Agent Graph Engine · Registry · RAG-as-a-Service · Production Hardening",
    changes: [
      {
        icon: GitBranch,
        text: "Agent Registry (GET /api/registry/search + /api/registry/[id]) — capability-based discovery with composite quality scores, version history, and chain-suggestion graph. The Agent Graph Engine now selects agents automatically based on composite_score, input/output type compatibility, and routing preference (accuracy | speed | cost | balanced).",
      },
      {
        icon: Brain,
        text: "RAG-as-a-Service — POST /api/rag/ingest ingests text chunks and URLs into pgvector (text-embedding-3-small). POST /api/rag/query does cosine-similarity retrieval. Agent executions with a knowledge_base_id automatically inject top-5 retrieved chunks into the system prompt. Builders attach knowledge bases from the Behavior tab in Builder Studio.",
      },
      {
        icon: Network,
        text: "MCP tool-use loop wired into agent execution — agents with mcp_server_ids now pass tool definitions to the Anthropic messages API and loop on tool_use blocks. MCP server executor stubs are in src/lib and ready for real API credentials.",
      },
      {
        icon: Layers,
        text: "Pipelines: 'Use in Pipeline' button on every marketplace agent detail page pre-seeds the creation modal with that agent as Step 1. Pipelines page reads ?add_agent= from URL and opens modal automatically.",
      },
      {
        icon: Cpu,
        text: "Multi-provider model router (src/lib/model-router.ts) — agents configured with GPT-4o, Gemini 1.5 Pro, or vLLM no longer silently fail. Router dispatches to the correct provider based on model_name prefix (claude- → Anthropic, gpt- → OpenAI, gemini- → Google, vllm/ → vLLM).",
      },
      {
        icon: Shield,
        text: "Prompt injection filter (src/lib/injection-filter.ts) — 18 regex patterns covering instruction override, system prompt extraction, special token injection, jailbreak keywords, and data exfiltration. Blocked inputs return HTTP 400 with code: INJECTION_BLOCKED. All attempts are logged to the injection_attempts table for admin review.",
      },
      {
        icon: DollarSign,
        text: "Credits system fully wired — per-call agents now deduct credits on every successful execution using the deduct_credits() Postgres RPC (row-level lock prevents double-spend). Stripe webhook checkout.session.completed case added so credits purchases actually arrive in the wallet.",
      },
      {
        icon: Database,
        text: "Migration 009 applied — agent_registry_versions auto-snapshot trigger fires on agent approval (status → active). agent_capabilities view refreshed with knowledge_base_id. agent_graph_nodes view added for pipeline DAG engine.",
      },
      {
        icon: ShieldCheck,
        text: "Builder navigation hardened — builder/page.tsx now renders its own header (logo + breadcrumb + Dashboard back-link) instead of hiding the global navbar. Users are never stranded on a blank builder page with no navigation out.",
      },
      {
        icon: BookOpen,
        text: "Docs page accuracy pass — all API endpoint signatures, response shapes, and parameter names updated to match the live codebase. Pipelines (DAG), Registry, and Smart Routing sections added. Incorrect 'data' array key fixed to 'agents' for GET /api/agents.",
      },
    ],
  },
  // ─── v1.5.0 ──────────────────────────────────────────────────────────────
  {
    version:    "1.5.0",
    date:       "March 31, 2026",
    type:       "major",
    highlights: "MCP Server Marketplace + Builder Studio v2",
    changes: [
      { icon: Rocket,    text: "Launched MCP Server Marketplace — 40+ verified integrations across 12 categories" },
      { icon: Zap,       text: "Builder Studio v2 — live playground, MCP server picker, version history" },
      { icon: DollarSign,text: "Stripe Connect payouts — automated monthly seller payouts with 80/20 revenue split" },
      { icon: Globe,     text: "Multi-region execution — iad1, sin1, syd1, lhr1, bom1" },
      { icon: BarChart3, text: "Advanced analytics — daily execution charts, category breakdown, seller revenue graphs" },
      { icon: Palette,   text: "Apple-grade UI redesign — new design system, glassmorphism, smooth animations" },
      { icon: Key,       text: "API key management with SHA-256 hashing, usage tracking, and rate limiting" },
    ],
  },
  // ─── v1.4.0 ──────────────────────────────────────────────────────────────
  {
    version:    "1.4.0",
    date:       "March 1, 2026",
    type:       "minor",
    highlights: "Admin Panel + Review System",
    changes: [
      { icon: ShieldCheck, text: "Admin panel — agent moderation queue, user management, platform revenue dashboard" },
      { icon: Star,        text: "Review & rating system for marketplace agents with spam protection" },
      { icon: Bell,        text: "Notification system — billing alerts, review notifications, agent approval status" },
      { icon: Mail,        text: "Transactional email via Resend — payment confirmations, payout notices" },
      { icon: LayoutGrid,  text: "Agent collections — curate and share public lists of favourite agents" },
    ],
  },
  // ─── v1.3.0 ──────────────────────────────────────────────────────────────
  {
    version:    "1.3.0",
    date:       "February 10, 2026",
    type:       "minor",
    highlights: "Billing + OAuth",
    changes: [
      { icon: CreditCard, text: "Stripe billing — Free, Starter ($19/mo), Pro ($79/mo), Enterprise plans" },
      { icon: Github,     text: "OAuth login — Google and GitHub single sign-on" },
      { icon: TrendingUp, text: "Seller portal — revenue dashboard, payout history, agent performance metrics" },
      { icon: Lock,       text: "Row-level security across all database tables" },
      { icon: Layers,     text: "Fully responsive mobile layout" },
    ],
  },
  // ─── v1.2.0 ──────────────────────────────────────────────────────────────
  {
    version:    "1.2.0",
    date:       "January 20, 2026",
    type:       "minor",
    highlights: "Marketplace Search + Filtering",
    changes: [
      { icon: Search,     text: "Full-text search across agent name, description, and documentation" },
      { icon: Filter,     text: "Category and pricing filters with URL-persistent state" },
      { icon: Star,       text: "Featured agents section with curated banners" },
      { icon: BarChart3,  text: "Agent detail page with playground, API docs, and reviews tab" },
      { icon: Zap,        text: "Real-time execution status with latency and token tracking" },
    ],
  },
  // ─── v1.1.0 ──────────────────────────────────────────────────────────────
  {
    version:    "1.1.0",
    date:       "January 10, 2026",
    type:       "patch",
    highlights: "Performance + Security",
    changes: [
      { icon: Zap,        text: "50% reduction in cold start time for agent execution" },
      { icon: ShieldCheck,text: "Rate limiting on all API endpoints — 100 req/min by default" },
      { icon: Key,        text: "API key authentication for programmatic access" },
      { icon: Database,   text: "Reduced database query count by 60% via query optimisation" },
    ],
  },
  // ─── v1.0.0 ──────────────────────────────────────────────────────────────
  {
    version:    "1.0.0",
    date:       "January 1, 2026",
    type:       "major",
    highlights: "Public Launch",
    changes: [
      { icon: Rocket,     text: "AgentDyne public launch — the world's first MCP-native agent marketplace" },
      { icon: LayoutGrid, text: "Marketplace with 500+ seed agents across 14 categories" },
      { icon: Zap,        text: "Agent builder with system prompt editor and model configuration" },
      { icon: Globe,      text: "REST API v1 with OpenAPI documentation" },
      { icon: CheckCircle,text: "Claude Sonnet 4, GPT-4o, and Gemini 1.5 Pro support" },
    ],
  },
]

const TYPE_CONFIG: Record<string, { label: string; text: string }> = {
  major: { label: "Major", text: "bg-primary/8  text-primary  border-primary/20" },
  minor: { label: "Minor", text: "bg-green-50   text-green-600 border-green-100" },
  patch: { label: "Patch", text: "bg-amber-50   text-amber-600 border-amber-100" },
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

          {/* Timeline */}
          <div className="relative">
            <div className="absolute left-[17px] top-0 bottom-0 w-px bg-zinc-100" />

            <div className="space-y-12">
              {RELEASES.map(release => {
                const tc = TYPE_CONFIG[release.type]
                return (
                  <div key={release.version} className="relative pl-12">
                    {/* Circle */}
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
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${tc.text}`}>
                        {tc.label}
                      </span>
                      <span className="text-sm text-zinc-400">{release.date}</span>
                    </div>
                    <p className="text-sm font-semibold text-zinc-700 mb-4">{release.highlights}</p>

                    <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-3"
                      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      {release.changes.map((change, i) => (
                        <div key={i} className="flex items-start gap-3">
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
            <div className="flex justify-center gap-4 flex-wrap text-sm">
              <a href="https://twitter.com/agentdyne" target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline font-semibold">
                Follow @agentdyne
              </a>
              <span className="text-zinc-300">·</span>
              <Link href="/blog" className="text-zinc-600 hover:text-zinc-900 font-semibold">
                Blog
              </Link>
              <span className="text-zinc-300">·</span>
              <a href="https://discord.gg/agentdyne" target="_blank" rel="noopener noreferrer"
                className="text-zinc-600 hover:text-zinc-900 font-semibold">
                Discord
              </a>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
