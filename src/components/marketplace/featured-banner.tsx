"use client";
import Link from "next/link";
import { Star, Zap, CheckCircle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, CATEGORY_ICONS } from "@/lib/utils";

export function FeaturedBanner({ agent }: { agent: any }) {
  return (
    <Link href={`/marketplace/${agent.id}`}>
      <div className="relative overflow-hidden rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-card p-5 card-hover group cursor-pointer">
        <div className="absolute top-3 right-3">
          <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-xs">⭐ Featured</Badge>
        </div>
        <div className="text-3xl mb-3">{CATEGORY_ICONS[agent.category]}</div>
        <h3 className="font-bold text-white group-hover:text-indigo-400 transition-colors mb-1">{agent.name}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{agent.description}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />{agent.average_rating?.toFixed(1)}</span>
          <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{formatNumber(agent.total_executions)}</span>
          {agent.profiles?.is_verified && <span className="flex items-center gap-1 text-blue-400"><CheckCircle className="h-3 w-3" />Verified</span>}
        </div>
        <div className="flex items-center gap-1 mt-3 text-indigo-400 text-xs font-medium group-hover:gap-2 transition-all">
          View Agent <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </Link>
  );
}
