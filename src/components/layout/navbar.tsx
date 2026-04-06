"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, Search, Bell, Menu, X, Zap, LayoutDashboard, Store, DollarSign, LogOut, Settings, Puzzle, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { getInitials, cn } from "@/lib/utils"
import type { User as SupabaseUser } from "@supabase/supabase-js"

const NAV = [
  { href: "/marketplace",  label: "Marketplace" },
  { href: "/integrations", label: "Integrations" },
  { href: "/builder",      label: "Build" },
  { href: "/docs",         label: "Docs" },
  { href: "/pricing",      label: "Pricing" },
]

export function Navbar() {
  const [user, setUser]           = useState<SupabaseUser | null>(null)
  const [profile, setProfile]     = useState<any>(null)
  const [scrolled, setScrolled]   = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user)
      if (data.user) {
        const { data: p } = await supabase.from("profiles").select("full_name,avatar_url,subscription_plan").eq("id", data.user.id).single()
        setProfile(p)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_, s) => {
      setUser(s?.user ?? null)
      if (s?.user) {
        const { data: p } = await supabase.from("profiles").select("full_name,avatar_url,subscription_plan").eq("id", s.user.id).single()
        setProfile(p)
      } else { setProfile(null) }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", fn, { passive: true })
    return () => window.removeEventListener("scroll", fn)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const signOut = async () => { await supabase.auth.signOut(); router.push("/"); router.refresh() }

  return (
    <header className={cn(
      "fixed top-0 inset-x-0 z-50 transition-all duration-300",
      scrolled
        ? "bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-b border-black/[0.06] dark:border-white/[0.06]"
        : "bg-transparent"
    )}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/" className="flex items-center group flex-shrink-0">
            <Image
              src="/logo.png"
              alt="AgentDyne"
              width={140} height={40}
              className="h-8 w-auto object-contain transition-opacity group-hover:opacity-80"
              onError={(e) => {
                const t = e.target as HTMLImageElement
                t.style.display = "none"
                const fb = t.nextElementSibling as HTMLElement
                if (fb) fb.style.display = "flex"
              }}
            />
            <span className="hidden text-lg font-black gradient-text">AgentDyne</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center">
            <div className="flex items-center gap-0.5 bg-black/[0.04] dark:bg-white/[0.06] rounded-xl p-1">
              {NAV.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + "/")
                return (
                  <Link key={href} href={href}>
                    <span className={cn(
                      "px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 block",
                      active
                        ? "bg-white dark:bg-zinc-800 text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
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
            {user ? (
              <>
                <Button variant="ghost" size="icon"
                  className="hidden md:flex h-9 w-9 rounded-xl"
                  onClick={() => router.push("/marketplace")}>
                  <Search className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon"
                  className="hidden md:flex relative h-9 w-9 rounded-xl">
                  <Bell className="h-4 w-4" />
                  <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-primary rounded-full ring-1 ring-background" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-9 gap-2 rounded-xl px-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={profile?.avatar_url} />
                        <AvatarFallback className="text-[10px] bg-primary text-white">
                          {getInitials(profile?.full_name || user.email || "U")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden md:block text-sm font-medium max-w-[120px] truncate">
                        {profile?.full_name?.split(" ")[0] || "Account"}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 hidden md:block opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-2xl shadow-lg">
                    <DropdownMenuLabel>
                      <p className="font-semibold truncate">{profile?.full_name || "User"}</p>
                      <p className="text-xs font-normal text-muted-foreground truncate mt-0.5">{user.email}</p>
                      {profile?.subscription_plan && profile.subscription_plan !== "free" && (
                        <Badge className="mt-1.5 text-[10px] h-4 px-1.5 capitalize">{profile.subscription_plan}</Badge>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => router.push("/dashboard")}><LayoutDashboard className="h-4 w-4 mr-2.5 opacity-60" />Dashboard</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/my-agents")}><Bot className="h-4 w-4 mr-2.5 opacity-60" />My Agents</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/integrations")}><Puzzle className="h-4 w-4 mr-2.5 opacity-60" />Integrations</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/seller")}><Store className="h-4 w-4 mr-2.5 opacity-60" />Seller Portal</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/billing")}><DollarSign className="h-4 w-4 mr-2.5 opacity-60" />Billing</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/settings")}><Settings className="h-4 w-4 mr-2.5 opacity-60" />Settings</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive"><LogOut className="h-4 w-4 mr-2.5" />Sign out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Link href="/login" className="hidden md:block">
                  <Button variant="ghost" size="sm" className="rounded-xl text-sm">Sign in</Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm" className="rounded-xl text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 shadow-sm">
                    Get started
                  </Button>
                </Link>
              </>
            )}

            <Button variant="ghost" size="icon" className="md:hidden h-9 w-9 rounded-xl"
              onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
            className="md:hidden border-t border-black/[0.06] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl overflow-hidden">
            <div className="px-4 py-4 space-y-1">
              {NAV.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <div className={cn(
                    "px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                    pathname === href ? "bg-primary/8 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}>{label}</div>
                </Link>
              ))}
              <div className="pt-3 pb-1 border-t border-black/[0.06] mt-2 flex flex-col gap-2">
                {user ? (
                  <Button variant="outline" onClick={signOut} className="w-full rounded-xl">Sign out</Button>
                ) : (
                  <>
                    <Link href="/login"><Button variant="outline" className="w-full rounded-xl">Sign in</Button></Link>
                    <Link href="/signup"><Button className="w-full rounded-xl bg-foreground text-background">Get started</Button></Link>
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
