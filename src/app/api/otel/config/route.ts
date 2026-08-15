export const runtime = "edge"

/**
 * GET/PATCH /api/otel/config — owner-managed OpenTelemetry push-export destination
 *
 * Off by default. A user must explicitly set an endpoint URL and enable=true
 * before any data is pushed anywhere. See migration 040 for the underlying
 * table. The batch exporter (POST /api/otel/export-batch) only ever reads
 * configs where enabled=true.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const { data } = await supabase
    .from("otel_export_config")
    .select("enabled, endpoint_url, protocol, last_exported_at, failure_count")
    .eq("user_id", user.id)
    .maybeSingle()

  return NextResponse.json(data ?? { enabled: false, endpoint_url: null, protocol: "otlphttp", last_exported_at: null, failure_count: 0 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  let body: { enabled?: boolean; endpointUrl?: string; headers?: Record<string, string> }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (body.enabled === true) {
    if (!body.endpointUrl || !/^https:\/\//.test(body.endpointUrl)) {
      return NextResponse.json({ error: "endpointUrl must be a valid https:// URL before enabling export" }, { status: 422 })
    }
  }

  const update: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() }
  if (typeof body.enabled === "boolean") update.enabled = body.enabled
  if (body.endpointUrl) update.endpoint_url = body.endpointUrl
  if (body.headers) update.headers = body.headers

  const { error } = await supabase.from("otel_export_config").upsert(update, { onConflict: "user_id" })
  if (error) return NextResponse.json({ error: "Failed to save export config" }, { status: 500 })

  return NextResponse.json({ ok: true })
}
