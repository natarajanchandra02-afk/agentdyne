"use client"
import Link from "next/link"
import { motion } from "framer-motion"
import { Home, Search, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-radial-brand opacity-20 pointer-events-none" />
      <div className="absolute inset-0 bg-grid bg-grid-light opacity-[0.03] pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative text-center max-w-lg"
      >
        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="w-24 h-24 rounded-3xl bg-gradient-brand mx-auto mb-8 flex items-center justify-center shadow-primary-lg"
        >
          <Bot className="h-12 w-12 text-white" strokeWidth={1.5} />
        </motion.div>
        <span className="text-8xl font-black gradient-text tabular-nums block mb-3">404</span>
        <h1 className="text-2xl font-bold tracking-tight mb-3">This page doesn't exist</h1>
        <p className="text-muted-foreground leading-relaxed mb-8 text-sm">
          The page you're looking for may have been moved, deleted, or never existed. Let's get you back on track.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/"><Button variant="brand" size="lg" className="gap-2 w-full sm:w-auto"><Home className="h-4 w-4" />Go home</Button></Link>
          <Link href="/marketplace"><Button variant="outline" size="lg" className="gap-2 w-full sm:w-auto"><Search className="h-4 w-4" />Browse Marketplace</Button></Link>
        </div>
        <div className="mt-8 flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <Link href="/docs"      className="hover:text-foreground transition-colors">Documentation</Link>
          <Link href="/contact"   className="hover:text-foreground transition-colors">Support</Link>
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
        </div>
      </motion.div>
    </div>
  )
}
