import type { Metadata } from "next"
import IntegrationsClient from "./integrations-client"

export const metadata: Metadata = {
  title: "Integrations — AgentDyne",
  description: "Connect your agents to databases, APIs, cloud services and more.",
}

export default function IntegrationsPage() {
  return <IntegrationsClient />
}
