// Fix: wrap useSearchParams consumer in Suspense — required by Next.js 14/15.
// Without this, the router suspends the entire page tree during streaming SSR,
// which collapses the render to the nearest Suspense fallback (or error.tsx).
// This was the root cause of the "blank page / unstyled buttons" regression.

import { Suspense } from "react"
import { MarketplaceLoader } from "./marketplace-client"
import { Skeleton } from "@/components/ui/skeleton"

function MarketplaceSkeleton() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navbar placeholder height */}
      <div className="h-14" />
      <div className="bg-zinc-50 border-b border-zinc-100 h-40" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-2 mb-6 overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full flex-shrink-0" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(9)].map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
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
