"use client"

/**
 * canvas-node.tsx — custom React Flow node for the pipeline canvas
 *
 * Renders the same collapsed-card visual as the existing DAGVisual's inline
 * `DAGNode()` function in page.tsx — same icon, same colors from
 * NODE_TYPE_CONFIG, same live status ring from NODE_STATUS_CONFIG — so
 * switching between list/canvas view feels like the same product.
 *
 * Two independent selection states, both visually distinct (Phase 2):
 *   - `selected` (React Flow native, single-select via click) — opens the
 *     settings drawer. Rendered as a primary-colored ring.
 *   - `data.isParallelSelected` (multi-select via marquee/ctrl-click,
 *     mapped to page.tsx's `parallelSelected` Set) — for grouping into
 *     parallel execution. Rendered as a blue ring, matching the checkbox
 *     accent color NodeCard already uses in the list view.
 *
 * Phase 3: when `data.metrics` is present (populated during a test run),
 * shows a small floating badge with latency/cost/tokens — sourced from the
 * exact same ExecutionNodeResult data the list view's NodeCard already
 * displays in its collapsed history view, just surfaced live on canvas here.
 */

import { memo } from "react"
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react"
import { Loader2, Check, X, Clock, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"
import { NODE_TYPE_CONFIG, NODE_STATUS_CONFIG } from "../page"
import type { AgentdyneFlowNode } from "./layout"

function CanvasNodeImpl({ data, selected }: NodeProps<AgentdyneFlowNode>) {
  const { dagNode, agent, status, metrics, isParallelSelected } = data
  const cfg = NODE_TYPE_CONFIG[dagNode.node_type ?? "linear"]
  const stCfg = NODE_STATUS_CONFIG[status]
  const isLive = status !== "idle"

  return (
    <div
      className={cn(
        "relative flex flex-col items-start px-3 py-2.5 rounded-xl border transition-all min-w-[140px] max-w-[180px] bg-white cursor-pointer",
        isLive ? `${stCfg.bg} ${stCfg.border}` : "border-zinc-100",
        selected && "ring-2 ring-primary/50 ring-offset-1",
        isParallelSelected && !selected && "ring-2 ring-blue-300 ring-offset-1 border-blue-300",
        status === "running" && "ring-2 ring-blue-200 ring-offset-1",
        status === "success" && "ring-1 ring-green-200",
        status === "failed" && "ring-1 ring-red-200",
      )}
      style={{ boxShadow: isLive ? "none" : "0 1px 3px rgba(0,0,0,0.06)" }}
    >
      {/* Connection handles — draggable in Phase 2 (connectable: true in
          layout.ts). Dragging from a source handle to a target handle fires
          onConnect in pipeline-canvas.tsx, which calls onConnectNodes(). */}
      <Handle type="target" position={Position.Left}  className="!bg-zinc-300 !w-2.5 !h-2.5 !border-2 !border-white hover:!bg-primary transition-colors" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-300 !w-2.5 !h-2.5 !border-2 !border-white hover:!bg-primary transition-colors" />

      <div className="flex items-center gap-1.5 w-full mb-1.5">
        <div className={cn("w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0", cfg.bg)}>
          <span className={cfg.color}>{cfg.icon}</span>
        </div>
        <span className="text-[9px] font-bold text-zinc-300">#{data.index + 1}</span>
        {isParallelSelected && (
          <span className="ml-auto w-3.5 h-3.5 rounded-sm bg-blue-400 flex items-center justify-center flex-shrink-0">
            <Check className="h-2.5 w-2.5 text-white" />
          </span>
        )}
      </div>

      <p className="text-[11px] font-semibold text-zinc-900 leading-tight line-clamp-2 w-full">
        {dagNode.label}
      </p>

      {agent && (
        <p className="text-[9px] text-zinc-400 mt-0.5 truncate w-full">
          {agent.model_name?.split("-")[0] ?? ""}
        </p>
      )}

      {dagNode.parallel_group && (
        <span className="text-[9px] text-blue-500 font-medium bg-blue-50 px-1.5 py-0.5 rounded-full mt-1">
          ∥ group
        </span>
      )}
      {dagNode.condition && (
        <span className="text-[9px] text-amber-600 font-medium mt-1 truncate w-full">
          if: {dagNode.condition.slice(0, 18)}…
        </span>
      )}

      {isLive && (
        <div
          className={cn(
            "absolute -top-2 -right-2 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
            stCfg.bg, stCfg.color, stCfg.border,
          )}
        >
          {status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {status === "success" && <Check className="h-2.5 w-2.5" />}
          {status === "failed" && <X className="h-2.5 w-2.5" />}
          {stCfg.label}
        </div>
      )}

      {/* Phase 3: live metric badge — only once we actually have a result
          for this node (i.e. it's finished, not just "running"). */}
      {metrics && (status === "success" || status === "failed") && (
        <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-black/5 w-full">
          <span className="flex items-center gap-0.5 text-[9px] text-zinc-400 font-mono">
            <Clock className="h-2.5 w-2.5" />{metrics.latency_ms}ms
          </span>
          <span className="flex items-center gap-0.5 text-[9px] text-zinc-400 font-mono">
            <DollarSign className="h-2.5 w-2.5" />{Number(metrics.cost ?? 0).toFixed(5)}
          </span>
          {metrics.tokens && (
            <span className="text-[9px] text-zinc-400 font-mono ml-auto">
              {metrics.tokens.input + metrics.tokens.output}t
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// memo: canvas can have many nodes; avoid re-rendering every node on every
// unrelated state change (e.g. typing in the pipeline name field).
export const CanvasNode = memo(CanvasNodeImpl)

// React Flow's NodeTypes indexes by string and its component signature is
// deliberately loose (ComponentType<any>-ish); the precise generic our
// component carries (NodeProps<AgentdyneFlowNode>) is more specific than
// that index signature can express, which is a known friction point in
// @xyflow/react v12's types, not a real runtime mismatch — this cast is the
// documented workaround. See pipeline-canvas.tsx for the matching <ReactFlow>
// generic that keeps everything else fully typed.
export const CANVAS_NODE_TYPES = { agentdyneNode: CanvasNode } as unknown as NodeTypes
