import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DashboardClient } from "./dashboard-client";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: recentExecutions } = await supabase
    .from("executions")
    .select("*, agents(name, icon_url)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: myAgents } = await supabase
    .from("agents")
    .select("id, name, status, total_executions, average_rating, total_revenue")
    .eq("seller_id", user.id)
    .order("total_executions", { ascending: false })
    .limit(5);

  const { count: totalExecutions } = await supabase
    .from("executions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  return (
    <DashboardClient
      profile={profile}
      recentExecutions={recentExecutions || []}
      myAgents={myAgents || []}
      totalExecutions={totalExecutions || 0}
    />
  );
}
