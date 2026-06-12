"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ChevronDown, Search, Bell, Menu, X, Zap,
  LayoutDashboard, Store, DollarSign, LogOut, Settings,
  Bot, Trophy, Key, BarChart3, CheckCircle,
  Clock, AlertCircle, Star, History, Network,
  Layers, Cpu, FolderOpen, CreditCard, HelpCircle,
  Link2, Crown, ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { useUser } from "@/hooks/use-user"
import { useNotifications } from "@/hooks/use-notifications"
import { getInitials, cn, formatRelativeTime } from "@/lib/utils"
import type { User } from "@supabase/supabase-js"

/* ─── Top nav links ──────────────────────────────────────────────────────── */
const NAV = [
  { href: "/marketplace",  label: "Marketplace"  },
  { href: "/integrations", label: "Integrations" },
  { href: "/builder",      label: "Build"        },
  { href: "/docs",         label: "Docs"         },
  { href: "/blog",         label: "Blog"         },
  { href: "/pricing",      label: "Pricing"      },
]

/* ─── Profile dropdown sections (GPT audit: mirrors sidebar exactly) ─────── */
const MENU_SECTIONS = [
  {
    id: "workspace", label: "Workspace",
    items: [
      { href: "/dashboard",   icon: LayoutDashboard, label: "Dashboard"   },
      { href: "/my-agents",   icon: Bot,             label: "My Agents"   },
      { href: "/executions",  icon: History,         label: "Executions"  },
      { href: "/collections", icon: FolderOpen,      label: "Collections" },
    ],
  },
  {
    id: "build", label: "Build",
    items: [
      { href: "/builder",      icon: Cpu,     label: "Agent Studio"  },
      { href: "/pipelines",    icon: Layers,  label: "Pipelines"     },
      { href: "/swarm",        icon: Network, label: "Swarms"        },
      { href: "/integrations", icon: Link2,   label: "Integrations"  },
      { href: "/api-keys",     icon: Key,     label: "API Keys"      },
    ],
  },
  {
    id: "monetize", label: "Monetize",
    items: [
      { href: "/seller",      icon: Store,     label: "Seller Portal" },
      { href: "/analytics",   icon: BarChart3, label: "Analytics"     },
      { href: "/leaderboard", icon: Trophy,    label: "Leaderboard"   },
      { href: "/revenue",     icon: DollarSign,label: "Revenue"       },
    ],
  },
  {
    id: "account", label: "Account",
    items: [
      { href: "/billing",  icon: CreditCard, label: "Billing"  },
      { href: "/settings", icon: Settings,   label: "Settings" },
      { href: "/docs",     icon: HelpCircle, label: "Support"  },
    ],
  },
]

/* ─── Notification helpers ───────────────────────────────────────────────── */
function NotifIcon({ type }: { type: string }) {
  const base = "h-3.5 w-3.5 flex-shrink-0 mt-0.5"
  if (type === "agent_approved")   return <CheckCircle className={cn(base,"text-green-500")}  />
  if (type === "review_posted")    return <Star        className={cn(base,"text-yellow-500")} />
  if (type === "payout_sent")      return <DollarSign  className={cn(base,"text-emerald-500")}/>
  if (type === "execution_failed") return <AlertCircle className={cn(base,"text-red-500")}    />
  if (type === "quota_warning")    return <AlertCircle className={cn(base,"text-amber-500")}  />
  return <Clock className={cn(base,"text-zinc-400")} />
}

function NotificationBell({ navigate }: { navigate:(href:string)=>void }) {
  const [open, setOpen]         = useState(false)
  const panelRef                = useRef<HTMLDivElement>(null)
  const { notifications, unreadCount, markAllRead } = useNotifications(20)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  return (
    <div className="relative" ref={panelRef}>
      <Button variant="ghost" size="icon"
        className="hidden md:flex relative h-9 w-9 rounded-xl"
        onClick={() => { if (!open && unreadCount > 0) markAllRead(); setOpen(o => !o) }}
        aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 ring-1 ring-white leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity:0, y:4, scale:0.96 }}
            animate={{ opacity:1, y:0, scale:1   }}
            exit={{ opacity:0, y:4, scale:0.96   }}
            transition={{ duration:0.15 }}
            className="absolute right-0 top-full mt-2 w-80 bg-white border border-zinc-100 rounded-2xl shadow-xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50">
              <p className="text-sm font-semibold text-zinc-900">Notifications</p>
              <button onClick={() => navigate("/settings")}
                className="text-xs text-zinc-400 hover:text-primary transition-colors">
                Settings
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="text-center py-10">
                  <Bell className="h-6 w-6 text-zinc-200 mx-auto mb-2" />
                  <p className="text-sm text-zinc-400">No notifications yet</p>
                  <p className="text-xs text-zinc-300 mt-1">We'll notify you about agent activity and payouts</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-50">
                  {notifications.slice(0,12).map((n: any) => (
                    <button key={n.id}
                      onClick={() => { navigate(n.action_url || "/dashboard"); setOpen(false) }}
                      className={cn(
                        "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50",
                        !n.is_read && "bg-primary/[0.02]"
                      )}>
                      <NotifIcon type={n.type} />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs leading-relaxed", n.is_read ? "text-zinc-500" : "text-zinc-900 font-medium")}>
                          {n.title}
                        </p>
                        {n.body && <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{n.body}</p>}
                        <p className="text-[10px] text-zinc-300 mt-1">{formatRelativeTime(n.created_at)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {notifications.length > 0 && (
              <div className="border-t border-zinc-50 px-4 py-2.5">
                <button onClick={() => { navigate("/dashboard"); setOpen(false) }}
                  className="text-xs text-primary font-semibold hover:underline">
                  View all activity →
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Auth area ──────────────────────────────────────────────────────────── */
interface AuthAreaProps {
  authLoading: boolean; user: User | null; profile: any
  onSignOut: ()=>void; signingOut: boolean; navigate: (href:string)=>void
}

function AuthArea({ authLoading, user, profile, onSignOut, signingOut, navigate }: AuthAreaProps) {
  if (authLoading) return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-20 rounded-xl bg-zinc-100 animate-pulse" />
      <div className="h-8 w-24 rounded-xl bg-zinc-100 animate-pulse" />
    </div>
  )

  if (user) return (
    <>
      <Button variant="ghost" size="icon"
        className="hidden md:flex h-9 w-9 rounded-xl"
        onClick={() => navigate("/marketplace")} aria-label="Search">
        <Search className="h-4 w-4" />
      </Button>
      <NotificationBell navigate={navigate} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost"
            className="h-9 gap-2 rounded-xl px-2 focus-visible:ring-0 focus-visible:ring-offset-0">
            <Avatar className="h-7 w-7">
              <AvatarImage src={profile?.avatar_url} />
              <AvatarFallback className="text-[10px] bg-primary text-white font-bold">
                {getInitials(profile?.full_name || user.email || "U")}
              </AvatarFallback>
            </Avatar>
            <span className="hidden md:block text-sm font-semibold max-w-[110px] truncate text-zinc-900">
              {profile?.full_name?.split(" ")[0] || "Account"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 hidden md:block text-zinc-400 flex-shrink-0" />
          </Button>
        </DropdownMenuTrigger>

        {/*
          Profile dropdown — matches the screenshot exactly.
          Width: 260px. Sections: WORKSPACE / BUILD / MONETIZE / ACCOUNT.
          Scrollable (max-h) so it never overflows the viewport.
        */}
        <DropdownMenuContent
          align="end" sideOffset={8}
          className="w-[260px] rounded-2xl shadow-2xl border-zinc-100 p-1.5 max-h-[88vh] overflow-y-auto"
        >
          {/* ── User header ── */}
          <DropdownMenuLabel className="px-2 py-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-9 w-9 flex-shrink-0 ring-2 ring-zinc-100">
                <AvatarImage src={profile?.avatar_url} />
                <AvatarFallback className="text-xs font-bold bg-primary text-white">
                  {getInitials(profile?.full_name || user.email || "U")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-900 truncate text-[13px]">
                  {profile?.full_name || "User"}
                </p>
                <p className="text-[11px] font-normal text-zinc-400 truncate">{user.email}</p>
                {profile?.subscription_plan && profile.subscription_plan !== "free" && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border-0 capitalize">
                    <Crown className="h-2.5 w-2.5" />
                    {profile.subscription_plan} Builder
                  </span>
                )}
                {(!profile?.subscription_plan || profile.subscription_plan === "free") && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
                    Free plan
                  </span>
                )}
              </div>
            </div>
          </DropdownMenuLabel>

          {/* ── Grouped sections ── */}
          {MENU_SECTIONS.map(section => (
            <div key={section.id}>
              <DropdownMenuSeparator className="bg-zinc-100 my-1" />
              <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold tracking-widest uppercase text-zinc-400 select-none">
                {section.label}
              </p>
              {section.items.map(({ href, icon: Icon, label }) => (
                <DropdownMenuItem key={href} onClick={() => navigate(href)}
                  className="rounded-xl cursor-pointer px-2 py-[7px] text-[13px] text-zinc-700 hover:text-zinc-900 focus:bg-zinc-50 gap-2">
                  <Icon className="h-[15px] w-[15px] text-zinc-400 flex-shrink-0" />
                  {label}
                </DropdownMenuItem>
              ))}
            </div>
          ))}

          {/* ── Sign out ── */}
          <DropdownMenuSeparator className="bg-zinc-100 my-1" />
          <DropdownMenuItem onClick={onSignOut} disabled={signingOut}
            className="rounded-xl cursor-pointer px-2 py-[7px] text-[13px] text-red-600 hover:text-red-700 focus:bg-red-50 focus:text-red-700 gap-2">
            <LogOut className="h-[15px] w-[15px] flex-shrink-0" />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  return (
    <>
      <Link href="/login" className="hidden md:block">
        <Button variant="ghost" size="sm"
          className="rounded-xl text-sm font-medium text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100">
          Sign in
        </Button>
      </Link>
      <Link href="/signup">
        <Button size="sm"
          className="rounded-xl text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-700 shadow-sm">
          Get started
        </Button>
      </Link>
    </>
  )
}

/* ─── Main Navbar ─────────────────────────────────────────────────────────── */
export function Navbar() {
  const [scrolled,   setScrolled]   = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const pathname  = usePathname()
  const router    = useRouter()
  const { user, profile, loading: authLoading } = useUser()

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", fn, { passive: true })
    return () => window.removeEventListener("scroll", fn)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try { await fetch("/api/auth/signout", { method: "POST" }) }
    finally { router.push("/login"); router.refresh(); setSigningOut(false) }
  }

  return (
    <header className={cn(
      "fixed top-0 inset-x-0 z-50 transition-all duration-300",
      scrolled
        ? "bg-white/90 backdrop-blur-xl border-b border-black/[0.06] shadow-sm"
        : "bg-white/80 backdrop-blur-sm"
    )}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="flex items-center group flex-shrink-0">
            <Image src="/logo.png" alt="AgentDyne" width={140} height={40}
              className="h-8 w-auto object-contain transition-opacity group-hover:opacity-80"
              priority
              onError={e => {
                const t = e.target as HTMLImageElement
                t.style.display = "none"
                const fb = t.nextElementSibling as HTMLElement
                if (fb) fb.style.removeProperty("display")
              }}
            />
            <span className="text-lg font-black text-zinc-900" style={{ display:"none" }}>AgentDyne</span>
          </Link>

          {/* Desktop nav pill */}
          <nav className="hidden md:flex items-center">
            <div className="flex items-center gap-0.5 bg-black/[0.04] rounded-xl p-1">
              {NAV.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + "/")
                return (
                  <Link key={href} href={href}>
                    <span className={cn(
                      "px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 block",
                      active ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                    )}>
                      {label}
                    </span>
                  </Link>
                )
              })}
            </div>
          </nav>

          {/* Right */}
          <div className="flex items-center gap-2">
            <AuthArea
              authLoading={authLoading} user={user} profile={profile}
              onSignOut={signOut} signingOut={signingOut}
              navigate={(href) => router.push(href)}
            />
            <Button variant="ghost" size="icon"
              className="md:hidden h-9 w-9 rounded-xl"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle navigation">
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity:0, height:0 }}
            animate={{ opacity:1, height:"auto" }}
            exit={{ opacity:0, height:0 }}
            transition={{ duration:0.18 }}
            className="md:hidden border-t border-zinc-100 bg-white overflow-hidden shadow-sm"
          >
            <div className="px-4 py-4 space-y-1 max-h-[80vh] overflow-y-auto">
              {/* Public links */}
              {NAV.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <div className={cn(
                    "px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                    pathname === href
                      ? "bg-primary/8 text-primary"
                      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
                  )}>
                    {label}
                  </div>
                </Link>
              ))}

              {/* Authenticated sections */}
              {!authLoading && user && (
                <>
                  {MENU_SECTIONS.map(section => (
                    <div key={section.id}>
                      <div className="border-t border-zinc-100 my-2" />
                      <p className="px-3 py-1 text-[10px] font-bold tracking-widest uppercase text-zinc-400">
                        {section.label}
                      </p>
                      {section.items.map(({ href, icon: Icon, label }) => (
                        <Link key={href} href={href}>
                          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition-colors">
                            <Icon className="h-4 w-4 text-zinc-400" />
                            {label}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ))}
                </>
              )}

              {/* Auth actions */}
              <div className="pt-3 pb-1 border-t border-zinc-100 mt-2 flex flex-col gap-2">
                {authLoading ? (
                  <div className="h-9 rounded-xl bg-zinc-100 animate-pulse" />
                ) : user ? (
                  <Button variant="outline" onClick={signOut} disabled={signingOut}
                    className="w-full rounded-xl text-red-600 border-red-100 hover:bg-red-50">
                    <LogOut className="h-4 w-4 mr-2" />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </Button>
                ) : (
                  <>
                    <Link href="/login">
                      <Button variant="outline" className="w-full rounded-xl font-semibold">Sign in</Button>
                    </Link>
                    <Link href="/signup">
                      <Button className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                        Get started free
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
