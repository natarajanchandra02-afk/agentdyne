"use client";

import Link from "next/link";
import Image from "next/image";
import { Star, Zap, CheckCircle, Tag, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatNumber, formatCurrency, categoryLabel, CATEGORY_ICONS, getInitials, cn } from "@/lib/utils";

interface Props {
  agent: any;
  view?: "grid" | "list";
}

const PRICING_BADGE: Record<string, { label: string; class: string }> = {
  free: { label: "Free", class: "bg-green-500/10 text-green-400 border-green-500/20" },
  per_call: { label: "Pay per use", class: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  subscription: { label: "Subscription", class: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  freemium: { label: "Freemium", class: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
};

export function AgentCard({ agent, view = "grid" }: Props) {
  const pricing = PRICING_BADGE[agent.pricing_model] || PRICING_BADGE.free;
  const seller = agent.profiles;

  if (view === "list") {
    return (
      <Link href={`/marketplace/${agent.id}`}>
        <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all group">
          <div className="w-12 h-12 rounded-xl bg-gradient-brand/20 flex items-center justify-center text-2xl flex-shrink-0">
            {agent.icon_url ? <Image src={agent.icon_url} alt={agent.name} width={48} height={48} className="rounded-xl" /> : CATEGORY_ICONS[agent.category]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white group-hover:text-indigo-400 transition-colors truncate">{agent.name}</h3>
              {agent.is_verified && <CheckCircle className="h-4 w-4 text-blue-400 flex-shrink-0" />}
            </div>
            <p className="text-sm text-muted-foreground truncate">{agent.description}</p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="flex items-center gap-1 text-sm"><Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /><span className="text-white">{agent.average_rating?.toFixed(1) || "—"}</span></div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground"><Zap className="h-3.5 w-3.5" />{formatNumber(agent.total_executions)}</div>
            <Badge className={pricing.class}>{pricing.label}</Badge>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/marketplace/${agent.id}`}>
      <div className="bg-card border border-border rounded-xl overflow-hidden card-hover group cursor-pointer h-full flex flex-col">
        {/* Cover */}
        <div className="h-2 bg-gradient-brand" />

        <div className="p-5 flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-start gap-3 mb-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-brand/20 flex items-center justify-center text-xl flex-shrink-0">
              {agent.icon_url ? <Image src={agent.icon_url} alt={agent.name} width={44} height={44} className="rounded-xl object-cover" /> : CATEGORY_ICONS[agent.category]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-semibold text-white group-hover:text-indigo-400 transition-colors truncate text-sm">{agent.name}</h3>
                {agent.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />}
                {agent.is_featured && <Star className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0" />}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Avatar className="h-4 w-4">
                  <AvatarImage src={seller?.avatar_url} />
                  <AvatarFallback className="text-[8px] bg-indigo-600">{getInitials(seller?.full_name || "A")}</AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground truncate">{seller?.full_name || "Anonymous"}</span>
                {seller?.is_verified && <CheckCircle className="h-3 w-3 text-blue-400" />}
              </div>
            </div>
          </div>

          {/* Description */}
          <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2 flex-1">{agent.description}</p>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <Badge variant="outline" className="text-xs px-2 py-0.5">
              {CATEGORY_ICONS[agent.category]} {categoryLabel(agent.category)}
            </Badge>
            <Badge className={cn("text-xs px-2 py-0.5", pricing.class)}>
              <Tag className="h-2.5 w-2.5 mr-1" />
              {agent.pricing_model === "per_call"
                ? `$${agent.price_per_call}/call`
                : agent.pricing_model === "subscription"
                ? `$${agent.subscription_price_monthly}/mo`
                : pricing.label}
            </Badge>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-between pt-3 border-t border-border/50">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                <span className="text-white font-medium">{agent.average_rating?.toFixed(1) || "—"}</span>
                <span>({formatNumber(agent.total_reviews)})</span>
              </span>
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {formatNumber(agent.total_executions)} runs
              </span>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-indigo-400 transition-colors" />
          </div>
        </div>
      </div>
    </Link>
  );
}
