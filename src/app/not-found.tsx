"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { Home, Search, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 relative overflow-hidden">
      {/* Subtle bg */}
      <div className="absolute inset-0 bg-hero pointer-events-none" />
      <div className="absolute inset-0 bg-grid opacity-[0.3] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative text-center max-w-md"
      >
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="w-20 h-20 rounded-3xl bg-zinc-900 mx-auto mb-8 flex items-center justify-center shadow-lg"
        >
          <Bot className="h-10 w-10 text-white" strokeWidth={1.5} />
        </motion.div>

        <p className="text-8xl font-black text-zinc-100 select-none mb-2" style={{ letterSpacing: "-4px" }}>404</p>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 mb-3">Page not found</h1>
        <p className="text-zinc-500 text-sm leading-relaxed mb-8">
          The page you're looking for may have been moved, deleted, or never existed.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button className="w-full sm:w-auto rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
              <Home className="h-4 w-4" /> Go home
            </Button>
          </Link>
          <Link href="/marketplace">
            <Button variant="outline" className="w-full sm:w-auto rounded-xl border-zinc-200 gap-2 font-semibold">
              <Search className="h-4 w-4" /> Marketplace
            </Button>
          </Link>
        </div>

        <div className="mt-8 flex items-center justify-center gap-6 text-xs text-zinc-400">
          <Link href="/docs"     className="hover:text-zinc-700 transition-colors">Docs</Link>
          <Link href="/contact"  className="hover:text-zinc-700 transition-colors">Support</Link>
          <Link href="/dashboard"className="hover:text-zinc-700 transition-colors">Dashboard</Link>
        </div>
      </motion.div>
    </div>
  )
}
