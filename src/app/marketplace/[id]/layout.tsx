import type { Metadata } from "next"

/**
 * Dynamic metadata for agent detail pages.
 * Falls back gracefully if the agent can't be resolved at build time
 * (the page itself fetches client-side with Supabase).
 */
export async function generateMetadata({
  params,
}: {
  params: { id: string }
}): Promise<Metadata> {
  // We generate a canonical URL deterministically from the id.
  // Full agent details are hydrated client-side; keep metadata generic-but-useful.
  const url = `https://agentdyne.com/marketplace/${params.id}`

  return {
    title: "AI Agent — AgentDyne Marketplace",
    description:
      "Explore this production-ready AI agent on AgentDyne. Try it live in the playground, read the docs, and integrate via API in minutes.",
    openGraph: {
      title: "AI Agent — AgentDyne Marketplace",
      description:
        "Try this AI agent live on AgentDyne — playground, docs, and one-line API integration.",
      type: "website",
      url,
      siteName: "AgentDyne",
      images: [
        {
          url: "https://agentdyne.com/og-marketplace.png",
          width: 1200,
          height: 630,
          alt: "AgentDyne — AI Agent Detail",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "AI Agent — AgentDyne Marketplace",
      description:
        "Try this AI agent live on AgentDyne — playground, docs, and one-line API integration.",
      images: ["https://agentdyne.com/og-marketplace.png"],
    },
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}

export default function AgentDetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
