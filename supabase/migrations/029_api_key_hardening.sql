-- =============================================================================
-- AgentDyne — Migration 029: API Key Security Hardening
-- Adds: HMAC hashing support, scoping, IP tracking, environment separation
-- Safe to re-run (idempotent).
-- =============================================================================

-- New columns on api_keys
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS hash_algo        text        DEFAULT 'hmac-sha256',
  ADD COLUMN IF NOT EXISTS environment      text        DEFAULT 'production'
                           CHECK (environment IN ('production', 'test')),
  ADD COLUMN IF NOT EXISTS allowed_agent_ids uuid[]     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ip_allowlist      text[]     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_used_ip      text,
  ADD COLUMN IF NOT EXISTS calls_today       integer    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS errors_today      integer    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_total_usd    numeric    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_limit_per_day integer   DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS rotate_before     timestamptz;

-- Mark existing keys as legacy sha256
UPDATE public.api_keys
SET hash_algo = 'sha256'
WHERE hash_algo IS NULL OR hash_algo = 'hmac-sha256';

-- Backfill: set expires_at to 1 year if not already set
UPDATE public.api_keys
SET expires_at = created_at + INTERVAL '1 year'
WHERE expires_at IS NULL;

-- Function: reset daily counters (called by cron at midnight)
CREATE OR REPLACE FUNCTION public.reset_api_key_daily_counters()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.api_keys SET calls_today = 0, errors_today = 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_api_key_daily_counters() TO service_role;

-- Register cron job
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-api-key-reset', '0 0 * * *',
      'SELECT public.reset_api_key_daily_counters()');
  END IF;
END $$;

-- RLS: users can only see their own keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='api_keys' AND policyname='api_keys_owner'
  ) THEN
    ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "api_keys_owner" ON public.api_keys FOR ALL
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $ BEGIN RAISE NOTICE '✅ Migration 029 complete — API key hardening applied'; END $;
