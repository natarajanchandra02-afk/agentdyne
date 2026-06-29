import type { Metadata } from "next"
// ✅ Bug 8 fix: use relative import — co-located file, no cross-folder dependency.
// Previously pointed to @/app/(dashboard)/dashboard/revenue-client which is a
// fragile absolute path that breaks if the dashboard folder is ever renamed/moved.
import RevenueClient from "./revenue-client"

export const metadata: Metadata = {
  title: "Revenue — AgentDyne",
  description: "Your earnings, agent performance, and payout center.",
}

export default function RevenuePage() {
  return <RevenueClient />
}
