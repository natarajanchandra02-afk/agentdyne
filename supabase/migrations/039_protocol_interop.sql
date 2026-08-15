-- ============================================================================
-- 039_protocol_interop.sql
--
-- Adds MCP-server-hosting and A2A (Agent-to-Agent) protocol support so
-- published AgentDyne agents are discoverable and callable by external
-- MCP clients and A2A-compliant orchestrators — not just via AgentDyne's
-- own REST API / embed widget.
--
-- Design goals:
--   1. ZERO impact on existing rows/behaviour. Every new column defaults to
--      false/empty, so no currently-published agent changes behavior.
--   2. Opt-in per agent. An owner must explicitly flip mcp_enabled /
--      a2a_enabled — nothing is exposed externally by default.
--   3. All execution still flows through the existing, hardened
--      /api/agents/[id]/execute path (guardrails, injection filter,
--      credit reservation, quotas, WAL). This migration adds *discovery
--      and task-lifecycle bookkeeping* tables only — no billing or
--      execution logic duplicated at the DB layer.
--   4. Abuse surface: every protocol call is logged to protocol_access_log
--      for the existing governance dashboard (/api/governance) to surface
--      alongside injection_attempts and audit_logs.
--
-- Safe to run on production: additive ALTER TABLE + new tables only.
-- ============================================================================

-- ── agents: opt-in protocol exposure flags ──────────────────────────────────

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS mcp_enabled        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS a2a_enabled        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS protocol_metadata  jsonb       NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN agents.mcp_enabled IS
  'Owner opt-in: when true AND status=active, this agent is listed in /api/mcp tools/list and callable via tools/call.';
COMMENT ON COLUMN agents.a2a_enabled IS
  'Owner opt-in: when true AND status=active, this agent publishes an A2A Agent Card at /api/a2a/{id}/card and accepts A2A tasks.';
COMMENT ON COLUMN agents.protocol_metadata IS
  'Optional A2A/MCP presentation metadata: { skills: [{id,name,description,tags,examples}], inputModes: [...], outputModes: [...] }. Falls back to name/description/category when empty.';

-- Partial indexes — only index the (small) set of agents actually opted in,
-- so this costs nothing on the 99%+ of agents that never enable it.
CREATE INDEX IF NOT EXISTS idx_agents_mcp_enabled
  ON agents (id) WHERE mcp_enabled = true AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_agents_a2a_enabled
  ON agents (id) WHERE a2a_enabled = true AND status = 'active';

-- ── a2a_tasks: A2A task lifecycle (submitted → working → completed/failed) ──

CREATE TABLE IF NOT EXISTS a2a_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id    uuid NOT NULL DEFAULT gen_random_uuid(),  -- A2A "contextId" groups related tasks
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,  -- agent owner (for RLS)
  caller_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,          -- which API key called us
  state         text NOT NULL DEFAULT 'submitted'
                  CHECK (state IN ('submitted','working','input-required','completed','canceled','failed')),
  input_message jsonb NOT NULL DEFAULT '{}'::jsonb,
  output        jsonb,
  error_message text,
  execution_id  uuid REFERENCES executions(id) ON DELETE SET NULL,  -- links back to the underlying billed execution
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_agent   ON a2a_tasks (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_owner    ON a2a_tasks (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_context  ON a2a_tasks (context_id);

ALTER TABLE a2a_tasks ENABLE ROW LEVEL SECURITY;

-- Owners can see tasks against their own agents (mirrors executions RLS pattern)
CREATE POLICY a2a_tasks_owner_select ON a2a_tasks
  FOR SELECT USING (owner_id = auth.uid());

-- No direct client INSERT/UPDATE — all writes go through the service-role
-- backed API routes (same pattern as `executions`, `execution_wal`, etc.)
CREATE POLICY a2a_tasks_service_all ON a2a_tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── protocol_access_log: abuse monitoring, feeds the governance dashboard ──

CREATE TABLE IF NOT EXISTS protocol_access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol     text NOT NULL CHECK (protocol IN ('mcp','a2a')),
  action       text NOT NULL,                 -- 'tools/list' | 'tools/call' | 'card_fetch' | 'task_create' | 'task_get'
  agent_id     uuid REFERENCES agents(id) ON DELETE SET NULL,
  api_key_id   uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  caller_ip    text,
  outcome      text NOT NULL DEFAULT 'ok',    -- 'ok' | 'denied' | 'error' | 'rate_limited'
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_protocol_access_log_created ON protocol_access_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_protocol_access_log_agent   ON protocol_access_log (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_protocol_access_log_outcome ON protocol_access_log (outcome) WHERE outcome != 'ok';

ALTER TABLE protocol_access_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read (same permission gate as injection_attempts / audit_logs
-- via requirePermission(rbac, "view_audit_logs") in /api/governance)
CREATE POLICY protocol_access_log_service_all ON protocol_access_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── pg_cron cleanup — mirrors the existing 30-day retention pattern used
--    for webhook_deliveries / execution_traces (see migration 012/030) ─────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup_protocol_access_log',
      '0 4 * * *',  -- daily at 4am, matches existing cleanup job cadence
      $cron$ DELETE FROM protocol_access_log WHERE created_at < now() - interval '30 days' $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron.schedule signature varies by Supabase project version; don't
  -- fail the migration if scheduling isn't available — cleanup can be
  -- added manually via the Supabase dashboard cron UI if this no-ops.
  NULL;
END $$;
