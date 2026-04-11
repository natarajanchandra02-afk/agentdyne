"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Book, Code2, Zap, Key, Webhook, Terminal,
  ChevronRight, Copy, Check, ExternalLink,
  Shield, BarChart3, Bot, Play, Lock, RefreshCw, Activity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"

const SECTIONS = [
  { id: "quickstart",    label: "Quick Start",    icon: Zap },
  { id: "authentication",label: "Authentication", icon: Key },
  { id: "execute",       label: "Execute Agent",  icon: Play },
  { id: "agents-api",   label: "Agents API",     icon: Bot },
  { id: "webhooks",      label: "Webhooks",       icon: Webhook },
  { id: "sdks",          label: "SDKs",           icon: Code2 },
  { id: "rate-limits",   label: "Rate Limits",    icon: Shield },
  { id: "errors",        label: "Error Codes",    icon: BarChart3 },
]

const AUTH_FEATURES = [
  { icon: Lock,       title: "Secure",       desc: "Keys are hashed with SHA-256. Even AgentDyne can't see your raw key." },
  { icon: RefreshCw,  title: "Rotatable",    desc: "Create and revoke keys anytime from your dashboard." },
  { icon: Activity,   title: "Trackable",    desc: "Each key tracks usage — total calls, last used date." },
  { icon: Zap,        title: "Rate-limited", desc: "Default 60 req/min per key. Contact us for higher limits." },
]

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

export default function DocsClient() {
  const [activeSection, setActiveSection] = useState("quickstart")

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 py-10">

          {/* Sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24">
              <p className="section-header mb-3">Documentation</p>
              <nav className="space-y-0.5">
                {SECTIONS.map(s => (
                  <a key={s.id} href={`#${s.id}`}
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
                    { label: "API Status", href: "https://status.agentdyne.com" },
                    { label: "GitHub",     href: "https://github.com/agentdyne" },
                    { label: "Discord",    href: "https://discord.gg/agentdyne" },
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
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
                <Book className="h-3.5 w-3.5" /> API v1
              </div>
              <h1 className="text-4xl font-black tracking-tight text-zinc-900 mb-3">AgentDyne Documentation</h1>
              <p className="text-lg text-zinc-500 max-w-2xl">
                Everything you need to integrate, build, and deploy with the AgentDyne platform.
                RESTful API, real-time execution, and MCP-native agent support.
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

            {/* Quick Start */}
            <SectionHeader id="quickstart" title="Quick Start" desc="Get your first agent running in under 2 minutes." />
            <div className="space-y-4 text-sm text-zinc-500 leading-relaxed">
              <p>Get your API key from the <Link href="/api-keys" className="text-primary hover:underline font-medium">API Keys dashboard</Link>, then make your first call:</p>
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
            <div className="space-y-4 text-sm text-zinc-500 leading-relaxed">
              <p>Include your API key in the <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded-lg text-zinc-900 font-mono text-xs">Authorization</code> header as a Bearer token:</p>
              <CodeBlock language="bash" code={`Authorization: Bearer agd_YourApiKeyHere`} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            </div>

            {/* Execute Agent */}
            <SectionHeader id="execute" title="Execute Agent" desc="Run any agent with a single API call." />
            <div className="space-y-4 text-sm text-zinc-500">
              <div className="bg-white border border-zinc-100 rounded-xl p-4" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-bold bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-full">POST</span>
                  <code className="font-mono text-sm text-zinc-900">/v1/agents/{"{agentId}"}/execute</code>
                </div>
                <p className="text-xs text-zinc-400 mt-1">Execute an agent synchronously. Returns output when complete.</p>
              </div>
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
              <CodeBlock language="python" code={`import requests

response = requests.post(
    "https://api.agentdyne.com/v1/agents/AGENT_ID/execute",
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    json={"input": "Your input here"}
)
data = response.json()
print(data["output"])`} />
            </div>

            {/* Agents API */}
            <SectionHeader id="agents-api" title="Agents API" desc="List, search, and retrieve agents programmatically." />
            <div className="space-y-3 text-sm">
              {[
                { method: "GET",  path: "/v1/agents",             desc: "List all active agents. Supports q, category, pricing, sort, page, limit params." },
                { method: "GET",  path: "/v1/agents/{id}",        desc: "Get a single agent by ID including schema and seller info." },
                { method: "POST", path: "/v1/agents/{id}/execute", desc: "Execute an agent. Requires valid API key and quota." },
              ].map(e => (
                <div key={e.path} className="bg-white border border-zinc-100 rounded-xl p-4 flex items-start gap-3"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <span className={cn("font-mono text-xs font-bold px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5",
                    e.method === "GET"
                      ? "bg-blue-50 text-blue-700 border-blue-100"
                      : "bg-green-50 text-green-700 border-green-100")}>
                    {e.method}
                  </span>
                  <div>
                    <code className="font-mono text-sm text-zinc-900">{e.path}</code>
                    <p className="text-xs text-zinc-400 mt-1">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Webhooks */}
            <SectionHeader id="webhooks" title="Webhooks" desc="Receive real-time events from AgentDyne." />
            <div className="space-y-4 text-sm text-zinc-500">
              <p>Register a webhook URL in your <Link href="/settings" className="text-primary hover:underline font-medium">settings</Link> to receive events when executions complete, subscriptions change, or payouts are processed.</p>
              <CodeBlock language="json" code={`{
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
            </div>

            {/* SDKs */}
            <SectionHeader id="sdks" title="SDKs & Libraries" desc="Official client libraries for popular languages." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { lang: "JavaScript / TypeScript", status: "stable",      install: "npm install @agentdyne/sdk" },
                { lang: "Python",                  status: "stable",      install: "pip install agentdyne" },
                { lang: "Go",                      status: "beta",        install: "go get github.com/agentdyne/go" },
                { lang: "Ruby",                    status: "coming-soon", install: "gem install agentdyne" },
              ].map(sdk => (
                <div key={sdk.lang} className="bg-white border border-zinc-100 rounded-xl p-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-zinc-900 text-sm">{sdk.lang}</p>
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                      sdk.status === "stable"      ? "bg-green-50 text-green-700" :
                      sdk.status === "beta"        ? "bg-amber-50 text-amber-700" :
                                                     "bg-zinc-100 text-zinc-500")}>
                      {sdk.status}
                    </span>
                  </div>
                  <code className="text-xs font-mono bg-zinc-50 border border-zinc-100 px-3 py-2 rounded-lg block text-zinc-600">
                    {sdk.install}
                  </code>
                </div>
              ))}
            </div>

            {/* Rate Limits */}
            <SectionHeader id="rate-limits" title="Rate Limits" desc="Limits vary by plan to ensure platform stability." />
            <div className="overflow-hidden rounded-xl border border-zinc-100">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    {["Plan", "Calls/month", "Req/min per key", "Concurrency"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {[
                    { plan: "Free",       monthly: "100",       rpm: "10",     concurrency: "1" },
                    { plan: "Starter",    monthly: "1,000",     rpm: "30",     concurrency: "3" },
                    { plan: "Pro",        monthly: "10,000",    rpm: "60",     concurrency: "10" },
                    { plan: "Enterprise", monthly: "Unlimited", rpm: "Custom", concurrency: "Custom" },
                  ].map(r => (
                    <tr key={r.plan} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-zinc-900">{r.plan}</td>
                      <td className="px-4 py-3 text-zinc-500 font-mono">{r.monthly}</td>
                      <td className="px-4 py-3 text-zinc-500 font-mono">{r.rpm}</td>
                      <td className="px-4 py-3 text-zinc-500">{r.concurrency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Error Codes */}
            <SectionHeader id="errors" title="Error Codes" desc="Standard HTTP status codes plus AgentDyne-specific error payloads." />
            <div className="space-y-2">
              {[
                { code: "400", title: "Bad Request",          desc: "Missing or invalid parameters in request body." },
                { code: "401", title: "Unauthorized",         desc: "Missing, invalid, or expired API key." },
                { code: "403", title: "Forbidden",            desc: "Valid key but insufficient permissions or no active subscription." },
                { code: "404", title: "Not Found",            desc: "Agent not found or not active." },
                { code: "429", title: "Too Many Requests",    desc: "Rate limit or monthly quota exceeded. Check Retry-After header." },
                { code: "500", title: "Internal Server Error",desc: "AgentDyne server error. Retry with exponential backoff." },
              ].map(e => (
                <div key={e.code} className="flex items-start gap-4 p-4 bg-white border border-zinc-100 rounded-xl"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <span className={cn("font-mono text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0",
                    parseInt(e.code) < 500
                      ? "bg-amber-50 text-amber-700 border border-amber-100"
                      : "bg-red-50 text-red-700 border border-red-100")}>
                    {e.code}
                  </span>
                  <div>
                    <p className="font-semibold text-sm text-zinc-900">{e.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{e.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Help CTA */}
            <div className="mt-12 mb-8 p-6 bg-zinc-50 border border-zinc-100 rounded-2xl text-center">
              <h3 className="font-bold text-zinc-900 text-lg mb-2">Need help?</h3>
              <p className="text-zinc-500 text-sm mb-4">Our team is available via Discord and email.</p>
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
