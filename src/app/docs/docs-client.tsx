"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  Book, Code2, Zap, Key, Webhook, Terminal,
  ChevronRight, Copy, Check, ExternalLink, Globe,
  Shield, BarChart3, Bot, Play,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"

const SECTIONS = [
  { id: "quickstart",    label: "Quick Start",     icon: Zap },
  { id: "authentication",label: "Authentication",  icon: Key },
  { id: "execute",       label: "Execute Agent",   icon: Play },
  { id: "agents-api",    label: "Agents API",      icon: Bot },
  { id: "webhooks",      label: "Webhooks",        icon: Webhook },
  { id: "sdks",          label: "SDKs",            icon: Code2 },
  { id: "rate-limits",   label: "Rate Limits",     icon: Shield },
  { id: "errors",        label: "Error Codes",     icon: BarChart3 },
]

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative rounded-xl border border-border bg-[#0d1117] overflow-hidden my-4">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <span className="text-xs text-muted-foreground font-mono">{language}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
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
    <div id={id} className="scroll-mt-24 pt-10 pb-4 border-b border-border mb-6">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-1.5">{desc}</p>
    </div>
  )
}

export default function DocsClient() {
  const [activeSection, setActiveSection] = useState("quickstart")

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 py-10">

          {/* Sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Documentation</p>
              <nav className="space-y-0.5">
                {SECTIONS.map(s => (
                  <a key={s.id} href={`#${s.id}`}
                    onClick={() => setActiveSection(s.id)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                      activeSection === s.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}>
                    <s.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    {s.label}
                  </a>
                ))}
              </nav>
              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Resources</p>
                <div className="space-y-0.5">
                  {[
                    { label: "API Status", href: "https://status.agentdyne.com" },
                    { label: "GitHub",     href: "https://github.com/agentdyne" },
                    { label: "Discord",    href: "https://discord.gg/agentdyne" },
                  ].map(r => (
                    <a key={r.label} href={r.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
                      {r.label} <ExternalLink className="h-3 w-3 ml-auto" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {/* Hero */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
              <Badge className="mb-3">API v1</Badge>
              <h1 className="text-4xl font-black tracking-tight mb-3">AgentDyne Documentation</h1>
              <p className="text-lg text-muted-foreground max-w-2xl">
                Everything you need to integrate, build, and deploy with the AgentDyne platform.
                RESTful API, real-time execution, and MCP-native agent support.
              </p>
              <div className="flex gap-3 mt-5">
                <Link href="/marketplace">
                  <Button variant="brand" className="gap-2"><Bot className="h-4 w-4" />Browse Agents</Button>
                </Link>
                <Link href="/builder">
                  <Button variant="outline" className="gap-2"><Code2 className="h-4 w-4" />Build an Agent</Button>
                </Link>
              </div>
            </motion.div>

            {/* Quick Start */}
            <SectionHeader id="quickstart" title="Quick Start" desc="Get your first agent running in under 2 minutes." />
            <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>Get your API key from the <Link href="/api-keys" className="text-primary hover:underline">API Keys dashboard</Link>, then make your first call:</p>
              <CodeBlock language="bash" code={`curl -X POST https://api.agentdyne.com/v1/agents/AGENT_ID/execute \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "Summarize this: The quarterly revenue grew 40%..."}'`} />
              <p>You'll get back a JSON response with the agent output, execution metadata, and token usage:</p>
              <CodeBlock language="json" code={`{
  "executionId": "exec_abc123",
  "output": {
    "summary": "Quarterly revenue grew 40% year-over-year...",
    "keyPoints": ["Revenue up 40%", "Strong Q4 performance"],
    "actionItems": []
  },
  "latencyMs": 842,
  "tokens": { "input": 124, "output": 87 },
  "cost": 0.00312
}`} />
            </div>

            {/* Authentication */}
            <SectionHeader id="authentication" title="Authentication" desc="All API requests require a valid API key." />
            <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>Include your API key in the <code className="bg-muted px-1.5 py-0.5 rounded-lg text-foreground font-mono text-xs">Authorization</code> header as a Bearer token:</p>
              <CodeBlock language="bash" code={`Authorization: Bearer agd_YourApiKeyHere`} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 not-prose">
                {[
                  { title: "✅ Secure", desc: "Keys are hashed with SHA-256. Even AgentDyne can't see your raw key." },
                  { title: "🔄 Rotatable", desc: "Create and revoke keys anytime from your dashboard." },
                  { title: "📊 Trackable", desc: "Each key tracks usage — total calls, last used date." },
                  { title: "⚡ Rate-limited", desc: "Default 60 req/min per key. Contact us for higher limits." },
                ].map(f => (
                  <div key={f.title} className="bg-card border border-border rounded-xl p-4">
                    <p className="font-semibold text-foreground text-sm">{f.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Execute Agent */}
            <SectionHeader id="execute" title="Execute Agent" desc="Run any agent with a single API call." />
            <div className="space-y-4 text-sm text-muted-foreground">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="default" className="font-mono text-xs bg-green-500/10 text-green-500 border-green-500/20">POST</Badge>
                  <code className="font-mono text-sm text-foreground">/v1/agents/{"{agentId}"}/execute</code>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Execute an agent synchronously. Returns output when complete.</p>
              </div>
              <p className="font-semibold text-foreground">Request body</p>
              <CodeBlock language="json" code={`{
  "input": "string | object",  // Required: input to the agent
  "stream": false              // Optional: stream output (coming soon)
}`} />
              <p className="font-semibold text-foreground">JavaScript / TypeScript</p>
              <CodeBlock language="typescript" code={`const response = await fetch(
  "https://api.agentdyne.com/v1/agents/AGENT_ID/execute",
  {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.AGENTDYNE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: "Your input here" }),
  }
)

const { output, executionId, latencyMs, tokens } = await response.json()`} />
              <p className="font-semibold text-foreground">Python</p>
              <CodeBlock language="python" code={`import requests

response = requests.post(
    "https://api.agentdyne.com/v1/agents/AGENT_ID/execute",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={"input": "Your input here"}
)

data = response.json()
print(data["output"])`} />
            </div>

            {/* Agents API */}
            <SectionHeader id="agents-api" title="Agents API" desc="List, search, and retrieve agents programmatically." />
            <div className="space-y-3 text-sm">
              {[
                { method: "GET",  path: "/v1/agents",          desc: "List all active agents. Supports q, category, pricing, sort, page, limit params." },
                { method: "GET",  path: "/v1/agents/{id}",     desc: "Get a single agent by ID including schema and seller info." },
                { method: "POST", path: "/v1/agents/{id}/execute", desc: "Execute an agent. Requires valid API key and quota." },
              ].map(e => (
                <div key={e.path} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
                  <Badge className={cn("font-mono text-xs flex-shrink-0 mt-0.5", e.method === "GET" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-green-500/10 text-green-500 border-green-500/20")}>
                    {e.method}
                  </Badge>
                  <div>
                    <code className="font-mono text-sm text-foreground">{e.path}</code>
                    <p className="text-xs text-muted-foreground mt-1">{e.desc}</p>
                  </div>
                </div>
              ))}
              <CodeBlock language="bash" code={`# List agents in the "coding" category
curl "https://api.agentdyne.com/v1/agents?category=coding&sort=rating&limit=10" \\
  -H "Authorization: Bearer YOUR_API_KEY"`} />
            </div>

            {/* Webhooks */}
            <SectionHeader id="webhooks" title="Webhooks" desc="Receive real-time events from AgentDyne." />
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>Register a webhook URL in your <Link href="/settings" className="text-primary hover:underline">settings</Link> to receive events when executions complete, subscriptions change, or payouts are processed.</p>
              <CodeBlock language="json" code={`// Example: execution.completed event
{
  "event": "execution.completed",
  "timestamp": "2026-03-31T12:00:00Z",
  "data": {
    "executionId": "exec_abc123",
    "agentId": "agent_xyz",
    "status": "success",
    "latencyMs": 842,
    "tokens": { "input": 124, "output": 87 }
  }
}`} />
              <p>All webhook payloads are signed with <code className="bg-muted px-1.5 py-0.5 rounded-lg text-foreground font-mono text-xs">HMAC-SHA256</code>. Verify signatures using the <code className="bg-muted px-1.5 py-0.5 rounded-lg text-foreground font-mono text-xs">X-AgentDyne-Signature</code> header.</p>
            </div>

            {/* SDKs */}
            <SectionHeader id="sdks" title="SDKs & Libraries" desc="Official client libraries for popular languages." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { lang: "JavaScript / TypeScript", status: "stable",      install: "npm install @agentdyne/sdk",    docs: "#" },
                { lang: "Python",                  status: "stable",      install: "pip install agentdyne",         docs: "#" },
                { lang: "Go",                      status: "beta",        install: "go get github.com/agentdyne/go",docs: "#" },
                { lang: "Ruby",                    status: "coming-soon", install: "gem install agentdyne",         docs: "#" },
              ].map(sdk => (
                <div key={sdk.lang} className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-sm">{sdk.lang}</p>
                    <Badge variant={sdk.status === "stable" ? "success" : sdk.status === "beta" ? "warning" : "secondary"} className="text-[10px]">
                      {sdk.status}
                    </Badge>
                  </div>
                  <code className="text-xs font-mono bg-muted px-3 py-2 rounded-lg block text-muted-foreground">{sdk.install}</code>
                </div>
              ))}
            </div>

            {/* Rate Limits */}
            <SectionHeader id="rate-limits" title="Rate Limits" desc="Limits vary by plan to ensure platform stability." />
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {["Plan", "Calls/month", "Req/min per key", "Concurrency"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    { plan: "Free",       monthly: "100",      rpm: "10",   concurrency: "1" },
                    { plan: "Starter",    monthly: "1,000",    rpm: "30",   concurrency: "3" },
                    { plan: "Pro",        monthly: "10,000",   rpm: "60",   concurrency: "10" },
                    { plan: "Enterprise", monthly: "Unlimited",rpm: "Custom",concurrency: "Custom" },
                  ].map(r => (
                    <tr key={r.plan} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{r.plan}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">{r.monthly}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">{r.rpm}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.concurrency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Rate limit headers are included in every response: <code className="bg-muted px-1 py-0.5 rounded font-mono">X-RateLimit-Remaining</code>, <code className="bg-muted px-1 py-0.5 rounded font-mono">X-RateLimit-Reset</code></p>

            {/* Error Codes */}
            <SectionHeader id="errors" title="Error Codes" desc="Standard HTTP status codes plus AgentDyne-specific error payloads." />
            <div className="space-y-2">
              {[
                { code: "400", title: "Bad Request",         desc: "Missing or invalid parameters in request body." },
                { code: "401", title: "Unauthorized",        desc: "Missing, invalid, or expired API key." },
                { code: "403", title: "Forbidden",           desc: "Valid key but insufficient permissions or no active subscription." },
                { code: "404", title: "Not Found",           desc: "Agent not found or not active." },
                { code: "429", title: "Too Many Requests",   desc: "Rate limit or monthly quota exceeded. Check Retry-After header." },
                { code: "500", title: "Internal Server Error",desc: "AgentDyne server error. Retry with exponential backoff." },
              ].map(e => (
                <div key={e.code} className="flex items-start gap-4 p-4 bg-card border border-border rounded-xl">
                  <Badge className={cn("font-mono flex-shrink-0 mt-0.5", parseInt(e.code) < 400 ? "" : parseInt(e.code) < 500 ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" : "bg-red-500/10 text-red-500 border-red-500/20")}>{e.code}</Badge>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{e.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <CodeBlock language="json" code={`// Error response shape
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",   // Optional
  "retryAfter": 60                   // Optional, for 429s
}`} />

            <div className="mt-12 mb-8 p-6 bg-gradient-to-r from-primary/10 to-purple-500/5 border border-primary/20 rounded-2xl text-center">
              <h3 className="font-bold text-lg mb-2">Need help?</h3>
              <p className="text-muted-foreground text-sm mb-4">Our team is available via Discord and email.</p>
              <div className="flex justify-center gap-3">
                <a href="https://discord.gg/agentdyne" target="_blank" rel="noopener noreferrer">
                  <Button variant="brand">Join Discord</Button>
                </a>
                <Link href="/contact">
                  <Button variant="outline">Contact Support</Button>
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
