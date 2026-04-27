"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import {
  Book, Code2, Zap, Key, Webhook,
  Copy, Check, ExternalLink, Shield, BarChart3, Bot, Play,
  Lock, RefreshCw, Activity, Database, GitMerge, Layers,
  CreditCard, Network, Cpu,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"

// ─── Code samples (plain constants — no JSX interpolation risk) ──────────────

const CODE_QUICKSTART = `curl -X POST https://agentdyne.com/api/agents/AGENT_ID/execute \\
  -H "Authorization: Bearer agd_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Summarise this: Q3 revenue grew 40% YoY…"}'`

const CODE_QUICKSTART_RESP = `{
  "executionId": "exec_abc123",
  "output": {
    "summary": "Q3 revenue increased 40% year-over-year.",
    "keyPoints": ["Revenue up 40%", "Strong Q4 outlook"]
  },
  "latencyMs": 842,
  "tokens": { "input": 124, "output": 87 },
  "cost": 0.00312
}`

const CODE_AUTH = `Authorization: Bearer agd_YourApiKeyHere
# Also accepted:
X-API-Key: agd_YourApiKeyHere`

const CODE_EXECUTE_SYNC = `// TypeScript — synchronous
const res = await fetch("https://agentdyne.com/api/agents/AGENT_ID/execute", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + process.env.AGENTDYNE_API_KEY,
    "Content-Type":  "application/json",
  },
  body: JSON.stringify({ input: "Summarise this email thread…" }),
})
const { executionId, output, latencyMs, tokens, cost } = await res.json()`

const CODE_EXECUTE_STREAM = `// Streaming (server-sent events)
const res = await fetch("https://agentdyne.com/api/agents/AGENT_ID/execute", {
  method: "POST",
  headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
  body:   JSON.stringify({ input: "Write a blog post about AI agents", stream: true }),
})
const reader = res.body.getReader()
const dec    = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const lines = dec.decode(value).split("\\n")
  for (const line of lines) {
    if (!line.startsWith("data:")) continue
    const data = JSON.parse(line.slice(5))
    if (data.type === "delta") process.stdout.write(data.delta)
    if (data.type === "done")  console.log("\\nDone in", data.latencyMs, "ms")
  }
}`

const CODE_AGENTS_LIST = `# List active agents in the "coding" category, sorted by rating
curl "https://agentdyne.com/api/agents?category=coding&sort=rating&limit=10" \\
  -H "Authorization: Bearer agd_your_key"

# Response
{
  "data": [{ "id": "…", "name": "…", "description": "…", "pricing_model": "free" }],
  "pagination": { "total": 284, "page": 1, "limit": 10, "pages": 29 }
}`

const CODE_AGENTS_CREATE = `curl -X POST https://agentdyne.com/api/agents/create \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name":          "Email Classifier",
    "description":   "Classifies support emails into categories",
    "category":      "customer_support",
    "pricing_model": "free",
    "system_prompt": "You are an email classifier. Return JSON: { category, priority }",
    "model_name":    "claude-sonnet-4-20250514",
    "temperature":   0.3,
    "max_tokens":    1024
  }'`

const CODE_PIPELINE_CREATE = `# 1. Create a pipeline
curl -X POST https://agentdyne.com/api/pipelines \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Research → Summarise → Email",
    "description": "Full research pipeline",
    "dag": {
      "nodes": [
        { "id": "n1", "agent_id": "RESEARCHER_AGENT_ID", "label": "Research" },
        { "id": "n2", "agent_id": "SUMMARISER_AGENT_ID", "label": "Summarise" },
        { "id": "n3", "agent_id": "EMAIL_DRAFT_AGENT_ID",  "label": "Email Draft" }
      ],
      "edges": [
        { "from": "n1", "to": "n2" },
        { "from": "n2", "to": "n3" }
      ]
    },
    "timeout_seconds": 120
  }'`

const CODE_PIPELINE_RUN = `# 2. Execute the pipeline
curl -X POST https://agentdyne.com/api/pipelines/PIPELINE_ID/execute \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{ "input": "Research recent AI breakthroughs in robotics" }'

# Response — per-node traces + final output
{
  "executionId":  "pex_abc",
  "status":       "success",
  "output":       "Dear team, here is the latest on robotics AI…",
  "node_results": [
    { "node_id": "n1", "status": "success", "latency_ms": 1240, "cost": 0.003 },
    { "node_id": "n2", "status": "success", "latency_ms": 820,  "cost": 0.002 },
    { "node_id": "n3", "status": "success", "latency_ms": 640,  "cost": 0.001 }
  ],
  "summary": { "total_latency_ms": 2700, "total_cost_usd": "0.006000" }
}`

const CODE_RAG_SETUP = `# 1. Create a knowledge base
curl -X POST https://agentdyne.com/api/rag/knowledge-bases \\
  -H "Authorization: Bearer agd_your_key" \\
  -d '{ "name": "Product Docs", "description": "Internal product documentation" }'
# => { "id": "kb_abc123", "name": "Product Docs", "doc_count": 0 }

# 2. Ingest a document (up to 100KB per request, 1000 docs per KB)
curl -X POST https://agentdyne.com/api/rag/ingest \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "knowledge_base_id": "kb_abc123",
    "title":   "Getting Started Guide",
    "content": "## Installation\\n\\nnpm install @agentdyne/sdk…",
    "chunk_size": 1200,
    "chunk_overlap": 200
  }'
# => { "document_id": "doc_xyz", "chunks_indexed": 8, "status": "indexed" }

# 3. Attach knowledge base to your agent (via Builder Studio or API)
curl -X PATCH https://agentdyne.com/api/agents/AGENT_ID \\
  -d '{ "knowledge_base_id": "kb_abc123" }'`

const CODE_RAG_QUERY = `# Semantic retrieval — called by the execute route automatically when
# the agent has a knowledge_base_id attached. You can also call it directly:
curl -X POST https://agentdyne.com/api/rag/query \\
  -H "Authorization: Bearer agd_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "knowledge_base_id": "kb_abc123",
    "query":    "How do I install the SDK?",
    "top_k":    5,
    "threshold": 0.65
  }'
# Returns: { results: [{ content, document_title, similarity }], context_string }
# The context_string can be injected into an agent system prompt directly.`

const CODE_AGENTIC_RAG = `// Agentic RAG — agent decides when to retrieve via tool calls
// Add this to your agent's system prompt:
const AGENTIC_SYSTEM_PROMPT = \`
You are a knowledgeable assistant with access to a knowledge base tool.

When asked a question that requires specific factual information:
1. Call search_knowledge_base(query) to retrieve relevant context
2. Use the returned context to formulate an accurate answer
3. Cite the source document when referencing specific facts
4. If no relevant context is found, clearly state the knowledge base
   does not contain information on this topic

Always prefer retrieved context over your training data for domain-specific questions.
\``

const CODE_REGISTRY = `# Machine-readable agent discovery — "DNS for agents"
# Find all agents that can summarise text in under $0.01/call
curl "https://agentdyne.com/api/registry?capabilities=summarize&max_cost=0.01&prefer=cost" \\
  -H "Authorization: Bearer agd_your_key"

# Response — machine-optimised (no UI cruft)
{
  "agents": [
    {
      "id":       "agent_abc",
      "endpoint": "https://agentdyne.com/api/agents/agent_abc/execute",
      "capability_tags": ["summarize","extract","classify"],
      "pricing":  { "model": "per_call", "price_per_call": 0.005 },
      "quality":  { "composite_score": 91.2, "accuracy_score": 94.1 }
    }
  ],
  "capability_graph": { "summarize": ["agent_abc", "agent_def"] },
  "composition_hints": [
    { "chain": ["agent_abc","agent_def"], "compatible_on": ["text"] }
  ]
}

# Full schema for a specific agent (input/output schemas, versions, seller)
curl "https://agentdyne.com/api/registry/AGENT_ID"`

const CODE_CREDITS = `# Get current credit balance
curl https://agentdyne.com/api/credits \\
  -H "Authorization: Bearer agd_your_key"
# => { "balance": 12.50, "hard_limit": 50, "low_balance": false }

# Purchase credits (creates Stripe Checkout session)
curl -X POST https://agentdyne.com/api/credits \\
  -H "Authorization: Bearer agd_your_key" \\
  -d '{ "package_id": "credits_20" }'
# packages: credits_5 ($5), credits_20 ($22), credits_50 ($57), credits_100 ($120)
# => { "url": "https://checkout.stripe.com/…" }`

const CODE_MCP = `// Attach MCP tools to an agent via the Builder Studio or API:
// PUT /api/agents/AGENT_ID (PATCH the mcp_servers field)

// In your system prompt, reference the tools by name:
const SYSTEM_PROMPT = \`
You have access to the following tools:
- GitHub: read repositories, create pull requests, manage issues
- Supabase: query tables, run SQL, fetch records
- Slack: send messages, read channels

When the user asks you to perform an action that requires one of these tools,
use the tool explicitly before responding. Always confirm the action was
completed successfully before reporting to the user.
\`

// Available MCP servers in Builder Studio:
// databases: supabase, postgres, mysql, mongodb, redis
// communication: gmail, slack, twilio, discord
// productivity: google-calendar, notion, google-drive, linear, asana
// development: github, filesystem, browserbase, puppeteer
// cloud: aws, gcp, cloudflare, vercel
// ai: anthropic, openai, pinecone, qdrant
// finance: stripe, plaid
// marketing: hubspot, salesforce`

const CODE_WEBHOOK = `// Register a webhook URL in Settings → Webhooks
// Every event is signed with HMAC-SHA256 in X-AgentDyne-Signature

// Next.js App Router handler:
export async function POST(req: Request) {
  const sig  = req.headers.get("x-agentdyne-signature") ?? ""
  const body = await req.text()

  // Verify signature (prevents spoofed events)
  const expected = await computeHmac(process.env.AGENTDYNE_WEBHOOK_SECRET!, body)
  if (sig !== expected) return new Response("Unauthorized", { status: 401 })

  const event = JSON.parse(body)
  switch (event.type) {
    case "execution.completed":  await onExecutionDone(event.data);  break
    case "execution.failed":     await onExecutionFailed(event.data); break
    case "agent.approved":       await onAgentApproved(event.data);  break
    case "payout.processed":     await recordPayout(event.data);     break
  }
  return Response.json({ received: true })
}

// Event types:
// execution.completed | execution.failed
// agent.approved | agent.rejected
// subscription.created | subscription.updated | subscription.canceled
// payout.processed | review.posted | credits.low`

const CODE_ERRORS = `// Every error response has this shape:
{
  "error": "Human-readable message",
  "code":  "MACHINE_READABLE_CODE",   // e.g. QUOTA_EXCEEDED, INSUFFICIENT_CREDITS
  "retryAfter": 60                    // only on 429
}

// Common codes:
// QUOTA_EXCEEDED          — monthly call limit reached; upgrade plan
// INSUFFICIENT_CREDITS    — balance < agent price; top up at /billing
// SUBSCRIPTION_REQUIRED   — agent requires active subscription
// INJECTION_BLOCKED       — input rejected by security filter
// AGENT_NOT_CONFIGURED    — system prompt missing or too short`

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar sections
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "quickstart",   label: "Quick Start",       icon: Zap },
  { id: "auth",         label: "Authentication",    icon: Key },
  { id: "execute",      label: "Execute Agent",     icon: Play },
  { id: "agents",       label: "Agents API",        icon: Bot },
  { id: "pipelines",    label: "Pipelines API",     icon: GitMerge },
  { id: "rag",          label: "RAG & Knowledge",   icon: Database },
  { id: "registry",     label: "Agent Registry",    icon: Network },
  { id: "credits",      label: "Credits API",       icon: CreditCard },
  { id: "mcp",          label: "MCP Integrations",  icon: Layers },
  { id: "webhooks",     label: "Webhooks",          icon: Webhook },
  { id: "rate-limits",  label: "Rate Limits",       icon: Shield },
  { id: "errors",       label: "Error Codes",       icon: BarChart3 },
]

const AGENTS_ENDPOINTS = [
  { method: "GET",   path: "/api/agents",                      desc: "List active agents. Params: q, category, pricing_model, sort (popular|rating|newest), page, limit." },
  { method: "GET",   path: "/api/agents/{id}",                 desc: "Single agent detail with full seller profile and version history." },
  { method: "POST",  path: "/api/agents/create",               desc: "Create a new agent (server-validated). Returns { id, name, slug, status: 'draft' }." },
  { method: "PATCH", path: "/api/agents/{id}",                 desc: "Update agent fields: system_prompt, model_name, pricing, capability_tags, knowledge_base_id." },
  { method: "POST",  path: "/api/agents/{id}/execute",         desc: "Execute agent. Enforces quota, credits, injection filter, streaming (stream: true)." },
  { method: "GET",   path: "/api/agents/{id}/reviews",         desc: "List approved reviews. Params: page, limit." },
  { method: "POST",  path: "/api/agents/{id}/reviews",         desc: "Post a review (1–5 stars). Requires prior successful execution." },
]

const PIPELINE_ENDPOINTS = [
  { method: "GET",   path: "/api/pipelines",                  desc: "List your pipelines. Params: public=true for public ones, limit, page." },
  { method: "POST",  path: "/api/pipelines",                  desc: "Create pipeline. Body: { name, description, dag: { nodes, edges }, timeout_seconds }." },
  { method: "GET",   path: "/api/pipelines/{id}",             desc: "Single pipeline with full DAG definition." },
  { method: "PATCH", path: "/api/pipelines/{id}",             desc: "Update DAG, name, timeout, visibility." },
  { method: "DELETE",path: "/api/pipelines/{id}",             desc: "Delete pipeline and all execution history." },
  { method: "POST",  path: "/api/pipelines/{id}/execute",     desc: "Run pipeline DAG. Returns per-node traces, final output, total cost + latency." },
]

const RAG_ENDPOINTS = [
  { method: "GET",   path: "/api/rag/knowledge-bases",        desc: "List knowledge bases you own." },
  { method: "POST",  path: "/api/rag/knowledge-bases",        desc: "Create knowledge base. Body: { name, description, is_public }. Max 10 per account." },
  { method: "POST",  path: "/api/rag/ingest",                 desc: "Ingest document. Body: { knowledge_base_id, content, title, chunk_size, chunk_overlap }. Max 100KB." },
  { method: "GET",   path: "/api/rag/ingest?knowledge_base_id=", desc: "List documents in a knowledge base." },
  { method: "DELETE",path: "/api/rag/ingest?document_id=",    desc: "Delete a document and all its chunks." },
  { method: "POST",  path: "/api/rag/query",                  desc: "Semantic search. Body: { knowledge_base_id, query, top_k, threshold }. Returns context_string." },
]

const REGISTRY_ENDPOINTS = [
  { method: "GET",   path: "/api/registry",                   desc: "Capability-based agent discovery. Params: capabilities, category, input_type, output_type, max_cost, min_score, prefer (accuracy|speed|cost|balanced), limit." },
  { method: "GET",   path: "/api/registry/{id}",              desc: "Full machine-readable agent schema: input_schema, output_schema, capability_tags, version history, seller." },
]

const CREDITS_ENDPOINTS = [
  { method: "GET",   path: "/api/credits",                    desc: "Balance, hard_limit, alert_threshold, transaction history. Params: page, limit." },
  { method: "POST",  path: "/api/credits",                    desc: "Create Stripe Checkout session to top up. Body: { package_id }. Returns { url }." },
]

const RATE_ROWS = [
  { plan: "Free",       monthly: "50 lifetime",  rpm: "3",      c: "1"      },
  { plan: "Starter",    monthly: "500",          rpm: "10",     c: "3"      },
  { plan: "Pro",        monthly: "5,000",        rpm: "30",     c: "10"     },
  { plan: "Enterprise", monthly: "Unlimited",    rpm: "200",    c: "50"     },
]

const ERROR_ROWS = [
  { code: "400", title: "Bad Request",           cls: "ValidationError",           desc: "Missing or invalid parameters. Check agentId format and body JSON." },
  { code: "401", title: "Unauthorized",          cls: "AuthenticationError",        desc: "Missing, invalid, or revoked API key." },
  { code: "402", title: "Payment Required",      cls: "InsufficientCreditsError",   desc: "Credit balance below agent price (INSUFFICIENT_CREDITS)." },
  { code: "403", title: "Forbidden",             cls: "SubscriptionRequiredError",  desc: "Agent requires subscription (SUBSCRIPTION_REQUIRED) or PLAN_RESTRICTION." },
  { code: "403", title: "Email Not Verified",    cls: "EMAIL_NOT_VERIFIED",         desc: "Verify your email before running agents." },
  { code: "403", title: "Account Banned",        cls: "AccountBanned",             desc: "Account suspended — contact support@agentdyne.com." },
  { code: "404", title: "Not Found",             cls: "NotFoundError",             desc: "Agent, pipeline, or resource does not exist." },
  { code: "413", title: "Payload Too Large",     cls: "InputTooLarge",             desc: "Input exceeds 32KB limit for your plan." },
  { code: "422", title: "Content Policy",        cls: "CONTENT_POLICY",            desc: "Input blocked by safety guardrails. See blocked_by field." },
  { code: "429", title: "Quota Exceeded",        cls: "QUOTA_EXCEEDED",            desc: "Monthly execution quota reached. Upgrade or wait for next billing cycle." },
  { code: "429", title: "Lifetime Limit",        cls: "LIFETIME_QUOTA_EXCEEDED",   desc: "Free plan 50-execution lifetime limit reached. Upgrade to Starter." },
  { code: "429", title: "Compute Cap",           cls: "COMPUTE_CAP_EXCEEDED",      desc: "Monthly USD compute cap reached ($10 Starter / $50 Pro). Upgrade for higher cap." },
  { code: "429", title: "Concurrency Limit",     cls: "CONCURRENCY_LIMIT",         desc: "Too many simultaneous executions. Free=1, Starter=3, Pro=10." },
  { code: "429", title: "Rate Limit",            cls: "RateLimitError",            desc: "Too many requests per minute. Retry-After header contains wait seconds." },
  { code: "500", title: "Server Error",          cls: "InternalServerError",       desc: "AgentDyne error. Retry with exponential back-off. ExecutionId is preserved for retry." },
]

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Code({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden my-4">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <span className="text-xs text-zinc-400 font-mono">{lang}</span>
        <button onClick={copy}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto whitespace-pre leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function SH({ id, title, desc }: { id: string; title: string; desc: string }) {
  return (
    <div id={id} className="scroll-mt-24 pt-10 pb-4 border-b border-zinc-100 mb-6">
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h2>
      <p className="text-zinc-500 mt-1.5 text-sm leading-relaxed">{desc}</p>
    </div>
  )
}

function MB({ method }: { method: string }) {
  const cls =
    method === "GET"    ? "bg-blue-50  text-blue-700  border-blue-100"  :
    method === "POST"   ? "bg-green-50 text-green-700 border-green-100" :
    method === "PATCH"  ? "bg-amber-50 text-amber-700 border-amber-100" :
    method === "DELETE" ? "bg-red-50   text-red-700   border-red-100"   :
                          "bg-zinc-50  text-zinc-700  border-zinc-100"
  return (
    <span className={cn("font-mono text-xs font-bold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5", cls)}>
      {method}
    </span>
  )
}

function EndpointRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-4 flex items-start gap-3"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <MB method={method} />
      <div>
        <code className="font-mono text-sm text-zinc-900">{path}</code>
        <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DocsClient() {
  const [active, setActive] = useState("quickstart")

  // Track active section via IntersectionObserver — updates as user scrolls
  useEffect(() => {
    const observers: IntersectionObserver[] = []
    const sectionIds = SECTIONS.map(s => s.id)

    sectionIds.forEach(id => {
      const el = document.getElementById(id)
      if (!el) return
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActive(id) },
        { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
      )
      obs.observe(el)
      observers.push(obs)
    })

    return () => observers.forEach(obs => obs.disconnect())
  }, [])

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 py-10">

          {/* Sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest px-3 mb-3">Documentation</p>
              <nav className="space-y-0.5">
                {SECTIONS.map(s => (
                  <a key={s.id} href={`#${s.id}`}
                    onClick={() => setActive(s.id)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                      active === s.id
                        ? "bg-primary/8 text-primary"
                        : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                    )}>
                    <s.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    {s.label}
                  </a>
                ))}
              </nav>
              <div className="mt-6 pt-6 border-t border-zinc-100">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest px-3 mb-3">Resources</p>
                <div className="space-y-0.5">
                  {[
                    { label: "API Status",      href: "https://status.agentdyne.com" },
                    { label: "GitHub",           href: "https://github.com/agentdyne" },
                    { label: "Discord",          href: "https://discord.gg/agentdyne" },
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

          {/* Content */}
          <main className="flex-1 min-w-0">

            {/* Hero */}
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
                <Book className="h-3.5 w-3.5" /> API v1 · April 2026
              </div>
              <h1 className="text-4xl font-black tracking-tight text-zinc-900 mb-3">AgentDyne Docs</h1>
              <p className="text-lg text-zinc-500 max-w-2xl leading-relaxed">
                Complete reference for the AgentDyne API — execute agents, build pipelines,
                manage RAG knowledge bases, and integrate 40+ MCP tools.
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

            {/* ── Quick Start ──────────────────────────────────────────────── */}
            <SH id="quickstart" title="Quick Start" desc="Your first agent call in under 2 minutes." />
            <p className="text-sm text-zinc-500 mb-2">
              Get your API key from the{" "}
              <Link href="/api-keys" className="text-primary hover:underline font-medium">API Keys dashboard</Link>, then:
            </p>
            <Code code={CODE_QUICKSTART} lang="bash" />
            <Code code={CODE_QUICKSTART_RESP} lang="json" />

            {/* ── Auth ──────────────────────────────────────────────────────── */}
            <SH id="auth" title="Authentication" desc="All API requests require a valid API key in the Authorization header." />
            <Code code={CODE_AUTH} lang="http" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {[
                { icon: Lock,      title: "Secure",       desc: "Keys are hashed SHA-256. AgentDyne never stores the raw key." },
                { icon: RefreshCw, title: "Rotatable",    desc: "Create and revoke keys anytime from your API Keys dashboard." },
                { icon: Activity,  title: "Trackable",    desc: "Each key tracks total calls, last used timestamp, and rate limits." },
                { icon: Zap,       title: "Rate-limited", desc: "Default 60 req/min. Quota enforced per plan. Headers: X-RateLimit-*." },
              ].map(f => (
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

            {/* ── Execute Agent ─────────────────────────────────────────────── */}
            <SH id="execute" title="Execute Agent"
              desc="Run any active agent — synchronously or token-by-token streaming. Enforces quota, credits, and injection filter automatically." />
            <EndpointRow method="POST" path="/api/agents/{id}/execute"
              desc="Body: { input, stream? }. stream:true returns Server-Sent Events. Input can be string or JSON object." />
            <Code code={CODE_EXECUTE_SYNC}   lang="typescript" />
            <Code code={CODE_EXECUTE_STREAM} lang="typescript" />

            {/* ── Agents API ───────────────────────────────────────────────── */}
            <SH id="agents" title="Agents API" desc="Create, list, search, and manage agents via REST." />
            <div className="space-y-3">
              {AGENTS_ENDPOINTS.map(e => <EndpointRow key={e.method+e.path} {...e} />)}
            </div>
            <Code code={CODE_AGENTS_LIST}   lang="bash" />
            <Code code={CODE_AGENTS_CREATE} lang="bash" />

            {/* ── Pipelines API ────────────────────────────────────────────── */}
            <SH id="pipelines" title="Pipelines API"
              desc="Chain multiple agents into a DAG workflow. Each node is an agent — output of node N feeds node N+1. The topological sort engine handles dependencies automatically." />

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-xs text-blue-700 leading-relaxed">
              <strong>How pipelines work:</strong> Create a pipeline with a DAG (directed acyclic graph) of agent nodes.
              When you run it, each agent is called in topological order — the text/JSON output of one agent
              is automatically stringified and passed as the <code className="font-mono bg-blue-100 px-1 rounded">input</code> to
              the next agent. All nodes run the same execution pipeline as direct agent calls (quota, credits, injection filter).
            </div>

            <div className="space-y-3 mb-4">
              {PIPELINE_ENDPOINTS.map(e => <EndpointRow key={e.method+e.path} {...e} />)}
            </div>
            <Code code={CODE_PIPELINE_CREATE} lang="bash" />
            <Code code={CODE_PIPELINE_RUN}    lang="bash" />

            {/* ── RAG & Knowledge ──────────────────────────────────────────── */}
            <SH id="rag" title="RAG & Knowledge Base"
              desc="Augment agents with custom documents. Upload text, code, or data — it's chunked, embedded (OpenAI text-embedding-3-small), and stored in pgvector. Agents retrieve relevant context at runtime via cosine similarity search." />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {[
                { icon: Database, title: "Standard RAG",  desc: "Documents ingest → chunked → embedded → stored in pgvector. Agent retrieves top-k chunks at execution time via semantic search." },
                { icon: Cpu,      title: "Agentic RAG",   desc: "Agent decides when to search using a tool call pattern. More accurate for multi-step questions. Configure via system prompt." },
              ].map(f => (
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

            <div className="space-y-3 mb-4">
              {RAG_ENDPOINTS.map(e => <EndpointRow key={e.method+e.path} {...e} />)}
            </div>
            <Code code={CODE_RAG_SETUP}    lang="bash" />
            <Code code={CODE_RAG_QUERY}    lang="bash" />
            <Code code={CODE_AGENTIC_RAG}  lang="typescript" />

            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700 leading-relaxed">
              <strong>External vector stores:</strong> For enterprise-scale RAG (100M+ vectors), use Pinecone or Qdrant
              via their MCP integrations. Add the Pinecone MCP server to your agent in Builder Studio → MCP Tools,
              then call <code className="font-mono bg-amber-100 px-1 rounded">upsert_vectors</code> and <code className="font-mono bg-amber-100 px-1 rounded">query</code> from
              your system prompt. The built-in RAG API (pgvector) handles up to ~10M vectors efficiently.
            </div>

            {/* ── Agent Registry ───────────────────────────────────────────── */}
            <SH id="registry" title="Agent Registry"
              desc="Machine-readable agent discovery API — the 'DNS for agents'. Used by pipelines, orchestrators, and developer tooling to find the right agent by capability, cost, and quality." />
            <div className="space-y-3 mb-4">
              {REGISTRY_ENDPOINTS.map(e => <EndpointRow key={e.method+e.path} {...e} />)}
            </div>
            <Code code={CODE_REGISTRY} lang="bash" />

            {/* ── Credits API ──────────────────────────────────────────────── */}
            <SH id="credits" title="Credits API"
              desc="Per-call and freemium agents deduct from your credit balance. Free agents and subscription agents do not use credits. Top up via Stripe Checkout." />
            <div className="space-y-3 mb-4">
              {CREDITS_ENDPOINTS.map(e => <EndpointRow key={e.method+e.path} {...e} />)}
            </div>
            <Code code={CODE_CREDITS} lang="bash" />

            {/* ── MCP Integrations ─────────────────────────────────────────── */}
            <SH id="mcp" title="MCP Integrations"
              desc="40+ verified MCP (Model Context Protocol) servers. Attach tools to any agent in Builder Studio → MCP Tools tab. Tools appear in the agent's execution context — reference them in your system prompt." />
            <Code code={CODE_MCP} lang="typescript" />
            <div className="mt-3">
              <Link href="/integrations" className="text-sm text-primary hover:underline font-semibold flex items-center gap-1">
                Browse all integrations <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>

            {/* ── Webhooks ─────────────────────────────────────────────────── */}
            <SH id="webhooks" title="Webhooks"
              desc="Real-time events pushed to your HTTPS endpoint. Register URLs in Settings → Webhooks. All events are HMAC-SHA256 signed." />
            <Code code={CODE_WEBHOOK} lang="typescript" />

            {/* ── Rate Limits ──────────────────────────────────────────────── */}
            <SH id="rate-limits" title="Rate Limits" desc="Limits apply per API key and scale with your plan." />
            <div className="overflow-hidden rounded-xl border border-zinc-100">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    {["Plan", "Calls/month", "Req/min", "Concurrency"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {RATE_ROWS.map(r => (
                    <tr key={r.plan} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-zinc-900 text-sm">{r.plan}</td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-sm">{r.monthly}</td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-sm">{r.rpm}</td>
                      <td className="px-4 py-3 text-zinc-500 text-sm">{r.c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Error Codes ──────────────────────────────────────────────── */}
            <SH id="errors" title="Error Codes" desc="Standard HTTP codes plus AgentDyne machine-readable codes." />
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
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-zinc-900">{e.title}</p>
                      <code className="text-[10px] font-mono bg-primary/8 text-primary px-1.5 py-0.5 rounded">{e.cls}</code>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <Code code={CODE_ERRORS} lang="json" />

            {/* CTA */}
            <div className="mt-12 mb-8 p-6 bg-zinc-50 border border-zinc-100 rounded-2xl text-center">
              <h3 className="font-bold text-zinc-900 text-lg mb-2">Need help?</h3>
              <p className="text-zinc-500 text-sm mb-4">We respond within 4 hours on Pro and Enterprise plans.</p>
              <div className="flex justify-center gap-3">
                <a href="https://discord.gg/agentdyne" target="_blank" rel="noopener noreferrer">
                  <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">Join Discord</Button>
                </a>
                <Link href="/contact">
                  <Button variant="outline" className="rounded-xl border-zinc-200 font-semibold">Contact Support</Button>
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
