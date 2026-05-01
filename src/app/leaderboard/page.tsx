import type { Metadata } from "next"
import LeaderboardClient from "./leaderboard-client"

export const metadata: Metadata = {
  title:       "Agent Leaderboard — AgentDyne",
  description: "Objective quality rankings for AI agents based on evaluation harness results, reliability, speed, cost efficiency, and adoption. Minimum 100 verified runs. Updated every 24h.",
  openGraph: {
    title:       "AgentDyne Agent Leaderboard",
    description: "Objective AI agent quality rankings from verified execution data. Updated every 24h.",
    url:         "https://agentdyne.com/leaderboard",
    siteName:    "AgentDyne",
    type:        "website",
  },
  twitter: {
    card:        "summary_large_image",
    title:       "AgentDyne Agent Leaderboard",
    description: "Objective AI agent rankings based on quality score, reliability, speed, and cost. Minimum 100 runs.",
  },
  alternates: { canonical: "https://agentdyne.com/leaderboard" },
}

export default function LeaderboardPage() {
  return <LeaderboardClient />
}
