"use client"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => { console.error("Global error:", error) }, [error])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-gradient-radial-brand opacity-10 pointer-events-none" />
      <div className="relative text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-3">Something went wrong</h2>
        <p className="text-muted-foreground text-sm mb-2 leading-relaxed">
          {error.message || "An unexpected error occurred. Our team has been notified."}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60 font-mono mb-6">Error ID: {error.digest}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <Button variant="brand" onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.href = "/"} className="gap-2">
            <Home className="h-4 w-4" /> Go home
          </Button>
        </div>
      </div>
    </div>
  )
}
