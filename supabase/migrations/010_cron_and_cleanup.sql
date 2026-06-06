-- =============================================================================
-- AgentDyne — Migration 010: pg_cron Jobs + Operational Maintenance
--
-- Requires the pg_cron extension, which is enabled in Supabase by default.
-- All jobs run in the agentdyne service role context (SECURITY DEFINER).
--
-- Jobs created:
--   1. monthly_quota_reset     — midnight on 1st of every month
--   2. cleanup_expired_memory  — every hour
--   3. cleanup_old_injection_attempts — every Sunday at 03:00
--   4. aggregate_agent_analytics — every day at 01:00
--   5. execution_quota_warning_notifications — every 6 hours
--
-- Run this ONCE in Supabase SQL Editor after migration 009.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. ENSURE pg_cron IS ENABLED
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- 1. HELPER FUNCTIONS (idempotent — CREATE OR REPLACE)
-- ---------------------------------------------------------------------------

-- Resets monthly execution quota for all active users at start of month
CREATE OR REPLACE FUNCTION reset_monthly_execution_quotas()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE profiles
  SET
    executions_used_this_month  = 0,
    quota_reset_date             = DATE_TRUNC('month', NOW()) + INTERVAL '1 month',
    updated_at                   = NOW()
  WHERE
    -- Only reset users who haven't been reset this month
    (quota_reset_date IS NULL OR quota_reset_date < NOW());

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_monthly_execution_quotas() TO service_role;

-- ---------------------------------------------------------------------------

-- Cleans up expired agent memory entries (TTL enforcement)
CREATE OR REPLACE FUNCTION cleanup_expired_memory()
RETURNS INTEGER
LANGUAGE SQL SECURITY DEFINER
AS $$
  WITH deleted AS (
    DELETE FROM agent_memory
    WHERE ttl_at IS NOT NULL AND ttl_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_memory() TO service_role;

-- ---------------------------------------------------------------------------

-- Purges injection attempts older than 90 days (keep recent for analysis)
CREATE OR REPLACE FUNCTION cleanup_old_injection_attempts()
RETURNS INTEGER
LANGUAGE SQL SECURITY DEFINER
AS $$
  WITH deleted AS (
    DELETE FROM injection_attempts
    WHERE created_at < NOW() - INTERVAL '90 days'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION cleanup_old_injection_attempts() TO service_role;

-- ---------------------------------------------------------------------------

-- Aggregates daily agent analytics from raw executions
-- Inserts/upserts one row per (agent_id, date) with revenue + execution counts
CREATE OR REPLACE FUNCTION aggregate_agent_analytics_yesterday()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  target_date DATE := (CURRENT_DATE - INTERVAL '1 day')::DATE;
  inserted_count INTEGER;
BEGIN
  -- Upsert analytics for yesterday's executions
  INSERT INTO agent_analytics (agent_id, date, executions, revenue, avg_latency_ms, success_rate, updated_at)
  SELECT
    e.agent_id,
    target_date,
    COUNT(*)::INTEGER                                                 AS executions,
    COALESCE(SUM(e.cost_usd) * 0.8, 0)                              AS revenue,
    COALESCE(AVG(e.latency_ms), 0)::INTEGER                          AS avg_latency_ms,
    (COUNT(*) FILTER (WHERE e.status = 'success')::FLOAT / NULLIF(COUNT(*), 0))
                                                                      AS success_rate,
    NOW()
  FROM executions e
  WHERE
    e.created_at >= target_date
    AND e.created_at < target_date + INTERVAL '1 day'
    AND e.agent_id IS NOT NULL
  GROUP BY e.agent_id
  ON CONFLICT (agent_id, date)
  DO UPDATE SET
    executions     = EXCLUDED.executions,
    revenue        = EXCLUDED.revenue,
    avg_latency_ms = EXCLUDED.avg_latency_ms,
    success_rate   = EXCLUDED.success_rate,
    updated_at     = NOW();

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  -- Also update lifetime stats on agents table
  UPDATE agents a
  SET
    total_executions     = (SELECT COUNT(*) FROM executions e WHERE e.agent_id = a.id AND e.status = 'success'),
    total_revenue        = (SELECT COALESCE(SUM(cost_usd) * 0.8, 0) FROM executions e WHERE e.agent_id = a.id),
    average_latency_ms   = (SELECT COALESCE(AVG(latency_ms), 0)::INTEGER FROM executions e WHERE e.agent_id = a.id AND e.status = 'success'),
    updated_at           = NOW()
  WHERE a.id IN (
    SELECT DISTINCT agent_id FROM executions
    WHERE created_at >= target_date AND created_at < target_date + INTERVAL '1 day'
  );

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION aggregate_agent_analytics_yesterday() TO service_role;

-- ---------------------------------------------------------------------------

-- Sends quota warning notifications when users hit 80% of monthly quota
CREATE OR REPLACE FUNCTION send_quota_warning_notifications()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  -- Insert notifications for users at 80-99% quota who haven't been warned this month
  INSERT INTO notifications (user_id, title, body, type, action_url)
  SELECT
    p.id,
    'You''re approaching your monthly limit',
    FORMAT(
      'You''ve used %s of your %s monthly agent calls (%s%%). Upgrade to avoid interruptions.',
      p.executions_used_this_month,
      p.monthly_execution_quota,
      ROUND((p.executions_used_this_month::FLOAT / NULLIF(p.monthly_execution_quota, 0)) * 100)
    ),
    'quota_warning',
    '/billing'
  FROM profiles p
  WHERE
    p.monthly_execution_quota > 0
    AND p.monthly_execution_quota != -1
    AND (p.executions_used_this_month::FLOAT / NULLIF(p.monthly_execution_quota, 0)) >= 0.80
    AND (p.executions_used_this_month::FLOAT / NULLIF(p.monthly_execution_quota, 0)) < 1.0
    -- Don't warn again if notified in last 24 hours
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = p.id
        AND n.type = 'quota_warning'
        AND n.created_at > NOW() - INTERVAL '24 hours'
    );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION send_quota_warning_notifications() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. SCHEDULE CRON JOBS
-- Remove any existing jobs with same names first (idempotent).
-- ---------------------------------------------------------------------------

-- Remove existing jobs (safe to run multiple times)
SELECT cron.unschedule('agentdyne_monthly_quota_reset')       WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agentdyne_monthly_quota_reset');
SELECT cron.unschedule('agentdyne_cleanup_expired_memory')    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agentdyne_cleanup_expired_memory');
SELECT cron.unschedule('agentdyne_cleanup_injection_logs')    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agentdyne_cleanup_injection_logs');
SELECT cron.unschedule('agentdyne_aggregate_analytics')       WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agentdyne_aggregate_analytics');
SELECT cron.unschedule('agentdyne_quota_warnings')            WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agentdyne_quota_warnings');

-- Job 1: Monthly quota reset — runs at midnight on 1st of every month
SELECT cron.schedule(
  'agentdyne_monthly_quota_reset',
  '0 0 1 * *',   -- min hour day-of-month month day-of-week
  'SELECT reset_monthly_execution_quotas();'
);

-- Job 2: Cleanup expired agent memory — every hour
SELECT cron.schedule(
  'agentdyne_cleanup_expired_memory',
  '0 * * * *',   -- top of every hour
  'SELECT cleanup_expired_memory();'
);

-- Job 3: Purge old injection attempt logs — every Sunday at 03:00 UTC
SELECT cron.schedule(
  'agentdyne_cleanup_injection_logs',
  '0 3 * * 0',   -- 03:00 UTC every Sunday
  'SELECT cleanup_old_injection_attempts();'
);

-- Job 4: Aggregate daily agent analytics — every day at 01:00 UTC
SELECT cron.schedule(
  'agentdyne_aggregate_analytics',
  '0 1 * * *',   -- 01:00 UTC daily
  'SELECT aggregate_agent_analytics_yesterday();'
);

-- Job 5: Quota warning notifications — every 6 hours
SELECT cron.schedule(
  'agentdyne_quota_warnings',
  '0 */6 * * *', -- every 6 hours
  'SELECT send_quota_warning_notifications();'
);

-- ---------------------------------------------------------------------------
-- 3. VERIFY JOBS WERE CREATED
-- ---------------------------------------------------------------------------
-- Run this to confirm: SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'agentdyne_%' ORDER BY jobname;

-- ---------------------------------------------------------------------------
-- 4. NOTIFICATIONS TABLE — ensure it exists with correct schema
-- (safe if already created by earlier migrations)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  body        TEXT,
  type        TEXT        NOT NULL DEFAULT 'system',
  action_url  TEXT,
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read, created_at DESC)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_user_all
  ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_user_own"    ON notifications;
DROP POLICY IF EXISTS "notifications_system_insert" ON notifications;

CREATE POLICY "notifications_user_own"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notifications_user_update"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "notifications_system_insert"
  ON notifications FOR INSERT
  WITH CHECK (true);   -- service_role can insert on behalf of any user

-- ---------------------------------------------------------------------------
-- 5. AGENT_ANALYTICS TABLE — ensure it exists (for aggregation job)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_analytics (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id       UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  date           DATE        NOT NULL,
  executions     INTEGER     DEFAULT 0,
  revenue        NUMERIC(12,6) DEFAULT 0,
  avg_latency_ms INTEGER     DEFAULT 0,
  success_rate   FLOAT       DEFAULT 1,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, date)
);

CREATE INDEX IF NOT EXISTS idx_agent_analytics_agent_date
  ON agent_analytics(agent_id, date DESC);

ALTER TABLE agent_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_seller_read" ON agent_analytics;
CREATE POLICY "analytics_seller_read"
  ON agent_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_analytics.agent_id
        AND agents.seller_id = auth.uid()
    )
  );
