"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard, Bot, BarChart3, CreditCard, Key,
  Settings, Store, ShieldCheck, LogOut, Zap, ChevronRight,
  HelpCircle, Trophy, Layers, GitMerge,
} from "lucide-react"
import { cn, getInitials } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useUser } from "@/hooks/use-user"

const MAIN_NAV = [
  { href: "/dashboard",   icon: LayoutDashboard, label: "Overview" },
  { href: "/my-agents",   icon: Bot,             label: "My Agents" },
  { href: "/analytics",   icon: BarChart3,        label: "Analytics" },
  { href: "/api-keys",    icon: Key,              label: "API Keys" },
  { href: "/leaderboard", icon: Trophy,    label: "Leaderboard" },
  { href: "/pipelines",   icon: GitMerge, label: "Pipelines"   },
]

const MONEY_NAV = [
  { href: "/billing", icon: CreditCard, label: "Billing & Plans" },
  { href: "/seller",  icon: Store,      label: "Seller Portal", badge: "Earn" },
]

const ADMIN_NAV = [
  { href: "/admin", icon: ShieldCheck, label: "Admin Panel" },
]

const BOTTOM_NAV = [
  { href: "/settings", icon: Settings,   label: "Settings" },
  { href: "/docs",     icon: HelpCircle, label: "Docs" },
]

function NavItem({
  href, icon: Icon, label, badge, pathname,
}: {
  href: string; icon: any; label: string; badge?: string; pathname: string
}) {
  const active = pathname === href || pathname.startsWith(href + "/")
  return (
    <Link href={href}>
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
  const { user, profile } = useUser()
  const [signingOut, setSigningOut] = useState(false)

  /**
   * Server-side sign-out — same pattern as Navbar.
   * Clears httpOnly cookies server-side so middleware stops seeing the session.
   */
  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch("/api/auth/signout", { method: "POST" })
    } finally {
      router.push("/login")
      router.refresh()
      setSigningOut(false)
    }
  }

  return (
    <aside className="w-60 flex-shrink-0 border-r border-zinc-100 bg-white min-h-screen flex flex-col">

      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-zinc-100 flex-shrink-0">
        <Link href="/">
          <Image
            src="/logo.png"
            alt="AgentDyne"
            width={120}
            height={32}
            className="h-7 w-auto object-contain"
          />
        </Link>
      </div>

      {/* New Agent CTA */}
      <div className="px-3 pt-3 pb-2">
        <Link href="/builder">
          <Button size="sm"
            className="w-full rounded-xl justify-start gap-2 font-semibold bg-primary hover:bg-primary/90 text-white shadow-sm">
            <Zap className="h-3.5 w-3.5" />
            New Agent
          </Button>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-5">
        <div>
          <p className="section-header px-3 mb-2">Platform</p>
          <div className="space-y-0.5">
            {MAIN_NAV.map(item => (
              <NavItem key={item.href} {...item} pathname={pathname} />
            ))}
          </div>
        </div>

        <div>
          <p className="section-header px-3 mb-2">Monetize</p>
          <div className="space-y-0.5">
            {MONEY_NAV.map(item => (
              <NavItem key={item.href} {...item} pathname={pathname} />
            ))}
          </div>
        </div>

        {profile?.role === "admin" && (
          <div>
            <p className="section-header px-3 mb-2">Admin</p>
            <div className="space-y-0.5">
              {ADMIN_NAV.map(item => (
                <NavItem key={item.href} {...item} pathname={pathname} />
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="section-header px-3 mb-2">General</p>
          <div className="space-y-0.5">
            {BOTTOM_NAV.map(item => (
              <NavItem key={item.href} {...item} pathname={pathname} />
            ))}
          </div>
        </div>
      </nav>

      {/* User card */}
      <div className="p-3 border-t border-zinc-100 flex-shrink-0">
        {user && (
          <div className="group relative">
            <div
              className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-zinc-50 transition-colors cursor-pointer"
              onClick={() => router.push("/settings")}
              role="button"
              tabIndex={0}
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
              <button
                onClick={e => { e.stopPropagation(); signOut() }}
                disabled={signingOut}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-red-50"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500 transition-colors" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
