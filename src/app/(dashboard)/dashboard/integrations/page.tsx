import type { Metadata } from "next"
import DashboardIntegrationsClient from "../integrations-client"

export const metadata: Metadata = {
  title: "Integrations — AgentDyne",
  description: "Connect your agents to databases, APIs, cloud services and more via MCP.",
}

export default function DashboardIntegrationsPage() {
  return <DashboardIntegrationsClient />
}
