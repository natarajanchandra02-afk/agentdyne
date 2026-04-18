/**
 * /marketplace/[id] — Server Component wrapper
 * Provides generateMetadata() (server-only) and exports the client page.
 * next-on-pages: export const runtime = 'edge' required for dynamic routes.
 */
import type { Metadata } from "next"

export const runtime = 'edge'

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params

  const base: Metadata = {
    title:       "AI Agent — AgentDyne",
    description: "Deploy this production-ready AI agent in one API call.",
  }

  try {
    // Fetch via public API endpoint — works on edge without service role key
    const res = await fetch(
      `https://agentdyne.com/api/agents/${id}`,
      { next: { revalidate: 3600 } }  // cache 1h
    )
    if (!res.ok) return base
    const agent = await res.json()

    if (!agent?.name) return base

    const title = `${agent.name} — AgentDyne`
    const desc  = agent.description ||
      `${agent.name}: AI microagent with ${(agent.total_executions || 0).toLocaleString()} executions.`

    return {
      title,
      description: desc,
      openGraph: {
        title, description: desc,
        url:      `https://agentdyne.com/marketplace/${id}`,
        siteName: "AgentDyne",
        type:     "website",
      },
      twitter: { card: "summary_large_image", title, description: desc },
      alternates: { canonical: `https://agentdyne.com/marketplace/${id}` },
    }
  } catch {
    return base
  }
}

// Delegate rendering to the "use client" page component
export { default } from "./agent-detail-page"
