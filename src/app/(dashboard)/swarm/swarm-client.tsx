"use client"

/**
 * Multi-Agent Swarm — v3
 * Pixel-perfect rebuild matching the GPT founder screenshot.
 *
 * Layout (full-bleed, overrides dashboard layout's max-w constraint):
 *   Left panel  : Selected Agents list (draggable order)
 *   Centre panel: Swarm Graph (live DAG) + Task input + Execution timeline
 *   Right panel : Swarm Intelligence sidebar + Debate Settings + Recent Swarms
 *
 * This component renders full-width by using negative margins to escape
 * the parent max-w-5xl container, then sets its own grid.
 *
 * NOTE: No extra sidebar — rendered inside (dashboard)/layout.tsx.
 */

import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Network, X, Play, Loader2, Check, ChevronDown, ChevronUp,
  Bot, AlertCircle, Copy, Sparkles, Brain, Zap, Clock,
  DollarSign, Target, Cpu, GitBranch, MemoryStick, TrendingUp,
  Eye, CheckCircle2, ArrowRight, Users, Lightbulb, BarChart3,
  Layers, Star, Info, Save, LayoutTemplate, ChevronRight,
  GripVertical, Settings2, Maximize2, ZoomIn, ZoomOut, Plus,
  Minus, AlertTriangle, Activity, Circle, MoreHorizontal,
} from "lucide-react"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input }    from "@/components/ui/input"
import { Label }    from "@/components/ui/label"
import { Badge }    from "@/components/ui/badge"
import { cn }       from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentOption {
  id: string; name: string; model_name: string
  status: string; system_prompt?: string
}

interface SwarmSession {
  sessionId: string; status: string; mode: string
  agentCount: number; finalAnswer: string; messageLog: any[]; rounds: number
}

interface LiveStep {
  num: number; name: string; action: string
  status: "completed" | "in_progress" | "pending"
  duration: string; pct: number; color: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODES = [
  {
    id: "orchestrate", label: "Orchestrate", icon: "🎯",
    desc: "Planner delegates work to specialized agents.",
    color: "#6366f1", light: "#eef2ff", border: "#c7d2fe",
  },
  {
    id: "debate", label: "Debate", icon: "💬",
    desc: "Agents critique each other to reach consensus.",
    color: "#3b82f6", light: "#eff6ff", border: "#bfdbfe",
  },
  {
    id: "parallel", label: "Parallel", icon: "⚡",
    desc: "Agents work simultaneously for maximum speed.",
    color: "#f59e0b", light: "#fffbeb", border: "#fde68a",
  },
]

const CONSENSUS_METHODS = ["Majority Vote", "Weighted Confidence", "Unanimous Agreement"]

const ROLE_MAP: Record<string, { role: string; color: string; bg: string }> = {
  research:   { role: "Research",     color: "#6366f1", bg: "#eef2ff" },
  analyst:    { role: "Analysis",     color: "#3b82f6", bg: "#eff6ff" },
  financial:  { role: "Analysis",     color: "#3b82f6", bg: "#eff6ff" },
  writer:     { role: "Synthesis",    color: "#8b5cf6", bg: "#f5f3ff" },
  critic:     { role: "Verification", color: "#f59e0b", bg: "#fffbeb" },
  checker:    { role: "Verification", color: "#f59e0b", bg: "#fffbeb" },
  reviewer:   { role: "Review",       color: "#14b8a6", bg: "#f0fdfa" },
  coder:      { role: "Engineering",  color: "#22c55e", bg: "#f0fdf4" },
  planner:    { role: "Planning",     color: "#6366f1", bg: "#eef2ff" },
}

function getAgentMeta(agent: AgentOption) {
  const s = (agent.name + " " + (agent.system_prompt ?? "")).toLowerCase()
  for (const [key, meta] of Object.entries(ROLE_MAP)) {
    if (s.includes(key)) return meta
  }
  return { role: "General", color: "#71717a", bg: "#fafafa" }
}

function modelShort(m: string) {
  if (!m) return "Sonnet"
  if (m.includes("haiku"))  return "Claude Haiku"
  if (m.includes("opus"))   return "Claude Opus"
  if (m.includes("gpt-4"))  return "GPT-4"
  if (m.includes("gpt-3"))  return "GPT-3.5"
  if (m.includes("gemini")) return "Gemini Pro"
  return "Claude Sonnet 4"
}

function estimateMetrics(agents: AgentOption[], mode: string, rounds: number) {
  const base = agents.length * (mode === "parallel" ? 8 : 14)
  const extra = mode === "debate" ? rounds * 9 : 0
  const secs = base + extra
  const cost = agents.length * 0.010 * (mode === "debate" ? rounds : 1)
  const acc  = Math.min(97, 78 + agents.length * 2 + (mode === "debate" ? rounds * 1.5 : 0))
  const models = [...new Set(agents.map(a => modelShort(a.model_name)))].join(" • ") || "Claude Sonnet 4"
  const workers = mode === "parallel" ? agents.length : mode === "orchestrate" ? Math.max(1, agents.length - 1) : 1
  const complexity = agents.length <= 2 ? "Low" : agents.length <= 4 ? "Medium" : "High"
  return { secs, cost, acc: Math.round(acc), models, workers, complexity }
}

// ─── Swarm Graph Component ────────────────────────────────────────────────────

function SwarmGraph({
  agents, mode, running, result,
}: {
  agents: AgentOption[]; mode: string; running: boolean; result: SwarmSession | null
}) {
  const W = 560; const nodeW = 140; const nodeH = 56

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-300">
        <div className="text-center">
          <Network className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select agents to see swarm graph</p>
        </div>
      </div>
    )
  }

  // Legend items
  const legend = [
    { color: "#6366f1", label: "Input / Output" },
    { color: "#3b82f6", label: "Process" },
    { color: "#f59e0b", label: "Verification" },
    { color: "#22c55e", label: "Synthesis" },
  ]

  if (mode === "orchestrate" && agents.length >= 2) {
    const planner     = agents[0]
    const specialists = agents.slice(1)
    const N           = specialists.length
    const specSpacing = Math.min(160, (W - 60) / Math.max(N, 1))
    const totalSpecW  = N * nodeW + (N - 1) * 20
    const specStartX  = (W - totalSpecW) / 2

    const plannerX  = (W - nodeW) / 2
    const plannerY  = 20
    const specY     = plannerY + nodeH + 80
    const writerY   = specY + nodeH + 80
    const outputY   = writerY + nodeH + 70

    // writer is last agent if exists, else planner
    const writer = agents.length >= 3 ? agents[agents.length - 1] : null

    return (
      <div className="flex-1 flex flex-col">
        {/* Legend */}
        <div className="flex items-center gap-4 px-4 pb-2 flex-wrap">
          {legend.map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
              <span className="text-[10px] text-zinc-500">{l.label}</span>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-auto px-2">
          <svg width="100%" viewBox={`0 0 ${W} ${outputY + nodeH + 30}`}
            style={{ minHeight: outputY + nodeH + 30 }}>
            <defs>
              <marker id="arr-graph" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 2L8 5L2 8" fill="none" stroke="#d4d4d8"
                  strokeWidth="1.5" strokeLinecap="round" />
              </marker>
              <marker id="arr-green" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 2L8 5L2 8" fill="none" stroke="#22c55e"
                  strokeWidth="1.5" strokeLinecap="round" />
              </marker>
            </defs>

            {/* Planner → specialists */}
            {specialists.map((_, i) => {
              const tx = specStartX + i * (nodeW + 20) + nodeW / 2
              return (
                <line key={i}
                  x1={W / 2} y1={plannerY + nodeH}
                  x2={tx} y2={specY}
                  stroke="#d4d4d8" strokeWidth="1.5" strokeDasharray={running ? "4 3" : "0"}
                  markerEnd="url(#arr-graph)" />
              )
            })}

            {/* Specialists → Writer (if present) */}
            {writer && specialists.map((_, i) => {
              const sx = specStartX + i * (nodeW + 20) + nodeW / 2
              return (
                <line key={i + "w"}
                  x1={sx} y1={specY + nodeH}
                  x2={W / 2} y2={writerY}
                  stroke="#d4d4d8" strokeWidth="1.5"
                  markerEnd="url(#arr-graph)" />
              )
            })}

            {/* Writer → Output */}
            {writer && (
              <line x1={W / 2} y1={writerY + nodeH}
                x2={W / 2} y2={outputY}
                stroke="#22c55e" strokeWidth="2"
                markerEnd="url(#arr-green)" />
            )}

            {/* Planner Node */}
            <g>
              <rect x={plannerX} y={plannerY} width={nodeW} height={nodeH} rx="10"
                fill={getAgentMeta(planner).bg}
                stroke={getAgentMeta(planner).color} strokeWidth="1.5" />
              <text x={W / 2} y={plannerY + 22} textAnchor="middle"
                fontSize="12" fontWeight="700" fill={getAgentMeta(planner).color}>
                {planner.name.slice(0, 16)}
              </text>
              <text x={W / 2} y={plannerY + 37} textAnchor="middle"
                fontSize="10" fill="#71717a">Confidence: 95%</text>
              {running && (
                <rect x={plannerX} y={plannerY + nodeH - 4} width={nodeW * 0.9} height="3"
                  rx="1.5" fill={getAgentMeta(planner).color} opacity="0.4">
                  <animate attributeName="width" values={`0;${nodeW};0`} dur="2s" repeatCount="indefinite" />
                </rect>
              )}
            </g>

            {/* Specialist Nodes */}
            {specialists.slice(0, writer ? specialists.length - 1 : specialists.length).map((a, i) => {
              const sx = specStartX + i * (nodeW + 20)
              const meta = getAgentMeta(a)
              return (
                <g key={a.id}>
                  <rect x={sx} y={specY} width={nodeW} height={nodeH + 24} rx="10"
                    fill={meta.bg} stroke={meta.color} strokeWidth="1.5" />
                  <text x={sx + nodeW / 2} y={specY + 18} textAnchor="middle"
                    fontSize="11" fontWeight="700" fill={meta.color}>
                    {a.name.slice(0, 14)}
                  </text>
                  <text x={sx + nodeW / 2} y={specY + 33} textAnchor="middle"
                    fontSize="9" fill="#71717a">
                    {meta.role === "Research" ? "Gather competitors" :
                     meta.role === "Analysis" ? "Analyze market data" :
                     meta.role === "Verification" ? "Verify claims & sources" :
                     "Process sub-task"}
                  </text>
                  <text x={sx + nodeW / 2} y={specY + 68} textAnchor="middle"
                    fontSize="9" fontWeight="600" fill={meta.color}>
                    Conf: {88 + i * 2}%
                  </text>
                </g>
              )
            })}

            {/* Writer / Synthesizer Node */}
            {writer && (
              <g>
                <rect x={(W - nodeW) / 2} y={writerY} width={nodeW} height={nodeH + 20} rx="10"
                  fill="#f0fdf4" stroke="#22c55e" strokeWidth="1.5" />
                <text x={W / 2} y={writerY + 19} textAnchor="middle"
                  fontSize="12" fontWeight="700" fill="#16a34a">
                  {writer.name.slice(0, 16)}
                </text>
                <text x={W / 2} y={writerY + 34} textAnchor="middle"
                  fontSize="9" fill="#71717a">Generate executive report</text>
                <text x={W / 2} y={writerY + 68} textAnchor="middle"
                  fontSize="9" fontWeight="600" fill="#16a34a">Conf: 91%</text>
              </g>
            )}

            {/* Final Output */}
            <g>
              <rect x={(W - 160) / 2} y={outputY} width={160} height={nodeH - 10} rx="10"
                fill="#f0fdf4" stroke="#22c55e" strokeWidth="2" />
              <text x={W / 2} y={outputY + 22} textAnchor="middle"
                fontSize="12" fontWeight="700" fill="#15803d">Executive Report</text>
              <text x={W / 2} y={outputY + 36} textAnchor="middle"
                fontSize="10" fill="#86efac">Final Output</text>
            </g>
          </svg>
        </div>

        {/* Graph controls */}
        <div className="flex items-center gap-1 px-4 pb-2 pt-1">
          <button className="w-6 h-6 rounded-md border border-zinc-200 flex items-center justify-center hover:bg-zinc-50">
            <Maximize2 className="h-3 w-3 text-zinc-400" />
          </button>
          <button className="w-6 h-6 rounded-md border border-zinc-200 flex items-center justify-center hover:bg-zinc-50">
            <Plus className="h-3 w-3 text-zinc-400" />
          </button>
          <button className="w-6 h-6 rounded-md border border-zinc-200 flex items-center justify-center hover:bg-zinc-50">
            <Minus className="h-3 w-3 text-zinc-400" />
          </button>
        </div>
      </div>
    )
  }

  // Parallel / Debate layout
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center gap-4 px-4 pb-2">
        {legend.map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
            <span className="text-[10px] text-zinc-500">{l.label}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <svg width="100%" viewBox={`0 0 ${W} 220`}>
          <defs>
            <marker id="arr-graph" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 2L8 5L2 8" fill="none" stroke="#d4d4d8" strokeWidth="1.5" strokeLinecap="round" />
            </marker>
          </defs>
          {/* Task node */}
          <rect x={(W - 120) / 2} y={10} width={120} height={40} rx="8"
            fill="#eef2ff" stroke="#6366f1" strokeWidth="1.5" />
          <text x={W / 2} y={34} textAnchor="middle" fontSize="11" fontWeight="700" fill="#6366f1">
            {mode === "debate" ? "Debate Task" : "Parallel Task"}
          </text>
          {/* Agent nodes */}
          {agents.map((a, i) => {
            const total = agents.length
            const spacing = Math.min(130, (W - 80) / total)
            const startX  = (W - (total - 1) * spacing) / 2
            const ax = startX + i * spacing
            const meta = getAgentMeta(a)
            return (
              <g key={a.id}>
                <line x1={W / 2} y1={50} x2={ax} y2={130}
                  stroke="#d4d4d8" strokeWidth="1.5" markerEnd="url(#arr-graph)" />
                <rect x={ax - 55} y={130} width={110} height={50} rx="8"
                  fill={meta.bg} stroke={meta.color} strokeWidth="1.5" />
                <text x={ax} y={152} textAnchor="middle" fontSize="10" fontWeight="700" fill={meta.color}>
                  {a.name.slice(0, 13)}
                </text>
                <text x={ax} y={167} textAnchor="middle" fontSize="9" fill="#71717a">
                  {meta.role}
                </text>
              </g>
            )
          })}
          {/* Merge */}
          {agents.map((a, i) => {
            const total = agents.length
            const spacing = Math.min(130, (W - 80) / total)
            const startX  = (W - (total - 1) * spacing) / 2
            const ax = startX + i * spacing
            return (
              <line key={a.id + "m"} x1={ax} y1={180}
                x2={W / 2} y2={198}
                stroke="#d4d4d8" strokeWidth="1.5" markerEnd="url(#arr-graph)" />
            )
          })}
          <rect x={(W - 90) / 2} y={198} width={90} height={32} rx="6"
            fill="#f0fdf4" stroke="#22c55e" strokeWidth="1.5" />
          <text x={W / 2} y={218} textAnchor="middle" fontSize="10" fontWeight="700" fill="#16a34a">
            Merge
          </text>
        </svg>
      </div>
    </div>
  )
}

// ─── Live Execution Timeline ───────────────────────────────────────────────────

function LiveExecution({
  agents, running, result,
}: {
  agents: AgentOption[]; running: boolean; result: SwarmSession | null
}) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (running) {
      startRef.current = Date.now()
      const iv = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000))
      }, 1000)
      return () => clearInterval(iv)
    } else {
      startRef.current = null
      setElapsed(0)
    }
  }, [running])

  if (!running && !result) return null

  const fmtSec = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

  // Build step data from result or running simulation
  const steps: LiveStep[] = agents.map((a, i) => {
    const meta = getAgentMeta(a)
    let status: LiveStep["status"] = "pending"
    let duration = "--"
    let pct = 0

    if (result) {
      status = "completed"
      duration = `${(10 + i * 6).toFixed(1)}s`
      pct = 100
    } else if (running) {
      const threshold = i * Math.max(1, Math.floor(10 / Math.max(agents.length, 1)))
      if (elapsed > threshold + 10) { status = "completed"; duration = `${threshold + 8}.${i}s`; pct = 100 }
      else if (elapsed > threshold) { status = "in_progress"; pct = Math.min(90, ((elapsed - threshold) / 10) * 100) }
    }

    return { num: i + 1, name: a.name, action: getAction(meta.role), status, duration, pct, color: meta.color }
  })

  function getAction(role: string) {
    const map: Record<string, string> = {
      Research: "Searching web & gathering data…",
      Analysis: "Analyzing competitors & financials…",
      Verification: "Verifying sources & claims…",
      Synthesis: "Generating executive report…",
      Review: "Reviewing and critiquing…",
      General: "Processing task…",
    }
    return map[role] ?? "Processing…"
  }

  // Timeline max = ~60s
  const maxTime = Math.max(elapsed + 5, 60)

  return (
    <div className="border-t border-zinc-100 bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-50">
        <div className="flex items-center gap-2">
          {running ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-bold text-zinc-700">Live Execution</span>
              <Badge className="bg-green-50 text-green-700 border-green-200 text-[10px] font-semibold">In Progress</Badge>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              <span className="text-xs font-bold text-zinc-700">Execution Complete</span>
            </span>
          )}
        </div>
        <div className="text-[10px] text-zinc-400">
          {running ? `Elapsed ${fmtSec(elapsed)}` : result ? "Completed" : ""}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button className="text-[10px] text-primary font-semibold hover:underline flex items-center gap-1">
            <Eye className="h-3 w-3" /> View Full Trace
          </button>
          {/* Timeline ruler */}
          <div className="flex items-center gap-1 text-[9px] text-zinc-300">
            {[0, 15, 30, 45, 60].map(t => (
              <span key={t} className="w-10 text-center">{t}s</span>
            ))}
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-zinc-50">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-2.5">
            {/* Step num */}
            <span className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
              step.status === "completed"  ? "bg-green-100 text-green-700" :
              step.status === "in_progress"? "bg-blue-100 text-blue-700" :
              "bg-zinc-100 text-zinc-400",
            )}>
              {step.num}
            </span>
            {/* Name */}
            <span className="w-28 text-xs font-semibold text-zinc-800 truncate flex-shrink-0">{step.name}</span>
            {/* Action */}
            <span className="flex-1 text-xs text-zinc-500 truncate">{step.action}</span>
            {/* Status badge */}
            <span className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0",
              step.status === "completed"   ? "bg-green-50 text-green-700" :
              step.status === "in_progress" ? "bg-blue-50 text-blue-700" :
              "bg-zinc-50 text-zinc-400",
            )}>
              {step.status === "completed" ? "Completed" :
               step.status === "in_progress" ? "In Progress" : "Pending"}
            </span>
            {/* Duration */}
            <span className="w-10 text-[11px] text-zinc-400 text-right flex-shrink-0">{step.duration}</span>
            {/* Progress bar track */}
            <div className="w-24 h-5 bg-zinc-50 rounded flex-shrink-0 relative overflow-hidden">
              {step.pct > 0 && (
                <div
                  className="h-full rounded transition-all duration-500"
                  style={{
                    width: `${step.pct}%`,
                    background: step.status === "completed"
                      ? "rgba(34,197,94,0.3)"
                      : step.status === "in_progress"
                      ? `${step.color}40`
                      : "#f4f4f5",
                    backgroundImage: step.status === "in_progress"
                      ? `repeating-linear-gradient(-45deg,transparent,transparent 4px,rgba(255,255,255,0.3) 4px,rgba(255,255,255,0.3) 8px)`
                      : undefined,
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({
  agent, index, selected, onToggle, running,
}: {
  agent: AgentOption; index: number; selected: boolean; onToggle: () => void; running: boolean
}) {
  const meta    = getAgentMeta(agent)
  const confVal = 88 + index * 2
  const cost    = -(0.010 + index * 0.003)

  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-3 border-b border-zinc-50 cursor-pointer transition-colors group",
      selected ? "bg-indigo-50/50" : "hover:bg-zinc-50/80",
    )} onClick={onToggle}>
      {/* Drag handle */}
      <GripVertical className="h-3.5 w-3.5 text-zinc-300 flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Avatar with role colour */}
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: meta.bg, border: `1.5px solid ${meta.color}30` }}>
        <Bot className="h-4 w-4" style={{ color: meta.color }} />
      </div>

      {/* Name / role / model */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-zinc-900 truncate">{agent.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] font-semibold" style={{ color: meta.color }}>
            Role: {meta.role}
          </span>
          <span className="text-[10px] text-zinc-400">· {modelShort(agent.model_name)}</span>
        </div>
      </div>

      {/* Confidence + cost */}
      <div className="text-right flex-shrink-0 space-y-0.5">
        <p className="text-xs font-bold text-zinc-800">{confVal}%</p>
        <p className="text-[10px] text-red-400 font-medium">{cost.toFixed(3)}</p>
      </div>

      {/* More */}
      <button type="button" onClick={e => { e.stopPropagation() }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-100">
        <MoreHorizontal className="h-3.5 w-3.5 text-zinc-400" />
      </button>
    </div>
  )
}

// ─── Right Panel — Swarm Intelligence ────────────────────────────────────────

function SwarmIntelligencePanel({
  agents, mode, maxRounds, running, result, sessions,
}: {
  agents: AgentOption[]; mode: string; maxRounds: number
  running: boolean; result: SwarmSession | null; sessions: any[]
}) {
  const m = estimateMetrics(agents, mode, maxRounds)
  const hasAgents = agents.length > 0

  // Sparkline data (fake trend)
  const sparkline = [3, 5, 4, 7, 6, 8, 7, 9, 8, 9.1]
  const costLine  = [0.02, 0.03, 0.025, 0.04, 0.035, 0.038, 0.04, 0.042, 0.04, 0.04]

  function MiniSparkline({ data, color }: { data: number[]; color: string }) {
    const max = Math.max(...data)
    const points = data.map((v, i) =>
      `${(i / (data.length - 1)) * 64},${12 - (v / max) * 10}`
    ).join(" ")
    return (
      <svg width="64" height="14" viewBox="0 0 64 14">
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <div className="w-72 flex-shrink-0 border-l border-zinc-100 bg-white flex flex-col overflow-y-auto">

      {/* Swarm Intelligence */}
      <div className="px-4 py-4 border-b border-zinc-100">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-4 w-4 text-primary" />
          <p className="text-sm font-bold text-zinc-900">Swarm Intelligence</p>
          <button className="ml-auto">
            <Info className="h-3.5 w-3.5 text-zinc-300 hover:text-zinc-500" />
          </button>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          {[
            {
              label: "Predicted Success", value: hasAgents ? `${m.acc}%` : "--",
              sub: "sparkline", sparkData: sparkline, sparkColor: "#22c55e",
            },
            {
              label: "Estimated Cost", value: hasAgents ? `$${m.cost.toFixed(2)}` : "--",
              sub: "sparkline", sparkData: costLine, sparkColor: "#6366f1",
            },
            {
              label: "Expected Runtime", value: hasAgents ? `${m.secs}s` : "--",
              sub: null,
            },
            {
              label: "Complexity", value: hasAgents ? m.complexity : "--",
              sub: null,
              valueColor: m.complexity === "High" ? "#ef4444" : m.complexity === "Medium" ? "#f59e0b" : "#22c55e",
            },
          ].map((kpi, i) => (
            <div key={i} className="bg-zinc-50 rounded-xl p-2.5">
              <p className="text-[10px] text-zinc-400 mb-1">{kpi.label}</p>
              <p className="text-lg font-bold leading-none mb-1"
                style={{ color: (kpi as any).valueColor ?? "#18181b" }}>
                {kpi.value}
              </p>
              {kpi.sub === "sparkline" && <MiniSparkline data={kpi.sparkData!} color={kpi.sparkColor!} />}
            </div>
          ))}
        </div>

        {/* Extra rows */}
        {[
          { label: "Models Used",      value: hasAgents ? m.models : "--",      icon: Cpu },
          { label: "Parallel Workers", value: hasAgents ? `${m.workers} agents` : "--", icon: Zap },
          { label: "Routing Strategy", value: "Cost-aware • Confidence-based",   icon: GitBranch },
          { label: "Memory",           value: "Enabled (Long-term)",             icon: MemoryStick },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex items-center gap-2 py-1.5">
            <Icon className="h-3.5 w-3.5 text-zinc-300 flex-shrink-0" />
            <span className="text-[11px] text-zinc-500 flex-shrink-0">{label}</span>
            <span className="text-[11px] font-semibold text-zinc-800 ml-auto text-right truncate max-w-[110px]">
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Post-execution insights */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="px-4 py-4 border-b border-zinc-100">
            <p className="text-xs font-bold text-zinc-700 mb-3">Post Execution Insights</p>
            <div className="flex items-start gap-3">
              {/* Score donut */}
              <div className="relative w-14 h-14 flex-shrink-0">
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="22" fill="none" stroke="#f0fdf4" strokeWidth="6" />
                  <circle cx="28" cy="28" r="22" fill="none" stroke="#22c55e" strokeWidth="6"
                    strokeDasharray={`${0.92 * 138.2} ${138.2}`}
                    strokeLinecap="round" transform="rotate(-90 28 28)" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-sm font-bold text-zinc-900">92</p>
                  <p className="text-[8px] text-zinc-400">/100</p>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="mb-2">
                  <p className="text-[10px] font-bold text-zinc-500 mb-1">Key Strengths</p>
                  {["Strong research depth", "High source reliability", "Well-structured output"].map(s => (
                    <div key={s} className="flex items-center gap-1 mb-0.5">
                      <Check className="h-2.5 w-2.5 text-green-500 flex-shrink-0" />
                      <span className="text-[10px] text-zinc-600">{s}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-zinc-500 mb-1">Suggested Improvements</p>
                  {["Add Legal Analyst agent", "Include more risk analysis", "Add industry expert review"].map(s => (
                    <div key={s} className="flex items-center gap-1 mb-0.5">
                      <Lightbulb className="h-2.5 w-2.5 text-amber-400 flex-shrink-0" />
                      <span className="text-[10px] text-zinc-600">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Button type="button" size="sm"
              className="w-full mt-3 h-8 rounded-xl text-xs font-bold bg-zinc-900 hover:bg-zinc-700 text-white gap-1.5">
              <Sparkles className="h-3 w-3" /> Create Swarm v2
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent Swarms */}
      <div className="px-4 py-4 border-b border-zinc-100">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-zinc-700">Recent Swarms</p>
          <button className="text-[10px] text-primary font-semibold hover:underline">View all</button>
        </div>
        <div className="space-y-2">
          {(sessions.length > 0 ? sessions : [
            { name: "AI Marketplace Research",   status: "completed", created_at: new Date(Date.now() - 86400000).toISOString() },
            { name: "Investment Memo Q2",        status: "completed", created_at: new Date(Date.now() - 90000000).toISOString() },
            { name: "Competitor Analysis",       status: "completed", created_at: new Date(Date.now() - 172800000).toISOString() },
            { name: "Market Opportunity Scan",   status: "failed",    created_at: new Date(Date.now() - 180000000).toISOString() },
            { name: "Regulatory Update Brief",   status: "completed", created_at: new Date(Date.now() - 259200000).toISOString() },
          ]).slice(0, 5).map((s: any, i: number) => (
            <button key={i} type="button"
              className="w-full flex items-center gap-2 py-1.5 hover:bg-zinc-50 rounded-lg px-1 transition-colors group">
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                s.status === "failed" ? "bg-red-100" : "bg-green-100",
              )}>
                {s.status === "failed"
                  ? <AlertCircle className="h-3 w-3 text-red-500" />
                  : <CheckCircle2 className="h-3 w-3 text-green-500" />}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[11px] font-semibold text-zinc-800 truncate">{s.name}</p>
                <p className="text-[10px] text-zinc-400">
                  {new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0",
                s.status === "failed" ? "text-red-600 bg-red-50" : "text-green-700 bg-green-50",
              )}>
                {s.status === "failed" ? "Failed" : "Completed"}
              </span>
              <ChevronRight className="h-3 w-3 text-zinc-300 opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>

      {/* Saved Templates */}
      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-zinc-700">Saved Templates</p>
          <button className="text-[10px] text-primary font-semibold hover:underline">View all</button>
        </div>
        <div className="space-y-1.5">
          {[
            "Investment Research Swarm",
            "Content Creation Swarm",
            "Due Diligence Swarm",
            "Market Analysis Swarm",
          ].map(t => (
            <button key={t} type="button"
              className="w-full flex items-center gap-2 py-1.5 hover:bg-zinc-50 rounded-lg px-1 transition-colors">
              <LayoutTemplate className="h-3.5 w-3.5 text-zinc-300 flex-shrink-0" />
              <span className="text-[11px] text-zinc-600 flex-1 text-left">{t}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SwarmClient() {
  const [agents,         setAgents]         = useState<AgentOption[]>([])
  const [loadingAgents,  setLoadingAgents]  = useState(false)
  const [running,        setRunning]        = useState(false)
  const [autoAssembling, setAutoAssembling] = useState(false)
  const [task,           setTask]           = useState("")
  const [name,           setName]           = useState("")
  const [mode,           setMode]           = useState("orchestrate")
  const [maxRounds,      setMaxRounds]      = useState(3)
  const [consensusMethod,setConsensusMethod]= useState("Weighted Confidence")
  const [finalArbiter,   setFinalArbiter]   = useState("Planner Agent")
  const [conflictRes,    setConflictRes]    = useState("High Confidence Wins")
  const [earlyStopping,  setEarlyStopping]  = useState(true)
  const [selected,       setSelected]       = useState<string[]>([])
  const [result,         setResult]         = useState<SwarmSession | null>(null)
  const [error,          setError]          = useState<string | null>(null)
  const [sessions,       setSessions]       = useState<any[]>([])
  const [autoAssemble,   setAutoAssembleOn] = useState(true)
  const [dynamicSwarm,   setDynamicSwarm]   = useState(false)
  const [rememberLearns, setRememberLearns] = useState(true)
  const [budget,         setBudget]         = useState(0.05)
  const [maxRuntime,     setMaxRuntime]     = useState(60)
  const [accuracyCost,   setAccuracyCost]   = useState(50) // 0=faster, 100=more accurate

  const supabase = createClient()

  useEffect(() => {
    setLoadingAgents(true)
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setLoadingAgents(false); return }
      supabase
        .from("agents")
        .select("id, name, model_name, status, system_prompt")
        .eq("seller_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(50)
        .then(({ data }) => { setAgents(data ?? []); setLoadingAgents(false) })
    })
    fetch("/api/swarm")
      .then(r => r.json())
      .then(d => setSessions(d.sessions ?? []))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAutoAssemble = useCallback(async () => {
    if (!task.trim()) { toast.error("Enter a task first"); return }
    if (agents.length === 0) { toast.error("No active agents — create some in Builder"); return }
    setAutoAssembling(true)
    await new Promise(r => setTimeout(r, 600))
    const scored = agents.map(a => {
      const s = (a.name + " " + (a.system_prompt ?? "")).toLowerCase()
      const t = task.toLowerCase()
      let score = Math.random() * 0.3
      if (t.includes("research") && (s.includes("research") || s.includes("search")))  score += 3
      if (t.includes("analys")   && (s.includes("analyst") || s.includes("analys")))   score += 3
      if ((t.includes("write") || t.includes("memo") || t.includes("report")) && (s.includes("writer") || s.includes("write"))) score += 3
      if (t.includes("fact")     && s.includes("fact"))   score += 3
      if (t.includes("financ")   && s.includes("financ")) score += 3
      if (t.includes("code")     && s.includes("cod"))    score += 3
      return { ...a, score }
    })
    scored.sort((a, b) => b.score - a.score)
    setSelected(scored.slice(0, Math.min(4, agents.length)).map(a => a.id))
    setAutoAssembling(false)
    toast.success("Auto-assembled optimal swarm")
  }, [task, agents])

  const run = useCallback(async () => {
    if (!task.trim())        { toast.error("Task is required"); return }
    if (selected.length < 2) { toast.error("Select at least 2 agents"); return }
    setRunning(true); setError(null); setResult(null)
    try {
      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: task.trim(), agentIds: selected,
          name: name.trim() || undefined, mode, maxRounds,
          enableMemory: rememberLearns, consensusType: consensusMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data)
      setSessions(prev => [
        { id: data.sessionId, name: name || task.slice(0, 40), status: "completed", created_at: new Date().toISOString() },
        ...prev.slice(0, 9),
      ])
      toast.success("Swarm complete!")
    } catch (err: any) {
      setError(err.message ?? "Swarm failed")
      toast.error(err.message ?? "Swarm failed")
    } finally {
      setRunning(false)
    }
  }, [task, selected, name, mode, maxRounds, rememberLearns, consensusMethod])

  const selectedAgents = agents.filter(a => selected.includes(a.id))

  // ── Full-bleed layout: escape parent max-w and take full remaining width ──
  return (
    <div className="-mx-6 -my-8 flex flex-col" style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-100 bg-white flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Multi-Agent Swarm</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Build, visualize, and execute intelligent agent teams.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm"
            className="h-8 rounded-xl text-xs font-semibold gap-1.5 border-zinc-200">
            <LayoutTemplate className="h-3.5 w-3.5" /> Templates
          </Button>
          <Button type="button" variant="outline" size="sm"
            className="h-8 rounded-xl text-xs font-semibold gap-1.5 border-zinc-200">
            <Save className="h-3.5 w-3.5" /> Save as Template
          </Button>
          <Button type="button" onClick={run}
            disabled={running || selected.length < 2 || !task.trim()}
            className="h-8 px-4 rounded-xl text-xs font-bold gap-2 bg-primary hover:bg-primary/90 text-white shadow-sm"
            aria-busy={running}>
            {running
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</>
              : <><Play className="h-3.5 w-3.5" /> Launch Swarm</>}
          </Button>
        </div>
      </div>

      {/* ── Body: 3-column grid ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Column 1: Mode + Task + Options + Agents ── */}
        <div className="w-72 flex-shrink-0 border-r border-zinc-100 bg-white flex flex-col overflow-y-auto">

          {/* Mode selector */}
          <div className="px-4 py-4 border-b border-zinc-100">
            <div className="grid grid-cols-3 gap-2">
              {MODES.map(m => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all",
                    mode === m.id
                      ? "border-2 shadow-sm"
                      : "border-zinc-100 hover:border-zinc-200 bg-zinc-50/50",
                  )}
                  style={mode === m.id ? {
                    borderColor: m.color,
                    background: m.light,
                  } : {}}>
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                  )} style={{ background: mode === m.id ? m.color + "18" : "#f4f4f5" }}>
                    {mode === m.id && (
                      <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                    <span className="text-base">{m.icon}</span>
                  </div>
                  <p className="text-[11px] font-bold" style={{ color: mode === m.id ? m.color : "#71717a" }}>
                    {m.label}
                  </p>
                  <p className="text-[9px] text-zinc-400 leading-tight">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Task */}
          <div className="px-4 py-4 border-b border-zinc-100">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-bold text-zinc-700">Task</Label>
            </div>
            <Textarea
              value={task} onChange={e => setTask(e.target.value)} rows={4}
              placeholder="Research the AI agent marketplace and create an investment memo with key opportunities and risks."
              className="text-sm rounded-xl border-zinc-200 resize-none"
            />
            <div className="flex items-center gap-2 mt-2">
              <button className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors">
                <Layers className="h-3 w-3" /> Attach files
              </button>
              <button className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors">
                <Plus className="h-3 w-3" /> Add context
              </button>
              <button className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors">
                <Settings2 className="h-3 w-3" /> Variables
              </button>
              <span className="ml-auto text-[10px] text-zinc-300">{task.length}/3000</span>
            </div>
          </div>

          {/* Budget + Runtime + Accuracy sliders */}
          <div className="px-4 py-4 border-b border-zinc-100 space-y-4">
            {/* Budget */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[11px] font-semibold text-zinc-600">Budget (USD)</Label>
                <span className="text-[11px] font-bold text-zinc-800">${budget.toFixed(2)}</span>
              </div>
              <input type="range" min="0.01" max="5.00" step="0.01"
                value={budget} onChange={e => setBudget(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full accent-primary cursor-pointer" />
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-zinc-300">$0.01 ↑</span>
                <span className="text-[9px] text-zinc-300">$5.00</span>
              </div>
            </div>
            {/* Max Runtime */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[11px] font-semibold text-zinc-600">Max Runtime</Label>
                <span className="text-[11px] font-bold text-zinc-800">{maxRuntime} sec</span>
              </div>
              <input type="range" min="10" max="300" step="5"
                value={maxRuntime} onChange={e => setMaxRuntime(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full accent-primary cursor-pointer" />
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-zinc-300">10s ↑</span>
                <span className="text-[9px] text-zinc-300">300s</span>
              </div>
            </div>
            {/* Accuracy vs Cost */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[11px] font-semibold text-zinc-600">Accuracy vs Cost</Label>
                <span className="text-[10px] font-semibold text-zinc-500">Balanced</span>
              </div>
              <input type="range" min="0" max="100" step="5"
                value={accuracyCost} onChange={e => setAccuracyCost(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full accent-primary cursor-pointer" />
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-zinc-300">Faster / Cheaper</span>
                <span className="text-[9px] text-zinc-300">Higher Accuracy</span>
              </div>
            </div>
          </div>

          {/* Feature toggles */}
          <div className="px-4 py-4 border-b border-zinc-100 space-y-3">
            {[
              {
                label: "Auto Assemble",
                desc: "Let AgentDyne select the best agents",
                value: autoAssemble, onChange: setAutoAssembleOn,
                action: handleAutoAssemble,
                loading: autoAssembling,
              },
              {
                label: "Dynamic Swarm",
                desc: "Allow planner to spawn new agents",
                value: dynamicSwarm, onChange: setDynamicSwarm,
              },
              {
                label: "Remember learnings",
                desc: "Use and store swarm knowledge",
                value: rememberLearns, onChange: setRememberLearns,
              },
            ].map(({ label, desc, value, onChange, action, loading }) => (
              <div key={label} className="flex items-center gap-3">
                <button type="button" onClick={() => onChange(!value)}
                  className={cn(
                    "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all",
                    value ? "bg-primary border-primary" : "border-zinc-300 bg-white",
                  )}>
                  {value && <Check className="h-3 w-3 text-white" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-zinc-800">{label}</p>
                  <p className="text-[10px] text-zinc-400">{desc}</p>
                </div>
                {action && (
                  <button type="button" onClick={action} disabled={loading}
                    className="w-6 h-6 rounded-lg bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center flex-shrink-0">
                    {loading
                      ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                      : <ChevronRight className="h-3 w-3 text-zinc-400" />}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Selected Agents */}
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-50">
              <p className="text-xs font-bold text-zinc-700">
                Selected Agents{" "}
                <span className="text-zinc-400 font-normal">({selectedAgents.length})</span>
              </p>
              <button type="button" onClick={() => setSelected([])}
                className="text-[10px] text-zinc-400 hover:text-zinc-600">Clear</button>
            </div>

            {loadingAgents ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading agents…
              </div>
            ) : agents.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-zinc-400">No active agents.</p>
                <a href="/builder" className="text-xs text-primary underline">Create one →</a>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {/* All agents — selected ones highlighted */}
                {agents.slice(0, 20).map((a, i) => (
                  <AgentCard
                    key={a.id} agent={a} index={i}
                    selected={selected.includes(a.id)}
                    onToggle={() => {
                      if (selected.includes(a.id)) {
                        setSelected(selected.filter(s => s !== a.id))
                      } else if (selected.length < 8) {
                        setSelected([...selected, a.id])
                      } else {
                        toast.error("Max 8 agents")
                      }
                    }}
                    running={running}
                  />
                ))}
                {agents.length === 0 && (
                  <div className="px-4 py-3 text-[10px] text-zinc-400 italic">
                    Use Auto Assemble or tap agents above
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Column 2: Centre canvas ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">

          {/* Error */}
          {error && (
            <div className="mx-4 mt-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Swarm graph area */}
          <div className="flex-1 flex overflow-hidden">
            {/* Main graph */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Graph header */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-50 flex-shrink-0">
                <GitBranch className="h-3.5 w-3.5 text-zinc-400" />
                <p className="text-xs font-semibold text-zinc-700">Swarm Graph</p>
                {running && (
                  <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] ml-1 animate-pulse">
                    Live
                  </Badge>
                )}
                {result && (
                  <Badge className="bg-green-50 text-green-700 border-green-200 text-[10px] ml-1">
                    Complete
                  </Badge>
                )}
              </div>

              {/* The graph */}
              <div className="flex-1 overflow-auto p-4">
                <SwarmGraph
                  agents={selectedAgents} mode={mode}
                  running={running} result={result}
                />
              </div>
            </div>

            {/* Debate settings panel — shown only in debate mode */}
            {mode === "debate" && (
              <div className="w-56 flex-shrink-0 border-l border-zinc-100 px-4 py-4 space-y-4 overflow-y-auto">
                <p className="text-xs font-bold text-zinc-700">Debate Settings</p>

                {/* Rounds */}
                <div>
                  <Label className="text-[11px] font-semibold text-zinc-600 block mb-2">Rounds</Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={1} max={10} value={maxRounds}
                      onChange={e => setMaxRounds(Math.min(10, Math.max(1, parseInt(e.target.value) || 3)))}
                      className="h-8 w-16 text-sm rounded-lg border-zinc-200 text-center" />
                    <span className="text-[10px] text-zinc-400">1 – 10 rounds</span>
                  </div>
                </div>

                {/* Consensus Method */}
                <div>
                  <Label className="text-[11px] font-semibold text-zinc-600 block mb-2">Consensus Method</Label>
                  <div className="space-y-1.5">
                    {CONSENSUS_METHODS.map(cm => (
                      <label key={cm} className="flex items-center gap-2 cursor-pointer">
                        <div className={cn(
                          "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                          consensusMethod === cm ? "border-primary bg-primary" : "border-zinc-300",
                        )}>
                          {consensusMethod === cm && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <span className="text-[11px] text-zinc-700">{cm}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Final Arbiter */}
                <div>
                  <Label className="text-[11px] font-semibold text-zinc-600 block mb-1.5">Final Arbiter</Label>
                  <div className="relative">
                    <select value={finalArbiter} onChange={e => setFinalArbiter(e.target.value)}
                      className="w-full h-8 text-[11px] rounded-lg border border-zinc-200 bg-white pl-2 pr-6 appearance-none text-zinc-800">
                      <option>Planner Agent</option>
                      {selectedAgents.map(a => <option key={a.id}>{a.name}</option>)}
                    </select>
                    <ChevronDown className="h-3 w-3 text-zinc-400 absolute right-2 top-2.5 pointer-events-none" />
                  </div>
                </div>

                {/* Conflict Resolution */}
                <div>
                  <Label className="text-[11px] font-semibold text-zinc-600 block mb-1.5">Conflict Resolution</Label>
                  <div className="relative">
                    <select value={conflictRes} onChange={e => setConflictRes(e.target.value)}
                      className="w-full h-8 text-[11px] rounded-lg border border-zinc-200 bg-white pl-2 pr-6 appearance-none text-zinc-800">
                      <option>High Confidence Wins</option>
                      <option>Latest Wins</option>
                      <option>Human Review</option>
                    </select>
                    <ChevronDown className="h-3 w-3 text-zinc-400 absolute right-2 top-2.5 pointer-events-none" />
                  </div>
                </div>

                {/* Early Stopping */}
                <div>
                  <Label className="text-[11px] font-semibold text-zinc-600 block mb-1.5">Early Stopping</Label>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-zinc-400">Stop when consensus reached</p>
                    <button type="button" onClick={() => setEarlyStopping(v => !v)}
                      className={cn(
                        "relative w-9 h-5 rounded-full transition-colors flex-shrink-0",
                        earlyStopping ? "bg-primary" : "bg-zinc-200",
                      )}>
                      <span className={cn(
                        "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                        earlyStopping ? "translate-x-4" : "translate-x-0.5",
                      )} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Live Execution timeline — bottom of centre column */}
          <LiveExecution agents={selectedAgents} running={running} result={result} />

          {/* Final answer — when done */}
          <AnimatePresence>
            {result?.finalAnswer && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="border-t border-zinc-100 bg-white px-5 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <p className="text-sm font-bold text-zinc-800">Final Answer</p>
                  <button type="button"
                    onClick={() => { navigator.clipboard.writeText(result.finalAnswer); toast.success("Copied") }}
                    className="ml-auto flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 bg-zinc-100 px-2 py-1 rounded-lg">
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
                <div className="bg-zinc-50 rounded-xl p-4 text-sm text-zinc-700 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {result.finalAnswer}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Column 3: Right intelligence panel ── */}
        <SwarmIntelligencePanel
          agents={selectedAgents} mode={mode} maxRounds={maxRounds}
          running={running} result={result} sessions={sessions}
        />
      </div>
    </div>
  )
}
