import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "AgentDyne — The Global Microagent Marketplace", template: "%s | AgentDyne" },
  description: "Discover, deploy, and monetize AI microagents. The world's largest marketplace for production-ready AI agents.",
  keywords: ["AI agents", "microagents", "AI marketplace", "LLM tools", "agent platform", "MCP agents"],
  authors: [{ name: "AgentDyne" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://agentdyne.com",
    title: "AgentDyne — The Global Microagent Marketplace",
    description: "Discover, deploy, and monetize AI microagents.",
    siteName: "AgentDyne",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentDyne — The Global Microagent Marketplace",
    description: "Discover, deploy, and monetize AI microagents.",
    images: ["/og-image.png"],
    creator: "@agentdyne",
  },
  robots: { index: true, follow: true },
  metadataBase: new URL("https://agentdyne.com"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <QueryProvider>
            {children}
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
