"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ChevronDown, Search, Bell, Menu, X, Zap,
  LayoutDashboard, Store, DollarSign, LogOut, Settings,
  Puzzle, Bot, Trophy, Key, BarChart3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { useUser } from "@/hooks/use-user"
import { getInitials, cn } from "@/lib/utils"

const NAV = [
  { href: "/marketplace",  label: "Marketplace" },
  { href: "/integrations", label: "Integrations" },
  { href: "/builder",      label: "Build" },
  { href: "/docs",         label: "Docs" },
  { href: "/pricing",      label: "Pricing" },
]

const USER_MENU = [
  { href: "/dashboard",  icon: LayoutDashboard, label: "Dashboard" },
  { href: "/my-agents",  icon: Bot,             label: "My Agents" },
  { href: "/analytics",  icon: BarChart3,        label: "Analytics" },
  { href: "/api-keys",   icon: Key,              label: "API Keys" },
  { href: "/leaderboard",icon: Trophy,            label: "Leaderboard" },
  { href: "/integrations",icon: Puzzle,           label: "Integrations" },
  { href: "/seller",     icon: Store,             label: "Seller Portal" },
  { href: "/billing",    icon: DollarSign,        label: "Billing" },
  { href: "/settings",   icon: Settings,          label: "Settings" },
]

export function Navbar() {
  const [scrolled,    setScrolled]    = useState(false)
  const [mobileOpen,  setMobileOpen]  = useState(false)
  const [signingOut,  setSigningOut]  = useState(false)
  const pathname  = usePathname()
  const router    = useRouter()
  const { user, profile } = useUser()

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", fn, { passive: true })
    return () => window.removeEventListener("scroll", fn)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  /**
   * Server-side sign-out via POST /api/auth/signout.
   *
   * Why not just supabase.auth.signOut() on the client?
   * Client-only signOut clears local storage but the middleware still sees the
   * HTTP-only cookie and re-validates the session — user stays "logged in" on
   * the server. The API route clears the cookie server-side with correct
   * attributes (httpOnly, SameSite, Secure) and revokes the Supabase session.
   */
  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch("/api/auth/signout", { method: "POST" })
    } finally {
      // Navigate away regardless of server response
      // router.push causes a hard navigation that clears all client-side state
      router.push("/login")
      router.refresh()
      setSigningOut(false)
    }
  }

  const navigate = (href: string) => {
    router.push(href)
  }

  return (
    <header className={cn(
      "fixed top-0 inset-x-0 z-50 transition-all duration-300",
      scrolled
        ? "bg-white/90 backdrop-blur-xl border-b border-black/[0.06] shadow-sm"
        : "bg-transparent"
    )}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="flex items-center group flex-shrink-0">
            <Image
              src="/logo.png"
              alt="AgentDyne"
              width={140}
              height={40}
              className="h-8 w-auto object-contain transition-opacity group-hover:opacity-80"
              priority
              onError={e => {
                const t = e.target as HTMLImageElement
                t.style.display = "none"
                const fb = t.nextElementSibling as HTMLElement
                if (fb) fb.style.display = "flex"
              }}
            />
            <span className="hidden text-lg font-black text-zinc-900">AgentDyne</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center">
            <div className="flex items-center gap-0.5 bg-black/[0.04] rounded-xl p-1">
              {NAV.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + "/")
                return (
                  <Link key={href} href={href}>
                    <span className={cn(
                      "px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 block",
                      active
                        ? "bg-white text-zinc-900 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-900"
                    )}>
                      {label}
                    </span>
                  </Link>
                )
              })}
            </div>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {/* Search */}
                <Button variant="ghost" size="icon"
                  className="hidden md:flex h-9 w-9 rounded-xl"
                  onClick={() => navigate("/marketplace")}>
                  <Search className="h-4 w-4" />
                </Button>

                {/* Notifications */}
                <Button variant="ghost" size="icon"
                  className="hidden md:flex relative h-9 w-9 rounded-xl"
                  onClick={() => navigate("/dashboard")}>
                  <Bell className="h-4 w-4" />
                  <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-primary rounded-full ring-1 ring-white" />
                </Button>

                {/* User dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-9 gap-2 rounded-xl px-2 focus-visible:ring-0">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={profile?.avatar_url} />
                        <AvatarFallback className="text-[10px] bg-primary text-white">
                          {getInitials(profile?.full_name || user.email || "U")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden md:block text-sm font-medium max-w-[120px] truncate text-zinc-900">
                        {profile?.full_name?.split(" ")[0] || "Account"}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 hidden md:block text-zinc-400" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="end" className="w-56 rounded-2xl shadow-xl border-zinc-100 p-1.5" sideOffset={8}>
                    {/* User info */}
                    <DropdownMenuLabel className="px-2 py-2">
                      <p className="font-semibold text-zinc-900 truncate">
                        {profile?.full_name || "User"}
                      </p>
                      <p className="text-xs font-normal text-zinc-400 truncate mt-0.5">
                        {user.email}
                      </p>
                      {profile?.subscription_plan && profile.subscription_plan !== "free" && (
                        <Badge className="mt-1.5 text-[10px] h-4 px-1.5 capitalize bg-primary/10 text-primary border-0">
                          {profile.subscription_plan}
                        </Badge>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-zinc-100" />

                    {/* Navigation items */}
                    {USER_MENU.map(({ href, icon: Icon, label }) => (
                      <DropdownMenuItem
                        key={href}
                        onClick={() => navigate(href)}
                        className="rounded-xl cursor-pointer px-2 py-2 text-sm text-zinc-700 hover:text-zinc-900 focus:bg-zinc-50"
                      >
                        <Icon className="h-4 w-4 mr-2.5 text-zinc-400" />
                        {label}
                      </DropdownMenuItem>
                    ))}

                    <DropdownMenuSeparator className="bg-zinc-100" />

                    {/* Sign out */}
                    <DropdownMenuItem
                      onClick={signOut}
                      disabled={signingOut}
                      className="rounded-xl cursor-pointer px-2 py-2 text-sm text-red-600 hover:text-red-700 focus:bg-red-50 focus:text-red-700"
                    >
                      <LogOut className="h-4 w-4 mr-2.5" />
                      {signingOut ? "Signing out…" : "Sign out"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Link href="/login" className="hidden md:block">
                  <Button variant="ghost" size="sm" className="rounded-xl text-sm text-zinc-600">
                    Sign in
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm" className="rounded-xl text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-700 shadow-sm">
                    Get started
                  </Button>
                </Link>
              </>
            )}

            {/* Mobile hamburger */}
            <Button
              variant="ghost" size="icon"
              className="md:hidden h-9 w-9 rounded-xl"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle navigation menu"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="md:hidden border-t border-zinc-100 bg-white/95 backdrop-blur-xl overflow-hidden"
          >
            <div className="px-4 py-4 space-y-1">
              {NAV.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <div className={cn(
                    "px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                    pathname === href
                      ? "bg-primary/8 text-primary"
                      : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                  )}>
                    {label}
                  </div>
                </Link>
              ))}

              {user && (
                <>
                  <div className="border-t border-zinc-100 my-2" />
                  {USER_MENU.map(({ href, icon: Icon, label }) => (
                    <Link key={href} href={href}>
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 transition-colors">
                        <Icon className="h-4 w-4" />
                        {label}
                      </div>
                    </Link>
                  ))}
                </>
              )}

              <div className="pt-3 pb-1 border-t border-zinc-100 mt-2 flex flex-col gap-2">
                {user ? (
                  <Button
                    variant="outline"
                    onClick={signOut}
                    disabled={signingOut}
                    className="w-full rounded-xl text-red-600 border-red-100 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </Button>
                ) : (
                  <>
                    <Link href="/login">
                      <Button variant="outline" className="w-full rounded-xl">Sign in</Button>
                    </Link>
                    <Link href="/signup">
                      <Button className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700">
                        Get started
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
