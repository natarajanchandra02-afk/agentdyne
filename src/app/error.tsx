"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Error:", error) }, [error])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="h-8 w-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-2">Something went wrong</h2>
        <p className="text-zinc-500 text-sm mb-2 leading-relaxed">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest && (
          <p className="text-xs text-zinc-300 font-mono mb-6">ID: {error.digest}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <Button onClick={reset}
            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.href = "/"}
            className="rounded-xl border-zinc-200 gap-2 font-semibold">
            <Home className="h-4 w-4" /> Go home
          </Button>
        </div>
      </div>
    </div>
  )
}
