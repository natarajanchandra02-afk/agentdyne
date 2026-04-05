import { createClient } from "@/lib/supabase/server"
import { notFound, redirect } from "next/navigation"
import { BuilderEditorClient } from "./builder-editor-client"

export default async function BuilderEditorPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: agent } = await supabase
    .from("agents")
    .select("*")
    .eq("id", params.id)
    .eq("seller_id", user.id)
    .single()

  if (!agent) notFound()
  return <BuilderEditorClient agent={agent} />
}
