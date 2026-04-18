"use client"

import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, CheckCircle, XCircle, Clock, Loader2,
  Zap, Brain, Code2, DollarSign, Hash, Bot,
  ChevronRight, Copy, Check,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { Button } from "@/components/ui/button"
import { formatRelativeTime, cn } from "@/lib/utils"

const STATUS_CONFIG = {
  success: { icon: CheckCircle, color: "text-green-500", bg: "bg-green-50", label: "Success" },
  failed:  { icon: XCircle,     color: "text-red-500",   bg: "bg-red-50",   label: "Failed"  },
  timeout: { icon: XCircle,     color: "text-orange-500",bg: "bg-orange-50",label: "Timeout" },
  running: { icon: Loader2,     color: "text-blue-500",  bg: "bg-blue-50",  label: "Running" },
  queued:  { icon: Clock,       color: "text-zinc-400",  bg: "bg-zinc-50",  label: "Queued"  },
} as const

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 transition-colors p-1 rounded">
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

export default function ExecutionDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const { user, loading: authLoading } = useUser()
  const supabaseRef = useRef(createClient())
  const supabase    = supabaseRef.current

  const [execution, setExecution] = useState<any>(null)
  const [trace,     setTrace]     = useState<any>(null)
  const [loading,   setLoading]   = useState(true)
  const [notFound,  setNotFound]  = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }
    if (!id)   return

    let cancelled = false
    Promise.all([
      supabase.from("executions")
        .select("*, agents(id, name, category, model_name)")
        .eq("id",      id)
        .eq("user_id", user.id)
        .single(),
      supabase.from("execution_traces")
        .select("*")
        .eq("execution_id", id)
        .eq("user_id",      user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .single(),
    ]).then(([{ data: exec }, { data: traceData }]) => {
      if (cancelled) return
      if (!exec) { setNotFound(true); setLoading(false); return }
      setExecution(exec)
      setTrace(traceData)
      setLoading(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, id])

  if (authLoading || loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-zinc-100 rounded-xl" />
        <div className="h-32 bg-zinc-50 border border-zinc-100 rounded-2xl" />
        <div className="h-48 bg-zinc-50 border border-zinc-100 rounded-2xl" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="text-center py-20">
        <Hash className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
        <p className="font-semibold text-zinc-900 mb-1">Execution not found</p>
        <p className="text-sm text-zinc-400 mb-5">It may belong to a different account or be too old.</p>
        <Link href="/executions">
          <Button variant="outline" className="rounded-xl">← Back to Executions</Button>
        </Link>
      </div>
    )
  }

  if (!execution) return null

  const cfg        = STATUS_CONFIG[execution.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.queued
  const StatusIcon = cfg.icon
  const agent      = execution.agents
  const cost       = execution.cost_usd ?? execution.cost ?? 0

  const outputStr  = typeof execution.output === "string"
    ? execution.output
    : JSON.stringify(execution.output, null, 2)
  const inputStr   = typeof execution.input === "string"
    ? execution.input
    : JSON.stringify(execution.input, null, 2)

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/executions">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-zinc-900">Execution Detail</h1>
            <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full", cfg.bg, cfg.color)}>
              <StatusIcon className={cn("h-3 w-3", execution.status === "running" && "animate-spin")} />
              {cfg.label}
            </span>
          </div>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">{execution.id}</p>
        </div>
      </div>

      {/* Summary card */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-zinc-900">
              {agent?.name ?? "Deleted Agent"}
            </p>
            {agent?.category && (
              <p className="text-xs text-zinc-400 capitalize">{agent.category.replace("_", " ")}</p>
            )}
          </div>
          {agent?.id && (
            <Link href={`/marketplace/${agent.id}`}
              className="ml-auto text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              View agent <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: Zap,      label: "Latency",      value: execution.latency_ms ? `${execution.latency_ms.toLocaleString()}ms` : "—" },
            { icon: Brain,    label: "Tokens In",    value: execution.tokens_input?.toLocaleString() ?? "—" },
            { icon: Brain,    label: "Tokens Out",   value: execution.tokens_output?.toLocaleString() ?? "—" },
            { icon: DollarSign,label: "Cost",        value: cost > 0 ? `$${cost.toFixed(6)}` : "Free" },
          ].map(s => (
            <div key={s.label} className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <s.icon className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">{s.label}</span>
              </div>
              <p className="text-base font-black text-zinc-900 nums">{s.value}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-zinc-400 mt-4">{formatRelativeTime(execution.created_at)}</p>
      </div>

      {/* Input */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-50">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Input</p>
          <CopyButton text={inputStr} />
        </div>
        <pre className="px-5 py-4 text-xs font-mono text-zinc-600 overflow-auto max-h-64 leading-relaxed whitespace-pre-wrap">
          {inputStr}
        </pre>
      </div>

      {/* Output */}
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-50">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Output</p>
          {outputStr && <CopyButton text={outputStr} />}
        </div>
        {execution.status === "failed" ? (
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-red-600 mb-1">Error</p>
            <pre className="text-xs font-mono text-red-500 leading-relaxed whitespace-pre-wrap">
              {execution.error_message ?? "Unknown error"}
            </pre>
          </div>
        ) : (
          <pre className="px-5 py-4 text-xs font-mono text-zinc-600 overflow-auto max-h-80 leading-relaxed whitespace-pre-wrap">
            {outputStr || <span className="text-zinc-300">No output</span>}
          </pre>
        )}
      </div>

      {/* Trace (if available) */}
      {trace && (
        <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-3.5 border-b border-zinc-50 flex items-center gap-2">
            <Code2 className="h-4 w-4 text-zinc-400" />
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">LLM Trace</p>
          </div>
          <div className="divide-y divide-zinc-50">
            {[
              { label: "Model",       value: trace.model ?? "—" },
              { label: "TTFT",        value: trace.ttft_ms ? `${trace.ttft_ms}ms` : "—" },
              { label: "Temperature", value: trace.temperature ?? "—" },
              { label: "Tool calls",  value: trace.tool_calls != null ? String(trace.tool_calls) : "0" },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between px-5 py-3">
                <span className="text-xs font-semibold text-zinc-400">{r.label}</span>
                <span className="text-sm font-mono text-zinc-700">{r.value}</span>
              </div>
            ))}
          </div>
          {trace.system_prompt && (
            <div className="border-t border-zinc-50">
              <div className="flex items-center justify-between px-5 py-3.5 bg-zinc-50/50">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">System Prompt</p>
                <CopyButton text={trace.system_prompt} />
              </div>
              <pre className="px-5 py-4 text-xs font-mono text-zinc-500 overflow-auto max-h-40 leading-relaxed whitespace-pre-wrap">
                {trace.system_prompt}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* API reference */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl px-5 py-4">
        <p className="text-xs font-semibold text-zinc-500 mb-2">Replay via API</p>
        <code className="text-xs font-mono text-zinc-600">
          GET /api/executions/{execution.id}
        </code>
      </div>
    </div>
  )
}
