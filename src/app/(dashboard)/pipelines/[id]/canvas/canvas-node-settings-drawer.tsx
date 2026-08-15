"use client"

/**
 * canvas-node-settings-drawer.tsx — Phase 2
 *
 * Opens as a side panel when a canvas node is clicked. Renders the EXACT
 * same settings UI as the list view's NodeCard expander — both import
 * NodeSettingsFields from ../page, so there is only ever one implementation
 * of "what a step's settings look like" in this codebase. Nothing here
 * duplicates ConditionBuilder/SubagentPipelineSelector/retry-settings JSX.
 */

import { X, Trash2 } from "lucide-react"
import { NODE_TYPE_CONFIG, NodeSettingsFields } from "../page"
import type { DAGNode, AgentLite } from "./layout"

interface Props {
  node: DAGNode
  agent?: AgentLite
  index: number
  total: number
  currentPipelineId: string
  onChange: (patch: Partial<DAGNode>) => void
  onRemove: () => void
  onClose: () => void
}

export function CanvasNodeSettingsDrawer({ node, agent, index, total, currentPipelineId, onChange, onRemove, onClose }: Props) {
  const cfg = NODE_TYPE_CONFIG[node.node_type ?? "linear"]

  return (
    <div className="absolute top-0 right-0 h-full w-[340px] bg-white border-l border-zinc-100 shadow-xl z-20 flex flex-col animate-in slide-in-from-right duration-150">
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-4 border-b border-zinc-100 flex-shrink-0">
        <div className={cfg.bg + " w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"}>
          <span className={cfg.color}>{cfg.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <input
            value={node.label}
            onChange={e => onChange({ label: e.target.value })}
            className="w-full text-sm font-semibold text-zinc-900 bg-transparent border-none outline-none focus:bg-zinc-50 focus:px-1 rounded transition-all truncate"
          />
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Step {index + 1} of {total} {agent && `· ${agent.name}`}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 flex-shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Settings — identical component to the list view */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <NodeSettingsFields node={node} onChange={onChange} currentPipelineId={currentPipelineId} />
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-100 flex-shrink-0">
        <button
          onClick={onRemove}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 border border-red-100 rounded-xl py-2 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove step
        </button>
      </div>
    </div>
  )
}
