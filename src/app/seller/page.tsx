import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { SellerClient } from "./seller-client"
export const metadata = { title: "Seller Portal" }

export default async function SellerPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  const { data: agents } = await supabase
    .from("agents").select("*").eq("seller_id", user.id).order("created_at", { ascending: false })

  const { data: payouts } = await supabase
    .from("payouts").select("*").eq("seller_id", user.id).order("created_at", { ascending: false }).limit(10)

  const { data: recentTx } = await supabase
    .from("transactions").select("*").eq("seller_id", user.id).order("created_at", { ascending: false }).limit(20)

  return <SellerClient profile={profile} agents={agents || []} payouts={payouts || []} transactions={recentTx || []} />
}
