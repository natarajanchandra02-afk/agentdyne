import type { Metadata } from "next"
import RevenueClient from "@/app/(dashboard)/dashboard/revenue-client"

export const metadata: Metadata = {
  title: "Revenue — AgentDyne",
  description: "Your earnings, agent performance, and payout center.",
}

export default function RevenuePage() {
  return <RevenueClient />
}
