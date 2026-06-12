// RankBadge — medals replaced with lucide Trophy/Medal icons
// Replaces 🥇 🥈 🥉 emoji with styled icon badges

import { Trophy } from "lucide-react"
import { cn } from "@/lib/utils"

export function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-yellow-400 shadow-sm">
        <Trophy className="h-3.5 w-3.5 text-yellow-900" />
      </span>
    )
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-zinc-300 shadow-sm">
        <Trophy className="h-3.5 w-3.5 text-zinc-600" />
      </span>
    )
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-600 shadow-sm">
        <Trophy className="h-3.5 w-3.5 text-amber-100" />
      </span>
    )
  }
  return (
    <span className="text-sm font-bold text-zinc-400 w-7 text-center tabular-nums">
      #{rank}
    </span>
  )
}
