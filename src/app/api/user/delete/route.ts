export const runtime = 'edge'

import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"

/**
 * DELETE /api/user/delete
 *
 * Permanently deletes the authenticated user's account.
 * Sequence:
 *   1. Verify auth
 *   2. Cancel active agent subscriptions
 *   3. Deactivate API keys
 *   4. Archive (not delete) seller agents — preserves transaction history
 *   5. Delete auth user via admin client (cascades to profiles via FK)
 *
 * Caller should POST /api/auth/signout and hard-redirect after this succeeds.
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = user.id

    // 1. Cancel active agent subscriptions
    await supabase
      .from("agent_subscriptions")
      .update({ status: "canceled" })
      .eq("user_id", userId)
      .eq("status", "active")

    // 2. Deactivate all API keys (so they stop working immediately)
    await supabase
      .from("api_keys")
      .update({ is_active: false })
      .eq("user_id", userId)

    // 3. Archive seller's agents (preserve transaction history; don't hard-delete)
    await supabase
      .from("agents")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("seller_id", userId)
      .neq("status", "archived")

    // 4. Delete the auth user — admin client bypasses RLS
    //    This cascades to public.profiles via ON DELETE CASCADE
    const admin = await createAdminClient()
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId)
    if (deleteErr) {
      console.error("DELETE /api/user/delete admin.deleteUser:", deleteErr)
      return NextResponse.json({ error: deleteErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("DELETE /api/user/delete:", err)
    return NextResponse.json({ error: err.message || "Deletion failed" }, { status: 500 })
  }
}
