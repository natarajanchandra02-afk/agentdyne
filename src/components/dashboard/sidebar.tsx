"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  LayoutDashboard, Bot, History, FolderOpen,
  Cpu, Layers, Network, Plug2, Key,
  Store, BarChart3, Trophy, DollarSign,
  CreditCard, Settings, HelpCircle,
  LogOut, Zap, ChevronRight, ChevronLeft, ChevronsUpDown,
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

// BUILD_NAV — /integrations, /compose, and planGate flags for Starter+ features
const BUILD_NAV = [
  { href: "/builder",      icon: Cpu,     label: "Agent Studio"                              },
  { href: "/compose",      icon: Sparkles,label: "AI Composer",  badge: "New"              },
  { href: "/pipelines",    icon: Layers,  label: "Pipelines"                                 },
  { href: "/swarm",        icon: Network, label: "Swarms",       badge: "Starter+", planGate: true },
  { href: "/integrations", icon: Plug2,   label: "Integrations"                              },
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
  planGate?: boolean; isFreePlan?: boolean
}) {
  const active   = pathname === href || pathname.startsWith(href + "/")
  const isLocked = planGate && isFreePlan
  // Plan-gated items still navigate to their OWN page — the page itself shows
  // the upgrade gate. Lock icon here is a hint only; Apple HIG + Material
  // Design both say show the feature first so users understand the upgrade.
  return (
    <Link
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      title={isLocked ? `${label} — requires Starter plan` : undefined}
    >
      <div className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150",
        active    ? "bg-primary/8 text-primary"
        : isLocked? "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 cursor-pointer"
        :           "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
      )}>
        <Icon className={cn(
          "h-4 w-4 flex-shrink-0",
          active ? "text-primary" : isLocked ? "opacity-40" : "opacity-60"
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
        {active && <ChevronRight className="h-3 w-3 opacity-40 flex-shrink-0" />}
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
      "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0",
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

  // Profile menu redesign: the old design was a permanently-expanded 2-row
  // card (avatar+name+email, then a 2-button footer) taking ~76px of fixed
  // vertical space at all times, whether anyone was looking at it or not.
  // Replaced with a compact single-row trigger that opens an upward popover
  // on click — the same pattern Notion, Linear, Vercel, and Slack all use.
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMobileOpen(false); setProfileMenuOpen(false) }, [pathname])

  // Close the popover on outside click or Escape
  useEffect(() => {
    if (!profileMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setProfileMenuOpen(false) }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [profileMenuOpen])

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

      {/* Profile menu — compact single-row trigger that opens an upward popover.
          Replaces the old permanently-expanded 2-row card. See note above. */}
      <div className="p-3 border-t border-zinc-100 flex-shrink-0 relative" ref={profileMenuRef}>
        {authLoading ? (
          <div className="h-11 rounded-xl bg-zinc-50 animate-pulse" />
        ) : user ? (
          <>
            {/* Popover — opens upward since the trigger sits at the bottom of the sidebar */}
            <AnimatePresence>
              {profileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="absolute left-3 right-3 bottom-full mb-2 bg-white border border-zinc-100 rounded-xl shadow-lg overflow-hidden z-50"
                >
                  {/* Identity header — email now lives here instead of always on screen */}
                  <div className="flex items-center gap-2.5 px-3 py-3 border-b border-zinc-50">
                    <Avatar className="h-8 w-8 flex-shrink-0 ring-2 ring-white shadow-sm">
                      <AvatarImage src={profile?.avatar_url} />
                      <AvatarFallback className="text-[11px] font-bold bg-primary text-white">
                        {getInitials(profile?.full_name || user.email || "U")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate text-zinc-900">{profile?.full_name || "User"}</p>
                      <p className="text-[10px] text-zinc-400 truncate">{user.email}</p>
                    </div>
                    <PlanBadge plan={profile?.subscription_plan} />
                  </div>

                  {/* Menu items */}
                  <div className="py-1">
                    <button
                      onClick={() => { setProfileMenuOpen(false); router.push("/settings") }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
                    >
                      <Settings className="h-3.5 w-3.5 opacity-60" /> Settings
                    </button>
                    <button
                      onClick={() => { setProfileMenuOpen(false); router.push("/billing") }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
                    >
                      <CreditCard className="h-3.5 w-3.5 opacity-60" /> Billing
                    </button>
                    <a
                      href="/docs" target="_blank" rel="noopener noreferrer"
                      onClick={() => setProfileMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
                    >
                      <HelpCircle className="h-3.5 w-3.5 opacity-60" /> Support
                    </a>
                  </div>

                  <div className="border-t border-zinc-50 py-1">
                    <button
                      onClick={signOut} disabled={signingOut}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      {signingOut ? "Signing out..." : "Sign out"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Compact trigger — single row, ~44px, same height whether open or closed */}
            <button
              type="button"
              onClick={() => setProfileMenuOpen(o => !o)}
              aria-expanded={profileMenuOpen}
              aria-label="Account menu"
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl transition-colors",
                profileMenuOpen ? "bg-zinc-100" : "hover:bg-zinc-50"
              )}
            >
              <Avatar className="h-7 w-7 flex-shrink-0 ring-2 ring-white shadow-sm">
                <AvatarImage src={profile?.avatar_url} />
                <AvatarFallback className="text-[10px] font-bold bg-primary text-white">
                  {getInitials(profile?.full_name || user.email || "U")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs font-bold truncate text-zinc-900">{profile?.full_name || "User"}</p>
              </div>
              <PlanBadge plan={profile?.subscription_plan} />
              <ChevronsUpDown className="h-3.5 w-3.5 text-zinc-300 flex-shrink-0" />
            </button>
          </>
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
