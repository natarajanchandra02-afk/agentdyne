-- ============================================================================
-- 040_otel_export.sql
--
-- Adds OpenTelemetry trace export so customers running AgentDyne agents
-- inside a larger stack can pipe execution traces into their own
-- Datadog/Honeycomb/Grafana/etc — not just view them in the AgentDyne
-- dashboard. Two delivery modes, both opt-in:
--
--   1. PULL — GET /api/executions/[id]/trace returns one execution as an
--      OTLP/HTTP JSON trace. No new tables needed for this; it reads the
--      existing `executions` / `governance_events` tables.
--   2. PUSH — a per-user configured OTLP collector endpoint that a batch
--      exporter (POST /api/otel/export-batch, cron-triggered) forwards
--      recent events to. This migration adds the two tables that mode needs.
--
-- ZERO impact on existing rows/behaviour: executionLogger.ts and every one
-- of its call sites are completely untouched. This migration only adds new
-- tables; it does not alter governance_events or executions.
--
-- Safe to run on production: additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS otel_export_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  endpoint_url text NOT NULL,                    -- customer's OTLP/HTTP collector, e.g. https://otel.customer.com/v1/traces
  protocol     text NOT NULL DEFAULT 'otlphttp' CHECK (protocol IN ('otlphttp')),
  headers      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- extra auth headers, e.g. {"Authorization": "Bearer ..."} — treat as secret
  secret       text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),  -- HMAC-signs every batch, same convention as `webhooks.secret`
  last_exported_at timestamptz,
  failure_count     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE otel_export_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY otel_export_config_owner_all ON otel_export_config
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY otel_export_config_service_all ON otel_export_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE otel_export_config IS
  'Opt-in per-user destination for pushed OpenTelemetry trace export. Disabled by default — no data leaves AgentDyne until a user configures and enables this.';

-- Index used by the batch exporter to find enabled configs quickly, and by
-- governance_events lookups to find "new since last export" per user.
CREATE INDEX IF NOT EXISTS idx_otel_export_config_enabled
  ON otel_export_config (user_id) WHERE enabled = true;

-- Defensive: only add if governance_events doesn't already have this index
-- (the batch exporter filters by user_id + created_at > cursor).
CREATE INDEX IF NOT EXISTS idx_governance_events_user_created
  ON governance_events (user_id, created_at DESC);
