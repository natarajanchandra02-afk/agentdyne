import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Agent Marketplace — AgentDyne",
  description:
    "Browse and deploy production-ready AI agents across productivity, coding, marketing, finance, legal, and more. Find the perfect agent for your workflow on AgentDyne.",
  keywords: [
    "AI agents", "agent marketplace", "AI automation", "productivity agents",
    "coding agents", "marketing AI", "finance AI", "AgentDyne",
  ],
  openGraph: {
    title: "Agent Marketplace — AgentDyne",
    description:
      "Discover production-ready AI agents for every use case. Deploy in minutes with our simple API.",
    type: "website",
    url: "https://agentdyne.com/marketplace",
    siteName: "AgentDyne",
    images: [
      {
        url: "https://agentdyne.com/og-marketplace.png",
        width: 1200,
        height: 630,
        alt: "AgentDyne Agent Marketplace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Marketplace — AgentDyne",
    description:
      "Discover production-ready AI agents for every use case. Deploy in minutes with our simple API.",
    images: ["https://agentdyne.com/og-marketplace.png"],
  },
  alternates: {
    canonical: "https://agentdyne.com/marketplace",
  },
}

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
