// Dashboard layout — always white, no dark mode classes
// DashboardSidebar handles its own sticky/fixed positioning

import { DashboardSidebar } from "@/components/dashboard/sidebar"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-50">
      <DashboardSidebar />
      {/* pt-14 on mobile accounts for the fixed 56px topbar the sidebar renders */}
      <main className="flex-1 overflow-auto bg-white md:pt-0 pt-14">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
