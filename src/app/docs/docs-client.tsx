"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Book, Code2, Zap, Key, Webhook, Database,
  Copy, Check, ExternalLink,
  Shield, BarChart3, Bot, Play, Lock, RefreshCw, Activity,
  Layers, Network, GitBranch, Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// Code samples — stored outside JSX to avoid parser confusion with
// Python f-string syntax and JSX template interpolations.
// ─────────────────────────────────────────────────────────────────────────────

const CODE_CURL_QUICKSTART = `curl -X POST https://agentdyne.com/api/agents/AGENT_ID/execute \\
  -H "Authorization: Bearer agd_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Summarise this: Q3 revenue grew 40% YoY..."}'`

const CODE_JSON_QUICKSTART = `{
  "executionId": "exec_abc123",
  "output": "Q3 revenue increased 40% YoY...",
  "latencyMs": 842,
  "tokens": { "input": 124, "output": 87 },
  "cost": 0.00312
}`

const CODE_AUTH_HEADER = `Authorization: Bearer agd_YourApiKeyHere`

// The correct API response shape — confirmed against /api/agents route.ts:
// GET /api/agents returns { agents: [...], pagination: {...} }
// NOT { data: [...] }
const CODE_AGENTS_CURL = `# List agents — response is { agents: [...], pagination: {...} }
curl "https://agentdyne.com/api/agents?category=coding&sort=rating&limit=10" \\
  -H "Authorization: Bearer agd_your_key"

# Response shape:
# {
#   "agents": [...],
#   "pagination": { "total", "page", "limit", "pages", "hasNext", "hasPrev" }
# }

# Create an agent
curl -X POST https://agentdyne.com/api/agents/create \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "My Agent", "description": "...", "category": "coding",
        "pricing_model": "free", "system_prompt": "You are...",
        "model_name": "claude-sonnet-4-20250514",
        "temperature": 0.7, "max_tokens": 4096 }'`

const CODE_EXECUTE_TS = `// Synchronous
const res = await fetch("https://agentdyne.com/api/agents/AGENT_ID/execute", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + process.env.AGENTDYNE_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ input: "Your input here" }),
})
const { executionId, output, latencyMs, tokens, cost } = await res.json()

// Streaming (server-sent events) — Anthropic models only
const stream = await fetch("https://agentdyne.com/api/agents/AGENT_ID/execute", {
  method: "POST",
  headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
  body: JSON.stringify({ input: "Write a blog post", stream: true }),
})
const reader = stream.body.getReader()
// Each chunk: { type: "delta", delta: "..." } | { type: "done", executionId: "..." }`

const CODE_PIPELINE_QUICKSTART = `# Create a pipeline with a 2-node DAG
curl -X POST https://agentdyne.com/api/pipelines \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Research → Summarise",
    "dag": {
      "nodes": [
        { "id": "n1", "agent_id": "RESEARCH_AGENT_ID", "label": "Research" },
        { "id": "n2", "agent_id": "SUMMARISE_AGENT_ID", "label": "Summarise",
          "continue_on_failure": false }
      ],
      "edges": [{ "from": "n1", "to": "n2" }]
    }
  }'

# Execute the pipeline — output of n1 is automatically the input to n2
curl -X POST https://agentdyne.com/api/pipelines/PIPELINE_ID/execute \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "input": "Explain the history of the internet" }'`

const CODE_REGISTRY_CURL = `# Find all agents that can summarise text, sorted by quality
curl "https://agentdyne.com/api/registry/search?capability=summarize&prefer=accuracy&limit=5" \\
  -H "Authorization: Bearer agd_your_key"

# Get full registry entry for one agent (schema, versions, quality)
curl "https://agentdyne.com/api/registry/AGENT_ID" \\
  -H "Authorization: Bearer agd_your_key"

# Machine-readable capability graph (external tool manifest)
curl "https://agentdyne.com/api/discover?capability=classify&max_cost=0.01" \\
  -H "Authorization: Bearer agd_your_key"`

const CODE_DISCOVER_CURL = `# Cost-aware agent routing — pick the best agent for a task
curl -X POST https://agentdyne.com/api/agents/route \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "task": "summarise a legal contract",
    "category": "legal",
    "prefer": "accuracy",
    "max_cost_usd": 0.05
  }'
# Returns: { matched: true, recommendation: { agent_id, name, reasoning }, alternatives: [...] }`

const CODE_EXECUTIONS_CURL = `# List recent executions
curl "https://agentdyne.com/api/executions?status=failed&limit=20" \\
  -H "Authorization: Bearer agd_your_key"`

const CODE_QUOTA_CURL = `# Get your quota usage
curl "https://agentdyne.com/api/user/quota" \\
  -H "Authorization: Bearer agd_your_key"
# => { "plan": "pro", "quota": 10000, "used": 3752, "remaining": 6248,
#      "percentUsed": 37.52, "resetsAt": "2026-05-01T00:00:00Z" }`

const CODE_WEBHOOK_JSON = `{
  "id":        "evt_abc123",
  "type":      "execution.completed",
  "timestamp": "2026-04-17T12:00:00Z",
  "data": {
    "executionId": "exec_xyz",
    "agentId":     "agent_abc",
    "status":      "success",
    "latencyMs":   842,
    "tokens":      { "input": 124, "output": 87 }
  }
}

// All event types:
// execution.completed   execution.failed
// agent.approved        agent.rejected
// subscription.created  subscription.updated  subscription.canceled
// payout.processed      review.posted`

const CODE_ERROR_JSON = `{
  "error": "Human-readable error message",
  "code":  "MACHINE_READABLE_CODE"
}`

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar sections
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "quickstart",     label: "Quick Start",        icon: Zap },
  { id: "authentication", label: "Authentication",      icon: Key },
  { id: "execute",        label: "Execute Agent",       icon: Play },
  { id: "agents-api",    label: "Agents API",          icon: Bot },
  { id: "pipelines",     label: "Pipelines (DAG)",     icon: Layers },
  { id: "registry",      label: "Agent Registry",      icon: Network },
  { id: "routing",       label: "Smart Routing",       icon: GitBranch },
  { id: "executions-api",label: "Executions API",      icon: BarChart3 },
  { id: "user-api",      label: "User & Quota",        icon: Shield },
  { id: "webhooks",      label: "Webhooks",            icon: Webhook },
  { id: "rate-limits",   label: "Rate Limits",         icon: Shield },
  { id: "errors",        label: "Error Codes",         icon: BarChart3 },
]

const AUTH_FEATURES = [
  { icon: Lock,      title: "Secure",       desc: "Keys are SHA-256 hashed. AgentDyne cannot see your raw key." },
  { icon: RefreshCw, title: "Rotatable",    desc: "Create and revoke keys from your API Keys dashboard." },
  { icon: Activity,  title: "Trackable",    desc: "Each key tracks total calls, last used date, and quota." },
  { icon: Zap,       title: "Rate-limited", desc: "60 req/min default per key. Enterprise: custom limits." },
]

const AGENTS_ENDPOINTS = [
  { method: "GET",  path: "/api/agents",                desc: "List active agents. Params: q, category, pricing, sort (popular|rating|newest|revenue), page, limit. Returns { agents: [...], pagination: {...} }." },
  { method: "POST", path: "/api/agents/create",         desc: "Create a new agent (draft). Body: name, description, category, pricing_model, system_prompt, model_name, temperature, max_tokens. Returns the created agent object." },
  { method: "GET",  path: "/api/agents/{id}",           desc: "Get a single active agent with seller profile." },
  { method: "PATCH",path: "/api/agents/{id}",           desc: "Update capability_tags (seller-only, session auth required)." },
  { method: "POST", path: "/api/agents/{id}/execute",   desc: "Execute an agent. Body: { input, stream? }. Supports sync and streaming. Enforces quota and subscription gating." },
  { method: "GET",  path: "/api/agents/{id}/score",     desc: "Get quality score breakdown for an agent." },
  { method: "GET",  path: "/api/agents/{id}/reviews",   desc: "List approved reviews. Params: page, limit." },
  { method: "POST", path: "/api/agents/{id}/reviews",   desc: "Post a review. Requires at least one prior successful execution." },
]

const PIPELINE_ENDPOINTS = [
  { method: "GET",    path: "/api/pipelines",           desc: "List your pipelines. Params: public=true, page, limit. Returns { data: [...], pagination: {...} }." },
  { method: "POST",   path: "/api/pipelines",           desc: "Create a pipeline. Body: name, description, dag { nodes[], edges[] }, is_public, timeout_seconds." },
  { method: "GET",    path: "/api/pipelines/{id}",      desc: "Get pipeline with enriched agent data per node." },
  { method: "PATCH",  path: "/api/pipelines/{id}",      desc: "Update pipeline. Allowed fields: name, description, dag, is_public, is_active, timeout_seconds, retry_on_failure, max_retries, tags." },
  { method: "DELETE", path: "/api/pipelines/{id}",      desc: "Delete a pipeline (owner only)." },
  { method: "POST",   path: "/api/pipelines/{id}/execute", desc: "Execute pipeline DAG. Body: { input, variables? }. Output of each node is automatically the input to downstream nodes." },
]

const REGISTRY_ENDPOINTS = [
  { method: "GET", path: "/api/registry/search",       desc: "Capability-based agent search. Params: capability, capabilities (comma list), input_type, output_type, category, max_cost, min_score, prefer (accuracy|speed|cost|balanced), limit." },
  { method: "GET", path: "/api/registry/{id}",         desc: "Full registry entry for one agent: schema, quality, version history, MCP tools, execution endpoints." },
  { method: "GET", path: "/api/discover",              desc: "OpenAI-compatible tool manifest for agent-to-agent discovery. Used by AI planners to select tools." },
  { method: "POST",path: "/api/agents/route",          desc: "Smart agent routing. Body: { task, category?, max_cost_usd?, prefer?, capability? }. Returns best matching agent with reasoning." },
]

const EXECUTIONS_ENDPOINTS = [
  { method: "GET", path: "/api/executions",            desc: "List your executions. Params: agentId, status, since (ISO 8601), page, limit." },
  { method: "GET", path: "/api/executions/{id}",       desc: "Get a single execution by ID." },
]

const USER_ENDPOINTS = [
  { method: "GET",   path: "/api/user/me",             desc: "Full profile including subscription plan and Stripe onboarding status." },
  { method: "PATCH", path: "/api/user/me",             desc: "Update: full_name, username, bio, website, company, avatar_url." },
  { method: "GET",   path: "/api/user/quota",          desc: "Quota usage: plan, quota, used, remaining, percentUsed, resetsAt." },
]

const RATE_LIMIT_ROWS = [
  { plan: "Free",       monthly: "100",       rpm: "10",     c: "1" },
  { plan: "Starter",    monthly: "1,000",     rpm: "30",     c: "3" },
  { plan: "Pro",        monthly: "10,000",    rpm: "60",     c: "10" },
  { plan: "Enterprise", monthly: "Unlimited", rpm: "Custom", c: "Custom" },
]

const ERROR_ROWS = [
  { code: "400", title: "Bad Request",           desc: "Missing or invalid parameters." },
  { code: "401", title: "Unauthorized",          desc: "Missing, invalid, or revoked API key." },
  { code: "402", title: "Payment Required",      desc: "Insufficient credits. Top up in Billing." },
  { code: "403", title: "Forbidden",             desc: "Subscription required (SUBSCRIPTION_REQUIRED) or not the resource owner." },
  { code: "404", title: "Not Found",             desc: "Agent, execution, or resource does not exist." },
  { code: "408", title: "Request Timeout",       desc: "Pipeline execution exceeded timeout_seconds." },
  { code: "413", title: "Payload Too Large",     desc: "Input exceeds 32 KB limit." },
  { code: "429", title: "Too Many Requests",     desc: "Rate limit or monthly quota exhausted (QUOTA_EXCEEDED)." },
  { code: "500", title: "Internal Server Error", desc: "AgentDyne server error — retry with exponential back-off." },
]

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative rounded-xl border border-zinc-200 bg-zinc-950 overflow-hidden my-4">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <span className="text-xs text-zinc-400 font-mono">{language}</span>
        <button onClick={copy}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-sm font-mono text-slate-300 overflow-x-auto whitespace-pre leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function SectionHeader({ id, title, desc }: { id: string; title: string; desc: string }) {
  return (
    <div id={id} className="scroll-mt-24 pt-10 pb-4 border-b border-zinc-100 mb-6">
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h2>
      <p className="text-zinc-500 mt-1.5 text-sm">{desc}</p>
    </div>
  )
}

function MethodBadge({ method }: { method: string }) {
  const cls =
    method === "GET"    ? "bg-blue-50 text-blue-700 border-blue-100" :
    method === "PATCH"  ? "bg-amber-50 text-amber-700 border-amber-100" :
    method === "DELETE" ? "bg-red-50 text-red-700 border-red-100" :
                          "bg-green-50 text-green-700 border-green-100"
  return (
    <span className={cn("font-mono text-xs font-bold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5", cls)}>
      {method}
    </span>
  )
}

function EndpointList({ endpoints }: { endpoints: { method: string; path: string; desc: string }[] }) {
  return (
    <div className="space-y-3">
      {endpoints.map(e => (
        <div key={e.method + e.path}
          className="bg-white border border-zinc-100 rounded-xl p-4 flex items-start gap-3"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <MethodBadge method={e.method} />
          <div className="min-w-0">
            <code className="font-mono text-sm text-zinc-900">{e.path}</code>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{e.desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export default function DocsClient() {
  const [activeSection, setActiveSection] = useState("quickstart")

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 py-10">

          {/* ── Sidebar ─────────────────────────────────────────────────── */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24">
              <p className="section-header mb-3">Documentation</p>
              <nav className="space-y-0.5">
                {SECTIONS.map(s => (
                  <a key={s.id} href={"#" + s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                      activeSection === s.id
                        ? "bg-primary/8 text-primary"
                        : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                    )}>
                    <s.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    {s.label}
                  </a>
                ))}
              </nav>
              <div className="mt-6 pt-6 border-t border-zinc-100">
                <p className="section-header mb-3">Resources</p>
                <div className="space-y-0.5">
                  {[
                    { label: "API Status",      href: "https://status.agentdyne.com" },
                    { label: "GitHub",           href: "https://github.com/agentdyne" },
                    { label: "Discord",          href: "https://discord.gg/agentdyne" },
                    { label: "Publishing Guide", href: "/PUBLISHING_GUIDE.md" },
                  ].map(r => (
                    <a key={r.label} href={r.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 transition-all">
                      {r.label} <ExternalLink className="h-3 w-3 ml-auto" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* ── Content ─────────────────────────────────────────────────── */}
          <main className="flex-1 min-w-0">

            {/* Hero */}
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
                <Book className="h-3.5 w-3.5" /> API v1
              </div>
              <h1 className="text-4xl font-black tracking-tight text-zinc-900 mb-3">
                AgentDyne Documentation
              </h1>
              <p className="text-lg text-zinc-500 max-w-2xl">
                Everything you need to build, deploy, and monetize with AgentDyne.
                Single agents, multi-agent pipelines, Agent Registry, and MCP integrations.
              </p>
              <div className="flex gap-3 mt-5">
                <Link href="/marketplace">
                  <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                    <Bot className="h-4 w-4" /> Browse Agents
                  </Button>
                </Link>
                <Link href="/builder">
                  <Button variant="outline" className="rounded-xl border-zinc-200 gap-2 font-semibold">
                    <Code2 className="h-4 w-4" /> Build an Agent
                  </Button>
                </Link>
              </div>
            </div>

            {/* ── Quick Start ─────────────────────────────────────────── */}
            <SectionHeader id="quickstart" title="Quick Start"
              desc="Your first agent call in under 2 minutes." />
            <p className="text-sm text-zinc-500 mb-2">
              Get your API key from the{" "}
              <Link href="/api-keys" className="text-primary hover:underline font-medium">
                API Keys dashboard
              </Link>, then:
            </p>
            <CodeBlock language="bash" code={CODE_CURL_QUICKSTART} />
            <p className="text-sm text-zinc-500 mb-2">Response:</p>
            <CodeBlock language="json" code={CODE_JSON_QUICKSTART} />

            {/* ── Authentication ──────────────────────────────────────── */}
            <SectionHeader id="authentication" title="Authentication"
              desc="All API requests require a valid API key." />
            <CodeBlock language="bash" code={CODE_AUTH_HEADER} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {AUTH_FEATURES.map(f => (
                <div key={f.title} className="bg-white border border-zinc-100 rounded-xl p-4"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/8 flex items-center justify-center">
                      <f.icon className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <p className="font-semibold text-zinc-900 text-sm">{f.title}</p>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>

            {/* ── Execute Agent ────────────────────────────────────────── */}
            <SectionHeader id="execute" title="Execute Agent"
              desc="Run any agent synchronously or stream output token-by-token." />
            <CodeBlock language="typescript" code={CODE_EXECUTE_TS} />

            {/* ── Agents API ───────────────────────────────────────────── */}
            <SectionHeader id="agents-api" title="Agents API"
              desc="List, search, create, and manage agents. NOTE: list response key is 'agents', not 'data'." />
            <EndpointList endpoints={AGENTS_ENDPOINTS} />
            <CodeBlock language="bash" code={CODE_AGENTS_CURL} />

            {/* ── Pipelines ────────────────────────────────────────────── */}
            <SectionHeader id="pipelines" title="Pipelines (Multi-Agent DAG)"
              desc="Chain agents into multi-step workflows. Output of node N becomes input to node N+1." />
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 mb-4">
              <strong>How it works:</strong> Create a pipeline with a DAG (Directed Acyclic Graph) of agent nodes.
              When you execute it, nodes run in topological order. Each node's output is automatically passed to
              downstream nodes. Nodes can be configured with <code>continue_on_failure: true</code> so the pipeline
              doesn't abort on a single node error.
            </div>
            <EndpointList endpoints={PIPELINE_ENDPOINTS} />
            <CodeBlock language="bash" code={CODE_PIPELINE_QUICKSTART} />

            {/* ── Agent Registry ───────────────────────────────────────── */}
            <SectionHeader id="registry" title="Agent Registry"
              desc="Machine-readable capability discovery. Used by the Agent Graph Engine and AI planners." />
            <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-4 mb-4 text-sm text-zinc-600 leading-relaxed">
              <strong className="text-zinc-900">Registry vs Discover:</strong>{" "}
              <code className="font-mono text-xs bg-white border border-zinc-200 px-1.5 py-0.5 rounded">/api/registry/search</code>{" "}
              is for internal routing with quality-score preference weighting.{" "}
              <code className="font-mono text-xs bg-white border border-zinc-200 px-1.5 py-0.5 rounded">/api/discover</code>{" "}
              returns an OpenAI-compatible tool manifest for external AI planners.
              Both are backed by the same <code>agent_capabilities</code> view.
            </div>
            <EndpointList endpoints={REGISTRY_ENDPOINTS} />
            <CodeBlock language="bash" code={CODE_REGISTRY_CURL} />

            {/* ── Smart Routing ────────────────────────────────────────── */}
            <SectionHeader id="routing" title="Smart Agent Routing"
              desc="Let AgentDyne pick the best agent for your task automatically." />
            <CodeBlock language="bash" code={CODE_DISCOVER_CURL} />

            {/* ── Executions API ───────────────────────────────────────── */}
            <SectionHeader id="executions-api" title="Executions API"
              desc="Retrieve your execution history." />
            <EndpointList endpoints={EXECUTIONS_ENDPOINTS} />
            <CodeBlock language="bash" code={CODE_EXECUTIONS_CURL} />

            {/* ── User & Quota ─────────────────────────────────────────── */}
            <SectionHeader id="user-api" title="User & Quota API"
              desc="Access your profile, subscription plan, and quota usage." />
            <EndpointList endpoints={USER_ENDPOINTS} />
            <CodeBlock language="bash" code={CODE_QUOTA_CURL} />

            {/* ── Webhooks ─────────────────────────────────────────────── */}
            <SectionHeader id="webhooks" title="Webhooks"
              desc="Receive real-time events pushed to your endpoint." />
            <p className="text-sm text-zinc-500 mb-4">
              Register a webhook URL in{" "}
              <Link href="/settings" className="text-primary hover:underline font-medium">Settings</Link>.
              Every event is signed with <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-xs font-mono text-zinc-700">HMAC-SHA256</code> —
              verify the <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-xs font-mono text-zinc-700">X-AgentDyne-Signature</code> header.
            </p>
            <CodeBlock language="json" code={CODE_WEBHOOK_JSON} />

            {/* ── Rate Limits ──────────────────────────────────────────── */}
            <SectionHeader id="rate-limits" title="Rate Limits"
              desc="Limits apply per API key and vary by plan." />
            <div className="overflow-hidden rounded-xl border border-zinc-100">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    {["Plan", "Calls/month", "Req/min per key", "Concurrency"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {RATE_LIMIT_ROWS.map(r => (
                    <tr key={r.plan} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-zinc-900 text-sm">{r.plan}</td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-sm nums">{r.monthly}</td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-sm nums">{r.rpm}</td>
                      <td className="px-4 py-3 text-zinc-500 text-sm">{r.c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-zinc-400 mt-2">
              Response headers:{" "}
              <code className="bg-zinc-50 border border-zinc-100 px-1 py-0.5 rounded font-mono">X-RateLimit-Remaining</code>{" "}
              <code className="bg-zinc-50 border border-zinc-100 px-1 py-0.5 rounded font-mono">X-RateLimit-Reset</code>{" "}
              <code className="bg-zinc-50 border border-zinc-100 px-1 py-0.5 rounded font-mono">Retry-After</code>
            </p>

            {/* ── Error Codes ──────────────────────────────────────────── */}
            <SectionHeader id="errors" title="Error Codes"
              desc="Standard HTTP status codes with AgentDyne machine-readable codes." />
            <div className="space-y-2">
              {ERROR_ROWS.map(e => (
                <div key={e.code}
                  className="flex items-start gap-4 p-4 bg-white border border-zinc-100 rounded-xl"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <span className={cn(
                    "font-mono text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0",
                    parseInt(e.code) >= 500
                      ? "bg-red-50 text-red-700 border border-red-100"
                      : "bg-amber-50 text-amber-700 border border-amber-100"
                  )}>
                    {e.code}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-zinc-900">{e.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <CodeBlock language="json" code={CODE_ERROR_JSON} />

            {/* CTA */}
            <div className="mt-12 mb-8 p-6 bg-zinc-50 border border-zinc-100 rounded-2xl text-center">
              <h3 className="font-bold text-zinc-900 text-lg mb-2">Need help?</h3>
              <p className="text-zinc-500 text-sm mb-4">
                Our team responds within 4 hours on Pro and Enterprise plans.
              </p>
              <div className="flex justify-center gap-3">
                <a href="https://discord.gg/agentdyne" target="_blank" rel="noopener noreferrer">
                  <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                    Join Discord
                  </Button>
                </a>
                <Link href="/contact">
                  <Button variant="outline" className="rounded-xl border-zinc-200 font-semibold">
                    Contact Support
                  </Button>
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>
      <Footer />
    </div>
  )
}
