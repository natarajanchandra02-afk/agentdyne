/**
 * CategoryIcon — renders the correct Lucide icon for an agent category.
 * Usage: <CategoryIcon category="coding" className="h-5 w-5 text-blue-500" />
 */

import {
  Zap, Code2, Megaphone, TrendingUp, Scale, Headphones,
  BarChart3, PenLine, FlaskConical, Users, LineChart,
  Settings2, ShieldCheck, Bot, LucideProps,
} from "lucide-react"
import { cn, CATEGORY_ICON_COLOR } from "@/lib/utils"

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  productivity:     Zap,
  coding:           Code2,
  marketing:        Megaphone,
  finance:          TrendingUp,
  legal:            Scale,
  customer_support: Headphones,
  data_analysis:    BarChart3,
  content:          PenLine,
  research:         FlaskConical,
  hr:               Users,
  sales:            LineChart,
  devops:           Settings2,
  security:         ShieldCheck,
  other:            Bot,
}

interface CategoryIconProps extends LucideProps {
  category: string
  /** Apply the preset color for this category */
  colored?: boolean
}

export function CategoryIcon({ category, colored = false, className, ...props }: CategoryIconProps) {
  const Icon  = ICON_MAP[category] ?? Bot
  const color = colored ? CATEGORY_ICON_COLOR[category] ?? "text-zinc-500" : ""
  return <Icon className={cn(color, className)} {...props} />
}
