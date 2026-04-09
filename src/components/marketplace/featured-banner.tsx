"use client"

import Link from "next/link"
import { Star, Zap, CheckCircle, ArrowRight } from "lucide-react"
import { CategoryIcon } from "@/components/ui/category-icon"
import { formatNumber } from "@/lib/utils"

export function FeaturedBanner({ agent }: { agent: any }) {
  return (
    <Link href={`/marketplace/${agent.id}`}>
      <div className="relative overflow-hidden rounded-2xl border border-zinc-100 bg-white p-5 hover:border-primary/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group cursor-pointer">
        <div className="absolute top-3 right-3">
          <span className="text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" /> Featured
          </span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mb-3">
          <CategoryIcon category={agent.category} colored className="h-5 w-5" />
        </div>
        <h3 className="font-bold text-zinc-900 group-hover:text-primary transition-colors mb-1 text-sm pr-16 truncate">
          {agent.name}
        </h3>
        <p className="text-xs text-zinc-500 line-clamp-2 mb-3 leading-relaxed">{agent.description}</p>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            <span className="font-semibold text-zinc-600">{agent.average_rating?.toFixed(1)}</span>
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {formatNumber(agent.total_executions)} runs
          </span>
          {agent.profiles?.is_verified && (
            <span className="flex items-center gap-1 text-blue-500">
              <CheckCircle className="h-3 w-3" /> Verified
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-3 text-xs font-semibold text-primary group-hover:gap-2 transition-all">
          View Agent <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </Link>
  )
}
