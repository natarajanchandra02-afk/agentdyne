"use client"

/**
 * pipeline-canvas.tsx — canvas view, Phases 1–3
 *
 * Controlled component: `nodes: DAGNode[]` (owned by page.tsx, exactly the
 * same state the list editor already uses) flows in, changes flow back out
 * via the callbacks below. This file never becomes a second source of
 * truth — see layout.ts's header comment.
 *
 * Phase 1 (skeleton): pan/zoom/minimap, drag-to-reposition.
 * Phase 2 (this revision): click a node → settings drawer (identical UI to
 *   the list view, via NodeSettingsFields); hand-drawn connections reorder
 *   execution order to match (see page.tsx's reconnectNodes, and the
 *   architectural note in the scope doc §5 — array order stays authoritative,
 *   drawing a connection is how you change it on canvas); marquee/ctrl-click
 *   multi-select feeds the same `parallelSelected` state the list view's
 *   checkboxes use, so "Group Parallel" works identically from either view.
 * Phase 3 (this revision): edges animate live during a test run (derived
 *   from nodeStatuses in layout.ts, zero new backend); nodes show a live
 *   latency/cost/token badge once their result lands (from nodeMetrics).
 */

import { useCallback, useMemo } from "react"
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
  type Node as FlowNode, type NodeChange, type Connection,
  applyNodeChanges,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { DAGNode, NodeStatus, ExecutionNodeResult, AgentLite, AgentdyneFlowNode } from "./layout"
import {
  dagNodesToFlowNodes, dagEdgesToFlowEdges, buildEdgesForLayout, applyPositionsToNodes,
} from "./layout"
import { CANVAS_NODE_TYPES } from "./canvas-node"
import { CanvasNodeSettingsDrawer } from "./canvas-node-settings-drawer"

interface Props {
  nodes: DAGNode[]
  agentMap: Record<string, AgentLite>
  nodeStatuses: Record<string, NodeStatus>
  nodeMetrics: Record<string, ExecutionNodeResult>
  onNodesChange: (nodes: DAGNode[]) => void
  currentPipelineId: string
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  onConnectNodes: (fromId: string, toId: string) => void
  parallelSelected: Set<string>
  onParallelSelectionChange: (ids: string[]) => void
  onRemoveNode: (id: string) => void
}

export function PipelineCanvas({
  nodes, agentMap, nodeStatuses, nodeMetrics, onNodesChange, currentPipelineId,
  selectedNodeId, onSelectNode, onConnectNodes,
  parallelSelected, onParallelSelectionChange, onRemoveNode,
}: Props) {
  const flowNodes = useMemo(
    () => dagNodesToFlowNodes(nodes, agentMap, nodeStatuses, nodeMetrics, selectedNodeId, parallelSelected),
    [nodes, agentMap, nodeStatuses, nodeMetrics, selectedNodeId, parallelSelected],
  )
  const flowEdges = useMemo(
    () => dagEdgesToFlowEdges(buildEdgesForLayout(nodes), nodeStatuses),
    [nodes, nodeStatuses],
  )

  // Only drag (position) changes are meaningful to persist — selection/
  // dimension changes from React Flow are applied to the local render but
  // don't need to propagate back into DAGNode[] (selection is tracked
  // separately via selectedNodeId/parallelSelected, driven by page.tsx).
  const handleNodesChange = useCallback(
    (changes: NodeChange<AgentdyneFlowNode>[]) => {
      const hasPositionChange = changes.some(c => c.type === "position" && c.dragging === false)
      if (!hasPositionChange) return  // ignore drag-in-progress / selection-only churn

      const updated = applyNodeChanges(changes, flowNodes)
      onNodesChange(applyPositionsToNodes(nodes, updated))
    },
    [flowNodes, nodes, onNodesChange],
  )

  // Phase 2: hand-drawn connection → reorder execution order to match.
  // Edges are never locally stateful here (always recomputed from `nodes`
  // via buildEdgesForLayout), so this doesn't need to touch an edges array
  // at all — reordering `nodes` upstream is the only effect needed.
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    onConnectNodes(connection.source, connection.target)
  }, [onConnectNodes])

  // `_event` deliberately untyped (any) rather than annotated `React.MouseEvent`
  // — this file only imports named exports from "react" (useCallback, useMemo),
  // not the default `React` export, so the `React` namespace isn't in scope
  // for a type position. Matches the pragmatic any-typed-callback-param
  // convention already used elsewhere in this codebase (e.g. admin routes,
  // agentEvaluator.ts) rather than adding an import solely to name a type
  // we never read the value of.
  const handleNodeClick = useCallback((_event: any, node: FlowNode) => {
    onSelectNode(node.id)
  }, [onSelectNode])

  const handlePaneClick = useCallback(() => {
    onSelectNode(null)
  }, [onSelectNode])

  // Same reasoning as handleNodeClick above: `any` instead of importing
  // `OnSelectionChangeParams` by name, since I can't verify that exact type
  // export exists in this project's installed @xyflow/react version without
  // a real build to check against — safer to stay untyped here than guess
  // an import name and risk a "has no exported member" error.
  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: FlowNode[] }) => {
    // Only meaningful for *multi*-select (≥2) — a single click is handled by
    // handleNodeClick opening the drawer, and we don't want every ordinary
    // click also toggling parallel-group membership.
    if (selected.length >= 2) onParallelSelectionChange(selected.map(n => n.id))
    else if (selected.length === 0 && parallelSelected.size > 0) onParallelSelectionChange([])
  }, [onParallelSelectionChange, parallelSelected.size])

  const selectedDagNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null
  const selectedIndex   = selectedNodeId ? nodes.findIndex(n => n.id === selectedNodeId) : -1

  if (nodes.length === 0) {
    return (
      <div className="h-[560px] flex items-center justify-center border-2 border-dashed border-zinc-100 rounded-2xl bg-white text-sm text-zinc-400">
        Add steps to see them on the canvas.
      </div>
    )
  }

  return (
    <div
      className="relative h-[560px] rounded-2xl border border-zinc-100 overflow-hidden bg-zinc-50/40"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
    >
      <ReactFlow<AgentdyneFlowNode>
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onSelectionChange={handleSelectionChange}
        nodeTypes={CANVAS_NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        elementsSelectable
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}  // deletion happens via the drawer's explicit Remove button, not stray keypresses
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e4e4e7" />
        <Controls showInteractive={false} className="!shadow-sm !border !border-zinc-100 !rounded-xl overflow-hidden" />
        <MiniMap
          pannable zoomable
          className="!border !border-zinc-100 !rounded-xl !shadow-sm"
          nodeColor={() => "#a1a1aa"}
          maskColor="rgba(244,244,245,0.6)"
        />
      </ReactFlow>

      {selectedDagNode && selectedIndex !== -1 && (
        <CanvasNodeSettingsDrawer
          node={selectedDagNode}
          agent={agentMap[selectedDagNode.agent_id]}
          index={selectedIndex}
          total={nodes.length}
          currentPipelineId={currentPipelineId}
          onChange={patch => {
            const updated = nodes.map(n => n.id === selectedDagNode.id ? { ...n, ...patch } : n)
            onNodesChange(updated)
          }}
          onRemove={() => onRemoveNode(selectedDagNode.id)}
          onClose={() => onSelectNode(null)}
        />
      )}
    </div>
  )
}
