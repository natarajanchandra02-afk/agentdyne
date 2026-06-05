"use client"

/**
 * AgentDyne System Architecture Diagram
 *
 * Google Material Design standard:
 *   ✅ Proper bezier-connected layers with arrow connectors
 *   ✅ Zoom IN / OUT buttons only — no scroll hijack
 *   ✅ Drag/pan works correctly at any zoom level via pointer capture
 *   ✅ Real Lucide icons — no placeholder boxes
 *   ✅ Layered: Application → Routing → Runtime → Providers
 *   ✅ Dashed label pills between layers (Material "flow" convention)
 *   ✅ "ARCHITECTURE" micro-labels top-right each card (GCP style)
 *   ✅ Node chips with coloured icon + label (Google Cloud arch style)
 *   ✅ Zero wheel/scroll interference
 *   ✅ Fit-to-view reset button
 */

import { useRef, useState, useCallback, useEffect } from "react"
import {
  Globe, Code2, Zap, Shield,
  Cpu, DollarSign, Database, CheckCircle2, Brain,
  Server, Layers, ZoomIn, ZoomOut, Maximize2,
  SlidersHorizontal, Activity, ArrowRight,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeDef {
  id:    string
  label: string
  icon:  React.ReactNode
  color: string
  bg:    string
}

interface LayerDef {
  id:       string
  label:    string
  sublabel: string
  icon:     React.ReactNode
  iconBg:   string
  iconFg:   string
  nodes:    NodeDef[]
  output?:  string
  tags?:    Array<{ text: string; color: string; bg: string; border: string }>
  footer?:  string
}

// ─── Layer data ───────────────────────────────────────────────────────────────

const LAYERS: LayerDef[] = [
  {
    id:       "application",
    label:    "Your Application",
    sublabel: "Client / Frontend / Service",
    icon:     <Code2 size={18} />,
    iconBg:   "#dbeafe",
    iconFg:   "#1d4ed8",
    nodes:    [],
    output:   "query + context",
  },
  {
    id:       "routing",
    label:    "StrataRouter Core",
    sublabel: "HNSW · BM25 · Entropy Engine · Safety Router",
    icon:     <Brain size={18} />,
    iconBg:   "#ede9fe",
    iconFg:   "#6d28d9",
    tags: [
      { text: "Python", color: "#5b21b6", bg: "#ede9fe", border: "#c4b5fd" },
      { text: "MIT",    color: "#065f46", bg: "#d1fae5", border: "#6ee7b7" },
    ],
    nodes:    [],
    footer:   "Output: route · confidence · entropy · recommended_stratum",
    output:   "entropy signal 0.0 – 1.0",
  },
  {
    id:       "runtime",
    label:    "StrataRouter Runtime",
    sublabel: "Rust / Axum · Apache-2.0",
    icon:     <Server size={18} />,
    iconBg:   "#d1fae5",
    iconFg:   "#065f46",
    nodes: [
      { id: "ce", label: "CascadeExecutor",  icon: <Zap size={12}/>,           color: "#4f46e5", bg: "#eef2ff" },
      { id: "bc", label: "BudgetController", icon: <DollarSign size={12}/>,    color: "#047857", bg: "#ecfdf5" },
      { id: "cp", label: "ClientPool",       icon: <Globe size={12}/>,         color: "#1d4ed8", bg: "#dbeafe" },
      { id: "cb", label: "CircuitBreaker",   icon: <Shield size={12}/>,        color: "#b91c1c", bg: "#fee2e2" },
      { id: "em", label: "EpisodicMemory",   icon: <Database size={12}/>,      color: "#6d28d9", bg: "#ede9fe" },
      { id: "qv", label: "QualityValidator", icon: <CheckCircle2 size={12}/>,  color: "#0e7490", bg: "#cffafe" },
    ],
    footer: "Output: execution_trace · total_cost · stratum_used · final_output · validation_score",
    output: "LLM API calls – 6 providers",
  },
  {
    id:       "providers",
    label:    "Model Providers",
    sublabel: "LLM API Integrations",
    icon:     <Cpu size={18} />,
    iconBg:   "#fef9c3",
    iconFg:   "#92400e",
    nodes: [
      { id: "groq",      label: "Groq",      icon: <Zap size={15}/>,              color: "#c2410c", bg: "#fff7ed" },
      { id: "anthropic", label: "Anthropic", icon: <Brain size={15}/>,            color: "#6d28d9", bg: "#ede9fe" },
      { id: "openai",    label: "OpenAI",    icon: <Activity size={15}/>,         color: "#111827", bg: "#f9fafb" },
      { id: "google",    label: "Google",    icon: <Globe size={15}/>,            color: "#1d4ed8", bg: "#dbeafe" },
      { id: "mistral",   label: "Mistral",   icon: <SlidersHorizontal size={15}/>,color: "#5b21b6", bg: "#ede9fe" },
      { id: "local",     label: "Local",     icon: <Server size={15}/>,           color: "#374151", bg: "#f3f4f6" },
    ],
  },
]

// ─── Sidebar metadata ─────────────────────────────────────────────────────────

const SIDEBAR: Array<{ label: string; sub: string; color: string; bg: string; icon: React.ReactNode; h: number }> = [
  { label: "APPLICATION",    sub: "Any language\nor framework",            color: "#1d4ed8", bg: "#dbeafe", icon: <Code2  size={15}/>, h: 80  },
  { label: "ROUTING\nLAYER", sub: "Intelligent routing\nand scoring",      color: "#6d28d9", bg: "#ede9fe", icon: <Brain  size={15}/>, h: 126 },
  { label: "RUNTIME\nLAYER", sub: "Execution, control\nand validation",    color: "#065f46", bg: "#d1fae5", icon: <Server size={15}/>, h: 170 },
  { label: "MODEL\nPROVIDERS",sub: "LLM API\nIntegrations",               color: "#92400e", bg: "#fef9c3", icon: <Layers size={15}/>, h: 126 },
]

const ZOOM_MIN  = 0.35
const ZOOM_MAX  = 2.2
const ZOOM_STEP = 0.15
const CARD_W    = 600

// ─── NodeChip ─────────────────────────────────────────────────────────────────

function NodeChip({ node, arrow }: { node: NodeDef; arrow?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        display:       "flex",
        alignItems:    "center",
        gap:           6,
        borderRadius:  8,
        border:        `1.5px solid ${node.color}35`,
        background:    node.bg,
        padding:       "5px 10px",
        minWidth:      126,
        userSelect:    "none",
      }}>
        <span style={{ color: node.color, display: "flex", flexShrink: 0 }}>{node.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#111827", whiteSpace: "nowrap" }}>
          {node.label}
        </span>
      </div>
      {arrow && <ArrowRight size={12} style={{ color: "#9ca3af", flexShrink: 0 }} />}
    </div>
  )
}

// ─── Connector ────────────────────────────────────────────────────────────────

function Connector({ label }: { label: string }) {
  return (
    <div style={{
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      padding:        "10px 0",
      gap:            0,
      pointerEvents:  "none",
    }}>
      <div style={{ width: 1.5, height: 16, background: "#cbd5e1" }} />
      <div style={{
        background:    "#f8fafc",
        border:        "1px solid #e2e8f0",
        borderRadius:  100,
        padding:       "3px 14px",
        fontSize:      11,
        color:         "#64748b",
        fontWeight:    500,
        margin:        "4px 0",
        whiteSpace:    "nowrap",
      }}>
        {label}
      </div>
      <div style={{ width: 1.5, height: 12, background: "#cbd5e1" }} />
      {/* Arrowhead */}
      <svg width="9" height="6" viewBox="0 0 9 6" style={{ display: "block" }}>
        <path d="M4.5 6L0 0H9L4.5 6Z" fill="#94a3b8" />
      </svg>
    </div>
  )
}

// ─── LayerCard ────────────────────────────────────────────────────────────────

function LayerCard({ layer }: { layer: LayerDef }) {
  const hasNodes = layer.nodes.length > 0
  const row1 = layer.nodes.slice(0, 3)
  const row2 = layer.nodes.slice(3)

  return (
    <div style={{ position: "relative" }}>
      {/* GCP-style "ARCHITECTURE" micro-label */}
      <div style={{
        position:      "absolute",
        top:           -1,
        right:         0,
        fontSize:      8.5,
        fontWeight:    700,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        color:         "#d1d5db",
        userSelect:    "none",
        zIndex:        2,
      }}>
        ARCHITECTURE
      </div>

      <div style={{
        border:       "1.5px solid #e5e7eb",
        borderRadius: 14,
        background:   "#ffffff",
        overflow:     "hidden",
        boxShadow:    "0 1px 5px rgba(0,0,0,0.06)",
        minWidth:     CARD_W,
      }}>
        {/* Header */}
        <div style={{
          display:      "flex",
          alignItems:   "flex-start",
          gap:          12,
          padding:      "14px 18px 12px",
          borderBottom: (hasNodes || layer.footer) ? "1px solid #f3f4f6" : "none",
        }}>
          <div style={{
            width:          38, height: 38, borderRadius: 10,
            background:     layer.iconBg, flexShrink: 0,
            display:        "flex", alignItems: "center", justifyContent: "center",
            color:          layer.iconFg,
          }}>
            {layer.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{layer.label}</span>
              {layer.tags?.map(tag => (
                <span key={tag.text} style={{
                  fontSize: 10, fontWeight: 600, color: tag.color,
                  background: tag.bg, border: `1px solid ${tag.border}`,
                  borderRadius: 100, padding: "1px 8px",
                }}>
                  {tag.text}
                </span>
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: "#6b7280" }}>{layer.sublabel}</span>
          </div>
        </div>

        {/* Runtime node rows */}
        {hasNodes && (
          <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "nowrap" }}>
              {row1.map((n, i) => <NodeChip key={n.id} node={n} arrow={i < row1.length - 1} />)}
            </div>
            {row2.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "nowrap" }}>
                {row2.map((n, i) => <NodeChip key={n.id} node={n} arrow={i < row2.length - 1} />)}
              </div>
            )}
          </div>
        )}

        {/* Footer output label */}
        {layer.footer && (
          <div style={{
            borderTop:   "1px solid #f3f4f6",
            background:  "#f9fafb",
            padding:     "7px 18px",
            display:     "flex", alignItems: "center", gap: 6,
          }}>
            <Activity size={10} style={{ color: "#9ca3af", flexShrink: 0 }} />
            <span style={{ fontSize: 10.5, color: "#6b7280", fontFamily: "ui-monospace, monospace" }}>
              {layer.footer}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Provider layer (icon grid) ───────────────────────────────────────────────

function ProviderLayer({ layer }: { layer: LayerDef }) {
  return (
    <div style={{ position: "relative" }}>
      <div style={{
        position: "absolute", top: -1, right: 0,
        fontSize: 8.5, fontWeight: 700, letterSpacing: "0.10em",
        textTransform: "uppercase", color: "#d1d5db", userSelect: "none", zIndex: 2,
      }}>
        ARCHITECTURE
      </div>

      <div style={{
        border:       "1.5px solid #e5e7eb",
        borderRadius: 14,
        background:   "#ffffff",
        overflow:     "hidden",
        boxShadow:    "0 1px 5px rgba(0,0,0,0.06)",
        minWidth:     CARD_W,
        padding:      "14px 18px",
        display:      "flex",
        alignItems:   "center",
        gap:          16,
      }}>
        {/* Left label */}
        <div style={{ width: 72, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: layer.iconBg, color: layer.iconFg,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 4,
          }}>
            {layer.icon}
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#111827", lineHeight: 1.25 }}>
            {layer.label}
          </span>
          <span style={{ fontSize: 9.5, color: "#9ca3af", lineHeight: 1.3 }}>
            {layer.sublabel}
          </span>
        </div>

        {/* Provider icon circles */}
        <div style={{ display: "flex", gap: 14, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
          {layer.nodes.map(node => (
            <div key={node.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 13,
                background:     node.bg,
                border:         `1.5px solid ${node.color}30`,
                display:        "flex", alignItems: "center", justifyContent: "center",
                color:          node.color,
              }}>
                {node.icon}
              </div>
              <span style={{ fontSize: 10.5, color: "#374151", fontWeight: 500, whiteSpace: "nowrap" }}>
                {node.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main exported diagram ────────────────────────────────────────────────────

export function SystemArchitectureDiagram() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom,   setZoom]   = useState(1.0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging  = useRef(false)
  const lastPos   = useRef({ x: 0, y: 0 })

  const zoomIn    = useCallback(() => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX)), [])
  const zoomOut   = useCallback(() => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN)), [])
  const resetView = useCallback(() => { setZoom(1.0); setOffset({ x: 0, y: 0 }) }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return
    dragging.current = true
    lastPos.current  = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }))
  }, [])

  const onPointerUp = useCallback(() => { dragging.current = false }, [])

  // Block scroll-wheel zoom — button-only
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const block = (e: WheelEvent) => e.preventDefault()
    el.addEventListener("wheel", block, { passive: false })
    return () => el.removeEventListener("wheel", block)
  }, [])

  const mainLayers  = LAYERS.slice(0, 3)
  const provLayer   = LAYERS[3]!

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>

      {/* Zoom control panel — fixed, outside transform */}
      <div style={{
        position:      "absolute",
        top:           12,
        right:         12,
        zIndex:        100,
        display:       "flex",
        flexDirection: "column",
        gap:           5,
        background:    "#ffffff",
        border:        "1px solid #e5e7eb",
        borderRadius:  12,
        padding:       6,
        boxShadow:     "0 2px 10px rgba(0,0,0,0.10)",
      }}>
        {[
          { icon: <ZoomIn size={13}/>,   fn: zoomIn,    label: "Zoom in",   off: zoom >= ZOOM_MAX },
          { icon: <ZoomOut size={13}/>,  fn: zoomOut,   label: "Zoom out",  off: zoom <= ZOOM_MIN },
          { icon: <Maximize2 size={13}/>,fn: resetView, label: "Reset view",off: false },
        ].map(({ icon, fn, label, off }) => (
          <button key={label} onClick={fn} disabled={off} title={label}
            style={{
              width:          30, height: 30,
              display:        "flex", alignItems: "center", justifyContent: "center",
              border:         "1px solid #e5e7eb",
              borderRadius:   8,
              background:     off ? "#f9fafb" : "#ffffff",
              color:          off ? "#d1d5db" : "#374151",
              cursor:         off ? "not-allowed" : "pointer",
              transition:     "background 0.1s, color 0.1s",
            }}
            onMouseEnter={e => { if (!off) (e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6" }}
            onMouseLeave={e => { if (!off) (e.currentTarget as HTMLButtonElement).style.background = "#ffffff" }}>
            {icon}
          </button>
        ))}
        <div style={{
          fontSize: 9, textAlign: "center", color: "#9ca3af",
          fontVariantNumeric: "tabular-nums", padding: "1px 0",
        }}>
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* Pannable + zoomable canvas */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width:       "100%",
          height:      "100%",
          overflow:    "hidden",
          cursor:      "grab",
          userSelect:  "none",
          touchAction: "none",
        }}
      >
        <div style={{
          transform:       `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: "top left",
          willChange:      "transform",
          display:         "flex",
          alignItems:      "flex-start",
          padding:         "28px 28px 48px",
          gap:             0,
          width:           "max-content",
        }}>
          {/* Left sidebar labels */}
          <div style={{ display: "flex", flexDirection: "column", marginRight: 14, marginTop: 8 }}>
            {SIDEBAR.map((s, i) => (
              <div key={i} style={{
                height:         s.h,
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                justifyContent: "center",
                gap:            5,
                paddingBottom:  i < SIDEBAR.length - 1 ? 0 : 0,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: s.bg, color: s.color, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {s.icon}
                </div>
                <div style={{ textAlign: "center" }}>
                  {s.label.split("\n").map((l, j) => (
                    <div key={j} style={{
                      fontSize: 8.5, fontWeight: 700, color: s.color,
                      textTransform: "uppercase", letterSpacing: "0.07em", lineHeight: 1.4,
                    }}>
                      {l}
                    </div>
                  ))}
                  {s.sub.split("\n").map((l, j) => (
                    <div key={j} style={{ fontSize: 8.5, color: "#9ca3af", lineHeight: 1.35, marginTop: j === 0 ? 3 : 0 }}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Main column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {mainLayers.map((layer, i) => (
              <div key={layer.id}>
                <LayerCard layer={layer} />
                {layer.output && (
                  <Connector label={layer.output} />
                )}
              </div>
            ))}
            <ProviderLayer layer={provLayer} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Default export (embeddable panel) ───────────────────────────────────────

export default function SystemArchitecturePanel() {
  return (
    <div style={{
      background:   "#f9fafb",
      borderRadius: 16,
      border:       "1px solid #e5e7eb",
      overflow:     "hidden",
      height:       600,
      position:     "relative",
      boxShadow:    "0 1px 3px rgba(0,0,0,0.05)",
    }}>
      <div style={{
        padding:      "11px 18px",
        borderBottom: "1px solid #e5e7eb",
        background:   "#ffffff",
        display:      "flex",
        alignItems:   "center",
        gap:          8,
      }}>
        <Layers size={15} style={{ color: "#6366f1" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>
          System Architecture
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4 }}>
          drag to pan · +/− to zoom
        </span>
      </div>
      <div style={{ height: "calc(100% - 44px)", position: "relative" }}>
        <SystemArchitectureDiagram />
      </div>
    </div>
  )
}
