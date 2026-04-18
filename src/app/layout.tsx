import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { QueryProvider } from "@/components/providers/query-provider"
import { validateEnv } from "@/lib/env"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

// Validate environment at startup — logs errors without crashing
// validateEnv() is cached after first call, so it runs once per process
validateEnv()

export const metadata: Metadata = {
  title: { default: "AgentDyne — The Global Microagent Marketplace", template: "%s | AgentDyne" },
  description: "Discover, deploy, and monetize production-ready AI microagents. One API call to integrate any agent.",
  keywords: ["AI agents", "microagents", "AI marketplace", "LLM tools", "MCP agents", "Claude", "GPT-4"],
  openGraph: {
    type:        "website",
    locale:      "en_US",
    url:         "https://agentdyne.com",
    title:       "AgentDyne — The Global Microagent Marketplace",
    description: "Discover, deploy, and monetize AI microagents. Deploy in seconds with one API call.",
    siteName:    "AgentDyne",
  },
  twitter: { card: "summary_large_image", creator: "@agentdyne" },
  robots:  { index: true, follow: true },
  metadataBase: new URL("https://agentdyne.com"),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-white text-zinc-900 antialiased`}>
        <QueryProvider>
          {children}
        </QueryProvider>
      </body>
    </html>
  )
}
