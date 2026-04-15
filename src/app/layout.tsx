import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { QueryProvider } from "@/components/providers/query-provider"
// NOTE: Toaster from shadcn/ui is NOT used here — all toast calls use react-hot-toast.
// react-hot-toast's <Toaster> is rendered inside QueryProvider to avoid duplication.
// Importing both would create two toast containers and duplicate notifications.

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "AgentDyne — The Global Microagent Marketplace", template: "%s | AgentDyne" },
  description: "Discover, deploy, and monetize AI microagents.",
  keywords: ["AI agents", "microagents", "AI marketplace", "LLM tools", "MCP agents"],
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
    // No suppressHydrationWarning + no dark class = always white
    // darkMode: 'class' in tailwind.config.ts means dark: variants never activate
    <html lang="en">
      <body className={`${inter.variable} font-sans bg-white text-zinc-900 antialiased`}>
        <QueryProvider>
          {children}
        </QueryProvider>
      </body>
    </html>
  )
}
