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
  Menu, X, ShieldCheck, Crown, Sparkles, Lock, PanelLeftClose, PanelLeftOpen,
  Radar,
} from "lucide-react"
import { cn, getInitials } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useUser } from "@/hooks/use-user"

/* ─────────────────────────────────────────────────────────────────────────────
 * Route map (Next.js route group: src/app/(dashboard)/...)
 * ─────────────────────────────────────────────────────────────────────────── */

const WORKSPACE_NAV = [
  { href: "/dashboard",    icon: LayoutDashboard, label: "Dashboard"   },
  { href: "/my-agents",    icon: Bot,             label: "My Agents"   },
  { href: "/fleet",        icon: Radar,           label: "Fleet Command", badge: "New" },
  { href: "/executions",   icon: History,         label: "Executions"  },
  { href: "/collections",  icon: FolderOpen,      label: "Collections" },
]

const BUILD_NAV = [
  { href: "/builder",      icon: Cpu,      label: "Agent Studio"                                 },
  { href: "/compose",      icon: Sparkles, label: "AI Composer",  badge: "New"                  },
  { href: "/pipelines",    icon: Layers,   label: "Pipelines"                                    },
  { href: "/swarm",        icon: Network,  label: "Swarms",       badge: "Starter+", planGate: true },
  // NOT /integrations — that URL is the public marketing catalog
  // (src/app/integrations/page.tsx). This dashboard-scoped connections
  // manager lives at a different path specifically to avoid colliding
  // with it; see (dashboard)/connections/page.tsx's header comment for
  // the full history (it was previously dead code because of exactly
  // this collision).
  { href: "/connections",  icon: Plug2,    label: "Integrations"                                 },
  { href: "/api-keys",     icon: Key,      label: "API Keys",     badge: "Starter+", planGate: true },
]

const MONETIZE_NAV = [
  { href: "/seller",      icon: Store,      label: "Seller Portal", badge: "Earn" },
  { href: "/analytics",   icon: BarChart3,  label: "Analytics"                   },
  { href: "/leaderboard", icon: Trophy,     label: "Leaderboard"                 },
  { href: "/revenue",     icon: DollarSign, label: "Revenue"                     },
]

const ACCOUNT_NAV = [
  { href: "/billing",  icon: CreditCard, label: "Billing"                      },
  { href: "/settings", icon: Settings,   label: "Settings"                     },
  { href: "/docs",     icon: HelpCircle, label: "Support", newTab: true        },
]

const ADMIN_NAV = [
  { href: "/admin", icon: ShieldCheck, label: "Admin Panel" },
]

const COLLAPSE_STORAGE_KEY = "agentdyne_sidebar_collapsed"

/* ─── NavItem ─────────────────────────────────────────────────────────────── */
function NavItem({ href, icon: Icon, label, badge, pathname, newTab, planGate, isFreePlan, collapsed }: {
  href: string; icon: any; label: string
  badge?: string; pathname: string; newTab?: boolean
  planGate?: boolean; isFreePlan?: boolean; collapsed?: boolean
}) {
  const active   = pathname === href || pathname.startsWith(href + "/")
  const isLocked = planGate && isFreePlan

  // ✅ Collapsed mode: icon-only, centered, native title attribute as a
  // tooltip (no label text is rendered in the DOM at all, so the layout
  // genuinely shrinks rather than just visually hiding overflow text).
  if (collapsed) {
    return (
      <Link
        href={href}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : undefined}
        title={isLocked ? `${label} — requires Starter plan` : label}
      >
        <div className={cn(
          "relative flex items-center justify-center h-10 w-10 mx-auto rounded-xl transition-all duration-150",
          active    ? "bg-primary/8 text-primary"
          : isLocked? "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50"
          :           "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
        )}>
          <Icon className={cn(
            "h-4.5 w-4.5", active ? "text-primary" : isLocked ? "opacity-40" : "opacity-70"
          )} style={{ width: 18, height: 18 }} />
          {isLocked ? (
            <Lock className="h-2.5 w-2.5 text-zinc-300 absolute -top-0.5 -right-0.5" />
          ) : badge ? (
            <span className={cn(
              "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full",
              badge === "New" || badge === "Earn" ? "bg-green-500" : "bg-amber-500"
            )} />
          ) : null}
        </div>
      </Link>
    )
  }

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
function SectionLabel({ label, collapsed }: { label: string; collapsed?: boolean }) {
  if (collapsed) {
    // A thin divider stands in for the section label when collapsed —
    // there's no room for text, but the visual grouping still needs a cue.
    return <div className="mx-3 my-1.5 border-t border-zinc-100" />
  }
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

  // ✅ Collapsible sidebar — icon-only rail to save horizontal space, with a
  // smooth width animation and a persisted preference (localStorage) so it
  // doesn't reset to expanded on every navigation. Desktop only — mobile
  // already uses its own full-width drawer, collapsing that further would
  // just make touch targets worse, not save anything meaningful.
  const [collapsed, setCollapsed] = useState(false)
  const [collapseHydrated, setCollapseHydrated] = useState(false)

  useEffect(() => {
    const saved = window.localStorage.getItem(COLLAPSE_STORAGE_KEY)
    if (saved === "1") setCollapsed(true)
    setCollapseHydrated(true)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0")
      return next
    })
    setProfileMenuOpen(false) // close the popover — its position assumes the current width
  }

  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMobileOpen(false); setProfileMenuOpen(false) }, [pathname])

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

  const SidebarContent = ({ forceExpanded = false }: { forceExpanded?: boolean }) => {
    // Mobile drawer always renders expanded (forceExpanded), regardless of
    // the desktop collapse preference — there's no reason to icon-collapse
    // a drawer that's already an overlay taking its own dedicated space.
    const isCollapsed = collapsed && !forceExpanded

    return (
    <>
      {/* Logo */}
      <div className={cn(
        "h-14 flex items-center border-b border-zinc-100 flex-shrink-0",
        isCollapsed ? "justify-center px-2" : "justify-between px-4"
      )}>
        {isCollapsed ? (
          <Link href="/" title="AgentDyne">
            <div className="w-8 h-8 rounded-xl bg-zinc-900 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-black text-sm">A</span>
            </div>
          </Link>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* New Agent CTA */}
      <div className={cn("pt-3 pb-2 flex-shrink-0", isCollapsed ? "px-2" : "px-3")}>
        <Link href="/builder" title={isCollapsed ? "New Agent" : undefined}>
          {isCollapsed ? (
            <div className="w-10 h-10 mx-auto rounded-xl bg-primary hover:bg-primary/90 flex items-center justify-center transition-colors shadow-sm">
              <Zap className="h-4 w-4 text-white" />
            </div>
          ) : (
            <Button size="sm" className="w-full rounded-xl justify-start gap-2 font-semibold bg-primary hover:bg-primary/90 text-white shadow-sm">
              <Zap className="h-3.5 w-3.5" /> New Agent
            </Button>
          )}
        </Link>
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 min-h-0 py-2 overflow-y-auto space-y-4", isCollapsed ? "px-1.5" : "px-3")}>
        <div>
          <SectionLabel label="Workspace" collapsed={isCollapsed} />
          <div className="space-y-0.5">
            {WORKSPACE_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} collapsed={isCollapsed} />)}
          </div>
        </div>

        <div>
          <SectionLabel label="Build" collapsed={isCollapsed} />
          <div className="space-y-0.5">
            {BUILD_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} collapsed={isCollapsed} />)}
          </div>
        </div>

        <div>
          <SectionLabel label="Monetize" collapsed={isCollapsed} />
          <div className="space-y-0.5">
            {MONETIZE_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} collapsed={isCollapsed} />)}
          </div>
        </div>

        <div>
          <SectionLabel label="Account" collapsed={isCollapsed} />
          <div className="space-y-0.5">
            {ACCOUNT_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} isFreePlan={isFreePlan} collapsed={isCollapsed} />)}
          </div>
        </div>

        {profile?.role === "admin" && (
          <div>
            <SectionLabel label="Admin" collapsed={isCollapsed} />
            <div className="space-y-0.5">
              {ADMIN_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} collapsed={isCollapsed} />)}
            </div>
          </div>
        )}

        {isFreePlan && !authLoading && !isCollapsed && (
          <div className="mx-1">
            <Link href="/billing?upgrade=starter">
              <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 px-3 py-3 cursor-pointer hover:border-indigo-200 transition-all">
                <p className="text-[11px] font-bold text-indigo-700 flex items-center gap-1.5 mb-0.5">
                  <Crown className="h-3 w-3" /> Upgrade to Starter
                </p>
                <p className="text-[10px] text-indigo-500 leading-relaxed">
                  Unlock API keys, swarms, and 500 calls/mo from $19.
                </p>
              </div>
            </Link>
          </div>
        )}
        {isFreePlan && !authLoading && isCollapsed && (
          <div className="flex justify-center">
            <Link href="/billing?upgrade=starter" title="Upgrade to Starter">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 flex items-center justify-center hover:border-indigo-200 transition-all">
                <Crown className="h-4 w-4 text-indigo-500" />
              </div>
            </Link>
          </div>
        )}
      </nav>

      {/* Profile menu */}
      <div className={cn("border-t border-zinc-100 flex-shrink-0 relative", isCollapsed ? "p-2" : "p-3")} ref={profileMenuRef}>
        {authLoading ? (
          <div className="h-11 rounded-xl bg-zinc-50 animate-pulse" />
        ) : user ? (
          <>
            <AnimatePresence>
              {profileMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className={cn(
                    "absolute bottom-full mb-2 bg-white border border-zinc-100 rounded-xl shadow-lg overflow-hidden z-50",
                    isCollapsed ? "left-2 w-56" : "left-3 right-3"
                  )}
                >
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
                      {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {isCollapsed ? (
              <button
                type="button"
                onClick={() => setProfileMenuOpen(o => !o)}
                aria-expanded={profileMenuOpen}
                aria-label="Account menu"
                title={profile?.full_name || "Account"}
                className={cn(
                  "w-10 h-10 mx-auto flex items-center justify-center rounded-xl transition-colors",
                  profileMenuOpen ? "bg-zinc-100" : "hover:bg-zinc-50"
                )}
              >
                <Avatar className="h-7 w-7 flex-shrink-0 ring-2 ring-white shadow-sm">
                  <AvatarImage src={profile?.avatar_url} />
                  <AvatarFallback className="text-[10px] font-bold bg-primary text-white">
                    {getInitials(profile?.full_name || user.email || "U")}
                  </AvatarFallback>
                </Avatar>
              </button>
            ) : (
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
            )}
          </>
        ) : null}
      </div>
    </>
  )}

  return (
    <>
      {/* ── Desktop ──────────────────────────────────────────────────────────── */}
      <motion.aside
        initial={false}
        animate={{ width: collapseHydrated && collapsed ? 68 : 240 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="hidden md:flex flex-shrink-0 border-r border-zinc-100 bg-white sticky top-0 h-screen flex-col relative"
      >
        <SidebarContent />

        {/* ✅ Edge toggle — sits on the sidebar's right border, half in/half
            out, the same pattern used by Notion/Linear/VS Code. Smooth icon
            crossfade instead of an instant swap. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex absolute -right-3 top-16 h-6 w-6 rounded-full bg-white border border-zinc-200 shadow-sm items-center justify-center text-zinc-400 hover:text-zinc-700 hover:border-zinc-300 transition-colors z-10"
        >
          <AnimatePresence mode="wait" initial={false}>
            {collapsed ? (
              <motion.span key="open" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 90 }} transition={{ duration: 0.15 }}>
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </motion.span>
            ) : (
              <motion.span key="close" initial={{ opacity: 0, rotate: 90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: -90 }} transition={{ duration: 0.15 }}>
                <PanelLeftClose className="h-3.5 w-3.5" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </motion.aside>

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

      {/* ── Mobile drawer ────────────────────────────────────────────────────── */}
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
              <SidebarContent forceExpanded />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Mobile spacer */}
      <div className="md:hidden h-14 flex-shrink-0" />
    </>
  )
}
