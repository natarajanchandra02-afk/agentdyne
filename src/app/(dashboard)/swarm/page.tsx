import type { Metadata } from "next"
import SwarmClient from "./swarm-client"

export const metadata: Metadata = {
  title:       "Multi-Agent Swarm — AgentDyne",
  description: "Orchestrate multiple AI agents in parallel, debate, or orchestrate patterns. Google A2A-compatible peer-to-peer agent communication.",
}

export default function SwarmPage() {
  return <SwarmClient />
}
