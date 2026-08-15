export const runtime = "edge"

/**
 * POST /api/otel/export-batch — cron-triggered push exporter
 *
 * NOT a public endpoint — protected by a shared secret (OTEL_EXPORT_CRON_SECRET)
 * checked against the X-Cron-Secret header. Intended to be invoked on a
 * schedule via Supabase pg_cron + pg_net (see the SQL block at the bottom
 * of this file's comment), or any external scheduler your ops team prefers.
 *
 * For every user with an enabled otel_export_config, batches their
 * governance_events since last_exported_at into one OTLP trace payload
 * (one span per event) and HMAC-signs + POSTs it to their configured
 * collector — same signing convention as lib/webhook-dispatcher.ts.
 *
 * Failure handling: per-user try/catch, so one customer's unreachable
 * collector never blocks another's export. failure_count increments on
 * failure; three consecutive failures auto-disables that user's export
 * (mirrors the existing webhook auto-disable pattern) so a permanently
 * broken endpoint doesn't retry forever on every cron tick.
 *
 * ── To enable the schedule (run once against your Supabase project) ────────
 *   select cron.schedule(
 *     'otel_export_batch',
 *     '*\/5 * * * *',  -- every 5 minutes
 *     $$
 *       select net.http_post(
 *         url := '<your-deployed-origin>/api/otel/export-batch',
 *         headers := jsonb_build_object('X-Cron-Secret', '<OTEL_EXPORT_CRON_SECRET value>'),
 *         body := '{}'::jsonb
 *       );
 *     $$
 *   );
 * Requires the pg_net extension (same one used by any existing webhook
 * dispatch cron, if you have one) — enable via Database → Extensions.
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hmacSignBatch, deliverOtlpBatch } from "@/lib/otel-export"

const MAX_EVENTS_PER_USER_PER_RUN = 500
const AUTO_DISABLE_AFTER_FAILURES = 3

function eventToSpan(ev: any) {
  // BigInt(x) function form, not the `123n` literal — see otel-export.ts's
  // toNanos() comment for why (pre-existing tsconfig target, not touched here).
  const startNs = String(BigInt(new Date(ev.created_at).getTime()) * BigInt(1_000_000))
  return {
    traceId: ev.id.replace(/-/g, "").padEnd(32, "0").slice(0, 32),
    spanId: ev.id.replace(/-/g, "").slice(0, 16),
    name: `agentdyne.${ev.event_type}`,
    kind: 1,
    startTimeUnixNano: startNs,
    endTimeUnixNano: startNs,
    attributes: Object.entries({
      "agentdyne.event_type": ev.event_type,
      "agentdyne.severity": ev.severity,
      "agentdyne.resource": ev.resource,
      "agentdyne.resource_id": ev.resource_id,
      ...(ev.details ?? {}),
    })
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([key, v]) => ({
        key,
        value: typeof v === "number"
          ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v })
          : { stringValue: String(v) },
      })),
    status: ev.severity === "critical" || ev.severity === "warning" ? { code: 2 } : { code: 1 },
  }
}

export async function POST(req: NextRequest) {
  const expected = process.env.OTEL_EXPORT_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "OTEL_EXPORT_CRON_SECRET not configured — push export is disabled" }, { status: 503 })
  }
  if (req.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: configs } = await admin
    .from("otel_export_config")
    .select("id, user_id, endpoint_url, headers, secret, last_exported_at, failure_count")
    .eq("enabled", true)

  const results: Array<{ userId: string; ok: boolean; sent: number; error?: string }> = []

  for (const cfg of configs ?? []) {
    try {
      const since = cfg.last_exported_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: events } = await admin
        .from("governance_events")
        .select("id, event_type, severity, resource, resource_id, details, created_at")
        .eq("user_id", cfg.user_id)
        .gt("created_at", since)
        .order("created_at", { ascending: true })
        .limit(MAX_EVENTS_PER_USER_PER_RUN)

      if (!events || events.length === 0) {
        results.push({ userId: cfg.user_id, ok: true, sent: 0 })
        continue
      }

      const payload = {
        resourceSpans: [{
          resource: { attributes: [{ key: "service.name", value: { stringValue: "agentdyne" } }] },
          scopeSpans: [{ scope: { name: "agentdyne.governance_events", version: "2.3.0" }, spans: events.map(eventToSpan) }],
        }],
      }

      const delivery = await deliverOtlpBatch(cfg.endpoint_url, cfg.headers ?? {}, cfg.secret, payload)

      if (delivery.ok) {
        await admin.from("otel_export_config").update({
          last_exported_at: events[events.length - 1].created_at,
          failure_count: 0,
        }).eq("id", cfg.id)
        results.push({ userId: cfg.user_id, ok: true, sent: events.length })
      } else {
        const nextFailureCount = (cfg.failure_count ?? 0) + 1
        await admin.from("otel_export_config").update({
          failure_count: nextFailureCount,
          enabled: nextFailureCount >= AUTO_DISABLE_AFTER_FAILURES ? false : true,
        }).eq("id", cfg.id)
        results.push({ userId: cfg.user_id, ok: false, sent: 0, error: delivery.error ?? `HTTP ${delivery.status}` })
      }
    } catch (err: any) {
      results.push({ userId: cfg.user_id, ok: false, sent: 0, error: err.message })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
