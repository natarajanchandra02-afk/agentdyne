"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { Toaster } from "react-hot-toast"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000, retry: 1 } },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Single Toaster instance for the entire app — consistent white design */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "#ffffff",
            color:       "#18181b",
            border:      "1px solid #f4f4f5",
            borderRadius: "12px",
            boxShadow:   "0 4px 16px rgba(0,0,0,0.08)",
            fontSize:    "13px",
            fontWeight:  "500",
            padding:     "10px 14px",
          },
          success: {
            iconTheme: { primary: "#22c55e", secondary: "#ffffff" },
          },
          error: {
            iconTheme: { primary: "#ef4444", secondary: "#ffffff" },
          },
        }}
      />
    </QueryClientProvider>
  )
}
