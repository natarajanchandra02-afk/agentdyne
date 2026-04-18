import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"

// Dynamic metadata — fetched from Supabase at request time
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params
  const base: Metadata = {
    title:       "AI Agent — AgentDyne",
    description: "Deploy this AI microagent in one API call on AgentDyne.",
    openGraph:   { type: "website", siteName: "AgentDyne" },
  }

  try {
    const supabase = await createClient()
    const { data: agent } = await supabase
      .from("agents")
      .select("name, description, category, average_rating, total_executions")
      .eq("id", id)
      .eq("status", "active")
      .single()

    if (!agent) return base

    const title       = `${agent.name} — AgentDyne`
    const description = agent.description ||
      `${agent.name}: a production-ready AI agent. ${agent.total_executions?.toLocaleString() ?? 0} executions, ${agent.average_rating?.toFixed(1) ?? "—"} stars.`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url:      `https://agentdyne.com/marketplace/${id}`,
        siteName: "AgentDyne",
        type:     "website",
        images:   [{ url: `https://agentdyne.com/og-agent.png`, width: 1200, height: 630 }],
      },
      twitter: {
        card:        "summary_large_image",
        title,
        description,
        images:      ["https://agentdyne.com/og-agent.png"],
      },
      alternates: { canonical: `https://agentdyne.com/marketplace/${id}` },
    }
  } catch {
    return base
  }
}

// Page component is the "use client" file — re-export from [id]/page.tsx
export { default } from "./page-client"
