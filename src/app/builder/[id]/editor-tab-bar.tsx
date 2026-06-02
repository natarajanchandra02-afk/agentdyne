"use client"

/**
 * EditorTabBar — builder tabs: Overview · Behavior · Security · Monetization · Deploy · Improve
 * Deploy tab = Embed Agent (viral distribution)
 * Improve tab = Self-Improving AI version diff panel
 */

import { LayoutDashboard, Brain, ShieldCheck, DollarSign, Globe, Sparkles } from "lucide-react"
import { SlidingTabs } from "@/components/ui/sliding-tabs"

export const EDITOR_TABS = [
  { id: "overview",     label: "Overview",     icon: LayoutDashboard },
  { id: "behavior",     label: "Behavior",     icon: Brain           },
  { id: "security",     label: "Security",     icon: ShieldCheck     },
  { id: "monetization", label: "Monetization", icon: DollarSign      },
  { id: "deploy",       label: "Deploy",       icon: Globe           },
  { id: "improve",      label: "Improve",      icon: Sparkles        },
] as const

export type EditorTabId = (typeof EDITOR_TABS)[number]["id"]

export const tabVariants = {
  enter:  { opacity: 0, y: 8  },
  center: { opacity: 1, y: 0,  transition: { duration: 0.20, ease: [0.25, 0.46, 0.45, 0.94] as const } },
  exit:   { opacity: 0, y: -5, transition: { duration: 0.14, ease: [0.55, 0.06, 0.68, 0.19] as const } },
}

interface EditorTabBarProps {
  active:   EditorTabId
  onChange: (id: EditorTabId) => void
}

export function EditorTabBar({ active, onChange }: EditorTabBarProps) {
  return (
    <SlidingTabs
      variant="card"
      bg="bg-zinc-50 border border-zinc-100"
      tabs={EDITOR_TABS as unknown as { id: string; label: string; icon?: React.ElementType }[]}
      active={active}
      onChange={id => onChange(id as EditorTabId)}
    />
  )
}
