import type { Metadata } from "next"
import { Suspense } from "react"
import { MarketplaceLoader } from "./marketplace-client"
import { Skeleton } from "@/components/ui/skeleton"

export const metadata: Metadata = {
  title:       "Agent Marketplace — AgentDyne",
  description: "Browse 12,400+ production-ready AI microagents. Deploy in one API call. Pay per use, no infra required.",
  keywords:    ["AI agents", "microagents", "AI marketplace", "API", "LLM", "automation"],
  openGraph: {
    title:       "AgentDyne Agent Marketplace",
    description: "12,400+ production-ready AI agents. Deploy in seconds.",
    url:         "https://agentdyne.com/marketplace",
    siteName:    "AgentDyne",
    type:        "website",
    images: [{ url: "https://agentdyne.com/og-marketplace.png", width: 1200, height: 630 }],
  },
  twitter: {
    card:        "summary_large_image",
    title:       "AgentDyne Agent Marketplace",
    description: "12,400+ production-ready AI agents. Deploy in one API call.",
    images:      ["https://agentdyne.com/og-marketplace.png"],
  },
  alternates: { canonical: "https://agentdyne.com/marketplace" },
}

function MarketplaceSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      <div className="h-14" />
      <div className="bg-zinc-50 border-b border-zinc-100 h-40" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-2 mb-6 overflow-hidden">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 w-24 rounded-full flex-shrink-0" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      </div>
    </div>
  )
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<MarketplaceSkeleton />}>
      <MarketplaceLoader />
    </Suspense>
  )
}
