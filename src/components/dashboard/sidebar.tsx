"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  LayoutDashboard, Bot, History, FolderOpen,
  Cpu, Layers, Network, Plug2, Key,
  Store, BarChart3, Trophy, DollarSign,
  CreditCard, Settings, HelpCircle,
  LogOut, Zap, ChevronRight, ChevronLeft,
  Menu, X, ShieldCheck, Crown, Sparkles, Lock,
} from "lucide-react"
import { cn, getInitials } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useUser } from "@/hooks/use-user"

/* ─────────────────────────────────────────────────────────────────────────────
 * Route map (Next.js route group: src/app/(dashboard)/...)
 *
 * The (dashboard) group means these URLs work WITHOUT a /dashboard prefix:
 *   /dashboard  → (dashboard)/dashboard/page.tsx   [overview]
 *   /my-agents  → (dashboard)/my-agents/page.tsx
 *   /revenue    → (dashboard)/revenue/page.tsx
 *   /collections→ (dashboard)/collections/page.tsx
 *   etc.
 *
 * Sidebar hrefs must match these final URLs exactly.
 * ─────────────────────────────────────────────────────────────────────────── */

const WORKSPACE_NAV = [
  { href: "/dashboard",    icon: LayoutDashboard, label: "Dashboard"   },
  { href: "/my-agents",    icon: Bot,             label: "My Agents"   },
  { href: "/executions",   icon: History,         label: "Executions"  },
  { href: "/collections",  icon: FolderOpen,      label: "Collections" },
]

// BUILD_NAV — ✅ Bug 7 fix: /integrations added; ✅ Bug 15 fix: /compose added; ✅ Bug 22 fix: planGate flags for Starter+ features
const BUILD_NAV = [
  { href: "/builder",      icon: Cpu,     label: "Agent Studio"                              },
  { href: "/compose",      icon: Sparkles,label: "AI Composer",  badge: "New"              }, // ✅ Bug 15 fix: was missing from nav
  { href: "/pipelines",    icon: Layers,  label: "Pipelines"                                 },
  { href: "/swarm",        icon: Network, label: "Swarms",       badge: "Starter+", planGate: true },
  { href: "/integrations", icon: Plug2,   label: "Integrations"                              }, // ✅ Bug 7 fix: was missing from nav
  { href: "/api-keys",     icon: Key,     label: "API Keys",     badge: "Starter+", planGate: true },
]

const MONETIZE_NAV = [
  { href: "/seller",       icon: Store,     label: "Seller Portal", badge: "Earn" },
  { href: "/analytics",    icon: BarChart3, label: "Analytics"                    },
  { href: "/leaderboard",  icon: Trophy,    label: "Leaderboard"                  },
  { href: "/revenue",      icon: DollarSign,label: "Revenue"                      },
]

const ACCOUNT_NAV = [
  { href: "/billing",  icon: CreditCard, label: "Billing"              },
  { href: "/settings", icon: Settings,   label: "Settings"             },
  { href: "/docs",     icon: HelpCircle, label: "Support", newTab: true },
]

const ADMIN_NAV = [
  { href: "/admin", icon: ShieldCheck, label: "Admin Panel" },
]

/* ─── NavItem ─────────────────────────────────────────────────────────────── */
function NavItem({ href, icon: Icon, label, badge, pathname, newTab, planGate, isFreePlan }: {
  href: string; icon: any; label: string
  badge?: string; pathname: string; newTab?: boolean
  planGate?: boolean; isFreePlan?: boolean  // ✅ Bug 22: plan gate support
}) {
  const active   = pathname === href || pathname.startsWith(href + "/")
  const isLocked = planGate && isFreePlan
  return (
    <Link
      href={isLocked ? "/billing?upgrade=starter" : href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      title={isLocked ? `${label} - requires Starter plan` : undefined}
    >
      <div className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150",
        active    ? "bg-primary/8 text-primary"
        : isLocked? "text-zinc-400 hover:text-zinc-500 hover:bg-zinc-50"
        :           "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
      )}>
        <Icon className={cn(
          "h-4 w-4 flex-shrink-0",
          active ? "text-primary" : isLocked ? "opacity-25" : "opacity-60"
        )} />
        <span className="flex-1 truncate">{label}</span>
        {isLocked ? (
          <Lock className="h-3 w-3 text-zinc-300 flex-shrink-0" />
        ) : badge ? (
          <Badge className={cn(
            "text-[10px] h-4 px-1.5 font-semibold",
            badge === "New" || badge === "Earn"
              ? "bg-green-50 text-green-600 border-green-200"
              : "bg-amber-50 text-amber-600 border-amber-200"
          )}>{badge}</Badge>
        ) : null}
        {active && !isLocked && <ChevronRight className="h-3 w-3 opacity-40 flex-shrink-0" />}
      </div>
    </Link>
  )
}

/* ─── Section label ───────────────────────────────────────────────────────── */
function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 mb-1.5 text-[10px] font-bold tracking-widest uppercase text-zinc-400 select-none">
      {label}
    </p>
  )
}

/* ─── Plan badge ──────────────────────────────────────────────────────────── */
function PlanBadge({ plan }: { plan?: string }) {
  if (!plan || plan === "free") return null
  const isPro = plan === "pro"
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full",
      isPro
        ? "bg-violet-50 text-violet-600 border border-violet-200"
        : "bg-amber-50 text-amber-600 border border-amber-200"
    )}>
      {isPro && <Crown className="h-2.5 w-2.5" />}
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </span>
  )
}

/* ─── Main component ──────────────────────────────────────────────────────── */
export function DashboardSidebar() {
  const pathname  = usePathname()
  const router    = useRouter()
  const { user, profile, loading: authLoading } = useUser()
  const [signingOut, setSigningOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const isFreePlan = !profile?.subscription_plan || profile.subscription_plan === "free"

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try { await fetch("/api/auth/signout", { method: "POST" }) }
    finally { router.push("/login"); router.refresh(); setSigningOut(false) }
  }

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-100 flex-shrink-0">
        <Link href="/">
          <Image
            src="/logo.png" alt="AgentDyne" width={120} height={32}
            className="h-7 w-auto object-contain"
          />
        </Link>
        <Link
          href="/marketplace"
          className="text-[11px] text-zinc-400 hover:text-primary transition-colors flex items-center gap-0.5 font-medium"
        >
          <ChevronLeft className="h-3 w-3" /> Site
        </Link>
      </div>

      {/* New Agent CTA */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <Link href="/builder">
          <Button size="sm" className="w-full rounded-xl justify-start gap-2 font-semibold bg-primary hover:bg-primary/90 text-white shadow-sm">
            <Zap className="h-3.5 w-3.5" /> New Agent
          </Button>
        </Link>
      </div>

      {/* Nav — min-h-0 + overflow-y-auto make this section scroll independently
          while the sidebar itself stays sticky via the <aside> wrapper */}
      <nav className="flex-1 min-h-0 px-3 py-2 overflow-y-auto space-y-4">
        <div>
          <SectionLabel label="Workspace" />
          <div className="space-y-0.5">
            {WORKSPACE_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} />)}
          </div>
        </div>

        <div>
          <SectionLabel label="Build" />
          <div className="space-y-0.5">
            {BUILD_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} />)}
          </div>
        </div>

        <div>
          <SectionLabel label="Monetize" />
          <div className="space-y-0.5">
            {MONETIZE_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} />)}
          </div>
        </div>

        <div>
          <SectionLabel label="Account" />
          <div className="space-y-0.5">
            {ACCOUNT_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} />)}
          </div>
        </div>

        {profile?.role === "admin" && (
          <div>
            <SectionLabel label="Admin" />
            <div className="space-y-0.5">
              {ADMIN_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
            </div>
          </div>
        )}
      </nav>

      {/* User card */}
      <div className="p-3 border-t border-zinc-100 flex-shrink-0">
        {authLoading ? (
          <div className="h-11 rounded-xl bg-zinc-50 animate-pulse" />
        ) : user ? (
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 overflow-hidden">
            <div
              className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-zinc-100/60 transition-colors"
              onClick={() => router.push("/settings")}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === "Enter" && router.push("/settings")}
            >
              <Avatar className="h-8 w-8 flex-shrink-0 ring-2 ring-white shadow-sm">
                <AvatarImage src={profile?.avatar_url} />
                <AvatarFallback className="text-[11px] font-bold bg-primary text-white">
                  {getInitials(profile?.full_name || user.email || "U")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate text-zinc-900">
                  {profile?.full_name || "User"}
                </p>
                <p className="text-[10px] text-zinc-400 truncate">{user.email}</p>
              </div>
              <PlanBadge plan={profile?.subscription_plan} />
            </div>
            <div className="border-t border-zinc-100 flex">
              <button
                onClick={() => router.push("/settings")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/60 transition-colors"
              >
                <Settings className="h-3 w-3" /> Settings
              </button>
              <div className="w-px bg-zinc-100" />
              <button
                onClick={signOut} disabled={signingOut}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-zinc-500 hover:text-red-600 hover:bg-red-50/60 transition-colors"
              >
                <LogOut className="h-3 w-3" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )

  return (
    <>
      {/* ── Desktop ─────────────────────────────────────────────────────────────
          sticky + h-screen: the sidebar column never moves when page content scrolls.
          The layout wrapper is `flex h-screen overflow-hidden`; main gets
          `overflow-y-auto`. This makes the sidebar stay pinned while only main scrolls.
          ───────────────────────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-60 flex-shrink-0 border-r border-zinc-100 bg-white sticky top-0 h-screen flex-col">
        <SidebarContent />
      </aside>

      {/* ── Mobile top bar ──────────────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 h-14 bg-white border-b border-zinc-100 flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(o => !o)}
          className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-50"
          aria-label="Open navigation"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link href="/">
          <Image src="/logo.png" alt="AgentDyne" width={100} height={28} className="h-6 w-auto object-contain" />
        </Link>
        <div className="flex-1" />
        <Link href="/marketplace" className="text-xs font-semibold text-zinc-400 hover:text-primary transition-colors">
          ← Site
        </Link>
      </div>

      {/* ── Mobile drawer ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="md:hidden fixed top-0 left-0 z-50 h-screen w-60 bg-white border-r border-zinc-100 flex flex-col"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Mobile spacer */}
      <div className="md:hidden h-14 flex-shrink-0" />
    </>
  )
}
