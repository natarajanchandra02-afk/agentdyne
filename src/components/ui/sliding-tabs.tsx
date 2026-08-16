"use client"

/**
 * SlidingTabs — Apple-smooth pill tab selector
 * Uses framer-motion layoutId to animate the active indicator.
 * Supports: pill | card variants, icons, badges, danger state.
 *
 * Drop-in replacement for shadcn <Tabs>.
 */

import { motion } from "framer-motion"
import { cn }     from "@/lib/utils"

export interface Tab {
  id:      string
  label:   string
  icon?:   React.ElementType
  badge?:  string     // numeric badge shown as pill
  danger?: boolean    // red colouring (e.g. security alerts)
}

interface SlidingTabsProps {
  tabs:       Tab[]
  active:     string
  onChange:   (id: string) => void
  className?: string
  /** "pill" = compact rounded-full | "card" = larger rounded-xl */
  variant?:   "pill" | "card"
  /** container background class */
  bg?:        string
}

export function SlidingTabs({
  tabs,
  active,
  onChange,
  className,
  variant = "pill",
  bg      = "bg-zinc-100",
}: SlidingTabsProps) {
  const isPill = variant === "pill"

  return (
    <div
      className={cn(
        "relative flex items-center gap-0.5 p-1 rounded-xl",
        // Card variant (used by tab bars that can grow past 5-6 items, e.g.
        // the builder's EditorTabBar) scrolls horizontally instead of
        // overflowing the rounded container — the bug this fixes: `flex-1`
        // tabs with text content don't shrink below their natural content
        // width by default (flexbox's min-width:auto), so once combined tab
        // width exceeds the container, buttons pushed past the rounded edge
        // rather than the box adapting. overflow-x-auto + flex-nowrap here,
        // paired with flex-shrink-0 (not flex-1) on each card-variant button
        // below, is the standard fix — same pattern Material Design tab bars
        // use once tabs exceed available width.
        !isPill && "overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden",
        bg, className,
      )}
      style={!isPill ? { scrollbarWidth: "none", msOverflowStyle: "none" } : undefined}
      role="tablist"
    >
      {tabs.map(tab => {
        const Icon     = tab.icon
        const isActive = tab.id === active

        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex items-center justify-center gap-1.5",
              "transition-colors duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1",
              isPill
                ? "px-4 py-1.5 rounded-full text-sm font-medium"
                : "flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap",
              isActive
                ? tab.danger ? "text-red-600" : "text-zinc-900"
                : tab.danger ? "text-red-400 hover:text-red-500" : "text-zinc-500 hover:text-zinc-800"
            )}
          >
            {/* Sliding background pill — spring-animated via layoutId */}
            {isActive && (
              <motion.span
                layoutId="sliding-tab-bg"
                className={cn(
                  "absolute inset-0 z-0 bg-white shadow-sm",
                  isPill ? "rounded-full" : "rounded-lg"
                )}
                transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }}
              />
            )}

            <span className="relative z-10 flex items-center gap-1.5">
              {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
              <span>{tab.label}</span>
              {tab.badge && (
                <span className={cn(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                  tab.danger
                    ? "bg-red-100 text-red-600"
                    : "bg-amber-100 text-amber-700"
                )}>
                  {tab.badge}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
