"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Book, Code2, Zap, Key, Webhook,
  Copy, Check, ExternalLink,
  Shield, BarChart3, Bot, Play, Lock, RefreshCw, Activity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// Code samples — defined as plain JS string constants OUTSIDE JSX so the
// parser never confuses Python f-string syntax ({...} / ${...}) with JSX
// template-literal interpolations.
// ─────────────────────────────────────────────────────────────────────────────

const CODE_CURL_QUICKSTART = `curl -X POST https://agentdyne.com/api/agents/AGENT_ID/execute \\
  -H "Authorization: Bearer agd_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Summarise this: Q3 revenue grew 40% YoY..."}'`

const CODE_JSON_QUICKSTART = `{
  "executionId": "exec_abc123",
  "output": {
    "summary": "Q3 revenue increased 40% year-over-year.",
    "keyPoints": ["Revenue up 40%", "Strong Q4 outlook"],
    "actionItems": []
  },
  "latencyMs": 842,
  "tokens": { "input": 124, "output": 87 },
  "cost": 0.00312
}`

const CODE_AUTH_HEADER = `Authorization: Bearer agd_YourApiKeyHere`

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

// Streaming (server-sent events)
const stream = await fetch("https://agentdyne.com/api/agents/AGENT_ID/execute", {
  method: "POST",
  headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
  body: JSON.stringify({ input: "Write a blog post about AI", stream: true }),
})
const reader = stream.body.getReader()
// each chunk: { type: "delta", delta: "..." } | { type: "done", executionId: "..." }`

// NOTE: Python f-strings use {var} and ${var:.fmt} — to avoid JSX parsing these
// as template interpolations we store the string as a regular JS constant here.
const CODE_EXECUTE_PY = [
  "import requests",
  "",
  "# Synchronous",
  'r = requests.post(',
  '    "https://agentdyne.com/api/agents/AGENT_ID/execute",',
  '    headers={"Authorization": f"Bearer {api_key}"},',
  '    json={"input": "Summarise this..."}',
  ")",
  "data = r.json()",
  'print(data["output"])  # parsed output',
  'print(f"Latency: {data[\'latencyMs\']}ms  Cost: ${data[\'cost\']:.6f}")',
].join("\n")

const CODE_AGENTS_CURL = `# Search agents in the "coding" category, sorted by rating
curl "https://agentdyne.com/api/agents?category=coding&sort=rating&limit=10" \\
  -H "Authorization: Bearer agd_your_key"

# Response shape (matches SDK PaginatedResponse<Agent>):
# { "data": [...], "pagination": { "total", "page", "limit", "pages", "hasNext", "hasPrev" } }`

const CODE_EXECUTIONS_CURL = `# List your last 20 failed executions
curl "https://agentdyne.com/api/executions?status=failed&limit=20" \\
  -H "Authorization: Bearer agd_your_key"

# Poll a specific execution (useful for long-running agents)
curl "https://agentdyne.com/api/executions/exec_abc123" \\
  -H "Authorization: Bearer agd_your_key"`

const CODE_QUOTA_CURL = `# Get your quota usage
curl "https://agentdyne.com/api/user/quota" \\
  -H "Authorization: Bearer agd_your_key"
# => { "plan": "pro", "quota": 10000, "used": 3752, "remaining": 6248,
#      "percentUsed": 37.52, "resetsAt": "2026-05-01T00:00:00Z" }`

const CODE_WEBHOOK_JSON = `// Event payload structure
{
  "id":        "evt_abc123",
  "type":      "execution.completed",
  "timestamp": "2026-04-01T12:00:00Z",
  "data": {
    "executionId": "exec_xyz",
    "agentId":     "agent_abc",
    "status":      "success",
    "latencyMs":   842,
    "tokens":      { "input": 124, "output": 87 }
  }
}

// Event types:
// execution.completed  execution.failed
// agent.approved       agent.rejected
// subscription.created subscription.updated subscription.canceled
// payout.processed     review.posted`

const CODE_WEBHOOK_TS = `// Next.js App Router webhook handler
import AgentDyne from "@agentdyne/sdk"

export async function POST(request: Request) {
  const rawBody = await request.text()
  const sig     = request.headers.get("x-agentdyne-signature") ?? ""
  const client  = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! })

  const event = await client.webhooks.constructEvent(
    rawBody, sig, process.env.AGENTDYNE_WEBHOOK_SECRET!
  )

  switch (event.type) {
    case "execution.completed":
      console.log("Done:", event.data.executionId)
      break
    case "payout.processed":
      await recordPayout(event.data)
      break
  }
  return Response.json({ received: true })
}`

const CODE_SDK_TS = `import AgentDyne from "@agentdyne/sdk"

const client = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! })

// Execute
const result = await client.execute("agent_id", "Summarise this email...")
console.log(result.output, result.latencyMs, result.cost)

// Stream token-by-token
for await (const chunk of client.stream("agent_id", "Write a blog post")) {
  if (chunk.type === "delta") process.stdout.write(chunk.delta ?? "")
}

// Paginate all coding agents
for await (const agent of client.agents.paginate({ category: "coding" })) {
  console.log(agent.name, agent.average_rating)
}

// Quota check
const quota = await client.user.quota()
console.log(quota.used + "/" + quota.quota + " calls (" + quota.percentUsed + "%)")`

// Python f-strings: stored as array-join to avoid ${} template collision
const CODE_SDK_PY = [
  "from agentdyne import AgentDyne",
  "",
  "client = AgentDyne()  # reads AGENTDYNE_API_KEY from env",
  "",
  "# Execute",
  'result = client.execute("agent_id", "Summarise this email...")',
  "print(result.output)",
  "",
  "# Stream",
  'for chunk in client.stream("agent_id", "Write a haiku"):',
  "    if chunk.type == \"delta\" and chunk.delta:",
  '        print(chunk.delta, end="", flush=True)',
  "",
  "# Quota",
  "quota = client.my_quota()",
  'print(f"{quota.used}/{quota.quota} calls ({quota.percent_used}%)")',
].join("\n")

const CODE_SDK_GO = `client := agentdyne.New(os.Getenv("AGENTDYNE_API_KEY"))

result, err := client.Execute(ctx, "agent_id", "Summarise this...")
if err != nil { log.Fatal(err) }
fmt.Println(result.Output)

// Stream
ch := make(chan agentdyne.StreamChunk, 64)
go client.Stream(ctx, "agent_id", "Write a blog post", ch)
for chunk := range ch {
    if chunk.Type == "delta" { fmt.Print(chunk.Delta) }
}`

const CODE_SDK_RUBY = `client = AgentDyne.new   # reads AGENTDYNE_API_KEY from env

result = client.execute("agent_id", "Summarise this...")
puts result.output

client.stream("agent_id", "Write a haiku") do |chunk|
  print chunk.delta if chunk.type == "delta"
end`

const CODE_ERROR_JSON = `// Error response body shape
{
  "error": "Human-readable error message",
  "code":  "MACHINE_READABLE_CODE",
  "retryAfter": 60
}`

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar sections
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "quickstart",     label: "Quick Start",    icon: Zap },
  { id: "authentication", label: "Authentication", icon: Key },
  { id: "execute",        label: "Execute Agent",  icon: Play },
  { id: "agents-api",    label: "Agents API",     icon: Bot },
  { id: "executions-api",label: "Executions API", icon: BarChart3 },
  { id: "user-api",      label: "User & Quota",   icon: Shield },
  { id: "webhooks",       label: "Webhooks",       icon: Webhook },
  { id: "sdks",           label: "SDKs",           icon: Code2 },
  { id: "rate-limits",    label: "Rate Limits",    icon: Shield },
  { id: "errors",         label: "Error Codes",    icon: BarChart3 },
]

const AUTH_FEATURES = [
  { icon: Lock,      title: "Secure",       desc: "Keys are hashed with SHA-256. Even AgentDyne cannot see your raw key." },
  { icon: RefreshCw, title: "Rotatable",    desc: "Create and revoke keys anytime from your API Keys dashboard." },
  { icon: Activity,  title: "Trackable",    desc: "Each key tracks total calls, last used date, and rate limits." },
  { icon: Zap,       title: "Rate-limited", desc: "Default 60 req/min per key. Contact us for higher limits on Enterprise." },
]

const SDK_LIST = [
  { lang: "JavaScript / TypeScript", status: "stable", install: "npm install @agentdyne/sdk",         note: "ESM + CJS. Node.js 18+, Cloudflare Workers, Vercel Edge, Deno, Bun.",           docs: "https://github.com/agentdyne/sdk-js" },
  { lang: "Python",                  status: "stable", install: "pip install agentdyne",               note: "Zero required deps (stdlib). Async: pip install agentdyne[async]",             docs: "https://github.com/agentdyne/sdk-python" },
  { lang: "Go",                      status: "beta",   install: "go get github.com/agentdyne/go",      note: "Zero deps, pure stdlib. Idiomatic Go with context, channels, options pattern.", docs: "https://pkg.go.dev/github.com/agentdyne/go" },
  { lang: "Ruby",                    status: "stable", install: "gem install agentdyne",               note: "Zero required deps (net/http, openssl). Ruby 3.1+. Rails & Sinatra ready.",    docs: "https://rubygems.org/gems/agentdyne" },
]

const AGENTS_ENDPOINTS = [
  { method: "GET",  path: "/api/agents",              desc: "List active agents. Params: q, category, pricing, sort (popular|rating|newest|revenue), page, limit." },
  { method: "GET",  path: "/api/agents/{id}",         desc: "Get a single agent with full details and seller profile." },
  { method: "POST", path: "/api/agents/{id}/execute", desc: "Execute an agent. Supports sync and streaming. Enforces quota + subscription gating." },
  { method: "GET",  path: "/api/agents/{id}/reviews", desc: "List approved reviews. Params: page, limit." },
  { method: "POST", path: "/api/agents/{id}/reviews", desc: "Post a review. Requires at least one prior successful execution." },
]

const EXECUTIONS_ENDPOINTS = [
  { method: "GET", path: "/api/executions",      desc: "List your executions. Params: agentId, status, since (ISO 8601), page, limit." },
  { method: "GET", path: "/api/executions/{id}", desc: "Get a single execution by ID. Used by SDK .executions.poll()." },
]

const USER_ENDPOINTS = [
  { method: "GET",   path: "/api/user/me",    desc: "Get your full profile including subscription plan and Stripe onboarding status." },
  { method: "PATCH", path: "/api/user/me",    desc: "Update profile fields: full_name, username, bio, website, company, avatar_url." },
  { method: "GET",   path: "/api/user/quota", desc: "Quota usage: plan, quota, used, remaining, percentUsed, resetsAt." },
]

const RATE_LIMIT_ROWS = [
  { plan: "Free",       monthly: "100",       rpm: "10",     c: "1" },
  { plan: "Starter",    monthly: "1,000",     rpm: "30",     c: "3" },
  { plan: "Pro",        monthly: "10,000",    rpm: "60",     c: "10" },
  { plan: "Enterprise", monthly: "Unlimited", rpm: "Custom", c: "Custom" },
]

const ERROR_ROWS = [
  { code: "400", title: "Bad Request",           sdkClass: "ValidationError",                 desc: "Missing or invalid parameters." },
  { code: "401", title: "Unauthorized",          sdkClass: "AuthenticationError",              desc: "Missing, invalid, or revoked API key." },
  { code: "403", title: "Forbidden",             sdkClass: "SubscriptionRequiredError",        desc: "Agent requires subscription (code: SUBSCRIPTION_REQUIRED)." },
  { code: "404", title: "Not Found",             sdkClass: "NotFoundError",                   desc: "Agent, execution, or resource does not exist." },
  { code: "429", title: "Too Many Requests",     sdkClass: "RateLimitError / QuotaExceededError", desc: "Rate limit or monthly quota exhausted (code: QUOTA_EXCEEDED)." },
  { code: "500", title: "Internal Server Error", sdkClass: "InternalServerError",              desc: "AgentDyne server error. Retry with exponential back-off." },
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
    method === "GET"   ? "bg-blue-50 text-blue-700 border-blue-100" :
    method === "PATCH" ? "bg-amber-50 text-amber-700 border-amber-100" :
                         "bg-green-50 text-green-700 border-green-100"
  return (
    <span className={cn("font-mono text-xs font-bold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5", cls)}>
      {method}
    </span>
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

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
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

          {/* ── Content ──────────────────────────────────────────────────── */}
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
                Everything you need to integrate, build, and deploy with the AgentDyne platform.
                RESTful API, real-time streaming, and MCP-native agent support.
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

            {/* ── Quick Start ───────────────────────────────────────────── */}
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

            {/* ── Authentication ────────────────────────────────────────── */}
            <SectionHeader id="authentication" title="Authentication"
              desc="All API requests require a valid API key." />
            <p className="text-sm text-zinc-500 mb-2">
              Include your key as a Bearer token in every request:
            </p>
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

            {/* ── Execute Agent ─────────────────────────────────────────── */}
            <SectionHeader id="execute" title="Execute Agent"
              desc="Run any agent synchronously or stream output token-by-token." />
            <div className="bg-white border border-zinc-100 rounded-xl p-4 mb-4"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <span className="font-mono text-xs font-bold bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-full">
                POST
              </span>
              <code className="font-mono text-sm text-zinc-900 ml-2">
                /api/agents/{"{agentId}"}/execute
              </code>
              <p className="text-xs text-zinc-400 mt-1">
                Supports synchronous (default) and streaming (<code>stream: true</code>) modes.
              </p>
            </div>
            <CodeBlock language="typescript" code={CODE_EXECUTE_TS} />
            <CodeBlock language="python"     code={CODE_EXECUTE_PY} />

            {/* ── Agents API ────────────────────────────────────────────── */}
            <SectionHeader id="agents-api" title="Agents API"
              desc="List, search, and retrieve agents programmatically." />
            <div className="space-y-3">
              {AGENTS_ENDPOINTS.map(e => (
                <div key={e.method + e.path}
                  className="bg-white border border-zinc-100 rounded-xl p-4 flex items-start gap-3"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <MethodBadge method={e.method} />
                  <div>
                    <code className="font-mono text-sm text-zinc-900">{e.path}</code>
                    <p className="text-xs text-zinc-400 mt-0.5">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <CodeBlock language="bash" code={CODE_AGENTS_CURL} />

            {/* ── Executions API ────────────────────────────────────────── */}
            <SectionHeader id="executions-api" title="Executions API"
              desc="List and retrieve your execution history." />
            <div className="space-y-3">
              {EXECUTIONS_ENDPOINTS.map(e => (
                <div key={e.path}
                  className="bg-white border border-zinc-100 rounded-xl p-4 flex items-start gap-3"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <MethodBadge method={e.method} />
                  <div>
                    <code className="font-mono text-sm text-zinc-900">{e.path}</code>
                    <p className="text-xs text-zinc-400 mt-0.5">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <CodeBlock language="bash" code={CODE_EXECUTIONS_CURL} />

            {/* ── User & Quota API ──────────────────────────────────────── */}
            <SectionHeader id="user-api" title="User & Quota API"
              desc="Access and update your profile and quota usage." />
            <div className="space-y-3">
              {USER_ENDPOINTS.map(e => (
                <div key={e.method + e.path}
                  className="bg-white border border-zinc-100 rounded-xl p-4 flex items-start gap-3"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <MethodBadge method={e.method} />
                  <div>
                    <code className="font-mono text-sm text-zinc-900">{e.path}</code>
                    <p className="text-xs text-zinc-400 mt-0.5">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <CodeBlock language="bash" code={CODE_QUOTA_CURL} />

            {/* ── Webhooks ──────────────────────────────────────────────── */}
            <SectionHeader id="webhooks" title="Webhooks"
              desc="Receive real-time events pushed to your endpoint." />
            <p className="text-sm text-zinc-500 mb-4">
              Register a webhook URL in{" "}
              <Link href="/settings" className="text-primary hover:underline font-medium">
                Settings
              </Link>. Every event is signed with{" "}
              <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-xs font-mono text-zinc-700">
                HMAC-SHA256
              </code>. Verify the{" "}
              <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-xs font-mono text-zinc-700">
                X-AgentDyne-Signature
              </code>{" "}
              header on every incoming request.
            </p>
            <CodeBlock language="json"       code={CODE_WEBHOOK_JSON} />
            <CodeBlock language="typescript" code={CODE_WEBHOOK_TS} />

            {/* ── SDKs ──────────────────────────────────────────────────── */}
            <SectionHeader id="sdks" title="SDKs & Libraries"
              desc="Official client libraries — production-ready, zero required dependencies." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {SDK_LIST.map(sdk => (
                <div key={sdk.lang} className="bg-white border border-zinc-100 rounded-xl p-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-zinc-900 text-sm">{sdk.lang}</p>
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                      sdk.status === "stable"
                        ? "bg-green-50 text-green-700"
                        : "bg-amber-50 text-amber-700")}>
                      {sdk.status}
                    </span>
                  </div>
                  <code className="text-xs font-mono bg-zinc-50 border border-zinc-100 px-3 py-2 rounded-lg block text-zinc-600 mb-2">
                    {sdk.install}
                  </code>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-2">{sdk.note}</p>
                  <a href={sdk.docs} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline font-medium flex items-center gap-1">
                    View source <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>

            <CodeBlock language="typescript" code={CODE_SDK_TS} />
            <CodeBlock language="python"     code={CODE_SDK_PY} />
            <CodeBlock language="go"         code={CODE_SDK_GO} />
            <CodeBlock language="ruby"       code={CODE_SDK_RUBY} />

            {/* ── Rate Limits ───────────────────────────────────────────── */}
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
                      <td className="px-4 py-3 text-zinc-500 font-mono text-sm">{r.monthly}</td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-sm">{r.rpm}</td>
                      <td className="px-4 py-3 text-zinc-500 text-sm">{r.c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-zinc-400 mt-2">
              Rate limit headers on every response:{" "}
              <code className="bg-zinc-50 border border-zinc-100 px-1 py-0.5 rounded font-mono">X-RateLimit-Remaining</code>{" "}
              <code className="bg-zinc-50 border border-zinc-100 px-1 py-0.5 rounded font-mono">X-RateLimit-Reset</code>{" "}
              <code className="bg-zinc-50 border border-zinc-100 px-1 py-0.5 rounded font-mono">Retry-After</code>
            </p>

            {/* ── Error Codes ───────────────────────────────────────────── */}
            <SectionHeader id="errors" title="Error Codes"
              desc="Standard HTTP codes plus AgentDyne-specific machine-readable codes." />
            <div className="space-y-2">
              {ERROR_ROWS.map(e => (
                <div key={e.code}
                  className="flex items-start gap-4 p-4 bg-white border border-zinc-100 rounded-xl"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <span className={cn(
                    "font-mono text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0",
                    parseInt(e.code) < 500
                      ? "bg-amber-50 text-amber-700 border border-amber-100"
                      : "bg-red-50 text-red-700 border border-red-100"
                  )}>
                    {e.code}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-zinc-900">{e.title}</p>
                      <code className="text-[10px] font-mono bg-primary/8 text-primary px-1.5 py-0.5 rounded">
                        {e.sdkClass}
                      </code>
                    </div>
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
