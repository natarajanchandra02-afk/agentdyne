export const runtime = "edge"

import type { Metadata } from "next"
import EmbedWidgetClient from "./EmbedWidgetClient"

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "AgentDyne Widget",
    robots: { index: false, follow: false },
  }
}

export default function EmbedWidgetPage({ params }: { params: { id: string } }) {
  return <EmbedWidgetClient agentId={params.id} />
}
