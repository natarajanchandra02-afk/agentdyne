"use client"

import Link from "next/link"
import { Star, Zap, CheckCircle } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { CategoryIcon } from "@/components/ui/category-icon"
import { formatNumber, formatCurrency, categoryLabel, getInitials, CATEGORY_ICON_COLOR, cn } from "@/lib/utils"

interface Props { agent: any; view?: "grid" | "list" }

const PRICING_CONFIG: Record<string, { label: string; color: string }> = {
  free:         { label: "Free",         color: "bg-green-50  text-green-700  border-green-100"  },
  per_call:     { label: "Pay per use",  color: "bg-blue-50   text-blue-700   border-blue-100"   },
  subscription: { label: "Subscription", color: "bg-violet-50 text-violet-700 border-violet-100" },
  freemium:     { label: "Freemium",     color: "bg-amber-50  text-amber-700  border-amber-100"  },
}

const ICON_BG: Record<string, string> = {
  productivity:     "bg-amber-50",
  coding:           "bg-blue-50",
  marketing:        "bg-pink-50",
  finance:          "bg-green-50",
  legal:            "bg-violet-50",
  customer_support: "bg-cyan-50",
  data_analysis:    "bg-indigo-50",
  content:          "bg-orange-50",
  research:         "bg-teal-50",
  hr:               "bg-rose-50",
  sales:            "bg-emerald-50",
  devops:           "bg-slate-50",
  security:         "bg-red-50",
  other:            "bg-zinc-50",
}

export function AgentCard({ agent, view = "grid" }: Props) {
  const pricing = PRICING_CONFIG[agent.pricing_model] || PRICING_CONFIG.free
  const seller  = agent.profiles
  const iconBg  = ICON_BG[agent.category] || "bg-zinc-50"
  const iconColor = CATEGORY_ICON_COLOR[agent.category] || "text-zinc-500"

  if (view === "list") {
    return (
      <Link href={`/marketplace/${agent.id}`}>
        <div className="flex items-center gap-4 px-5 py-4 bg-white border border-zinc-100 rounded-2xl hover:border-zinc-200 hover:shadow-sm transition-all group">
          <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
            <CategoryIcon category={agent.category} colored className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-zinc-900 group-hover:text-primary transition-colors truncate">{agent.name}</h3>
              {agent.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
            </div>
            <p className="text-xs text-zinc-500 truncate mt-0.5">{agent.description}</p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex items-center gap-1 text-xs text-zinc-600">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              <span className="font-semibold nums">{agent.average_rating?.toFixed(1) || "—"}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-zinc-400 nums">
              <Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}
            </div>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", pricing.color)}>{pricing.label}</span>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={`/marketplace/${agent.id}`}>
      <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden hover:border-zinc-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group h-full flex flex-col">
        {/* Top accent bar */}
        <div className="h-1 bg-gradient-to-r from-primary via-violet-500 to-cyan-500" />

        <div className="p-5 flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-start gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
              <CategoryIcon category={agent.category} colored className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="font-semibold text-sm text-zinc-900 group-hover:text-primary transition-colors truncate">
                  {agent.name}
                </h3>
                {agent.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                {agent.is_featured && (
                  <span className="text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    Featured
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Avatar className="h-3.5 w-3.5">
                  <AvatarImage src={seller?.avatar_url} />
                  <AvatarFallback className="text-[8px] bg-primary text-white">
                    {getInitials(seller?.full_name || "A")}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] text-zinc-400 truncate">{seller?.full_name || "Anonymous"}</span>
                {seller?.is_verified && <CheckCircle className="h-3 w-3 text-blue-400 flex-shrink-0" />}
              </div>
            </div>
          </div>

          {/* Description */}
          <p className="text-xs text-zinc-500 leading-relaxed mb-3 line-clamp-2 flex-1">{agent.description}</p>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <span className="text-[10px] font-medium bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
              {categoryLabel(agent.category)}
            </span>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", pricing.color)}>
              {agent.pricing_model === "per_call"
                ? `$${agent.price_per_call}/call`
                : agent.pricing_model === "subscription"
                ? `$${agent.subscription_price_monthly}/mo`
                : pricing.label}
            </span>
          </div>

          {/* Stats footer */}
          <div className="flex items-center justify-between pt-3 border-t border-zinc-50">
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                <span className="font-semibold text-zinc-700 nums">{agent.average_rating?.toFixed(1) || "—"}</span>
                <span className="nums">({formatNumber(agent.total_reviews)})</span>
              </span>
              <span className="flex items-center gap-1 nums">
                <Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
