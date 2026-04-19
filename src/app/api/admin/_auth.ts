export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildRBAC } from "@/lib/rbac"
import { apiRateLimit } from "@/lib/rate-limit"

async function verifyAdmin(req: NextRequest) {
  const anonClient = await createClient()
  const { data: { user } } = await anonClient.auth.getUser()
  if (!user) return { error: "Authentication required", status: 401 as const, user: null, adminDb: null }

  const adminDb = await createAdminClient()
  const { data: profileRow } = await adminDb.from("profiles").select("role").eq("id", user.id).single()
  const rbac = buildRBAC(user.id, profileRow?.role)
  if (!rbac.isAdmin) return { error: "Admin access required", status: 403 as const, user: null, adminDb: null }

  return { error: null, status: null, user, adminDb }
}

export { verifyAdmin }
