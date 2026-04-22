"use client"

import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, CheckCircle, XCircle, Clock, Loader2,
  Bot, DollarSign, Zap, Eye, EyeOff, Code2,
  AlertCircle, ExternalLink, RefreshCw, Terminal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { formatNumber, formatDate, cn } from "@/lib/utils"

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  success: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50", label: "Success" },
  failed:  { icon: XCircle,     color: "text-red-500",   bg: "bg-red-50",   label: "Failed"  },
  timeout: { icon: XCircle,     color: "text-orange-500",bg: "bg-orange-50",label: "Timeout" },
  running: { icon: Loader2,     color: "text-blue-500",  bg: "bg-blue-50",  label: "Running" },
  queued:  { icon: Clock,       color: "text-zinc-400",  bg: "bg-zinc-50",  label: "Queued"  },
} as const

// ─── JSON display ─────────────────────────────────────────────────────────────

function JsonDisplay({ data, maxHeight = 300 }: { data: unknown; maxHeight?: number }) {
  const [showFull, setShowFull] = useState(false)
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2)

  return (
    <div className="relative">
      <pre
        className="bg-zinc-950 text-zinc-200 rounded-xl px-4 py-3 text-[11px] font-mono overflow-auto leading-relaxed whitespace-pre-wrap"
        style={{ maxHeight: showFull ? "none" : maxHeight }}>
        {text}
      </pre>
      {text.length > 500 && (
        <button
          onClick={() => setShowFull(v => !v)}
          className="mt-1.5 text-[11px] text-primary font-semibold hover:underline">
          {showFull ? "Show less ↑" : "Show full output ↓"}
        </button>
      )}
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="px-5 py-3.5 border-b border-zinc-50 flex items-center gap-2">
        <Icon className="h-4 w-4 text-zinc-400" />
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ExecutionDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const { user, loading: authLoading } = useUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const [execution, setExecution] = useState<any>(null)
  const [trace,     setTrace]     = useState<any>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState("")

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }
    if (!id) return

    let cancelled = false

    Promise.all([
      // Main execution record
      supabase.from("executions")
        .select("*, agents(id, name, category, model_name, icon_url)")
        .eq("id", id)
        .eq("user_id", user.id)
        .single(),
      // Execution trace (system prompt, user message, LLM reply)
      supabase.from("execution_traces")
        .select("*")
        .eq("execution_id", id)
        .single(),
    ]).then(([{ data: exec, error: execErr }, { data: traceData }]) => {
      if (cancelled) return
      if (execErr || !exec) { setError("Execution not found or access denied"); setLoading(false); return }
      setExecution(exec)
      setTrace(traceData)  // May be null if trace not stored
      setLoading(false)
    }).catch(err => {
      if (!cancelled) { setError(err.message); setLoading(false) }
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id, authLoading])

  if (authLoading || loading) return (
    <div className="space-y-4">
      <div className="h-10 w-48 bg-zinc-100 rounded-xl animate-pulse" />
      <div className="h-32 bg-zinc-50 rounded-2xl animate-pulse" />
      <div className="h-64 bg-zinc-50 rounded-2xl animate-pulse" />
      <div className="h-48 bg-zinc-50 rounded-2xl animate-pulse" />
    </div>
  )

  if (error || !execution) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <AlertCircle className="h-10 w-10 text-red-400 mb-3" />
      <h2 className="font-bold text-zinc-900 text-lg mb-1">Execution not found</h2>
      <p className="text-zinc-400 text-sm mb-5">{error || "This execution doesn't exist or you don't have access."}</p>
      <Link href="/executions">
        <Button variant="outline" className="rounded-xl border-zinc-200">← Back to history</Button>
      </Link>
    </div>
  )

  const cost = execution.cost_usd ?? execution.cost ?? 0
  const status = execution.status as keyof typeof STATUS_CONFIG
  const stCfg  = STATUS_CONFIG[status] ?? STATUS_CONFIG.queued
  const StatusIcon = stCfg.icon
  const agent  = execution.agents

  return (
    <div className="space-y-6 max-w-3xl">

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Link href="/executions">
          <Button variant="ghost" size="sm" className="rounded-xl gap-1.5 text-zinc-500 hover:text-zinc-900 -ml-2">
            <ArrowLeft className="h-4 w-4" /> Execution History
          </Button>
        </Link>
        <span className="text-zinc-300">/</span>
        <span className="text-xs text-zinc-400 font-mono">{id.slice(0, 16)}…</span>
      </div>

      {/* ── Header card ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-zinc-100 rounded-2xl p-5"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/8 flex items-center justify-center flex-shrink-0">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-lg font-bold text-zinc-900">
                {agent?.name ?? "Deleted Agent"}
              </h1>
              <span className={cn(
                "flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full",
                stCfg.bg, stCfg.color
              )}>
                <StatusIcon className={cn("h-3.5 w-3.5", status === "running" && "animate-spin")} />
                {stCfg.label}
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono mb-3">{execution.id}</p>

            {/* Key metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { icon: Clock,       label: "Latency",      value: execution.latency_ms ? `${formatNumber(execution.latency_ms)}ms` : "—" },
                { icon: DollarSign,  label: "Cost",         value: cost > 0 ? `$${cost.toFixed(6)}` : "Free" },
                { icon: Zap,         label: "Tokens In",    value: execution.tokens_input  ? formatNumber(execution.tokens_input)  : "—" },
                { icon: Zap,         label: "Tokens Out",   value: execution.tokens_output ? formatNumber(execution.tokens_output) : "—" },
              ].map(m => (
                <div key={m.label}>
                  <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">{m.label}</p>
                  <p className="text-sm font-bold text-zinc-900 nums flex items-center gap-1">
                    <m.icon className="h-3.5 w-3.5 text-zinc-300" /> {m.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Agent link */}
          {agent && (
            <Link href={`/marketplace/${agent.id}`} target="_blank"
              className="flex-shrink-0 p-2 rounded-xl border border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 text-zinc-400 hover:text-primary transition-colors"
              title="View agent in marketplace">
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-50 flex items-center gap-4 text-xs text-zinc-400 flex-wrap">
          <span>Created {formatDate(execution.created_at)}</span>
          {execution.completed_at && (
            <span>Completed {formatDate(execution.completed_at)}</span>
          )}
          {agent?.model_name && (
            <span className="flex items-center gap-1">
              <Code2 className="h-3 w-3" /> {agent.model_name}
            </span>
          )}
          {/* Run again */}
          {agent && (
            <Link href={`/marketplace/${agent.id}`}
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
              <RefreshCw className="h-3 w-3" /> Run again
            </Link>
          )}
        </div>
      </div>

      {/* ── Error message ──────────────────────────────────────────────────── */}
      {execution.error_message && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl px-5 py-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700 mb-1">Execution failed</p>
            <p className="text-xs text-red-600 font-mono leading-relaxed">{execution.error_message}</p>
          </div>
        </div>
      )}

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      {execution.input && (
        <Section title="Input" icon={Eye}>
          <JsonDisplay data={execution.input} />
        </Section>
      )}

      {/* ── Output ─────────────────────────────────────────────────────────── */}
      {execution.output && (
        <Section title="Output" icon={EyeOff}>
          <JsonDisplay data={execution.output} />
        </Section>
      )}

      {/* ── LLM Trace (if available) ───────────────────────────────────────── */}
      {trace ? (
        <>
          {trace.system_prompt && (
            <Section title="System Prompt (what the LLM saw)" icon={Terminal}>
              <pre className="bg-zinc-950 text-zinc-200 rounded-xl px-4 py-3 text-[11px] font-mono overflow-auto leading-relaxed whitespace-pre-wrap max-h-64">
                {trace.system_prompt}
              </pre>
              <p className="text-[11px] text-zinc-400 mt-2">
                Includes base prompt + RAG context (if knowledge base attached).
              </p>
            </Section>
          )}

          {trace.user_message && (
            <Section title="User Message (after transformation)" icon={Eye}>
              <pre className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 text-[11px] font-mono overflow-auto leading-relaxed whitespace-pre-wrap max-h-64 text-zinc-700">
                {trace.user_message}
              </pre>
            </Section>
          )}

          {trace.assistant_reply && (
            <Section title="Raw LLM Reply (before processing)" icon={Code2}>
              <pre className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 text-[11px] font-mono overflow-auto leading-relaxed whitespace-pre-wrap max-h-64 text-zinc-700">
                {trace.assistant_reply}
              </pre>
            </Section>
          )}

          {/* Trace metadata */}
          <div className="bg-white border border-zinc-100 rounded-2xl px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            {[
              { label: "Model",       value: trace.model ?? "—" },
              { label: "Temperature", value: trace.temperature != null ? String(trace.temperature) : "—" },
              { label: "TTFT",        value: trace.ttft_ms ? `${trace.ttft_ms}ms` : "—" },
              { label: "Total ms",    value: trace.total_ms ? `${trace.total_ms}ms` : "—" },
            ].map(m => (
              <div key={m.label}>
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">{m.label}</p>
                <p className="text-sm font-semibold text-zinc-700 nums">{m.value}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        // Trace not available (old executions or trace disabled)
        execution.status === "success" && !execution.error_message && (
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">
              Detailed LLM trace not available for this execution.
              Traces are retained for 30 days.
            </p>
          </div>
        )
      )}

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap pb-8">
        <Link href="/executions">
          <Button variant="outline" className="rounded-xl border-zinc-200 gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to history
          </Button>
        </Link>
        {agent && (
          <Link href={`/marketplace/${agent.id}`}>
            <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
              <RefreshCw className="h-4 w-4" /> Run this agent again
            </Button>
          </Link>
        )}
      </div>
    </div>
  )
}
