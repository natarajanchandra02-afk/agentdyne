export const runtime = "edge"
import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import WebhooksClient from "./webhooks-client"

export const metadata: Metadata = {
  title: "Webhooks — AgentDyne",
  description: "Configure outbound webhooks for execution events",
}

export default async function WebhooksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: webhooks } = await supabase
    .from("webhooks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)

  return <WebhooksClient initialWebhooks={webhooks ?? []} />
}
