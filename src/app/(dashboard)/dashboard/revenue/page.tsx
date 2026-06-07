import type { Metadata } from "next"
import RevenueClient from "./revenue-client"

export const metadata: Metadata = {
  title: "Revenue — AgentDyne",
  description: "Your Shopify dashboard for AI creator earnings — by agent, by day, by source.",
}

export default function RevenuePage() {
  return <RevenueClient />
}
