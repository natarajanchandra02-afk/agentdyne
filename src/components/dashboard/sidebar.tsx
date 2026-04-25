"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  LayoutDashboard, Bot, BarChart3, CreditCard, Key,
  Settings, Store, ShieldCheck, LogOut, Zap, ChevronRight,
  HelpCircle, Trophy, Layers, ChevronLeft, Menu, X, History,
  Sparkles,
} from "lucide-react"
import { cn, getInitials } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useUser } from "@/hooks/use-user"

const MAIN_NAV = [
  { href: "/dashboard",   icon: LayoutDashboard, label: "Overview"    },
  { href: "/compose",     icon: Sparkles,        label: "Compose",    badge: "New" },
  { href: "/my-agents",   icon: Bot,             label: "My Agents"   },
  { href: "/pipelines",   icon: Layers,          label: "Pipelines"   },
  { href: "/executions",  icon: History,         label: "Executions"  },
  { href: "/analytics",   icon: BarChart3,       label: "Analytics"   },
  { href: "/api-keys",    icon: Key,             label: "API Keys"    },
  { href: "/leaderboard", icon: Trophy,          label: "Leaderboard" },
]

const MONEY_NAV = [
  { href: "/billing", icon: CreditCard, label: "Billing & Plans" },
  { href: "/seller",  icon: Store,      label: "Seller Portal",  badge: "Earn" },
]

const ADMIN_NAV  = [{ href: "/admin",    icon: ShieldCheck, label: "Admin Panel" }]
const BOTTOM_NAV = [
  { href: "/settings", icon: Settings,   label: "Settings" },
  { href: "/docs",     icon: HelpCircle, label: "Docs", newTab: true },
]

function NavItem({
  href, icon: Icon, label, badge, pathname, newTab,
}: {
  href: string; icon: any; label: string; badge?: string; pathname: string; newTab?: boolean
}) {
  const active = pathname === href || pathname.startsWith(href + "/")
  return (
    <Link href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}>
      <div className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 group",
        active
          ? "bg-primary/8 text-primary"
          : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
      )}>
        <Icon className={cn("h-4 w-4 flex-shrink-0", active ? "text-primary" : "opacity-60")} />
        <span className="flex-1 truncate">{label}</span>
        {badge && (
          <Badge className="text-[10px] h-4 px-1.5 bg-green-50 text-green-600 border-green-200 font-semibold">
            {badge}
          </Badge>
        )}
        {active && <ChevronRight className="h-3 w-3 opacity-40 flex-shrink-0" />}
      </div>
    </Link>
  )
}

export function DashboardSidebar() {
  const pathname     = usePathname()
  const router       = useRouter()
  const { user, profile, loading: authLoading } = useUser()
  const [signingOut,  setSigningOut]  = useState(false)
  const [mobileOpen,  setMobileOpen]  = useState(false)

  // Close mobile menu on navigation
  useEffect(() => { setMobileOpen(false) }, [pathname])

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try { await fetch("/api/auth/signout", { method: "POST" }) }
    finally { router.push("/login"); router.refresh(); setSigningOut(false) }
  }

  const SidebarContent = () => (
    <>
      {/* Logo + back-to-site */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-100 flex-shrink-0">
        <Link href="/" className="flex items-center gap-2 group">
          <Image src="/logo.png" alt="AgentDyne" width={120} height={32}
            className="h-7 w-auto object-contain" />
        </Link>
        {/* Back to site — subtle link */}
        <Link href="/marketplace"
          className="text-[11px] text-zinc-400 hover:text-primary transition-colors flex items-center gap-0.5 font-medium">
          <ChevronLeft className="h-3 w-3" /> Site
        </Link>
      </div>

      {/* New Agent CTA */}
      <div className="px-3 pt-3 pb-2">
        <Link href="/builder">
          <Button size="sm"
            className="w-full rounded-xl justify-start gap-2 font-semibold bg-primary hover:bg-primary/90 text-white shadow-sm">
            <Zap className="h-3.5 w-3.5" /> New Agent
          </Button>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-5">
        <div>
          <p className="section-header px-3 mb-2">Platform</p>
          <div className="space-y-0.5">
            {MAIN_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
          </div>
        </div>

        <div>
          <p className="section-header px-3 mb-2">Monetize</p>
          <div className="space-y-0.5">
            {MONEY_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
          </div>
        </div>

        {profile?.role === "admin" && (
          <div>
            <p className="section-header px-3 mb-2">Admin</p>
            <div className="space-y-0.5">
              {ADMIN_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
            </div>
          </div>
        )}

        <div>
          <p className="section-header px-3 mb-2">General</p>
          <div className="space-y-0.5">
            {BOTTOM_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
          </div>
        </div>
      </nav>

      {/* User card */}
      <div className="p-3 border-t border-zinc-100 flex-shrink-0">
        {authLoading ? (
          <div className="h-11 rounded-xl bg-zinc-50 animate-pulse" />
        ) : user ? (
          <div className="group relative">
            <div
              className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-zinc-50 transition-colors cursor-pointer"
              onClick={() => router.push("/settings")}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === "Enter" && router.push("/settings")}
            >
              <Avatar className="h-7 w-7 flex-shrink-0">
                <AvatarImage src={profile?.avatar_url} />
                <AvatarFallback className="text-[10px] bg-primary text-white">
                  {getInitials(profile?.full_name || user.email || "U")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate text-zinc-900">
                  {profile?.full_name || "User"}
                </p>
                <p className="text-[11px] text-zinc-400 truncate">{user.email}</p>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); router.push("/settings") }}
                  className="p-1 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
                  title="Settings"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); signOut() }}
                  disabled={signingOut}
                  className="p-1 rounded-lg hover:bg-red-50"
                  aria-label="Sign out" title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500 transition-colors" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-60 flex-shrink-0 border-r border-zinc-100 bg-white min-h-screen flex-col">
        <SidebarContent />
      </aside>

      {/* ── Mobile: top bar + slide-in drawer ──────────────────────────── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 h-14 bg-white border-b border-zinc-100 flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(o => !o)}
          className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-50"
          aria-label="Open navigation menu">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link href="/">
          <Image src="/logo.png" alt="AgentDyne" width={100} height={28}
            className="h-6 w-auto object-contain" />
        </Link>
        <div className="flex-1" />
        <Link href="/marketplace"
          className="text-xs font-semibold text-zinc-400 hover:text-primary transition-colors">
          ← Site
        </Link>
      </div>

      {/* Mobile drawer overlay + slide-in */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="md:hidden fixed top-0 left-0 z-50 h-screen w-60 bg-white border-r border-zinc-100 flex flex-col"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Spacer for mobile top bar */}
      <div className="md:hidden h-14 flex-shrink-0" />
    </>
  )
}
