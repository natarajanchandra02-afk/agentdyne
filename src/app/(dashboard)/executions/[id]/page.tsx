"use client"
export const dynamic = 'force-dynamic'

import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, CheckCircle, XCircle, Clock, Zap, Bot,
  Brain, Shield, Database, Copy, ExternalLink,
  AlertCircle, Loader2, RotateCcw
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { formatRelativeTime, cn } from "@/lib/utils"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import toast from "react-hot-toast"

const STATUS_CONFIG = {
  success: { icon: CheckCircle, color: "text-green-500", bg: "bg-green-50", label: "Success" },
  failed:  { icon: XCircle,     color: "text-red-500",   bg: "bg-red-50",   label: "Failed"  },
  timeout: { icon: AlertCircle, color: "text-orange-500",bg: "bg-orange-50",label: "Timeout" },
  running: { icon: Loader2,     color: "text-blue-500",  bg: "bg-blue-50",  label: "Running" },
  queued:  { icon: Clock,       color: "text-zinc-400",  bg: "bg-zinc-50",  label: "Queued"  },
} as const

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const copy = () => { navigator.clipboard.writeText(code); toast.success("Copied!") }
  return (
    <div className="relative">
      {label && <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">{label}</p>}
      <div className="relative bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
        <button onClick={copy} className="absolute top-2.5 right-2.5 text-zinc-500 hover:text-zinc-300 transition-colors z-10">
          <Copy className="h-3.5 w-3.5" />
        </button>
        <pre className="p-4 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed max-h-72 overflow-y-auto">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

export default function ExecutionDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const [data,   setData]   = useState<any>(null)
  const [trace,  setTrace]  = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error,  setError]  = useState("")

  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const [
        { data: execution, error: execErr },
        { data: traceRow },
      ] = await Promise.all([
        supabase.from("executions")
          .select("*, agents(id, name, category, model_name, icon_url)")
          .eq("id", id).eq("user_id", user.id).single(),
        supabase.from("execution_traces")
          .select("*").eq("execution_id", id).maybeSingle(),
      ])

      if (cancelled) return
      if (execErr || !execution) { setError("Execution not found or access denied"); setLoading(false); return }
      setData(execution)
      setTrace(traceRow)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-zinc-400">Loading execution trace…</p>
        </div>
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-zinc-700 font-semibold mb-1">{error || "Execution not found"}</p>
          <Link href="/executions"><Button variant="outline" className="rounded-xl mt-3">← Back</Button></Link>
        </div>
      </div>
    </div>
  )

  const status   = (data.status ?? "queued") as keyof typeof STATUS_CONFIG
  const cfg      = STATUS_CONFIG[status] ?? STATUS_CONFIG.queued
  const Icon     = cfg.icon
  const cost     = data.cost_usd ?? data.cost ?? 0
  const inputStr = typeof data.input === "string" ? data.input : JSON.stringify(data.input, null, 2)
  const outStr   = typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2)

  const METRICS = [
    { label: "Status",       value: <span className={cn("font-bold", cfg.color)}>{cfg.label}</span> },
    { label: "Latency",      value: data.latency_ms ? `${data.latency_ms.toLocaleString()}ms` : "—" },
    { label: "Tokens In",    value: data.tokens_input?.toLocaleString() ?? "—" },
    { label: "Tokens Out",   value: data.tokens_output?.toLocaleString() ?? "—" },
    { label: "Cost",         value: cost > 0 ? `$${cost.toFixed(6)}` : "Free" },
    { label: "Created",      value: formatRelativeTime(data.created_at) },
  ]

  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-zinc-50">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/executions">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl"><ArrowLeft className="h-4 w-4" /></Button>
              </Link>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-zinc-900">Execution Trace</h1>
                  <div className={cn("inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full", cfg.bg, cfg.color)}>
                    <Icon className={cn("h-3.5 w-3.5", status === "running" && "animate-spin")} />
                    {cfg.label}
                  </div>
                </div>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">{id}</p>
              </div>
            </div>
            {data.agents && (
              <Link href={`/marketplace/${data.agents.id}`} target="_blank">
                <Button variant="outline" size="sm" className="rounded-xl border-zinc-200 gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" /> View Agent
                </Button>
              </Link>
            )}
          </div>

          {/* Agent card */}
          {data.agents && (
            <div className="bg-white border border-zinc-100 rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-zinc-900">{data.agents.name}</p>
                <p className="text-xs text-zinc-400">{data.agents.model_name} · {data.agents.category?.replace("_"," ")}</p>
              </div>
            </div>
          )}

          {/* Metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {METRICS.map(m => (
              <div key={m.label} className="bg-white border border-zinc-100 rounded-2xl px-4 py-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">{m.label}</p>
                <p className="text-sm font-bold text-zinc-900 nums">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Input / Output */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <p className="text-sm font-semibold text-zinc-900">Input</p>
              </div>
              <CodeBlock code={inputStr} />
            </div>
            <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                  <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                </div>
                <p className="text-sm font-semibold text-zinc-900">Output</p>
              </div>
              {data.error_message ? (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700 font-mono leading-relaxed">
                  {data.error_message}
                </div>
              ) : (
                <CodeBlock code={outStr ?? "No output"} />
              )}
            </div>
          </div>

          {/* LLM Trace — only shown when execution_traces row exists */}
          {trace && (
            <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center">
                  <Brain className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900">LLM Trace</p>
                  <p className="text-xs text-zinc-400">{trace.model} · TTFT: {trace.ttft_ms ?? "—"}ms · Total: {trace.total_ms ?? "—"}ms</p>
                </div>
              </div>

              {trace.system_prompt && <CodeBlock code={trace.system_prompt} label="System Prompt" />}
              {trace.user_message  && <CodeBlock code={trace.user_message}  label="User Message" />}
              {trace.assistant_reply && <CodeBlock code={trace.assistant_reply} label="Model Response" />}

              {trace.tool_calls && Array.isArray(trace.tool_calls) && trace.tool_calls.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Tool Calls</p>
                  <CodeBlock code={JSON.stringify(trace.tool_calls, null, 2)} />
                </div>
              )}

              {/* Timing breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-zinc-50">
                {[
                  { label: "TTFT",        value: trace.ttft_ms ? `${trace.ttft_ms}ms` : "—" },
                  { label: "Total",       value: trace.total_ms ? `${trace.total_ms}ms` : "—" },
                  { label: "Tokens In",   value: trace.tokens_input?.toLocaleString() ?? "—" },
                  { label: "Tokens Out",  value: trace.tokens_output?.toLocaleString() ?? "—" },
                ].map(m => (
                  <div key={m.label}>
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">{m.label}</p>
                    <p className="text-sm font-bold text-zinc-700 nums">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security flags */}
          {trace?.status === "flagged" && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3">
              <Shield className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Security flag detected</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {trace.error_message ?? "PII or suspicious content detected in output — some fields may have been redacted."}
                </p>
              </div>
            </div>
          )}

          {/* Replay CTA */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-sm font-semibold text-zinc-900">Replay this execution</p>
              <p className="text-xs text-zinc-400 mt-0.5">Re-run with the same input against the same agent.</p>
            </div>
            <Link href={`/marketplace/${data.agents?.id}?replay=${id}`}>
              <Button variant="outline" size="sm" className="rounded-xl border-zinc-200 gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </Button>
            </Link>
          </div>

        </div>
      </main>
    </div>
  )
}
