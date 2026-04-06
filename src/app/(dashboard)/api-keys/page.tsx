export const dynamic = "force-dynamic"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ApiKeysClient } from "./api-keys-client"
export const metadata = { title: "API Keys" }
export default async function ApiKeysPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const { data: keys } = await supabase.from("api_keys").select("*").eq("user_id", user.id).order("created_at", { ascending: false })
  return <ApiKeysClient initialKeys={keys || []} />
}
