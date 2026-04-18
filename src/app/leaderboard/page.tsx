import type { Metadata } from "next"
import LeaderboardClient from "./leaderboard-client"

export const metadata: Metadata = {
  title:       "Agent Leaderboard — AgentDyne",
  description: "Objective quality rankings for AI agents based on accuracy, reliability, speed, cost, and adoption. Updated every 24h.",
  openGraph: {
    title:       "AgentDyne Agent Leaderboard",
    description: "Objective AI agent quality rankings. Updated every 24h from live execution data.",
    url:         "https://agentdyne.com/leaderboard",
    siteName:    "AgentDyne",
    type:        "website",
  },
  twitter: {
    card:        "summary_large_image",
    title:       "AgentDyne Agent Leaderboard",
    description: "Objective AI agent rankings based on accuracy, speed, cost, and reliability.",
  },
  alternates: { canonical: "https://agentdyne.com/leaderboard" },
}

export default function LeaderboardPage() {
  return <LeaderboardClient />
}
