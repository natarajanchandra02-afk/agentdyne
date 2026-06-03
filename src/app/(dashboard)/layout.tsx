// Dashboard layout — always white, no dark mode classes
// DashboardSidebar handles its own sticky/fixed positioning
// The swarm page uses -mx-6 -my-8 to escape the padding and go full-bleed

import { DashboardSidebar } from "@/components/dashboard/sidebar"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      {/* pt-14 on mobile accounts for the fixed 56px topbar the sidebar renders */}
      <main className="flex-1 overflow-auto bg-white md:pt-0 pt-14">
        <div className="px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
