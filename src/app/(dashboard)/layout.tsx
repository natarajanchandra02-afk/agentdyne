// Dashboard layout
// Sidebar is sticky/h-screen — it never moves when the page scrolls.
// Main content has overflow-auto so it scrolls independently.
// The swarm page uses -mx-6 -my-8 to escape padding and go full-bleed.
//
// Bug #10 fix: the mobile top-offset (for the fixed mobile header) used to live
// on <main> via `pt-14 md:pt-0`, OUTSIDE the `px-6 py-8` wrapper div. Pages that
// go full-bleed with `-mx-6 -my-8` only cancel the wrapper's own padding — they
// have no way to reach padding declared one level up on <main>. On mobile this
// left a 56px gap/seam above the swarm page's full-bleed header.
// Moving pt-14/md:pt-0 onto the same wrapper div that full-bleed pages negate
// means a single `-mx-6 -my-8` consistently cancels ALL surrounding spacing,
// on every breakpoint, with no special-casing needed per page.

import { DashboardSidebar } from "@/components/dashboard/sidebar"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      <DashboardSidebar />
      {/* overflow-y-auto here is what lets the sidebar stay sticky while content scrolls */}
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="px-6 py-8 pt-14 md:pt-8">
          {children}
        </div>
      </main>
    </div>
  )
}
