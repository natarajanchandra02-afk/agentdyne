/**
 * /marketplace/[id] — Server Component wrapper
 * Provides generateMetadata() (server-only) and exports the client page.
 * next-on-pages: export const runtime = 'edge' required for dynamic routes.
 */
import type { Metadata } from "next"

export const runtime = 'edge'

// Bug 3 FIX: never hardcode agentdyne.com.
// In production NEXT_PUBLIC_APP_URL is set in Cloudflare env vars.
// In dev it falls back to localhost.
// The try/catch means metadata still works even if the fetch fails.
function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  return "https://agentdyne.com"   // only used when env var is absent in production
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id }    = await params
  const baseUrl   = getBaseUrl()

  const base: Metadata = {
    title:       "AI Agent — AgentDyne",
    description: "Deploy this production-ready AI agent in one API call.",
  }

  try {
    const res = await fetch(
      `${baseUrl}/api/agents/${id}`,
      { next: { revalidate: 3600 } }
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
        url:      `${baseUrl}/marketplace/${id}`,
        siteName: "AgentDyne",
        type:     "website",
      },
      twitter: { card: "summary_large_image", title, description: desc },
      alternates: { canonical: `${baseUrl}/marketplace/${id}` },
    }
  } catch {
    return base
  }
}

export { default } from "./agent-detail-page"
