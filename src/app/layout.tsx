import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: { default: "AgentDyne — The Global Microagent Marketplace", template: "%s | AgentDyne" },
  description: "Discover, deploy, and monetize AI microagents. The world's largest marketplace for production-ready AI agents.",
  keywords: ["AI agents", "microagents", "AI marketplace", "LLM tools", "agent platform", "MCP agents"],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://agentdyne.com",
    title: "AgentDyne — The Global Microagent Marketplace",
    description: "Discover, deploy, and monetize AI microagents.",
    siteName: "AgentDyne",
  },
  twitter: { card: "summary_large_image", creator: "@agentdyne" },
  robots: { index: true, follow: true },
  metadataBase: new URL("https://agentdyne.com"),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        {/* defaultTheme="light" = Apple white by default */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <QueryProvider>
            {children}
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
