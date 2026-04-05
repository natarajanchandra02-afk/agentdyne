"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard, Bot, BarChart3, CreditCard, Key,
  Settings, Store, ShieldCheck, LogOut, Zap, ChevronRight,
  HelpCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { getInitials } from "@/lib/utils"

const MAIN_NAV = [
  { href: "/dashboard",  icon: LayoutDashboard, label: "Overview" },
  { href: "/my-agents",  icon: Bot,             label: "My Agents" },
  { href: "/analytics",  icon: BarChart3,        label: "Analytics" },
  { href: "/api-keys",   icon: Key,              label: "API Keys" },
]

const MONEY_NAV = [
  { href: "/billing",    icon: CreditCard,  label: "Billing & Plans" },
  { href: "/seller",     icon: Store,       label: "Seller Portal", badge: "Earn" },
]

const ADMIN_NAV = [
  { href: "/admin",      icon: ShieldCheck, label: "Admin Panel" },
]

const BOTTOM_NAV = [
  { href: "/settings",   icon: Settings,    label: "Settings" },
  { href: "/docs",       icon: HelpCircle,  label: "Docs" },
]

function NavItem({ href, icon: Icon, label, badge, pathname }: {
  href: string; icon: any; label: string; badge?: string; pathname: string
}) {
  const active = pathname === href || pathname.startsWith(href + "/")
  return (
    <Link href={href}>
      <div className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 group",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}>
        <Icon className={cn(
          "h-4 w-4 flex-shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
        )} />
        <span className="flex-1 truncate">{label}</span>
        {badge && (
          <Badge variant="success" className="text-[10px] h-4 px-1.5 font-semibold">{badge}</Badge>
        )}
        {active && <ChevronRight className="h-3 w-3 text-primary/60 flex-shrink-0" />}
      </div>
    </Link>
  )
}

export function DashboardSidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { user, profile } = useUser()
  const supabase = createClient()

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  return (
    <aside className="w-60 flex-shrink-0 border-r border-border bg-card/30 min-h-screen flex flex-col">
      {/* Logo — image only */}
      <div className="h-14 flex items-center px-4 border-b border-border flex-shrink-0">
        <Link href="/" className="inline-block">
          <Image
            src="/logo.png"
            alt="AgentDyne"
            width={130}
            height={36}
            className="h-8 w-auto object-contain"
          />
        </Link>
      </div>

      {/* New Agent CTA */}
      <div className="px-3 pt-3 pb-2">
        <Link href="/builder">
          <Button variant="brand" size="sm" className="w-full rounded-xl justify-start gap-2 font-semibold shadow-primary">
            <Zap className="h-3.5 w-3.5" />
            New Agent
          </Button>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto scrollbar-hide space-y-4">
        <div>
          <p className="section-header mb-2">Platform</p>
          <div className="space-y-0.5">
            {MAIN_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
          </div>
        </div>

        <div>
          <p className="section-header mb-2">Monetize</p>
          <div className="space-y-0.5">
            {MONEY_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
          </div>
        </div>

        {profile?.role === "admin" && (
          <div>
            <p className="section-header mb-2">Admin</p>
            <div className="space-y-0.5">
              {ADMIN_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
            </div>
          </div>
        )}

        <div>
          <p className="section-header mb-2">General</p>
          <div className="space-y-0.5">
            {BOTTOM_NAV.map(item => <NavItem key={item.href} {...item} pathname={pathname} />)}
          </div>
        </div>
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-border flex-shrink-0">
        {user && (
          <div
            className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-accent transition-colors cursor-pointer group"
            onClick={() => router.push("/settings")}
          >
            <Avatar className="h-7 w-7 flex-shrink-0">
              <AvatarImage src={profile?.avatar_url} />
              <AvatarFallback className="text-[10px]">
                {getInitials(profile?.full_name || user.email || "U")}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate text-foreground">{profile?.full_name || "User"}</p>
              <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); signOut() }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors" />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
