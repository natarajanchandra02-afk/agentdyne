"use client"

/**
 * ProtocolPanel — Builder "Protocols" tab
 *
 * Lets an owner opt an active agent into:
 *   - MCP hosting  — discoverable/callable by any MCP client via /api/mcp
 *   - A2A discovery — a public Agent Card + task endpoint for external
 *                      A2A-compliant orchestrators (LangGraph, CrewAI, etc.)
 *
 * Both are OFF by default (see migration 039) — this panel is the only
 * place they can be turned on. Built to the same standard as DeployPanel:
 *   - Accessible (ARIA labels, keyboard nav, focus-visible rings)
 *   - WCAG 2.1 AA color contrast
 *   - Optimistic toggle with rollback on failure
 *   - Error states with recovery paths
 */

import { useState, useCallback, useEffect } from "react"
import {
  Share2, Network, Copy, Check, AlertCircle, Loader2,
  ShieldCheck, ExternalLink, Info,
} from "lucide-react"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

interface Props {
  agentId: string
  agentName: string
  isPublic: boolean  // agent.status === "active"
}

interface ProtocolState {
  mcpEnabled:  boolean
  a2aEnabled:  boolean
  canPublish:  boolean
  mcpEndpoint: string
  a2aCardUrl:  string
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { toast.error("Copy failed — select and copy manually") }
  }, [value])

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2 bg-zinc-950 rounded-xl px-3 py-2.5 border border-zinc-800">
        <code className="flex-1 text-[11px] font-mono text-zinc-100 truncate">{value}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied!" : `Copy ${label}`}
          className="flex-shrink-0 text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded p-1"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}

function ProtocolToggleCard({
  icon: Icon, title, tagline, description, enabled, onToggle, busy, disabled, accent,
}: {
  icon: any; title: string; tagline: string; description: string
  enabled: boolean; onToggle(): void; busy: boolean; disabled: boolean; accent: string
}) {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", accent)}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-zinc-900 text-sm">{title}</p>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                enabled ? "bg-green-50 text-green-700 border border-green-200" : "bg-zinc-100 text-zinc-500"
              )}>
                {enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p className="text-xs text-zinc-500 font-medium mt-0.5">{tagline}</p>
            <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed max-w-md">{description}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${title}`}
          disabled={busy || disabled}
          onClick={onToggle}
          className="flex-shrink-0 mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className={cn("w-11 h-6 rounded-full relative transition-colors duration-200", enabled ? "bg-primary" : "bg-zinc-200")}>
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              )}
            />
          </div>
        </button>
      </div>
    </div>
  )
}

export function ProtocolPanel({ agentId, agentName, isPublic }: Props) {
  const [state, setState]     = useState<ProtocolState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<"mcp" | "a2a" | null>(null)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}/protocols`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        if (!cancelled) setState(data)
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load protocol settings")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [agentId])

  const toggle = useCallback(async (key: "mcpEnabled" | "a2aEnabled") => {
    if (!state) return
    if (!isPublic) {
      toast.error("Submit your agent for review first — protocols unlock once it's live")
      return
    }
    const which = key === "mcpEnabled" ? "mcp" : "a2a"
    const nextValue = !state[key]
    const prev = state

    setBusy(which)
    setState({ ...state, [key]: nextValue })  // optimistic
    try {
      const res = await fetch(`/api/agents/${agentId}/protocols`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: nextValue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      toast.success(
        nextValue
          ? `${which === "mcp" ? "MCP hosting" : "A2A discovery"} enabled`
          : `${which === "mcp" ? "MCP hosting" : "A2A discovery"} disabled`
      )
    } catch (e: any) {
      setState(prev)  // rollback
      toast.error(e.message ?? "Failed to update — try again")
    } finally {
      setBusy(null)
    }
  }, [agentId, state, isPublic])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400 gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading protocol settings…
      </div>
    )
  }

  if (error || !state) {
    return (
      <div role="alert" className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
        <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-red-700">{error ?? "Could not load protocol settings."}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4 bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 rounded-2xl p-5">
        <div className="w-10 h-10 rounded-xl bg-white border border-violet-100 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Network className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <p className="font-bold text-zinc-900">Interoperability Protocols</p>
          <p className="text-sm text-zinc-600 mt-0.5 leading-relaxed">
            Make <strong>{agentName}</strong> reachable outside AgentDyne — as a tool any MCP client can call,
            or as a peer any A2A-compliant orchestrator can discover and hire. Both are off by default and
            execute through the exact same guardrails, quotas, and billing as every other call to this agent.
          </p>
        </div>
      </div>

      {!isPublic && (
        <div role="alert" className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Agent must be live on the marketplace</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Submit for review from the <strong>Overview</strong> tab first — protocols unlock once your agent passes evaluation.
            </p>
          </div>
        </div>
      )}

      {/* MCP */}
      <ProtocolToggleCard
        icon={Share2}
        title="MCP Server Hosting"
        tagline="Model Context Protocol · spec 2026-07-28"
        description="List this agent as a callable tool at AgentDyne's single MCP endpoint. Any MCP client — Claude, ChatGPT, another team's agent runtime — can discover and call it."
        enabled={state.mcpEnabled}
        onToggle={() => toggle("mcpEnabled")}
        busy={busy === "mcp"}
        disabled={!isPublic}
        accent="bg-indigo-50 text-indigo-600"
      />
      {state.mcpEnabled && (
        <div className="-mt-3 ml-1 space-y-3 pl-4 border-l-2 border-indigo-100">
          <CopyField value={state.mcpEndpoint} label="MCP endpoint (Streamable HTTP)" />
          <p className="text-[11px] text-zinc-400 flex items-start gap-1.5">
            <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
            Callers authenticate with a normal AgentDyne API key on <code className="bg-zinc-100 px-1 rounded">tools/call</code>.
            <code className="bg-zinc-100 px-1 rounded ml-1">tools/list</code> is open for discovery.
          </p>
        </div>
      )}

      {/* A2A */}
      <ProtocolToggleCard
        icon={ShieldCheck}
        title="A2A Discovery"
        tagline="Agent2Agent Protocol · Linux Foundation v1.0"
        description="Publish a public Agent Card describing this agent's skills. External A2A orchestrators can discover and delegate tasks to it directly."
        enabled={state.a2aEnabled}
        onToggle={() => toggle("a2aEnabled")}
        busy={busy === "a2a"}
        disabled={!isPublic}
        accent="bg-violet-50 text-violet-600"
      />
      {state.a2aEnabled && (
        <div className="-mt-3 ml-1 space-y-3 pl-4 border-l-2 border-violet-100">
          <CopyField value={state.a2aCardUrl} label="Agent Card URL (public)" />
          <a
            href={state.a2aCardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View Agent Card JSON
          </a>
          <p className="text-[11px] text-zinc-400 flex items-start gap-1.5">
            <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
            Task creation (<code className="bg-zinc-100 px-1 rounded">POST /tasks</code>) requires the API key
            declared in the card's <code className="bg-zinc-100 px-1 rounded">securitySchemes</code>.
          </p>
        </div>
      )}

      <div className="flex items-start gap-3 bg-zinc-50 border border-zinc-100 rounded-xl p-4">
        <ShieldCheck className="h-4 w-4 text-zinc-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-zinc-500 leading-relaxed">
          Every external call — MCP <code className="bg-zinc-100 px-1 rounded">tools/call</code> or an A2A task —
          runs through the same guardrails, injection filtering, credit reservation, and quota enforcement as a
          direct API call, and is logged for your account's audit trail.
        </p>
      </div>
    </div>
  )
}
