/**
 * canvas/layout.ts — DAGNode[] ⇄ React Flow adapters
 *
 * The single source of truth for pipeline state remains `DAGNode[]` in
 * pipelines/[id]/page.tsx — exactly as it is today for the list editor.
 * React Flow's internal node/edge arrays are a VIEW-LAYER CACHE derived
 * from that array; this file is the only place the two shapes meet.
 *
 * Nothing here changes execution order semantics: array order + parallel_group
 * remain authoritative (see graphExecutor.ts / buildLevels() in page.tsx).
 * `position` is a purely presentational addition to DAGNode — optional, so
 * pipelines saved before this feature existed still load correctly (they
 * just get auto-laid-out on first open instead of restoring a saved layout).
 *
 * Phase 2/3 additions (this revision):
 *   - CanvasNodeData carries `metrics` (live latency/cost/tokens during a
 *     test run) and `selected`/`parallelSelected` view flags
 *   - dagEdgesToFlowEdges takes nodeStatuses and derives per-edge `animated`
 *     — an edge animates while either endpoint is `running`, visually
 *     showing data "in flight" along that connection (Phase 3)
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react"
import type { DAGNode, DAGEdge, NodeType, NodeStatus, ExecutionNodeResult } from "../page"

// Re-exported so canvas/ files only need one import source for these types.
export type { DAGNode, DAGEdge, NodeType, NodeStatus, ExecutionNodeResult }

export interface AgentLite {
  id: string
  name: string
  model_name: string
}

// Data payload carried by each React Flow node — everything canvas-node.tsx
// needs to render without re-deriving it from agentMap/nodeStatuses every time.
export interface CanvasNodeData {
  dagNode: DAGNode
  agent?: AgentLite
  status: NodeStatus
  metrics?: ExecutionNodeResult
  index: number
  total: number
  isCanvasSelected: boolean    // drawer-open state (single selection)
  isParallelSelected: boolean  // grouping selection (multi-select)
  [key: string]: unknown  // React Flow's Node<T> requires an index signature
}

// The full React Flow node type for our one custom node kind. NodeProps<T> in
// @xyflow/react v12 is generic over the whole Node (not just its `data`), so
// canvas-node.tsx and pipeline-canvas.tsx both import THIS type — not
// `CanvasNodeData` directly — anywhere they need NodeProps<...>, NodeChange<...>,
// or the nodeTypes map to type-check cleanly against the library's generics.
export type AgentdyneFlowNode = FlowNode<CanvasNodeData, "agentdyneNode">

const COLUMN_WIDTH = 220
const GROUP_ROW_GAP = 70

/**
 * buildLevelsForLayout — topological levels for layout purposes.
 * Deliberately identical logic to buildLevels() in page.tsx (same grouping
 * rule: consecutive same parallel_group nodes cluster into one level) so
 * a pipeline auto-lays-out the same way the read-only DAGVisual diagram
 * already draws it today — no surprise reflow when a user first opens
 * canvas view on an existing pipeline.
 */
export function buildLevelsForLayout(nodes: DAGNode[]): DAGNode[][] {
  if (!nodes.length) return []
  const levels: DAGNode[][] = []
  const seen = new Set<string>()
  const remaining = [...nodes]
  while (remaining.length > 0) {
    const node = remaining.shift()!
    if (seen.has(node.id)) continue
    if (node.node_type === "parallel" && node.parallel_group) {
      const groupNodes = [node, ...remaining.filter(n => n.parallel_group === node.parallel_group)]
      groupNodes.forEach(n => seen.add(n.id))
      remaining.splice(0, remaining.length, ...remaining.filter(n => n.parallel_group !== node.parallel_group))
      levels.push(groupNodes)
    } else {
      seen.add(node.id)
      levels.push([node])
    }
  }
  return levels
}

/** Auto-layout: assigns a column-based position to any node missing one. */
function autoPosition(nodes: DAGNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const levels = buildLevelsForLayout(nodes)
  levels.forEach((levelNodes, colIdx) => {
    const groupOffsetY = levelNodes.length > 1
      ? -((levelNodes.length - 1) * GROUP_ROW_GAP) / 2
      : 0
    levelNodes.forEach((node, rowIdx) => {
      positions.set(node.id, {
        x: colIdx * COLUMN_WIDTH,
        y: groupOffsetY + rowIdx * GROUP_ROW_GAP,
      })
    })
  })
  return positions
}

/**
 * dagNodesToFlowNodes
 * Converts DAGNode[] → React Flow Node[]. Nodes with a saved `position`
 * use it; nodes without one (older pipelines, or freshly added via
 * AgentPicker/AIEditPanel) get auto-laid-out via buildLevelsForLayout().
 */
export function dagNodesToFlowNodes(
  nodes: DAGNode[],
  agentMap: Record<string, AgentLite>,
  nodeStatuses: Record<string, NodeStatus>,
  nodeMetrics: Record<string, ExecutionNodeResult>,
  selectedNodeId: string | null,
  parallelSelected: Set<string>,
): AgentdyneFlowNode[] {
  const needsAutoLayout = nodes.some(n => !n.position)
  const autoPositions = needsAutoLayout ? autoPosition(nodes) : null

  return nodes.map((dagNode, index) => ({
    id: dagNode.id,
    type: "agentdyneNode" as const,
    position: dagNode.position ?? autoPositions?.get(dagNode.id) ?? { x: index * COLUMN_WIDTH, y: 0 },
    selected: selectedNodeId === dagNode.id,
    data: {
      dagNode,
      agent: agentMap[dagNode.agent_id],
      status: nodeStatuses[dagNode.id] ?? "idle",
      metrics: nodeMetrics[dagNode.id],
      index,
      total: nodes.length,
      isCanvasSelected: selectedNodeId === dagNode.id,
      isParallelSelected: parallelSelected.has(dagNode.id),
    },
    draggable: true,
    connectable: true,  // Phase 2 — hand-drawable connections
  }))
}

/**
 * buildEdgesForLayout — identical rule to buildEdges() in page.tsx
 * (linear chain, branch condition labeled). Kept as a separate copy here
 * rather than importing from page.tsx, since page.tsx doesn't currently
 * export it — matches the established per-file small-helper-duplication
 * convention already used throughout this codebase (see e.g. UUID_RE
 * repeated across API route files).
 */
export function buildEdgesForLayout(nodes: DAGNode[]): DAGEdge[] {
  return nodes.slice(0, -1).map((n, i) => {
    const next = nodes[i + 1]!
    const e: DAGEdge = { from: n.id, to: next.id }
    if (next.node_type === "branch" && next.condition) e.condition = next.condition
    return e
  })
}

/**
 * dagEdgesToFlowEdges
 * Phase 3: `animated` is derived from live nodeStatuses, not baked in
 * statically — an edge animates (dashed, moving) while either its source
 * or target node is currently `running`, giving the "data flowing along
 * this connection" visual during a test run. Idle/completed runs render
 * static edges, exactly as Phase 1 did.
 */
export function dagEdgesToFlowEdges(
  edges: DAGEdge[],
  nodeStatuses: Record<string, NodeStatus>,
): FlowEdge[] {
  return edges.map(e => {
    const live = nodeStatuses[e.from] === "running" || nodeStatuses[e.to] === "running"
    const sourceDone = nodeStatuses[e.from] === "success"
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      label: e.condition ? `if: ${e.condition.slice(0, 24)}${e.condition.length > 24 ? "…" : ""}` : undefined,
      animated: live,
      style: live
        ? { stroke: "#3b82f6", strokeWidth: 2 }
        : sourceDone
          ? { stroke: "#22c55e", strokeWidth: 1.5 }
          : undefined,
    }
  })
}

/**
 * applyPositionsToNodes
 * After a drag ends, React Flow gives us its current node array; this
 * folds the resulting positions back into DAGNode[] so page.tsx's
 * save()/AI-edit/preflight logic keeps working against the same
 * DAGNode[] shape it always has — the canvas never becomes a second
 * source of truth.
 */
export function applyPositionsToNodes(
  dagNodes: DAGNode[],
  flowNodes: AgentdyneFlowNode[],
): DAGNode[] {
  const posById = new Map(flowNodes.map(fn => [fn.id, fn.position]))
  return dagNodes.map(n => {
    const pos = posById.get(n.id)
    return pos ? { ...n, position: pos } : n
  })
}
