-- ============================================================
-- AgentDyne — Migration 014: Production Infrastructure
-- Final pre-launch migration.
-- Run ONCE in Supabase SQL Editor after migrations 001-013.
-- All statements idempotent — safe to re-run.
--
-- Creates:
--   Tables:  idempotency_keys, execution_cache,
--            processed_stripe_events, failed_webhooks,
--            platform_config
--   RPCs:    reserve_credits, commit_credit_reservation,
--            release_credit_reservation,
--            get_concurrent_executions,
--            increment_rate_limit,
--            increment_cache_hits,
--            fail_stuck_executions,
--            cleanup_rate_limit_counters,
--            cleanup_expired_memory,
--            cleanup_expired_cache
-- ============================================================

-- ── 1. idempotency_keys ───────────────────────────────────────────────────────
-- Prevents duplicate agent/pipeline executions on client retries.
-- Used by /api/agents/[id]/execute (X-Idempotency-Key header).
-- Rows expire after 24 hours (cleaned by pg_cron).

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_hash     TEXT        NOT NULL UNIQUE,   -- SHA-256(userId:agentId:clientKey)
  user_id      UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','success','failed')),
  execution_id UUID,                           -- filled after success
  response     JSONB,                          -- cached response for retries
  created_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_idem_hash    ON public.idempotency_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_idem_user    ON public.idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idem_expires ON public.idempotency_keys(expires_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='idempotency_keys' AND policyname='idem_own'
  ) THEN
    CREATE POLICY "idem_own" ON public.idempotency_keys FOR ALL
      USING (user_id = auth.uid());
    CREATE POLICY "idem_service" ON public.idempotency_keys FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.idempotency_keys TO authenticated, service_role;

-- ── 2. execution_cache ────────────────────────────────────────────────────────
-- Semantic response cache: same input → same cached output.
-- Cuts LLM cost and latency for deterministic queries.
-- TTL: per-agent configurable (default 1 hour).

CREATE TABLE IF NOT EXISTS public.execution_cache (
  cache_key     TEXT        PRIMARY KEY,       -- SHA-256(agentId:normalizedInput)
  agent_id      UUID        NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  output        JSONB       NOT NULL,
  tokens_input  INTEGER     DEFAULT 0,
  tokens_output INTEGER     DEFAULT 0,
  cost_usd      NUMERIC     DEFAULT 0,
  hit_count     INTEGER     DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_agent   ON public.execution_cache(agent_id);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON public.execution_cache(expires_at);

ALTER TABLE public.execution_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='execution_cache' AND policyname='cache_service_all'
  ) THEN
    -- Cache is private infra — no user-level RLS needed
    CREATE POLICY "cache_service_all" ON public.execution_cache FOR ALL
      USING (auth.role() = 'service_role');
    -- Authenticated reads allowed (for cache lookup in edge routes)
    CREATE POLICY "cache_auth_read" ON public.execution_cache FOR SELECT
      USING (true);
    CREATE POLICY "cache_auth_write" ON public.execution_cache FOR INSERT
      WITH CHECK (true);
    CREATE POLICY "cache_auth_update" ON public.execution_cache FOR UPDATE
      USING (true);
    CREATE POLICY "cache_auth_delete" ON public.execution_cache FOR DELETE
      USING (auth.role() = 'service_role');
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.execution_cache TO authenticated, service_role;

-- increment_cache_hits — called fire-and-forget after a cache hit
CREATE OR REPLACE FUNCTION public.increment_cache_hits(key TEXT)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER AS $$
  UPDATE public.execution_cache
  SET hit_count = hit_count + 1
  WHERE cache_key = key;
$$;
GRANT EXECUTE ON FUNCTION public.increment_cache_hits(TEXT) TO authenticated, service_role;

-- cleanup_expired_cache — scheduled by pg_cron
CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH deleted AS (
    DELETE FROM public.execution_cache
    WHERE expires_at < now()
    RETURNING cache_key
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_cache() TO service_role;

-- ── 3. processed_stripe_events ────────────────────────────────────────────────
-- Stripe idempotency: each event processed exactly once.
-- Without this, checkout.session.completed fires twice → double credits.

CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id    TEXT        PRIMARY KEY,         -- Stripe event ID (evt_xxx)
  event_type  TEXT        NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_at
  ON public.processed_stripe_events(processed_at DESC);

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='processed_stripe_events' AND policyname='stripe_service_all'
  ) THEN
    CREATE POLICY "stripe_service_all" ON public.processed_stripe_events FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;
GRANT SELECT, INSERT ON public.processed_stripe_events TO service_role;

-- Auto-cleanup: keep only 30 days of event records
CREATE OR REPLACE FUNCTION public.cleanup_old_stripe_events()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH deleted AS (
    DELETE FROM public.processed_stripe_events
    WHERE processed_at < now() - INTERVAL '30 days'
    RETURNING event_id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_stripe_events() TO service_role;

-- ── 4. failed_webhooks ────────────────────────────────────────────────────────
-- Dead letter queue: webhook handler errors go here so we can retry manually.
-- We return 200 to Stripe (stops retries) and process from here ourselves.

CREATE TABLE IF NOT EXISTS public.failed_webhooks (
  id          BIGSERIAL   PRIMARY KEY,
  event_id    TEXT        NOT NULL,
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  error       TEXT,
  retry_count INTEGER     DEFAULT 0,
  resolved    BOOLEAN     DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_failed_webhooks_resolved
  ON public.failed_webhooks(resolved, created_at DESC);

ALTER TABLE public.failed_webhooks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='failed_webhooks' AND policyname='fw_service_all'
  ) THEN
    CREATE POLICY "fw_service_all" ON public.failed_webhooks FOR ALL
      USING (auth.role() = 'service_role');
    CREATE POLICY "fw_admin_read" ON public.failed_webhooks FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.failed_webhooks TO service_role;
GRANT SELECT ON public.failed_webhooks TO authenticated;

-- ── 5. platform_config ────────────────────────────────────────────────────────
-- Key-value store for platform-level config.
-- Used by health check + admin feature flags.

CREATE TABLE IF NOT EXISTS public.platform_config (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='platform_config' AND policyname='pc_public_read'
  ) THEN
    CREATE POLICY "pc_public_read" ON public.platform_config FOR SELECT USING (true);
    CREATE POLICY "pc_admin_write" ON public.platform_config FOR ALL
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
    CREATE POLICY "pc_service_all" ON public.platform_config FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;
GRANT SELECT ON public.platform_config TO anon, authenticated;
GRANT ALL    ON public.platform_config TO service_role;

-- Seed default config
INSERT INTO public.platform_config (key, value) VALUES
  ('maintenance_mode',    '{"enabled": false}'),
  ('signup_enabled',      '{"enabled": true}'),
  ('max_free_agents',     '{"limit": 5}'),
  ('platform_fee_pct',    '{"pct": 20}')
ON CONFLICT (key) DO NOTHING;

-- ── 6. credit_reservations ────────────────────────────────────────────────────
-- Atomic credit reservation: reserve BEFORE execution, commit/release AFTER.
-- Prevents "execute then crash = free call" race condition.

CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_usd   NUMERIC(12,6) NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'reserved'
               CHECK (status IN ('reserved','committed','released')),
  execution_id UUID,
  created_at   TIMESTAMPTZ DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cr_user   ON public.credit_reservations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_cr_status ON public.credit_reservations(status, created_at);

ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='credit_reservations' AND policyname='cr_own'
  ) THEN
    CREATE POLICY "cr_own"     ON public.credit_reservations FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY "cr_service" ON public.credit_reservations FOR ALL USING (auth.role() = 'service_role');
    CREATE POLICY "cr_auth_insert" ON public.credit_reservations FOR INSERT WITH CHECK (true);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.credit_reservations TO authenticated, service_role;

-- ── 7. reserve_credits RPC ───────────────────────────────────────────────────
-- Atomically deducts credits to a "reserved" holding state BEFORE execution.
-- If execution crashes, release_credit_reservation restores the balance.
-- If execution succeeds, commit_credit_reservation finalises at actual cost.

CREATE OR REPLACE FUNCTION public.reserve_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  execution_id_param UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_balance     NUMERIC;
  v_new_balance NUMERIC;
  v_reservation_id UUID;
BEGIN
  IF amount_param <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Lock the credits row for this user
  SELECT balance_usd INTO v_balance
  FROM public.credits
  WHERE user_id = user_id_param
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credits account not found');
  END IF;

  IF v_balance < amount_param THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient credits',
      'balance', v_balance,
      'required', amount_param
    );
  END IF;

  v_new_balance := v_balance - amount_param;

  -- Deduct from balance immediately (held in reservation)
  UPDATE public.credits
  SET balance_usd = v_new_balance,
      updated_at  = now()
  WHERE user_id = user_id_param;

  -- Create reservation record for tracking
  INSERT INTO public.credit_reservations (user_id, amount_usd, status, execution_id)
  VALUES (user_id_param, amount_param, 'reserved', execution_id_param)
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'success',         true,
    'reservation_id',  v_reservation_id,
    'reserved_amount', amount_param,
    'new_balance',     v_new_balance
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, NUMERIC, UUID)
  TO authenticated, service_role;

-- ── 8. commit_credit_reservation ─────────────────────────────────────────────
-- After execution: if actual cost < reserved, refund the difference.
-- If actual cost > reserved (unusual), nothing extra is charged (agent pricing issue).

CREATE OR REPLACE FUNCTION public.commit_credit_reservation(
  reservation_id_param UUID,
  actual_cost_param    NUMERIC
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_reservation   RECORD;
  v_refund_amount NUMERIC;
BEGIN
  SELECT * INTO v_reservation
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Already committed or released — idempotent, return success
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  -- If actual cost less than reserved, refund the difference
  v_refund_amount := GREATEST(0, v_reservation.amount_usd - COALESCE(actual_cost_param, 0));

  IF v_refund_amount > 0 THEN
    UPDATE public.credits
    SET balance_usd = balance_usd + v_refund_amount,
        updated_at  = now()
    WHERE user_id = v_reservation.user_id;
  END IF;

  -- Mark reservation as committed
  UPDATE public.credit_reservations
  SET status      = 'committed',
      resolved_at = now()
  WHERE id = reservation_id_param;

  -- Record final transaction
  INSERT INTO public.credit_transactions (
    user_id, type, amount_usd, description, reference_id,
    balance_after
  )
  SELECT
    v_reservation.user_id,
    'deduction',
    COALESCE(actual_cost_param, v_reservation.amount_usd),
    'Agent execution (reservation committed)',
    reservation_id_param,
    (SELECT balance_usd FROM public.credits WHERE user_id = v_reservation.user_id)
  ;

  RETURN jsonb_build_object(
    'success',        true,
    'reserved',       v_reservation.amount_usd,
    'actual_cost',    actual_cost_param,
    'refunded',       v_refund_amount
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.commit_credit_reservation(UUID, NUMERIC)
  TO authenticated, service_role;

-- ── 9. release_credit_reservation ────────────────────────────────────────────
-- Called on execution failure: restores the full reserved amount to balance.

CREATE OR REPLACE FUNCTION public.release_credit_reservation(
  reservation_id_param UUID
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_reservation RECORD;
BEGIN
  SELECT * INTO v_reservation
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  -- Restore the reserved amount
  UPDATE public.credits
  SET balance_usd = balance_usd + v_reservation.amount_usd,
      updated_at  = now()
  WHERE user_id = v_reservation.user_id;

  -- Mark as released
  UPDATE public.credit_reservations
  SET status      = 'released',
      resolved_at = now()
  WHERE id = reservation_id_param;

  RETURN jsonb_build_object(
    'success',  true,
    'released', v_reservation.amount_usd
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation(UUID)
  TO authenticated, service_role;

-- ── 10. get_concurrent_executions ────────────────────────────────────────────
-- Counts running executions for a user in the last 10 minutes.
-- 10-minute stale guard prevents phantom "running" rows blocking users forever.

CREATE OR REPLACE FUNCTION public.get_concurrent_executions(user_id_param UUID)
RETURNS INTEGER LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.executions
  WHERE user_id    = user_id_param
    AND status     = 'running'
    AND created_at > now() - INTERVAL '10 minutes';
$$;
GRANT EXECUTE ON FUNCTION public.get_concurrent_executions(UUID)
  TO authenticated, service_role;

-- ── 11. increment_rate_limit ──────────────────────────────────────────────────
-- Atomic per-user rate limit counter using the rate_limit_counters table.
-- Returns { count, window_end, blocked } for the current window.

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  key_param        TEXT,
  window_end_param TIMESTAMPTZ,
  limit_param      INTEGER
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_count      INTEGER;
  v_window_end TIMESTAMPTZ;
  v_blocked    BOOLEAN;
BEGIN
  -- Check if existing window is still valid
  SELECT count, window_end
  INTO v_count, v_window_end
  FROM public.rate_limit_counters
  WHERE id = key_param
  FOR UPDATE;

  IF NOT FOUND OR now() > v_window_end THEN
    -- New window: upsert with count = 1
    INSERT INTO public.rate_limit_counters (id, count, window_end)
    VALUES (key_param, 1, window_end_param)
    ON CONFLICT (id) DO UPDATE
      SET count      = 1,
          window_end = window_end_param;

    v_count      := 1;
    v_window_end := window_end_param;
    v_blocked    := (1 > limit_param);
  ELSE
    -- Existing window: increment
    UPDATE public.rate_limit_counters
    SET count = count + 1
    WHERE id = key_param
    RETURNING count INTO v_count;

    v_blocked := (v_count > limit_param);
  END IF;

  RETURN jsonb_build_object(
    'count',      v_count,
    'window_end', v_window_end,
    'blocked',    v_blocked
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER)
  TO authenticated, service_role;

-- cleanup_rate_limit_counters — removes expired windows (run every 30 min)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_counters()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH deleted AS (
    DELETE FROM public.rate_limit_counters
    WHERE window_end < now() - INTERVAL '1 hour'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_counters() TO service_role;

-- ── 12. fail_stuck_executions ────────────────────────────────────────────────
-- Marks executions stuck in 'running' for >15 minutes as 'failed'.
-- Prevents phantom running rows from blocking concurrency limits.
-- Run by pg_cron every 5 minutes.

CREATE OR REPLACE FUNCTION public.fail_stuck_executions()
RETURNS INTEGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE public.executions
    SET status        = 'failed',
        error_message = 'Execution timed out (stuck > 15 minutes)',
        completed_at  = now()
    WHERE status     = 'running'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM updated;

  -- Also release any stuck reservations for failed executions
  WITH stuck_reservations AS (
    UPDATE public.credit_reservations
    SET status      = 'released',
        resolved_at = now()
    WHERE status    = 'reserved'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING user_id, amount_usd
  )
  UPDATE public.credits c
  SET balance_usd = c.balance_usd + sr.amount_usd,
      updated_at  = now()
  FROM stuck_reservations sr
  WHERE c.user_id = sr.user_id;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fail_stuck_executions() TO service_role;

-- ── 13. cleanup_expired_memory ───────────────────────────────────────────────
-- Purges agent_memory rows past their TTL.

CREATE OR REPLACE FUNCTION public.cleanup_expired_memory()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH deleted AS (
    DELETE FROM public.agent_memory
    WHERE ttl_at IS NOT NULL AND ttl_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memory() TO service_role;

-- ── 14. Ensure executions table has idempotency_key ──────────────────────────
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_idempotency
  ON public.executions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── 15. terms_acceptance on profiles ─────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_accepted_at  TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_version       TEXT DEFAULT '1.0';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified      BOOLEAN DEFAULT FALSE;

-- ── 16. agents — ensure cache_ttl_seconds exists ─────────────────────────────
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS cache_ttl_seconds INTEGER DEFAULT 3600;

-- ── 17. pg_cron schedules ────────────────────────────────────────────────────
-- All cron schedules in one place. Idempotent — cron.schedule overwrites.
-- Enable pg_cron first: Dashboard → Database → Extensions → pg_cron

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Critical: fail stuck executions every 5 minutes
    PERFORM cron.schedule('agentdyne-fail-stuck',        '*/5 * * * *',   $$SELECT public.fail_stuck_executions()$$);
    -- Monthly quota reset (1st of month, midnight UTC)
    PERFORM cron.schedule('agentdyne-reset-quotas',      '0 0 1 * *',     $$SELECT public.reset_monthly_quotas()$$);
    -- Daily analytics aggregation (1 AM UTC)
    PERFORM cron.schedule('agentdyne-daily-analytics',   '0 1 * * *',     $$SELECT public.aggregate_daily_analytics()$$);
    -- Daily ranking refresh (2 AM UTC)
    PERFORM cron.schedule('agentdyne-refresh-rankings',  '0 2 * * *',     $$SELECT public.refresh_agent_rankings()$$);
    -- Hourly: cleanup expired memory
    PERFORM cron.schedule('agentdyne-cleanup-memory',    '0 * * * *',     $$SELECT public.cleanup_expired_memory()$$);
    -- Hourly: cleanup expired cache
    PERFORM cron.schedule('agentdyne-cleanup-cache',     '30 * * * *',    $$SELECT public.cleanup_expired_cache()$$);
    -- Every 30 min: cleanup rate limit counters
    PERFORM cron.schedule('agentdyne-cleanup-rl',        '*/30 * * * *',  $$SELECT public.cleanup_rate_limit_counters()$$);
    -- Daily: cleanup old Stripe event records (30+ days)
    PERFORM cron.schedule('agentdyne-cleanup-stripe',    '0 3 * * *',     $$SELECT public.cleanup_old_stripe_events()$$);
    -- Daily: cleanup expired idempotency keys
    PERFORM cron.schedule('agentdyne-cleanup-idempotency','0 4 * * *',    $$DELETE FROM public.idempotency_keys WHERE expires_at < now()$$);
    RAISE NOTICE '✅ All pg_cron schedules registered';
  ELSE
    RAISE NOTICE '⚠️  pg_cron not enabled. Enable via Dashboard → Database → Extensions → pg_cron';
    RAISE NOTICE '    Then run this migration again to schedule the jobs.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  pg_cron schedule error: %', SQLERRM;
END $$;

-- ── 18. Verification ─────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl   TEXT;
  rtn   TEXT;
  v_exists BOOLEAN;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'idempotency_keys', 'execution_cache', 'processed_stripe_events',
    'failed_webhooks', 'platform_config', 'credit_reservations'
  ]) LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=tbl
    ) INTO v_exists;
    RAISE NOTICE '✅ Table %: %', tbl, CASE WHEN v_exists THEN 'OK' ELSE '⚠ MISSING' END;
  END LOOP;

  FOR rtn IN SELECT unnest(ARRAY[
    'reserve_credits', 'commit_credit_reservation', 'release_credit_reservation',
    'get_concurrent_executions', 'increment_rate_limit', 'increment_cache_hits',
    'fail_stuck_executions', 'cleanup_rate_limit_counters', 'cleanup_expired_memory',
    'cleanup_expired_cache', 'cleanup_old_stripe_events'
  ]) LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname=rtn
    ) INTO v_exists;
    RAISE NOTICE '✅ Function %: %', rtn, CASE WHEN v_exists THEN 'OK' ELSE '⚠ MISSING' END;
  END LOOP;

  RAISE NOTICE '✅ Migration 014 complete. AgentDyne is production-ready.';
END $$;
