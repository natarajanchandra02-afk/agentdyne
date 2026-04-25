/**
 * EditorTabBar — shared animated tab bar for the Builder Editor.
 * Uses the same SlidingTabs + AnimatePresence pattern as settings-client.tsx.
 *
 * Export this component and the tabVariants, then import both into
 * builder-editor-client.tsx to replace the shadcn <Tabs> tree.
 *
 * Usage (inside BuilderEditorClient):
 *   const [activeTab, setActiveTab] = useState(defaultTab === "rag" ? "behavior" : defaultTab || "overview")
 *
 *   <EditorTabBar active={activeTab} onChange={setActiveTab} />
 *   <AnimatePresence mode="wait" initial={false}>
 *     <motion.div key={activeTab} variants={tabVariants} initial="enter" animate="center" exit="exit">
 *       {panels[activeTab as keyof typeof panels]}
 *     </motion.div>
 *   </AnimatePresence>
 */

"use client"

import { LayoutDashboard, Brain, ShieldCheck, DollarSign } from "lucide-react"
import { SlidingTabs } from "@/components/ui/sliding-tabs"

export const EDITOR_TABS = [
  { id: "overview",     label: "Overview",     icon: LayoutDashboard },
  { id: "behavior",     label: "Behavior",     icon: Brain },
  { id: "security",     label: "Security",     icon: ShieldCheck },
  { id: "monetization", label: "Monetization", icon: DollarSign },
]

export const tabVariants = {
  enter:  { opacity: 0, y: 10 },
  center: { opacity: 1, y: 0,  transition: { duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] as const } },
  exit:   { opacity: 0, y: -6, transition: { duration: 0.15, ease: [0.55, 0.06, 0.68, 0.19] as const } },
}

interface EditorTabBarProps {
  active:   string
  onChange: (id: string) => void
}

export function EditorTabBar({ active, onChange }: EditorTabBarProps) {
  return (
    <SlidingTabs
      variant="card"
      bg="bg-zinc-50 border border-zinc-100"
      tabs={EDITOR_TABS}
      active={active}
      onChange={onChange}
    />
  )
}
