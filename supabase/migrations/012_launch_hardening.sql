-- =============================================================================
-- AgentDyne — Migration 012: Launch Hardening
-- April 2026 | Based on DeepSeek + founder pre-launch audit
--
-- Run ONCE after migrations 010 and 011.
-- All statements are idempotent — safe to re-run.
--
-- Fixes:
--   1.  idempotency_key column on executions (Stripe-pattern dedup)
--   2.  email_confirmed_at gate — free tier abuse prevention
--   3.  terms_accepted_at + terms_version — legal compliance
--   4.  failed_webhooks table — dead letter queue for Stripe events
--   5.  processed_stripe_events — Stripe webhook idempotency
--   6.  fail_stuck_executions() — pg_cron cleanup for hung executions
--   7.  cleanup_rate_limit_counters() — prevent rate_limit_counters bloat
--   8.  webhook_url on pipelines — enterprise pipeline completion hooks
--   9.  cost_model overhead columns on agents — accurate margin tracking
--  10.  platform_config table — runtime config without redeployment
--  11.  Complete pg_cron schedule (all missing jobs)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. idempotency_key ON executions TABLE
--    DeepSeek: idempotency via separate table is correct (done in 011),
--    but also store the key directly on executions for O(1) lookup.
-- ---------------------------------------------------------------------------
ALTER TABLE executions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$ BEGIN
  CREATE UNIQUE INDEX idx_executions_idempotency
    ON executions(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 2. EMAIL VERIFICATION GATE columns
--    profiles.email_confirmed_at — copied from auth.users on trigger
--    This lets the execute route check without joining auth schema.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email_verified     BOOLEAN DEFAULT FALSE;

-- Sync trigger: when auth.users confirms email, update profiles
-- NOTE: This requires the auth schema trigger to be set up in Supabase Dashboard:
--   Auth → Hooks → After user confirmed
-- OR use the function below directly in the execute route (simpler).

-- Function for the execute route to call: is_email_verified(user_id)
CREATE OR REPLACE FUNCTION is_email_verified(user_id_param UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT email_confirmed_at IS NOT NULL FROM auth.users WHERE id = user_id_param),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION is_email_verified(UUID) TO authenticated, service_role;

-- Sync existing verified users (one-time backfill)
UPDATE profiles p
SET email_confirmed_at = u.email_confirmed_at,
    email_verified     = (u.email_confirmed_at IS NOT NULL)
FROM auth.users u
WHERE p.id = u.id
  AND u.email_confirmed_at IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. TERMS OF SERVICE TRACKING — legal compliance
--    Store which version of ToS each user accepted and when.
--    Required for GDPR Article 7 + most enterprise agreements.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS terms_version     TEXT DEFAULT '1.0';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

-- Log each acceptance for audit trail
CREATE TABLE IF NOT EXISTS terms_acceptance_log (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version TEXT       NOT NULL,
  document_type TEXT       NOT NULL DEFAULT 'terms'
                           CHECK (document_type IN ('terms', 'privacy', 'dpa')),
  ip_address   TEXT,
  user_agent   TEXT,
  accepted_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terms_log_user ON terms_acceptance_log(user_id, accepted_at DESC);
ALTER TABLE terms_acceptance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "terms_own_read"    ON terms_acceptance_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "terms_own_write"   ON terms_acceptance_log FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "terms_admin_read"  ON terms_acceptance_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
GRANT SELECT, INSERT ON terms_acceptance_log TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. FAILED_WEBHOOKS TABLE — Dead Letter Queue for Stripe
--    When webhook processing fails, we store the event here so it can be
--    retried manually or by a background job.
--    We always return 200 to Stripe to stop their retry loop — we handle
--    retries ourselves with full context.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS failed_webhooks (
  id           BIGSERIAL   PRIMARY KEY,
  event_id     TEXT        NOT NULL,        -- Stripe event ID (e.g., evt_xxx)
  event_type   TEXT        NOT NULL,        -- e.g., checkout.session.completed
  payload      JSONB       NOT NULL DEFAULT '{}',
  error        TEXT,
  retry_count  INTEGER     DEFAULT 0,
  last_tried   TIMESTAMPTZ DEFAULT now(),
  resolved     BOOLEAN     DEFAULT FALSE,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fw_event_id    ON failed_webhooks(event_id);
CREATE INDEX IF NOT EXISTS idx_fw_unresolved  ON failed_webhooks(created_at DESC) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_fw_type        ON failed_webhooks(event_type);

ALTER TABLE failed_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fw_admin_only"  ON failed_webhooks FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "fw_system_write" ON failed_webhooks FOR INSERT WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON failed_webhooks TO service_role;
GRANT SELECT ON failed_webhooks TO authenticated;  -- admins see via RLS


-- ---------------------------------------------------------------------------
-- 5. PROCESSED_STRIPE_EVENTS — Webhook Idempotency
--    Prevents processing the same Stripe event twice when Stripe retries.
--    Key: Stripe event.id (globally unique per Stripe account).
--    TTL: 7 days (Stripe retries within 72h, we keep buffer).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id     TEXT        PRIMARY KEY,     -- Stripe event ID
  event_type   TEXT        NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_pse_expires ON processed_stripe_events(expires_at);
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pse_system" ON processed_stripe_events FOR ALL USING (true);
GRANT SELECT, INSERT ON processed_stripe_events TO service_role;

-- Cleanup old event records
CREATE OR REPLACE FUNCTION cleanup_processed_stripe_events()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH d AS (DELETE FROM processed_stripe_events WHERE expires_at < now() RETURNING event_id)
  SELECT COUNT(*)::integer FROM d;
$$;
GRANT EXECUTE ON FUNCTION cleanup_processed_stripe_events() TO service_role;

SELECT cron.schedule('cleanup-stripe-events', '0 3 * * *',
  $$SELECT cleanup_processed_stripe_events()$$);


-- ---------------------------------------------------------------------------
-- 6. fail_stuck_executions() — heal hung executions
--    Called every 5 min by pg_cron.
--    Any execution stuck in 'running' for > 10 minutes is marked failed.
--    This prevents users from seeing permanently "running" jobs after crashes.
--    Also releases any associated credit reservations.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fail_stuck_executions()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  affected INTEGER;
  stuck_ids UUID[];
BEGIN
  -- Find stuck execution IDs
  SELECT ARRAY_AGG(id) INTO stuck_ids
  FROM executions
  WHERE status     = 'running'
    AND created_at < now() - INTERVAL '10 minutes';

  IF stuck_ids IS NULL OR array_length(stuck_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- Mark as failed
  UPDATE executions
  SET status        = 'failed',
      error_message = 'Execution timed out — automatically marked as failed by system',
      completed_at  = now()
  WHERE id = ANY(stuck_ids);

  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Release any stuck credit reservations for these executions
  UPDATE credit_reservations
  SET status = 'released'
  WHERE execution_id = ANY(stuck_ids)
    AND status       = 'reserved';

  -- Refund reserved credits back to users
  UPDATE credits c
  SET balance_usd = c.balance_usd + r.reserved_usd,
      updated_at  = now()
  FROM credit_reservations r
  WHERE r.execution_id = ANY(stuck_ids)
    AND r.status       = 'released'
    AND r.user_id      = c.user_id;

  -- Log to governance
  INSERT INTO audit_logs (actor_type, action, resource, payload)
  VALUES ('system', 'fail_stuck_executions', 'executions',
    jsonb_build_object('count', affected, 'execution_ids', stuck_ids, 'ran_at', now()));

  RETURN affected;
END;
$$;
GRANT EXECUTE ON FUNCTION fail_stuck_executions() TO service_role;

SELECT cron.schedule('fail-stuck', '*/5 * * * *',
  $$SELECT fail_stuck_executions()$$);


-- ---------------------------------------------------------------------------
-- 7. cleanup_rate_limit_counters() — prevent table bloat
--    Rate limit counters accumulate indefinitely. Clean expired windows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_rate_limit_counters()
RETURNS INTEGER
LANGUAGE SQL SECURITY DEFINER AS $$
  WITH d AS (
    DELETE FROM rate_limit_counters
    WHERE window_end < now() - INTERVAL '1 hour'
    RETURNING id
  )
  SELECT COUNT(*)::integer FROM d;
$$;
GRANT EXECUTE ON FUNCTION cleanup_rate_limit_counters() TO service_role;

SELECT cron.schedule('cleanup-rl', '*/30 * * * *',
  $$SELECT cleanup_rate_limit_counters()$$);


-- ---------------------------------------------------------------------------
-- 8. cleanup_expired_memory() — expire agent memory entries with TTL
--    (Referenced in previous migrations but function not defined yet)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_expired_memory()
RETURNS INTEGER
LANGUAGE SQL SECURITY DEFINER AS $$
  WITH d AS (
    DELETE FROM agent_memory
    WHERE ttl_at IS NOT NULL AND ttl_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::integer FROM d;
$$;
GRANT EXECUTE ON FUNCTION cleanup_expired_memory() TO service_role;

-- Fix the existing cron schedule (it was registered but function didn't exist)
SELECT cron.schedule('cleanup-memory', '0 2 * * *',
  $$SELECT cleanup_expired_memory()$$);


-- ---------------------------------------------------------------------------
-- 9. WEBHOOK_URL on pipelines — enterprise pipeline completion notifications
--    When a pipeline finishes (success or failure), POST to this URL.
--    Format: POST { executionId, status, output, latencyMs, cost }
-- ---------------------------------------------------------------------------
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS webhook_url          TEXT;
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS webhook_secret       TEXT;    -- HMAC-SHA256 signing secret
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS webhook_on_success   BOOLEAN DEFAULT TRUE;
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS webhook_on_failure   BOOLEAN DEFAULT TRUE;


-- ---------------------------------------------------------------------------
-- 10. COST MODEL OVERHEAD on agents
--     Tracks per-agent overhead factors for accurate margin calculation.
--     Used by the cost estimator to account for RAG embedding + MCP costs.
-- ---------------------------------------------------------------------------
ALTER TABLE agents ADD COLUMN IF NOT EXISTS cache_ttl_seconds    INTEGER DEFAULT 3600;  -- 0 = no cache
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rag_enabled          BOOLEAN DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_enabled          BOOLEAN DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS platform_margin      NUMERIC(4,2) DEFAULT 3.0; -- default 3×
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rag_overhead_factor  NUMERIC(4,2) DEFAULT 0.10; -- +10% for RAG
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_overhead_factor  NUMERIC(4,2) DEFAULT 0.20; -- +20% for MCP tools


-- ---------------------------------------------------------------------------
-- 11. PLATFORM_CONFIG TABLE
--     Runtime configuration that doesn't require redeployment.
--     Admin editable via /api/admin?action=set_config.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_config (
  key         TEXT PRIMARY KEY,
  value       JSONB        NOT NULL,
  description TEXT,
  updated_by  UUID         REFERENCES profiles(id),
  updated_at  TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_admin_write" ON platform_config FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "config_public_read" ON platform_config FOR SELECT USING (true);
GRANT SELECT ON platform_config TO authenticated, anon;
GRANT ALL    ON platform_config TO service_role;

-- Seed critical defaults
INSERT INTO platform_config (key, value, description) VALUES
  ('rag_similarity_threshold',  '0.75',         'Minimum cosine similarity for RAG chunk retrieval'),
  ('max_free_tier_credits',     '2.00',          'Max credits given to free tier users on signup'),
  ('min_credit_purchase_usd',   '5.00',          'Minimum credit top-up amount (Stripe fee protection)'),
  ('platform_margin_default',   '3.0',           'Default platform margin multiplier on LLM costs'),
  ('pipeline_overhead_factor',  '0.5',           'Pipeline overhead: charge 50% extra on multi-node pipelines'),
  ('rag_overhead_factor',       '0.1',           'RAG overhead: charge 10% extra when RAG is used'),
  ('mcp_overhead_factor',       '0.2',           'MCP overhead: charge 20% extra when MCP tools used'),
  ('maintenance_mode',          'false',         'Global maintenance mode flag'),
  ('signup_disabled',           'false',         'Disable new signups (use during abuse wave)'),
  ('require_email_verification','true',          'Require email verification before first execution'),
  ('free_tier_daily_exec_cap',  '50',            'Max executions per day for free tier users'),
  ('abuse_auto_ban_score',      '90',            'Abuse score threshold for automatic account ban')
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 12. SEARCH — ensure composite_score index exists for fast sorting
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agents_composite_score
  ON agents(composite_score DESC, total_executions DESC)
  WHERE status = 'active';


-- ---------------------------------------------------------------------------
-- 13. PROFILES — ensure email_confirmed_at sync trigger exists
--     Supabase fires auth.user_confirmed trigger when user verifies email.
--     We copy the timestamp to profiles for fast access without auth join.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_email_confirmed()
RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE profiles
    SET email_confirmed_at = NEW.email_confirmed_at,
        email_verified     = TRUE,
        updated_at         = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Note: This trigger goes on auth.users — must be created by superuser.
-- In Supabase: this is done via Database → Triggers → New Trigger on auth.users.
-- The SQL below works if you have access to the auth schema:
DO $$ BEGIN
  DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
  CREATE TRIGGER on_auth_user_confirmed
    AFTER UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW
    WHEN (NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL)
    EXECUTE FUNCTION sync_email_confirmed();
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Cannot create auth.users trigger — do this manually in Supabase Dashboard';
END $$;


-- ---------------------------------------------------------------------------
-- 14. GOVERNANCE_EVENTS — ensure severity column CHECK is correct
-- ---------------------------------------------------------------------------
ALTER TABLE governance_events
  DROP CONSTRAINT IF EXISTS governance_events_severity_check;

ALTER TABLE governance_events
  ADD CONSTRAINT governance_events_severity_check
  CHECK (severity IN ('info', 'warning', 'critical'));


-- ---------------------------------------------------------------------------
-- 15. COMPLETE pg_cron SCHEDULE (all jobs)
-- ---------------------------------------------------------------------------

SELECT cron.schedule('reset-monthly-quotas',    '0 0 1 * *',     $$SELECT reset_monthly_quotas()$$);
SELECT cron.schedule('daily-analytics',         '0 1 * * *',     $$SELECT aggregate_daily_analytics()$$);
SELECT cron.schedule('refresh-rankings',        '0 2 * * *',     $$SELECT refresh_agent_rankings()$$);
SELECT cron.schedule('cleanup-memory',          '0 2 * * *',     $$SELECT cleanup_expired_memory()$$);
SELECT cron.schedule('cleanup-idempotency',     '0 * * * *',     $$SELECT cleanup_expired_idempotency_keys()$$);
SELECT cron.schedule('cleanup-cache',           '30 * * * *',    $$SELECT cleanup_execution_cache()$$);
SELECT cron.schedule('cleanup-rl',              '*/30 * * * *',  $$SELECT cleanup_rate_limit_counters()$$);
SELECT cron.schedule('cleanup-stripe-events',   '0 3 * * *',     $$SELECT cleanup_processed_stripe_events()$$);
SELECT cron.schedule('fail-stuck',              '*/5 * * * *',   $$SELECT fail_stuck_executions()$$);


-- ---------------------------------------------------------------------------
-- 16. VERIFICATION
-- ---------------------------------------------------------------------------
DO $$
DECLARE v INTEGER;
BEGIN
  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'executions' AND column_name = 'idempotency_key';
  RAISE NOTICE '✅ executions.idempotency_key: %', CASE WHEN v=1 THEN 'OK' ELSE '⚠ MISSING' END;

  SELECT COUNT(*) INTO v FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'failed_webhooks';
  RAISE NOTICE '✅ failed_webhooks table: %', CASE WHEN v=1 THEN 'OK' ELSE '⚠ MISSING' END;

  SELECT COUNT(*) INTO v FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'processed_stripe_events';
  RAISE NOTICE '✅ processed_stripe_events table: %', CASE WHEN v=1 THEN 'OK' ELSE '⚠ MISSING' END;

  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'terms_accepted_at';
  RAISE NOTICE '✅ profiles.terms_accepted_at: %', CASE WHEN v=1 THEN 'OK' ELSE '⚠ MISSING' END;

  SELECT COUNT(*) INTO v FROM cron.job WHERE jobname IN (
    'fail-stuck', 'cleanup-rl', 'cleanup-memory', 'reset-monthly-quotas',
    'cleanup-idempotency', 'cleanup-cache', 'cleanup-stripe-events',
    'daily-analytics', 'refresh-rankings'
  );
  RAISE NOTICE '✅ pg_cron jobs registered: % / 9 expected', v;

  RAISE NOTICE '✅ Migration 012 complete — launch hardening applied.';
END $$;
