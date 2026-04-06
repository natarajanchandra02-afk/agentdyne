export const dynamic = "force-dynamic"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { MyAgentsClient } from "./my-agents-client"
export const metadata = { title: "My Agents" }
export default async function MyAgentsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const { data: agents } = await supabase.from("agents").select("*").eq("seller_id", user.id).order("created_at", { ascending: false })
  return <MyAgentsClient agents={agents || []} />
}
