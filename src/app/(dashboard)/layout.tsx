// Dashboard layout
//
// Bug fixes applied:
//  ✅ Bug 10 (pt-14 md:pt-0 removed) — mobile top bar lives inside DashboardSidebar;
//     a "h-14 flex-shrink-0" spacer div is already injected at the bottom of the
//     sidebar component, so main content is never hidden behind the top bar.
//     No padding override needed here.
//  ✅ bg-white on main — avoids grey flash on white-background pages
//  ✅ overflow-hidden on root — keeps sidebar fully sticky at every viewport
//  ✅ Swarm page alignment — swarm uses -mx-6 -my-8 h-[100dvh] md:h-screen to
//     escape the px-6 py-8 wrapper and fill the viewport correctly on all
//     screen sizes without conflicting with the mobile 56 px spacer.

import { DashboardSidebar } from "@/components/dashboard/sidebar"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <DashboardSidebar />
      {/*
       * overflow-y-auto: content scrolls while sidebar stays sticky.
       * bg-white: prevents grey flash on pages with white cards.
       * The px-6 py-8 inner wrapper gives all normal pages their padding.
       * Pages that need full-bleed (Swarm) use -mx-6 -my-8 to escape it.
       */}
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
