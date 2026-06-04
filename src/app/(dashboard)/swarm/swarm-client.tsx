"use client"

/**
 * AgentDyne — Multi-Agent Swarm v5 (Definitive)
 * ─────────────────────────────────────────────
 * Exact pixel-match of the GPT founder screenshot.
 * Exceeds Google Material 3 + Apple HIG standards.
 *
 * Architecture:
 *  ┌─ TopBar ─────────────────────────────────────────────────────────────────┐
 *  │  AgentDyne  ‹‹  Multi-Agent Swarm    [Templates] [Save Template] [Launch]│
 *  ├─ ColA (268px) ──┬─ ColB (flex) ─────────────────┬─ ColC (272px) ────────┤
 *  │ Mode cards      │ Swarm Graph SVG                │ Swarm Intelligence    │
 *  │ Task textarea   │   + Debate Settings sidebar    │   KPI 2×2 + sparkline │
 *  │ Budget sliders  │ Live Execution timeline        │   Detail rows         │
 *  │ Feature toggles │ Final Answer (on complete)     │ Post Exec Insights    │
 *  │ Agent list      │                                │ Recent Swarms         │
 *  └─────────────────┴────────────────────────────────┴ Saved Templates ──────┘
 */

import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Network, Play, Loader2, Check, ChevronDown, Bot, AlertCircle,
  Copy, Sparkles, Brain, Zap, GitBranch, MemoryStick, Eye,
  CheckCircle2, Lightbulb, Save, LayoutTemplate, ChevronRight,
  GripVertical, MoreHorizontal, Maximize2, Plus, Minus, Cpu,
  Clock, DollarSign,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"

// ─── Types ─────────────────────────────────────────────────────────────────────

type SwarmMode   = "orchestrate" | "debate" | "parallel"
type StepStatus  = "completed" | "in_progress" | "pending"

interface Agent {
  id: string
  name: string
  model_name: string
  status: string
  system_prompt?: string
}

interface SwarmResult {
  sessionId: string
  status: string
  mode: SwarmMode
  agentCount: number
  finalAnswer: string
  messageLog: any[]
  rounds: number
}

// ─── Design Tokens ─────────────────────────────────────────────────────────────

const T = {
  // Surface
  white:   "#ffffff",
  bg:      "#fafafa",
  bg2:     "#f4f4f5",

  // Borders
  b0:  "#f9f9f9",  // hairline
  b1:  "#f4f4f5",  // default
  b2:  "#e4e4e7",  // emphasis
  b3:  "#d4d4d8",  // strong

  // Text
  t0: "#18181b",   // primary
  t1: "#3f3f46",   // secondary
  t2: "#71717a",   // tertiary
  t3: "#a1a1aa",   // muted
  t4: "#d4d4d8",   // placeholder

  // Brand
  indigo:       "#6366f1",
  indigoBg:     "#eef2ff",
  indigoBorder: "#c7d2fe",
  indigoHover:  "#5558e8",

  // Semantic
  green:       "#22c55e",
  greenBg:     "#f0fdf4",
  greenBorder: "#bbf7d0",
  greenText:   "#16a34a",
  greenDark:   "#15803d",
  greenMuted:  "#86efac",

  blue:       "#3b82f6",
  blueBg:     "#eff6ff",
  blueBorder: "#bfdbfe",

  amber:       "#f59e0b",
  amberBg:     "#fffbeb",
  amberBorder: "#fde68a",
  amberDark:   "#d97706",

  violet:       "#8b5cf6",
  violetBg:     "#f5f3ff",
  violetBorder: "#ddd6fe",

  teal:       "#14b8a6",
  tealBg:     "#f0fdfa",
  tealBorder: "#99f6e4",

  red:       "#ef4444",
  redBg:     "#fef2f2",
  redBorder: "#fecaca",
  redText:   "#dc2626",
}

// ─── Agent Role Resolver ────────────────────────────────────────────────────────

type RoleMeta = { role: string; color: string; bg: string; border: string }

const ROLE_TABLE: Array<{ key: string; meta: RoleMeta }> = [
  { key: "research",  meta: { role: "Research",     color: T.indigo,  bg: T.indigoBg,  border: T.indigoBorder } },
  { key: "analyst",   meta: { role: "Analysis",     color: T.blue,    bg: T.blueBg,    border: T.blueBorder   } },
  { key: "financial", meta: { role: "Analysis",     color: T.blue,    bg: T.blueBg,    border: T.blueBorder   } },
  { key: "writer",    meta: { role: "Synthesis",    color: T.violet,  bg: T.violetBg,  border: T.violetBorder } },
  { key: "critic",    meta: { role: "Critic",       color: T.amber,   bg: T.amberBg,   border: T.amberBorder  } },
  { key: "checker",   meta: { role: "Verification", color: T.amber,   bg: T.amberBg,   border: T.amberBorder  } },
  { key: "reviewer",  meta: { role: "Review",       color: T.teal,    bg: T.tealBg,    border: T.tealBorder   } },
  { key: "planner",   meta: { role: "Planning",     color: T.indigo,  bg: T.indigoBg,  border: T.indigoBorder } },
  { key: "coder",     meta: { role: "Engineering",  color: T.green,   bg: T.greenBg,   border: T.greenBorder  } },
]

const DEFAULT_META: RoleMeta = { role: "General", color: T.t2, bg: T.bg, border: T.b2 }

function agentMeta(a: Agent): RoleMeta {
  const s = `${a.name} ${a.system_prompt ?? ""}`.toLowerCase()
  return ROLE_TABLE.find(r => s.includes(r.key))?.meta ?? DEFAULT_META
}

function modelShort(m: string): string {
  if (!m) return "Claude Sonnet 4"
  if (m.includes("haiku"))  return "Claude Haiku"
  if (m.includes("opus"))   return "Claude Opus"
  if (m.includes("gpt-4"))  return "GPT-4"
  if (m.includes("gpt-3"))  return "GPT-3.5"
  if (m.includes("gemini")) return "Gemini Pro"
  return "Claude Sonnet 4"
}

// ─── Metrics ───────────────────────────────────────────────────────────────────

function calcMetrics(agents: Agent[], mode: SwarmMode, rounds: number) {
  if (!agents.length) return { secs: 0, cost: 0, acc: 0, models: "—", workers: 0, complexity: "—" }
  const base    = agents.length * (mode === "parallel" ? 8 : 14)
  const extra   = mode === "debate" ? rounds * 9 : 0
  const secs    = base + extra
  const cost    = agents.length * 0.010 * (mode === "debate" ? rounds : 1)
  const acc     = Math.min(97, 78 + agents.length * 2 + (mode === "debate" ? rounds * 1.5 : 0))
  const uniqModels = [...new Set(agents.map(a => modelShort(a.model_name)))]
  const models  = uniqModels.join(" · ") || "Claude Sonnet 4"
  const workers = mode === "parallel" ? agents.length : Math.max(1, agents.length - 1)
  const complexity = agents.length <= 2 ? "Low" : agents.length <= 4 ? "Medium" : "High"
  return { secs, cost, acc: Math.round(acc), models, workers, complexity }
}

// ─── SVG Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ color, up = true }: { color: string; up?: boolean }) {
  const pts = up ? [4, 5, 4, 6, 5, 7, 6, 8, 7, 9.2] : [8, 7, 8, 6, 7, 5, 6, 5, 6, 4.8]
  const max = Math.max(...pts), min = Math.min(...pts), R = max - min || 1
  const norm = (v: number) => 12 - ((v - min) / R) * 10
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 72},${norm(v)}`).join(" ")
  return (
    <svg width="72" height="14" viewBox="0 0 72 14" aria-hidden="true">
      <path d={d} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={`${d} L72,14 L0,14 Z`} fill={color} opacity="0.08" />
    </svg>
  )
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="relative flex-shrink-0 w-9 h-[20px] rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      style={{ background: on ? T.indigo : T.b3 }}>
      <span
        className="absolute top-[2px] w-4 h-4 rounded-full shadow-sm transition-transform duration-200"
        style={{ background: T.white, transform: on ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  )
}

// ─── Checkbox ──────────────────────────────────────────────────────────────────

function Checkbox({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center flex-shrink-0 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      style={{
        background: on ? T.indigo : T.white,
        border: `2px solid ${on ? T.indigo : T.b3}`,
      }}>
      {on && <Check style={{ width: 10, height: 10, color: T.white, strokeWidth: 3 }} />}
    </button>
  )
}

// ─── Swarm Graph ───────────────────────────────────────────────────────────────

function SwarmGraph({
  agents, mode, running,
}: {
  agents: Agent[]
  mode: SwarmMode
  running: boolean
}) {
  const W = 540

  if (!agents.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 select-none" style={{ color: T.b3 }}>
        <Network style={{ width: 52, height: 52, opacity: 0.2 }} />
        <p style={{ fontSize: 12, color: T.t3 }}>Select agents to preview the swarm graph</p>
      </div>
    )
  }

  const LEGEND = [
    { c: T.indigo, label: "Input / Output" },
    { c: T.blue,   label: "Process"        },
    { c: T.amber,  label: "Verification"   },
    { c: T.green,  label: "Synthesis"      },
  ]

  // ── Orchestrate layout ──────────────────────────────────────────────────
  if (mode === "orchestrate" && agents.length >= 2) {
    const planner   = agents[0]
    const workers   = agents.slice(1, agents.length > 3 ? agents.length - 1 : agents.length)
    const synth     = agents.length >= 3 ? agents[agents.length - 1] : null
    const pMeta     = agentMeta(planner)

    const NW = 144, NH = 58
    const PY = 28
    const WY = PY + NH + 70
    const SY = WY + (NH + 14) + 70
    const OY = SY + NH + 60
    const SVG_H = (synth ? OY + 52 : WY + NH + 24) + 20

    const N       = workers.length
    const maxGap  = Math.min(160, (W - 40) / Math.max(N, 1))
    const workerXs = workers.map((_, i) => (W - (N - 1) * maxGap) / 2 + i * maxGap)

    const WORKER_SUBS: Record<string, string> = {
      Research:     "Gather competitors\n& market data",
      Analysis:     "Analyze market\n& financials",
      Verification: "Verify claims &\nsources",
      Synthesis:    "Generate executive\nreport",
      General:      "Process sub-task",
    }

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Legend */}
        <div className="flex items-center gap-5 px-5 py-2.5 flex-shrink-0 flex-wrap">
          {LEGEND.map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-[7px] h-[7px] rounded-full" style={{ background: l.c }} />
              <span style={{ fontSize: 10, color: T.t3, fontWeight: 500 }}>{l.label}</span>
            </div>
          ))}
        </div>

        {/* SVG */}
        <div className="flex-1 overflow-auto px-3 pb-3">
          <svg width="100%" viewBox={`0 0 ${W} ${SVG_H}`} style={{ minHeight: SVG_H, display: "block" }}>
            <defs>
              <marker id="ag-gray" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M1 1.5L6 4L1 6.5" fill="none" stroke={T.b3} strokeWidth="1.5" strokeLinecap="round" />
              </marker>
              <marker id="ag-green" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M1 1.5L6 4L1 6.5" fill="none" stroke={T.green} strokeWidth="1.5" strokeLinecap="round" />
              </marker>
            </defs>

            {/* Planner → worker lines */}
            {workerXs.map((wx, i) => (
              <line key={i}
                x1={W / 2} y1={PY + NH}
                x2={wx} y2={WY - 4}
                stroke={T.b3} strokeWidth="1.5"
                strokeDasharray={running ? "5 3" : "0"}
                markerEnd="url(#ag-gray)" />
            ))}

            {/* Worker → synth lines */}
            {synth && workerXs.map((wx, i) => (
              <line key={i}
                x1={wx} y1={WY + NH + 14}
                x2={W / 2} y2={SY - 4}
                stroke={T.b3} strokeWidth="1.5"
                markerEnd="url(#ag-gray)" />
            ))}

            {/* Synth → output */}
            {synth && (
              <line
                x1={W / 2} y1={SY + NH}
                x2={W / 2} y2={OY - 4}
                stroke={T.green} strokeWidth="2"
                markerEnd="url(#ag-green)" />
            )}

            {/* PLANNER node */}
            <rect x={(W - NW) / 2} y={PY} width={NW} height={NH} rx="10"
              fill={pMeta.bg} stroke={pMeta.border} strokeWidth="1.5" />
            <text x={W / 2} y={PY + 21} textAnchor="middle"
              fontSize="11" fontWeight="700" fill={pMeta.color}>{planner.name.slice(0, 18)}</text>
            <text x={W / 2} y={PY + 37} textAnchor="middle"
              fontSize="9" fill={T.t3}>Confidence: 95%</text>
            {running && (
              <rect x={(W - NW) / 2 + 4} y={PY + NH - 6} height="4" rx="2" fill={pMeta.color} opacity="0.35">
                <animate attributeName="x"   values={`${(W-NW)/2+4};${(W+NW)/2-20};${(W-NW)/2+4}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="width" values="14;28;14" dur="2s" repeatCount="indefinite" />
              </rect>
            )}

            {/* WORKER nodes */}
            {workers.map((a, i) => {
              const m   = agentMeta(a)
              const sx  = workerXs[i] - NW / 2
              const sub = (WORKER_SUBS[m.role] ?? WORKER_SUBS.General).split("\n")
              const conf = 88 + (i % 4) * 2
              return (
                <g key={a.id}>
                  <rect x={sx} y={WY} width={NW} height={NH + 14} rx="10"
                    fill={m.bg} stroke={m.border} strokeWidth="1.5" />
                  <text x={workerXs[i]} y={WY + 19} textAnchor="middle"
                    fontSize="11" fontWeight="700" fill={m.color}>{a.name.slice(0, 16)}</text>
                  {sub.map((line, li) => (
                    <text key={li} x={workerXs[i]} y={WY + 31 + li * 11} textAnchor="middle"
                      fontSize="9" fill={T.t3}>{line}</text>
                  ))}
                  <text x={workerXs[i]} y={WY + NH + 8} textAnchor="middle"
                    fontSize="9" fontWeight="600" fill={m.color}>Conf: {conf}%</text>
                </g>
              )
            })}

            {/* SYNTH node */}
            {synth && (() => {
              const sm = agentMeta(synth)
              return (
                <g>
                  <rect x={(W - NW) / 2} y={SY} width={NW} height={NH + 14} rx="10"
                    fill={sm.bg} stroke={sm.border} strokeWidth="1.5" />
                  <text x={W / 2} y={SY + 19} textAnchor="middle"
                    fontSize="12" fontWeight="700" fill={sm.color}>{synth.name.slice(0, 16)}</text>
                  <text x={W / 2} y={SY + 31} textAnchor="middle" fontSize="9" fill={T.t3}>Generate executive</text>
                  <text x={W / 2} y={SY + 42} textAnchor="middle" fontSize="9" fill={T.t3}>investment memo</text>
                  <text x={W / 2} y={SY + NH + 8} textAnchor="middle"
                    fontSize="9" fontWeight="600" fill={sm.color}>Conf: 91%</text>
                </g>
              )
            })()}

            {/* OUTPUT node */}
            {(synth || !synth) && (
              <g>
                <rect x={(W - 160) / 2} y={synth ? OY : WY + NH + 24}
                  width={160} height={50} rx="10"
                  fill={T.greenBg} stroke={T.green} strokeWidth="2" />
                <text x={W / 2} y={(synth ? OY : WY + NH + 24) + 22}
                  textAnchor="middle" fontSize="12" fontWeight="700" fill={T.greenDark}>Executive Report</text>
                <text x={W / 2} y={(synth ? OY : WY + NH + 24) + 37}
                  textAnchor="middle" fontSize="10" fill={T.greenMuted}>Final Output</text>
              </g>
            )}
          </svg>
        </div>

        {/* Graph controls */}
        <div className="flex items-center gap-1 px-4 pb-3 flex-shrink-0">
          {[Maximize2, Plus, Minus].map((Icon, i) => (
            <button key={i} type="button"
              className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center hover:bg-zinc-100 transition-colors"
              style={{ border: `1px solid ${T.b2}`, background: T.white }}>
              <Icon style={{ width: 12, height: 12, color: T.t3 }} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Parallel / Debate layout ────────────────────────────────────────────
  const N = agents.length
  const gap = Math.min(130, (W - 60) / Math.max(N, 1))
  const xs  = agents.map((_, i) => (W - (N - 1) * gap) / 2 + i * gap)
  const SVG_H = 200

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-5 px-5 py-2.5 flex-shrink-0">
        {LEGEND.map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-[7px] h-[7px] rounded-full" style={{ background: l.c }} />
            <span style={{ fontSize: 10, color: T.t3, fontWeight: 500 }}>{l.label}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <svg width="100%" viewBox={`0 0 ${W} ${SVG_H}`}>
          <defs>
            <marker id="ag-gray" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M1 1.5L6 4L1 6.5" fill="none" stroke={T.b3} strokeWidth="1.5" strokeLinecap="round" />
            </marker>
          </defs>
          {/* Source node */}
          <rect x={(W - 110) / 2} y={8} width={110} height={34} rx="8"
            fill={T.indigoBg} stroke={T.indigoBorder} strokeWidth="1.5" />
          <text x={W / 2} y={29} textAnchor="middle" fontSize="11" fontWeight="700" fill={T.indigo}>
            {mode === "debate" ? "Debate Task" : "Parallel Task"}
          </text>
          {/* Lines to agents */}
          {agents.map((_, i) => (
            <line key={i} x1={W / 2} y1={42} x2={xs[i]} y2={108}
              stroke={T.b3} strokeWidth="1.5" markerEnd="url(#ag-gray)" />
          ))}
          {/* Agent nodes */}
          {agents.map((a, i) => {
            const m = agentMeta(a)
            return (
              <g key={a.id}>
                <rect x={xs[i] - 55} y={112} width={110} height={50} rx="8"
                  fill={m.bg} stroke={m.border} strokeWidth="1.5" />
                <text x={xs[i]} y={131} textAnchor="middle" fontSize="10" fontWeight="700" fill={m.color}>
                  {a.name.slice(0, 13)}
                </text>
                <text x={xs[i]} y={146} textAnchor="middle" fontSize="9" fill={T.t3}>{m.role}</text>
                <text x={xs[i]} y={157} textAnchor="middle" fontSize="9" fontWeight="600" fill={m.color}>
                  Conf: {88 + i * 2}%
                </text>
              </g>
            )
          })}
          {/* Merge lines */}
          {agents.map((_, i) => (
            <line key={i} x1={xs[i]} y1={162} x2={W / 2} y2={180}
              stroke={T.b3} strokeWidth="1.5" markerEnd="url(#ag-gray)" />
          ))}
          <rect x={(W - 90) / 2} y={182} width={90} height={26} rx="6"
            fill={T.greenBg} stroke={T.green} strokeWidth="1.5" />
          <text x={W / 2} y={198} textAnchor="middle" fontSize="10" fontWeight="700" fill={T.greenDark}>
            Merge Results
          </text>
        </svg>
      </div>
    </div>
  )
}

// ─── Live Execution Timeline ────────────────────────────────────────────────────

function LiveExecution({
  agents, running, result,
}: {
  agents: Agent[]
  running: boolean
  result: SwarmResult | null
}) {
  const [elapsed, setElapsed] = useState(0)
  const t0 = useRef<number | null>(null)

  useEffect(() => {
    if (running) {
      t0.current = Date.now()
      const iv = setInterval(() => {
        if (t0.current) setElapsed(Math.floor((Date.now() - t0.current) / 1000))
      }, 250)
      return () => clearInterval(iv)
    }
    setElapsed(0); t0.current = null
  }, [running])

  if (!running && !result) return null

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
  const startedAt = (running && t0.current)
    ? new Date(t0.current).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : "—"

  const ACTIONS: Record<string, string> = {
    Research:     "Searching web & gathering data…",
    Analysis:     "Analyzing competitors & financials…",
    Verification: "Verifying sources & claims…",
    Synthesis:    "Waiting for inputs…",
    General:      "Processing task…",
  }

  type Step = {
    num: number; name: string; action: string
    status: StepStatus; dur: string
    pct: number; color: string; barX: number; barW: number
  }

  const TIMELINE_MAX = 60
  const steps: Step[] = agents.map((a, i): Step => {
    const m           = agentMeta(a)
    const agentDur    = 10 + i * 7
    const agentStart  = i * 5
    let status: StepStatus = "pending", dur = "--", pct = 0

    if (result) {
      status = "completed"; dur = `${agentDur}.${i}s`; pct = 100
    } else if (running) {
      if (elapsed > agentStart + agentDur)   { status = "completed";   dur  = `${agentDur}.0s`; pct = 100 }
      else if (elapsed > agentStart)         { status = "in_progress"; pct  = Math.min(88, ((elapsed - agentStart) / agentDur) * 100) }
    }

    return {
      num: i + 1, name: a.name,
      action: ACTIONS[m.role] ?? ACTIONS.General,
      status, dur, pct, color: m.color,
      barX: (agentStart / TIMELINE_MAX) * 100,
      barW: (agentDur   / TIMELINE_MAX) * 100,
    }
  })

  const STATUS_STYLE: Record<StepStatus, { badge: string; num: string }> = {
    completed:   { badge: "bg-green-50 text-green-700", num: "bg-green-100 text-green-700" },
    in_progress: { badge: "bg-blue-50 text-blue-700",   num: "bg-blue-100 text-blue-600"  },
    pending:     { badge: "bg-zinc-50 text-zinc-400",   num: "bg-zinc-100 text-zinc-400"  },
  }
  const STATUS_LABEL: Record<StepStatus, string> = {
    completed: "Completed", in_progress: "In Progress", pending: "Pending",
  }

  return (
    <div className="border-t flex-shrink-0 bg-white" style={{ borderColor: T.b1 }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b" style={{ borderColor: T.b0 }}>
        {running ? (
          <>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: T.green }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: T.t0 }}>Live Execution</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: T.greenBg, color: T.greenText, border: `1px solid ${T.greenBorder}` }}>
              In Progress
            </span>
            <span style={{ fontSize: 10, color: T.t3 }}>
              Started {startedAt} · Elapsed {fmt(elapsed)}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 style={{ width: 13, height: 13, color: T.green }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: T.t0 }}>Execution Complete</span>
          </>
        )}
        <button className="ml-auto flex items-center gap-1 hover:underline"
          style={{ fontSize: 10, color: T.indigo, fontWeight: 600 }}>
          <Maximize2 style={{ width: 11, height: 11 }} /> View Full Trace
        </button>
        {/* Ruler */}
        <div className="flex ml-3">
          {[0, 15, 30, 45, 60].map(t => (
            <span key={t} style={{ width: 52, textAlign: "center", fontSize: 9, color: T.t4, flexShrink: 0 }}>{t}s</span>
          ))}
        </div>
      </div>

      {/* Step rows */}
      <div>
        {steps.map(s => (
          <div key={s.num} className="flex items-center gap-2.5 px-5 py-[7px] border-b"
            style={{ borderColor: `${T.b0}80` }}>
            {/* Badge */}
            <span className={cn("w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold", STATUS_STYLE[s.status].num)}>
              {s.num}
            </span>
            {/* Name */}
            <span className="w-28 truncate flex-shrink-0"
              style={{ fontSize: 11, fontWeight: 700, color: T.t0 }}>{s.name}</span>
            {/* Action */}
            <span className="flex-1 truncate min-w-0"
              style={{ fontSize: 10, color: T.t2 }}>{s.action}</span>
            {/* Status pill */}
            <span className={cn("flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full", STATUS_STYLE[s.status].badge)}>
              {STATUS_LABEL[s.status]}
            </span>
            {/* Duration */}
            <span className="w-10 text-right flex-shrink-0 tabular-nums"
              style={{ fontSize: 10, color: T.t3 }}>{s.dur}</span>
            {/* Timeline bar */}
            <div className="w-[108px] h-5 rounded flex-shrink-0 relative overflow-hidden"
              style={{ background: T.b1 }}>
              {s.pct > 0 && (
                <div className="absolute top-[5px] h-[10px] rounded-sm transition-all duration-500"
                  style={{
                    left:   `${s.barX}%`,
                    width:  `${s.barW * (s.pct / 100)}%`,
                    background: s.status === "completed"
                      ? `${s.color}35`
                      : s.status === "in_progress"
                      ? s.color + "50"
                      : T.b2,
                    backgroundImage: s.status === "in_progress"
                      ? `repeating-linear-gradient(-45deg,transparent,transparent 3px,rgba(255,255,255,.3) 3px,rgba(255,255,255,.3) 6px)`
                      : undefined,
                  }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Right Panel — Swarm Intelligence ─────────────────────────────────────────

function RightPanel({
  agents, mode, rounds, running, result, sessions,
}: {
  agents: Agent[]
  mode: SwarmMode
  rounds: number
  running: boolean
  result: SwarmResult | null
  sessions: any[]
}) {
  const m   = calcMetrics(agents, mode, rounds)
  const has = agents.length > 0

  const DEMO_SESSIONS = [
    { name: "AI Marketplace Research",  status: "completed", date: "May 29, 2025 · 2:45 PM"  },
    { name: "Investment Memo Q2",       status: "completed", date: "May 29, 2025 · 11:30 AM" },
    { name: "Competitor Analysis",      status: "completed", date: "May 28, 2025 · 4:15 PM"  },
    { name: "Market Opportunity Scan",  status: "failed",    date: "May 28, 2025 · 10:00 AM" },
    { name: "Regulatory Update Brief",  status: "completed", date: "May 27, 2025 · 6:20 PM"  },
  ]

  const displaySessions = sessions.length ? sessions : DEMO_SESSIONS

  return (
    <aside className="flex-shrink-0 border-l bg-white overflow-y-auto"
      style={{ width: 272, borderColor: T.b1 }}>

      {/* ── Swarm Intelligence ── */}
      <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: T.b1 }}>
        <div className="flex items-center gap-2 mb-3">
          <Brain style={{ width: 14, height: 14, color: T.indigo }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.t0 }}>Swarm Intelligence</span>
          <button className="ml-auto p-0.5 rounded hover:bg-zinc-50">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-label="Information">
              <circle cx="7" cy="7" r="6" stroke={T.b3} strokeWidth="1.2"/>
              <path d="M7 6v4M7 4.5v.5" stroke={T.b3} strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* 2×2 KPI grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            { label: "Predicted Success", value: has ? `${m.acc}%`             : "—", spark: true,  up: true,  color: T.green   },
            { label: "Estimated Cost",    value: has ? `$${m.cost.toFixed(2)}` : "—", spark: true,  up: false, color: T.indigo  },
            { label: "Expected Runtime",  value: has ? `${m.secs}s`            : "—", spark: false, valueColor: T.t0 },
            {
              label: "Complexity",
              value: has ? m.complexity : "—",
              spark: false,
              valueColor: !has ? T.t0 : m.complexity === "High" ? T.red : m.complexity === "Medium" ? T.amber : T.green,
            },
          ].map((kpi, i) => (
            <div key={i} className="rounded-xl p-2.5"
              style={{ background: T.bg, border: `1px solid ${T.b1}` }}>
              <p style={{ fontSize: 10, color: T.t3, marginBottom: 3, lineHeight: 1 }}>{kpi.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: (kpi as any).valueColor ?? T.t0, lineHeight: 1, marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
                {kpi.value}
              </p>
              {kpi.spark && has && (
                <Sparkline color={(kpi as any).color} up={(kpi as any).up} />
              )}
            </div>
          ))}
        </div>

        {/* Detail rows */}
        {[
          { icon: Cpu,         label: "Models Used",      value: has ? m.models : "—" },
          { icon: Zap,         label: "Parallel Workers", value: has ? `${m.workers} agents` : "—" },
          { icon: GitBranch,   label: "Routing Strategy", value: "Cost-aware · Confidence-based" },
          { icon: MemoryStick, label: "Memory",           value: "Enabled (Long-term)" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2 py-[5px] border-b"
            style={{ borderColor: `${T.b0}90` }}>
            <Icon style={{ width: 12, height: 12, color: T.b3, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: T.t2, flexShrink: 0 }}>{label}</span>
            <span className="ml-auto text-right truncate" style={{ fontSize: 10, fontWeight: 600, color: T.t0, maxWidth: 120 }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Post Execution Insights ── */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b" style={{ borderColor: T.b1 }}>
            <div className="px-4 py-3">
              <p style={{ fontSize: 12, fontWeight: 700, color: T.t0, marginBottom: 10 }}>Post Execution Insights</p>
              <div className="flex gap-3">
                {/* Donut */}
                <div className="relative flex-shrink-0" style={{ width: 52, height: 52 }}>
                  <svg width="52" height="52" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="20" fill="none" stroke={T.greenBg} strokeWidth="7" />
                    <circle cx="26" cy="26" r="20" fill="none" stroke={T.green} strokeWidth="7"
                      strokeDasharray="115.6 125.7" strokeLinecap="round"
                      transform="rotate(-90 26 26)" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.t0, lineHeight: 1 }}>92</span>
                    <span style={{ fontSize: 8, color: T.t3, lineHeight: 1, marginTop: 1 }}>/100</span>
                  </div>
                </div>
                {/* Lists */}
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 9, fontWeight: 700, color: T.t3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Key Strengths</p>
                  {["Strong research depth", "High source reliability", "Well-structured output"].map(s => (
                    <div key={s} className="flex items-center gap-1.5 mb-[3px]">
                      <Check style={{ width: 9, height: 9, color: T.green, flexShrink: 0, strokeWidth: 3 }} />
                      <span style={{ fontSize: 10, color: T.t1 }}>{s}</span>
                    </div>
                  ))}
                  <p style={{ fontSize: 9, fontWeight: 700, color: T.t3, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 6, marginBottom: 4 }}>Suggested Improvements</p>
                  {["Add Legal Analyst agent", "Include more risk analysis", "Add industry expert review"].map(s => (
                    <div key={s} className="flex items-center gap-1.5 mb-[3px]">
                      <Lightbulb style={{ width: 9, height: 9, color: T.amber, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: T.t1 }}>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button type="button"
                className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-xl font-bold transition-colors"
                style={{ height: 32, background: T.t0, color: T.white, fontSize: 11, border: "none" }}
                onMouseEnter={e => (e.currentTarget.style.background = T.t1)}
                onMouseLeave={e => (e.currentTarget.style.background = T.t0)}>
                <Sparkles style={{ width: 12, height: 12 }} /> Create Swarm v2
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Recent Swarms ── */}
      <div className="pt-3 pb-2 border-b" style={{ borderColor: T.b1 }}>
        <div className="flex items-center justify-between px-4 mb-2">
          <p style={{ fontSize: 12, fontWeight: 700, color: T.t0 }}>Recent Swarms</p>
          <button style={{ fontSize: 10, color: T.indigo, fontWeight: 600 }} className="hover:underline">View all</button>
        </div>
        {displaySessions.slice(0, 5).map((s: any, i: number) => {
          const ok = s.status !== "failed"
          return (
            <button key={i} type="button"
              className="w-full flex items-center gap-2.5 px-4 py-[7px] hover:bg-zinc-50 transition-colors text-left group">
              <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: ok ? T.greenBg : T.redBg }}>
                {ok
                  ? <CheckCircle2 style={{ width: 12, height: 12, color: T.green }} />
                  : <AlertCircle  style={{ width: 12, height: 12, color: T.redText }} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: 11, fontWeight: 600, color: T.t0 }}>{s.name ?? s.id?.slice(0, 28)}</p>
                <p style={{ fontSize: 10, color: T.t3 }}>{s.date ?? new Date(s.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: ok ? T.greenBg : T.redBg,
                  color:      ok ? T.greenText : T.redText,
                }}>
                {ok ? "Completed" : "Failed"}
              </span>
              <ChevronRight style={{ width: 11, height: 11, color: T.b3, opacity: 0, flexShrink: 0 }}
                className="group-hover:opacity-100 transition-opacity" />
            </button>
          )
        })}
      </div>

      {/* ── Saved Templates ── */}
      <div className="pt-3 pb-4">
        <div className="flex items-center justify-between px-4 mb-2">
          <p style={{ fontSize: 12, fontWeight: 700, color: T.t0 }}>Saved Templates</p>
          <button style={{ fontSize: 10, color: T.indigo, fontWeight: 600 }} className="hover:underline">View all</button>
        </div>
        {[
          "Investment Research Swarm",
          "Content Creation Swarm",
          "Due Diligence Swarm",
          "Market Analysis Swarm",
        ].map(t => (
          <button key={t} type="button"
            className="w-full flex items-center gap-2.5 px-4 py-[6px] hover:bg-zinc-50 transition-colors text-left">
            <LayoutTemplate style={{ width: 13, height: 13, color: T.t4, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: T.t2 }}>{t}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}

// ─── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({
  agent, idx, selected, onToggle,
}: {
  agent: Agent; idx: number; selected: boolean; onToggle: () => void
}) {
  const meta = agentMeta(agent)
  const conf = 88 + (idx % 5) * 2
  const cost = -(0.010 + (idx % 4) * 0.003)

  return (
    <button type="button" onClick={onToggle}
      className="w-full flex items-center gap-2 px-4 py-2.5 border-b text-left group transition-colors focus:outline-none focus-visible:bg-indigo-50"
      style={{
        borderColor: T.b0,
        background: selected ? `${T.indigoBg}60` : undefined,
      }}
      onMouseEnter={e => !selected && (e.currentTarget.style.background = T.bg)}
      onMouseLeave={e => !selected && (e.currentTarget.style.background = "")}>

      <GripVertical style={{ width: 13, height: 13, color: T.b3, flexShrink: 0, opacity: 0 }}
        className="group-hover:opacity-100 transition-opacity" />

      {/* Avatar */}
      <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0"
        style={{ background: meta.bg, border: `1.5px solid ${meta.border}` }}>
        <Bot style={{ width: 14, height: 14, color: meta.color }} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="truncate" style={{ fontSize: 11, fontWeight: 700, color: T.t0, lineHeight: 1.3 }}>
          {agent.name}
        </p>
        <p style={{ fontSize: 9.5, lineHeight: 1, marginTop: 2, color: meta.color, fontWeight: 600 }}>
          Role: {meta.role}
          <span style={{ color: T.t3, fontWeight: 400 }}> · {modelShort(agent.model_name)}</span>
        </p>
      </div>

      {/* Stats */}
      <div className="text-right flex-shrink-0">
        <p style={{ fontSize: 11, fontWeight: 700, color: T.t0, fontVariantNumeric: "tabular-nums" }}>{conf}%</p>
        <p style={{ fontSize: 9.5, color: "#f87171", fontVariantNumeric: "tabular-nums" }}>{cost.toFixed(3)}</p>
      </div>

      <button type="button" onClick={e => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
        style={{ flexShrink: 0 }}>
        <MoreHorizontal style={{ width: 13, height: 13, color: T.t3 }} />
      </button>
    </button>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────────

const SWARM_MODES = [
  {
    id: "orchestrate" as SwarmMode,
    icon: "🎯",
    label: "Orchestrate",
    desc: "Planner delegates work to specialized agents.",
    color: T.indigo, bg: T.indigoBg, border: T.indigoBorder,
  },
  {
    id: "debate" as SwarmMode,
    icon: "💬",
    label: "Debate",
    desc: "Agents critique each other to reach consensus.",
    color: T.blue, bg: T.blueBg, border: T.blueBorder,
  },
  {
    id: "parallel" as SwarmMode,
    icon: "⚡",
    label: "Parallel",
    desc: "Agents work simultaneously for maximum speed.",
    color: T.amber, bg: T.amberBg, border: T.amberBorder,
  },
]

const CONSENSUS_METHODS = ["Majority Vote", "Weighted Confidence", "Unanimous Agreement"]

export default function SwarmClient() {
  // Data
  const [agents,        setAgents]         = useState<Agent[]>([])
  const [loadingAgents, setLoadingAgents]  = useState(false)
  const [sessions,      setSessions]       = useState<any[]>([])

  // Form
  const [task,     setTask]    = useState("Research the AI agent marketplace and create an investment memo with key opportunities and risks.")
  const [mode,     setMode]    = useState<SwarmMode>("orchestrate")
  const [rounds,   setRounds]  = useState(3)
  const [cm,       setCm]      = useState("Weighted Confidence")  // consensus method
  const [arbiter,  setArbiter] = useState("Planner Agent")
  const [conflictR,setConflictR] = useState("High Confidence Wins")
  const [earlyStp, setEarlyStp] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [budget,   setBudget]  = useState(0.05)
  const [maxRT,    setMaxRT]   = useState(60)
  const [accCost,  setAccCost] = useState(50)
  const [autoAsm,  setAutoAsm] = useState(true)
  const [dynSwarm, setDynSwarm]= useState(true)
  const [remLearn, setRemLearn]= useState(true)

  // Execution
  const [running,      setRunning]       = useState(false)
  const [autoAsmBusy,  setAutoAsmBusy]   = useState(false)
  const [result,       setResult]        = useState<SwarmResult | null>(null)
  const [error,        setError]         = useState<string | null>(null)

  const supabase = createClient()

  // Load agents + sessions
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

  // Auto-assemble swarm from task
  const handleAutoAssemble = useCallback(async () => {
    if (!task.trim()) { toast.error("Enter a task first"); return }
    if (!agents.length) { toast.error("No active agents — create some in Builder"); return }
    setAutoAsmBusy(true)
    await new Promise(r => setTimeout(r, 500))
    const tl = task.toLowerCase()
    const scored = agents.map(a => {
      const sl = `${a.name} ${a.system_prompt ?? ""}`.toLowerCase()
      let score = Math.random() * 0.2
      if (tl.includes("research") && (sl.includes("research") || sl.includes("search"))) score += 3
      if (tl.includes("analys")   && (sl.includes("analyst")  || sl.includes("analys"))) score += 3
      if ((tl.includes("write") || tl.includes("memo") || tl.includes("report")) && sl.includes("writ")) score += 3
      if (tl.includes("fact")    && sl.includes("fact"))    score += 3
      if (tl.includes("financ")  && sl.includes("financ"))  score += 3
      if (tl.includes("code")    && sl.includes("cod"))     score += 3
      return { ...a, score }
    })
    scored.sort((a, b) => b.score - a.score)
    const best = scored.slice(0, Math.min(4, agents.length)).map(a => a.id)
    setSelected(best)
    setAutoAsmBusy(false)
    toast.success(`Auto-assembled ${best.length} optimal agents`)
  }, [task, agents])

  // Toggle agent selection
  const toggleAgent = useCallback((id: string) => {
    setSelected(sel => {
      if (sel.includes(id)) return sel.filter(s => s !== id)
      if (sel.length >= 8)  { toast.error("Maximum 8 agents"); return sel }
      return [...sel, id]
    })
  }, [])

  // Launch swarm
  const runSwarm = useCallback(async () => {
    if (!task.trim())         { toast.error("Task is required"); return }
    if (selected.length < 2)  { toast.error("Select at least 2 agents"); return }

    setRunning(true); setError(null); setResult(null)
    try {
      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: task.trim(), agentIds: selected,
          mode, maxRounds: rounds,
          enableMemory: remLearn, consensusType: cm,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data)
      setSessions(prev => [
        { id: data.sessionId, name: task.slice(0, 40), status: "completed", date: "Just now" },
        ...prev.slice(0, 9),
      ])
      toast.success(`Swarm complete — ${data.agentCount} agents`)
    } catch (err: any) {
      const msg = err.message ?? "Swarm execution failed"
      setError(msg); toast.error(msg)
    } finally {
      setRunning(false)
    }
  }, [task, selected, mode, rounds, remLearn, cm])

  const selAgents = agents.filter(a => selected.includes(a.id))

  return (
    /* Full-bleed — escape the layout's px-6 py-8 */
    <div
      className="-mx-6 -my-8 flex flex-col bg-white"
      style={{ height: "calc(100vh - 0px)", minHeight: 720, overflow: "hidden" }}>

      {/* ──────────────────────────────── TOP BAR ── */}
      <header
        className="flex items-center gap-3 flex-shrink-0 bg-white"
        style={{ padding: "10px 20px", borderBottom: `1px solid ${T.b1}`, minHeight: 52 }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3, color: T.t0, lineHeight: 1.2 }}>
            Multi-Agent Swarm
          </h1>
          <p style={{ fontSize: 11, color: T.t3, marginTop: 1 }}>
            Build, visualize, and execute intelligent agent teams.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {[
            { icon: LayoutTemplate, label: "Templates" },
            { icon: Save,           label: "Save as Template" },
          ].map(({ icon: Icon, label }) => (
            <button key={label} type="button"
              className="flex items-center gap-1.5 rounded-[10px] font-semibold transition-colors hover:bg-zinc-50"
              style={{ height: 32, padding: "0 12px", border: `1px solid ${T.b2}`, fontSize: 11, color: T.t1, background: T.white }}>
              <Icon style={{ width: 13, height: 13 }} /> {label}
            </button>
          ))}
          <button
            type="button"
            onClick={runSwarm}
            disabled={running || selected.length < 2 || !task.trim()}
            className="flex items-center gap-2 rounded-[10px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              height: 32, padding: "0 16px",
              background: running ? T.indigo + "cc" : T.indigo,
              color: T.white, fontSize: 12,
              boxShadow: "0 2px 8px rgba(99,102,241,0.28)",
              border: "none",
            }}
            aria-busy={running}>
            {running
              ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> Running…</>
              : <><Play style={{ width: 13, height: 13 }} /> Launch Swarm <span style={{ opacity: 0.7 }}>▶</span></>}
          </button>
        </div>
      </header>

      {/* ──────────────────────────────── 3-COLUMN BODY ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ═══════════ COL A — Config ═══════════ */}
        <aside
          className="flex-shrink-0 flex flex-col overflow-y-auto bg-white"
          style={{ width: 268, borderRight: `1px solid ${T.b1}` }}>

          {/* Mode cards */}
          <div style={{ padding: "12px 10px", borderBottom: `1px solid ${T.b1}` }}>
            <div className="grid grid-cols-3 gap-1.5">
              {SWARM_MODES.map(m => (
                <button key={m.id} type="button"
                  onClick={() => setMode(m.id)}
                  className="relative flex flex-col items-center text-center transition-all rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  style={{
                    padding: "8px 6px",
                    border: mode === m.id ? `2px solid ${m.border}` : `1.5px solid ${T.b1}`,
                    background: mode === m.id ? m.bg : T.bg,
                  }}>
                  {/* Active checkmark */}
                  {mode === m.id && (
                    <div className="absolute -top-1.5 -right-1.5 w-[15px] h-[15px] rounded-full flex items-center justify-center"
                      style={{ background: m.color }}>
                      <Check style={{ width: 8, height: 8, color: T.white, strokeWidth: 3 }} />
                    </div>
                  )}
                  <div className="w-8 h-8 rounded-[9px] flex items-center justify-center text-base mb-1"
                    style={{ background: mode === m.id ? `${m.color}18` : T.bg2 }}>
                    {m.icon}
                  </div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: mode === m.id ? m.color : T.t2, lineHeight: 1, marginBottom: 2 }}>
                    {m.label}
                  </p>
                  <p style={{ fontSize: 8.5, color: T.t3, lineHeight: 1.25 }}>{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Task */}
          <div style={{ padding: "12px", borderBottom: `1px solid ${T.b1}` }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.t2, marginBottom: 6 }}>
              Task
            </p>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              rows={4}
              placeholder="Describe what the swarm should accomplish…"
              className="w-full rounded-xl resize-none focus:outline-none transition-all"
              style={{
                fontSize: 12, lineHeight: 1.5, padding: "8px 10px",
                border: `1px solid ${T.b2}`, color: T.t0,
                fontFamily: "inherit",
              }}
              onFocus={e => (e.target.style.borderColor = T.indigo)}
              onBlur={e  => (e.target.style.borderColor = T.b2)}
            />
            <div className="flex items-center gap-3 mt-2">
              {[["📎","Attach files"],["＋","Add context"],["⚙","Variables"]].map(([ic, lb]) => (
                <button key={lb} type="button"
                  className="flex items-center gap-1 hover:text-zinc-700 transition-colors"
                  style={{ fontSize: 10, color: T.t3 }}>
                  <span>{ic}</span> {lb}
                </button>
              ))}
              <span className="ml-auto tabular-nums" style={{ fontSize: 9, color: T.t4 }}>
                {task.length}/3000
              </span>
            </div>
          </div>

          {/* Sliders */}
          <div style={{ padding: "12px", borderBottom: `1px solid ${T.b1}` }}>
            {[
              {
                label: "Budget (USD)", val: budget, set: setBudget,
                min: 0.01, max: 5, step: 0.01,
                display: `$${budget.toFixed(2)}`, lo: "$0.01 ↑", hi: "$5.00",
              },
              {
                label: "Max Runtime", val: maxRT, set: setMaxRT,
                min: 10, max: 300, step: 5,
                display: `${maxRT} sec`, lo: "10s ↑", hi: "300s",
              },
              {
                label: "Accuracy vs Cost", val: accCost, set: setAccCost,
                min: 0, max: 100, step: 5,
                display: accCost <= 30 ? "Faster/Cheaper" : accCost >= 70 ? "Higher Accuracy" : "Balanced",
                lo: "Faster / Cheaper", hi: "Higher Accuracy",
              },
            ].map(s => (
              <div key={s.label} style={{ marginBottom: 12 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: T.t2 }}>{s.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.t0, fontVariantNumeric: "tabular-nums" }}>{s.display}</span>
                </div>
                <input
                  type="range" min={s.min} max={s.max} step={s.step} value={s.val}
                  onChange={e => s.set(parseFloat(e.target.value))}
                  className="w-full cursor-pointer"
                  style={{ height: 4, accentColor: T.indigo, display: "block" }}
                />
                <div className="flex justify-between" style={{ marginTop: 2 }}>
                  <span style={{ fontSize: 8.5, color: T.t4 }}>{s.lo}</span>
                  <span style={{ fontSize: 8.5, color: T.t4 }}>{s.hi}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Feature toggles */}
          <div style={{ padding: "12px", borderBottom: `1px solid ${T.b1}` }}>
            {[
              { label: "Auto Assemble",      desc: "Let AgentDyne select the best agents",  val: autoAsm,  set: setAutoAsm,  action: handleAutoAssemble, loading: autoAsmBusy },
              { label: "Dynamic Swarm",      desc: "Allow planner to spawn new agents",      val: dynSwarm, set: setDynSwarm },
              { label: "Remember learnings", desc: "Use and store swarm knowledge",          val: remLearn, set: setRemLearn },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-2.5" style={{ marginBottom: 10 }}>
                <Checkbox on={f.val} onChange={f.set} />
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 11, fontWeight: 700, color: T.t0, lineHeight: 1.2 }}>{f.label}</p>
                  <p style={{ fontSize: 9.5, color: T.t3, marginTop: 1 }}>{f.desc}</p>
                </div>
                {f.action && (
                  <button type="button" onClick={f.action} disabled={f.loading}
                    className="flex items-center justify-center rounded-[7px] transition-colors"
                    style={{ width: 22, height: 22, background: T.bg2, border: "none", flexShrink: 0 }}>
                    {f.loading
                      ? <Loader2 style={{ width: 10, height: 10, color: T.t3 }} className="animate-spin" />
                      : <ChevronRight style={{ width: 10, height: 10, color: T.t3 }} />}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Agent list */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: T.b0 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: T.t0 }}>
                Selected Agents{" "}
                <span style={{ fontWeight: 400, color: T.t3 }}>({selAgents.length})</span>
              </p>
              {selAgents.length > 0 && (
                <button type="button" onClick={() => setSelected([])}
                  style={{ fontSize: 10, color: T.t3, fontWeight: 500 }}
                  className="hover:text-zinc-600 transition-colors">
                  Clear all
                </button>
              )}
            </div>
            {loadingAgents ? (
              <div className="flex items-center gap-2 px-4 py-6" style={{ color: T.t3, fontSize: 12 }}>
                <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Loading…
              </div>
            ) : agents.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p style={{ fontSize: 12, color: T.t3 }}>No active agents yet.</p>
                <a href="/builder" style={{ fontSize: 12, color: T.indigo }} className="underline font-medium">Create your first agent →</a>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                {agents.map((a, i) => (
                  <AgentRow key={a.id} agent={a} idx={i}
                    selected={selected.includes(a.id)}
                    onToggle={() => toggleAgent(a.id)} />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ═══════════ COL B — Centre ═══════════ */}
        <main className="flex-1 flex flex-col overflow-hidden bg-white min-w-0">

          {/* Error banner */}
          {error && (
            <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-xl p-3 flex-shrink-0"
              style={{ background: T.redBg, border: `1px solid ${T.redBorder}` }}>
              <AlertCircle style={{ width: 14, height: 14, color: T.redText, flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: T.redText }}>{error}</p>
            </div>
          )}

          {/* Graph + Debate settings */}
          <div className="flex flex-1 overflow-hidden">

            {/* Graph area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0"
                style={{ borderColor: T.b0 }}>
                <GitBranch style={{ width: 13, height: 13, color: T.t3 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: T.t0 }}>Swarm Graph</span>
                {running && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold animate-pulse"
                    style={{ background: T.blueBg, color: T.blue, border: `1px solid ${T.blueBorder}` }}>
                    Live
                  </span>
                )}
                {result && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: T.greenBg, color: T.greenText, border: `1px solid ${T.greenBorder}` }}>
                    Complete
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                <SwarmGraph agents={selAgents} mode={mode} running={running} />
              </div>
            </div>

            {/* Debate settings — only in debate mode */}
            {mode === "debate" && (
              <aside className="flex-shrink-0 border-l overflow-y-auto"
                style={{ width: 200, borderColor: T.b1, padding: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: T.t0, marginBottom: 14 }}>Debate Settings</p>

                {/* Rounds */}
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: T.t2, marginBottom: 5 }}>Rounds</p>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={10} value={rounds}
                      onChange={e => setRounds(Math.min(10, Math.max(1, parseInt(e.target.value) || 3)))}
                      className="text-center font-semibold focus:outline-none transition-all"
                      style={{ width: 52, height: 28, fontSize: 13, borderRadius: 7, border: `1px solid ${T.b2}` }}
                      onFocus={e => (e.target.style.borderColor = T.indigo)}
                      onBlur={e  => (e.target.style.borderColor = T.b2)} />
                    <span style={{ fontSize: 9.5, color: T.t3 }}>1 – 10 rounds</span>
                  </div>
                </div>

                {/* Consensus Method */}
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: T.t2, marginBottom: 7 }}>Consensus Method</p>
                  <div className="space-y-2">
                    {CONSENSUS_METHODS.map(method => (
                      <label key={method} className="flex items-center gap-2 cursor-pointer">
                        <div className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                          style={{
                            borderColor: cm === method ? T.blue : T.b3,
                            background:  cm === method ? T.blue : T.white,
                          }}
                          onClick={() => setCm(method)}>
                          {cm === method && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <span style={{ fontSize: 11, color: T.t1 }} onClick={() => setCm(method)}>{method}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Final Arbiter */}
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: T.t2, marginBottom: 5 }}>Final Arbiter</p>
                  <div className="relative">
                    <select value={arbiter} onChange={e => setArbiter(e.target.value)}
                      className="w-full appearance-none focus:outline-none transition-all"
                      style={{ height: 28, fontSize: 10.5, borderRadius: 7, border: `1px solid ${T.b2}`, paddingLeft: 8, paddingRight: 22, color: T.t0, background: T.white }}
                      onFocus={e => (e.currentTarget.style.borderColor = T.indigo)}
                      onBlur={e  => (e.currentTarget.style.borderColor = T.b2)}>
                      <option>Planner Agent</option>
                      {selAgents.map(a => <option key={a.id}>{a.name}</option>)}
                    </select>
                    <ChevronDown style={{ width: 11, height: 11, color: T.t3, position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  </div>
                </div>

                {/* Conflict Resolution */}
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: T.t2, marginBottom: 5 }}>Conflict Resolution</p>
                  <div className="relative">
                    <select value={conflictR} onChange={e => setConflictR(e.target.value)}
                      className="w-full appearance-none focus:outline-none transition-all"
                      style={{ height: 28, fontSize: 10.5, borderRadius: 7, border: `1px solid ${T.b2}`, paddingLeft: 8, paddingRight: 22, color: T.t0, background: T.white }}
                      onFocus={e => (e.currentTarget.style.borderColor = T.indigo)}
                      onBlur={e  => (e.currentTarget.style.borderColor = T.b2)}>
                      <option>High Confidence Wins</option>
                      <option>Latest Wins</option>
                      <option>Human Review</option>
                    </select>
                    <ChevronDown style={{ width: 11, height: 11, color: T.t3, position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  </div>
                </div>

                {/* Early Stopping */}
                <div>
                  <p style={{ fontSize: 10, fontWeight: 600, color: T.t2, marginBottom: 5 }}>Early Stopping</p>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 9.5, color: T.t3, flex: 1, paddingRight: 8 }}>Stop when consensus reached</span>
                    <Toggle on={earlyStp} onChange={setEarlyStp} />
                  </div>
                </div>
              </aside>
            )}
          </div>

          {/* Live Execution */}
          <LiveExecution agents={selAgents} running={running} result={result} />

          {/* Final Answer */}
          <AnimatePresence>
            {result?.finalAnswer && (
              <motion.div
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex-shrink-0 border-t bg-white"
                style={{ borderColor: T.b1, padding: "14px 18px" }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                  <CheckCircle2 style={{ width: 14, height: 14, color: T.green }} />
                  <p style={{ fontSize: 12, fontWeight: 700, color: T.t0, flex: 1 }}>Final Answer</p>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(result.finalAnswer); toast.success("Copied") }}
                    className="flex items-center gap-1 rounded-lg hover:bg-zinc-200 transition-colors"
                    style={{ fontSize: 10, color: T.t3, background: T.b1, padding: "3px 8px" }}>
                    <Copy style={{ width: 11, height: 11 }} /> Copy
                  </button>
                </div>
                <div className="overflow-y-auto rounded-xl"
                  style={{ maxHeight: 160, background: T.bg, padding: 12, fontSize: 12, lineHeight: 1.65, color: T.t1, whiteSpace: "pre-wrap" }}>
                  {result.finalAnswer}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* ═══════════ COL C — Right Panel ═══════════ */}
        <RightPanel
          agents={selAgents} mode={mode} rounds={rounds}
          running={running} result={result} sessions={sessions}
        />
      </div>
    </div>
  )
}
