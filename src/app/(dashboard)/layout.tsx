// Dashboard layout
// Sidebar is sticky/h-screen — it never moves when the page scrolls.
// Main content has overflow-auto so it scrolls independently.
// The swarm page uses -mx-6 -my-8 to escape padding and go full-bleed.

import { DashboardSidebar } from "@/components/dashboard/sidebar"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      <DashboardSidebar />
      {/* overflow-y-auto here is what lets the sidebar stay sticky while content scrolls */}
      <main className="flex-1 overflow-y-auto bg-white pt-14 md:pt-0">
        <div className="px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
