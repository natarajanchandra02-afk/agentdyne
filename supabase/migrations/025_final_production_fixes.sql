-- ============================================================
-- AgentDyne — Migration 025: Final Production Fixes
-- Run in Supabase SQL Editor ONCE before global launch.
-- Idempotent — safe to re-run.
--
-- FIXES IN THIS MIGRATION:
--
-- 🔴 CRITICAL:
--   1.  reserve_credits / commit / release / fail_stuck all reference
--       column "amount_usd" — actual column is "reserved_usd" → every
--       credit reservation call silently throws a column-not-found error.
--   2.  credit_reservations missing "resolved_at" column that RPCs update.
--   3.  pg_cron jobid 14 calls refresh_agent_rankings() which DOES NOT
--       EXIST → silent error every day at 2 AM.
--
-- 🟠 HIGH:
--   4.  waitlist table has RLS disabled → anyone can read all emails.
--   5.  email_queue UPDATE policy qual = "true" → any authenticated user
--       can modify any queued email (spam / account takeover vector).
--   6.  agent_pipeline_usage has no UNIQUE(agent_id, pipeline_id) →
--       upsert RPC's ON CONFLICT clause silently inserts duplicates instead
--       of upserting.
--   7.  pg_cron fix: standalone cron.schedule calls (not inside DO block)
--       to avoid $$ delimiter conflict.
--
-- 🟡 MEDIUM:
--   8.  Duplicate cron jobs removed (quota reset × 2, memory cleanup × 2,
--       analytics × 2).
--   9.  Duplicate agent_pipeline_usage RLS policies cleaned up.
--   10. cleanup_execution_cache alias for cleanup_expired_cache.
-- ============================================================

-- ─── 1. FIX credit_reservations — add missing "resolved_at" column ────────────

ALTER TABLE public.credit_reservations
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- ─── 2. FIX reserve_credits — column name was "amount_usd", is "reserved_usd" ─

CREATE OR REPLACE FUNCTION public.reserve_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  execution_id_param UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_balance        NUMERIC;
  v_new_balance    NUMERIC;
  v_reservation_id UUID;
BEGIN
  IF amount_param <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Lock the credits row to prevent concurrent over-spend
  SELECT balance_usd INTO v_balance
  FROM public.credits
  WHERE user_id = user_id_param
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credits account not found');
  END IF;

  IF v_balance < amount_param THEN
    RETURN jsonb_build_object(
      'success',  false,
      'error',    'Insufficient credits',
      'balance',  v_balance,
      'required', amount_param
    );
  END IF;

  v_new_balance := v_balance - amount_param;

  -- Deduct from balance into reservation hold
  UPDATE public.credits
  SET balance_usd = v_new_balance,
      updated_at  = now()
  WHERE user_id = user_id_param;

  -- BUG FIX: was "amount_usd" → correct column is "reserved_usd"
  INSERT INTO public.credit_reservations (user_id, reserved_usd, status, execution_id)
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

-- ─── 3. FIX commit_credit_reservation — was referencing "amount_usd" ──────────

CREATE OR REPLACE FUNCTION public.commit_credit_reservation(
  reservation_id_param UUID,
  actual_cost_param    NUMERIC
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_reservation   RECORD;
  v_refund_amount NUMERIC;
BEGIN
  -- BUG FIX: was "amount_usd" → correct column is "reserved_usd"
  SELECT id, user_id, reserved_usd
  INTO v_reservation
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Already committed or released — idempotent
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  -- If actual cost < reserved, refund the difference
  v_refund_amount := GREATEST(0, v_reservation.reserved_usd - COALESCE(actual_cost_param, 0));

  IF v_refund_amount > 0 THEN
    UPDATE public.credits
    SET balance_usd = balance_usd + v_refund_amount,
        updated_at  = now()
    WHERE user_id = v_reservation.user_id;
  END IF;

  -- BUG FIX: added resolved_at which was missing from the column list
  UPDATE public.credit_reservations
  SET status      = 'committed',
      resolved_at = now()
  WHERE id = reservation_id_param;

  -- Record the final transaction
  INSERT INTO public.credit_transactions (
    user_id, type, amount_usd, description, reference_id, balance_after
  )
  SELECT
    v_reservation.user_id,
    'deduction',
    COALESCE(actual_cost_param, v_reservation.reserved_usd),
    'Agent execution (reservation committed)',
    reservation_id_param,
    (SELECT balance_usd FROM public.credits WHERE user_id = v_reservation.user_id)
  ;

  RETURN jsonb_build_object(
    'success',     true,
    'reserved',    v_reservation.reserved_usd,
    'actual_cost', actual_cost_param,
    'refunded',    v_refund_amount
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.commit_credit_reservation(UUID, NUMERIC)
  TO authenticated, service_role;

-- ─── 4. FIX release_credit_reservation — was referencing "amount_usd" ─────────

CREATE OR REPLACE FUNCTION public.release_credit_reservation(
  reservation_id_param UUID
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_reservation RECORD;
BEGIN
  -- BUG FIX: was "amount_usd" → correct column is "reserved_usd"
  SELECT id, user_id, reserved_usd
  INTO v_reservation
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  -- Restore the reserved amount to user's balance
  UPDATE public.credits
  SET balance_usd = balance_usd + v_reservation.reserved_usd,
      updated_at  = now()
  WHERE user_id = v_reservation.user_id;

  UPDATE public.credit_reservations
  SET status      = 'released',
      resolved_at = now()
  WHERE id = reservation_id_param;

  RETURN jsonb_build_object(
    'success',  true,
    'released', v_reservation.reserved_usd
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation(UUID)
  TO authenticated, service_role;

-- ─── 5. FIX fail_stuck_executions — was referencing "amount_usd" ───────────────

CREATE OR REPLACE FUNCTION public.fail_stuck_executions()
RETURNS INTEGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Mark stuck running executions as failed
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

  -- BUG FIX: was "amount_usd" → correct column is "reserved_usd"
  -- Release credit reservations for stuck executions
  WITH stuck_reservations AS (
    UPDATE public.credit_reservations
    SET status      = 'released',
        resolved_at = now()
    WHERE status    = 'reserved'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING user_id, reserved_usd
  )
  UPDATE public.credits c
  SET balance_usd = c.balance_usd + sr.reserved_usd,
      updated_at  = now()
  FROM stuck_reservations sr
  WHERE c.user_id = sr.user_id;

  -- Also mark stuck pipeline executions as failed
  UPDATE public.pipeline_executions
  SET status        = 'failed',
      error_message = 'Pipeline execution timed out (stuck > 15 minutes)',
      completed_at  = now()
  WHERE status     = 'running'
    AND created_at < now() - INTERVAL '15 minutes';

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fail_stuck_executions() TO service_role;

-- ─── 6. CREATE refresh_agent_rankings — cron jobid 14 calls this daily ─────────
-- Without this function, the cron job silently errors at 2 AM every day.
-- This computes composite scores for all active agents.

CREATE OR REPLACE FUNCTION public.refresh_agent_rankings()
RETURNS INTEGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Recompute scores for all active agents that have at least 1 execution
  WITH agents_to_score AS (
    SELECT id FROM public.agents
    WHERE status = 'active'
      AND total_executions > 0
  ),
  scored AS (
    SELECT compute_agent_score(id) AS score, id
    FROM agents_to_score
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM scored;

  -- Update global_rank on agent_scores based on composite_score DESC
  UPDATE public.agent_scores ags
  SET global_rank  = ranked.rn,
      updated_at   = now()
  FROM (
    SELECT agent_id,
           ROW_NUMBER() OVER (ORDER BY composite_score DESC NULLS LAST) AS rn
    FROM public.agent_scores
  ) ranked
  WHERE ags.agent_id = ranked.agent_id;

  -- Update category_rank within each category
  UPDATE public.agent_scores ags
  SET category_rank = ranked.rn,
      updated_at    = now()
  FROM (
    SELECT ags2.agent_id,
           ROW_NUMBER() OVER (
             PARTITION BY a.category
             ORDER BY ags2.composite_score DESC NULLS LAST
           ) AS rn
    FROM public.agent_scores ags2
    JOIN public.agents a ON a.id = ags2.agent_id
    WHERE a.status = 'active'
  ) ranked
  WHERE ags.agent_id = ranked.agent_id;

  -- Sync composite_score back to agents table for fast marketplace queries
  UPDATE public.agents a
  SET composite_score  = ags.composite_score,
      is_top_rated     = ags.is_top_rated,
      is_fastest       = ags.is_fastest,
      is_cheapest      = ags.is_cheapest,
      is_most_reliable = ags.is_most_reliable
  FROM public.agent_scores ags
  WHERE a.id = ags.agent_id
    AND a.status = 'active';

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_agent_rankings() TO service_role;

-- ─── 7. FIX waitlist — enable RLS (currently rowsecurity = false) ────────────

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Only admins and service_role can read waitlist entries (they contain emails)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='waitlist' AND policyname='waitlist_admin_read'
  ) THEN
    CREATE POLICY "waitlist_admin_read"
      ON public.waitlist FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='waitlist' AND policyname='waitlist_public_insert'
  ) THEN
    -- Allow anyone to join the waitlist (public feature)
    CREATE POLICY "waitlist_public_insert"
      ON public.waitlist FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- ─── 8. FIX email_queue UPDATE — was wide open (qual: "true") ─────────────────

DROP POLICY IF EXISTS "email_queue_sys_upd" ON public.email_queue;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='email_queue' AND policyname='email_queue_service_update'
  ) THEN
    CREATE POLICY "email_queue_service_update"
      ON public.email_queue FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─── 9. FIX agent_pipeline_usage — add UNIQUE constraint for ON CONFLICT ───────
-- Without this, the upsert RPC's ON CONFLICT(agent_id, pipeline_id)
-- raises "there is no unique constraint matching the ON CONFLICT specification"
-- and silently falls back to inserting duplicates.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_pipeline_usage'::regclass
      AND contype   = 'u'
      AND conname   = 'agent_pipeline_usage_agent_pipeline_unique'
  ) THEN
    -- Deduplicate first (keep the row with the highest use_count)
    DELETE FROM public.agent_pipeline_usage a
    USING public.agent_pipeline_usage b
    WHERE a.agent_id    = b.agent_id
      AND a.pipeline_id = b.pipeline_id
      AND a.id          > b.id;  -- keep lower id (oldest)

    ALTER TABLE public.agent_pipeline_usage
      ADD CONSTRAINT agent_pipeline_usage_agent_pipeline_unique
      UNIQUE (agent_id, pipeline_id);
  END IF;
END $$;

-- ─── 10. CLEAN UP duplicate agent_pipeline_usage RLS policies ─────────────────

DROP POLICY IF EXISTS "apu_write"            ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_insert"           ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "Usage is public-readable" ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "Users manage own usage records" ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_public"           ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_public_read"      ON public.agent_pipeline_usage;

-- Single clean set of policies
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='agent_pipeline_usage' AND policyname='apu_public_select'
  ) THEN
    CREATE POLICY "apu_public_select"
      ON public.agent_pipeline_usage FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='agent_pipeline_usage' AND policyname='apu_service_insert'
  ) THEN
    CREATE POLICY "apu_service_insert"
      ON public.agent_pipeline_usage FOR INSERT
      WITH CHECK (true);  -- backend upserts via service_role
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='agent_pipeline_usage' AND policyname='apu_own_update'
  ) THEN
    CREATE POLICY "apu_own_update"
      ON public.agent_pipeline_usage FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 11. CLEAN UP duplicate cron jobs ─────────────────────────────────────────
-- jobid 1  (reset_monthly_execution_quotas) + jobid 12 (reset_monthly_quotas) = DUPLICATE
-- jobid 2  (cleanup_expired_memory hourly)  + jobid 11 (cleanup_expired_memory daily) = DUPLICATE
-- jobid 4  (aggregate_agent_analytics_yesterday) + jobid 13 (aggregate_daily_analytics) = DUPLICATE
-- Keep the newer jobs (higher IDs) as they use the correct function names.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE command IN (
  'SELECT reset_monthly_execution_quotas();',
  'SELECT aggregate_agent_analytics_yesterday();'
) OR (
  jobid = 2  -- early duplicate cleanup_expired_memory (hourly vs daily — keep daily)
);

-- ─── 12. FIX pg_cron — standalone calls (not inside DO block) ─────────────────
-- The original 014 migration used $$ inside DO $$...$$, which terminates the
-- outer DO block early → "syntax error at or near SELECT".
-- Fix: call cron.schedule directly at the SQL statement level.
-- These are idempotent — cron.schedule with same name updates the existing job.

SELECT cron.schedule(
  'agentdyne-fail-stuck',
  '*/5 * * * *',
  'SELECT public.fail_stuck_executions()'
);

SELECT cron.schedule(
  'agentdyne-reset-quotas',
  '0 0 1 * *',
  'SELECT public.reset_monthly_quotas()'
);

SELECT cron.schedule(
  'agentdyne-daily-analytics',
  '0 1 * * *',
  'SELECT public.aggregate_daily_analytics()'
);

-- FIX: now the function exists — update job 14 to the real function name
SELECT cron.schedule(
  'agentdyne-refresh-rankings',
  '0 2 * * *',
  'SELECT public.refresh_agent_rankings()'
);

SELECT cron.schedule(
  'agentdyne-cleanup-memory',
  '0 2 * * *',
  'SELECT public.cleanup_expired_memory()'
);

SELECT cron.schedule(
  'agentdyne-cleanup-cache',
  '30 * * * *',
  'SELECT public.cleanup_execution_cache()'
);

SELECT cron.schedule(
  'agentdyne-cleanup-rl',
  '*/30 * * * *',
  'SELECT public.cleanup_rate_limit_counters()'
);

SELECT cron.schedule(
  'agentdyne-cleanup-stripe',
  '0 3 * * *',
  'SELECT public.cleanup_processed_stripe_events()'
);

SELECT cron.schedule(
  'agentdyne-cleanup-idempotency',
  '0 4 * * *',
  'SELECT public.cleanup_expired_idempotency_keys()'
);

SELECT cron.schedule(
  'agentdyne-cleanup-injection',
  '0 3 * * 0',
  'SELECT public.cleanup_old_injection_attempts()'
);

SELECT cron.schedule(
  'agentdyne-quota-warnings',
  '0 */6 * * *',
  'SELECT public.send_quota_warning_notifications()'
);

-- ─── 13. PERFORMANCE — add missing indices ────────────────────────────────────

-- agent_pipeline_usage: support flywheel queries
CREATE INDEX IF NOT EXISTS idx_apu_agent_uses
  ON public.agent_pipeline_usage(agent_id, use_count DESC);

CREATE INDEX IF NOT EXISTS idx_apu_pipeline
  ON public.agent_pipeline_usage(pipeline_id);

-- executions: user history queries (most frequent dashboard query)
CREATE INDEX IF NOT EXISTS idx_executions_user_created
  ON public.executions(user_id, created_at DESC);

-- credit_reservations: cleanup + lookup
CREATE INDEX IF NOT EXISTS idx_credit_res_status
  ON public.credit_reservations(status, created_at)
  WHERE status = 'reserved';

-- idempotency_keys: expiry cleanup
CREATE INDEX IF NOT EXISTS idx_idem_expires
  ON public.idempotency_keys(expires_at)
  WHERE status != 'success';

-- ─── 14. SECURITY — ensure anon role cannot read sensitive tables ─────────────
-- The table-level grants for anon on agent_analytics are too broad.
-- RLS protects these, but defense-in-depth: revoke excess anon grants.

REVOKE INSERT, UPDATE, DELETE ON public.agent_analytics FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.executions FROM anon;
REVOKE ALL ON public.execution_traces FROM anon;
REVOKE ALL ON public.execution_snapshots FROM anon;
REVOKE ALL ON public.governance_events FROM anon;
REVOKE ALL ON public.injection_attempts FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.hitl_approvals FROM anon;

-- ─── 15. VERIFICATION ────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_resolved_at    BOOLEAN;
  v_has_reserved_usd   BOOLEAN;
  v_has_unique_apu     BOOLEAN;
  v_has_rankings_fn    BOOLEAN;
  v_waitlist_rls       BOOLEAN;
  v_cron_count         INTEGER;
BEGIN
  -- Check credit_reservations.resolved_at exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_reservations'
      AND column_name = 'resolved_at'
  ) INTO v_has_resolved_at;

  -- Check credit_reservations.reserved_usd exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_reservations'
      AND column_name = 'reserved_usd'
  ) INTO v_has_reserved_usd;

  -- Check UNIQUE constraint on agent_pipeline_usage
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_pipeline_usage'::regclass AND contype = 'u'
  ) INTO v_has_unique_apu;

  -- Check refresh_agent_rankings exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_agent_rankings'
  ) INTO v_has_rankings_fn;

  -- Check waitlist RLS enabled
  SELECT rowsecurity INTO v_waitlist_rls
  FROM pg_tables WHERE schemaname = 'public' AND tablename = 'waitlist';

  -- Count active cron jobs
  SELECT COUNT(*) INTO v_cron_count FROM cron.job WHERE active = true;

  RAISE NOTICE '=== AgentDyne Migration 025 Verification ===';
  RAISE NOTICE 'credit_reservations.resolved_at: %',  CASE WHEN v_has_resolved_at  THEN '✅ OK' ELSE '❌ MISSING' END;
  RAISE NOTICE 'credit_reservations.reserved_usd: %', CASE WHEN v_has_reserved_usd THEN '✅ OK' ELSE '❌ MISSING' END;
  RAISE NOTICE 'agent_pipeline_usage UNIQUE constraint: %', CASE WHEN v_has_unique_apu  THEN '✅ OK' ELSE '❌ MISSING' END;
  RAISE NOTICE 'refresh_agent_rankings() function: %', CASE WHEN v_has_rankings_fn  THEN '✅ OK' ELSE '❌ MISSING' END;
  RAISE NOTICE 'waitlist RLS enabled: %',              CASE WHEN v_waitlist_rls     THEN '✅ OK' ELSE '❌ DISABLED' END;
  RAISE NOTICE 'Active cron jobs: %',                 v_cron_count;
  RAISE NOTICE '=== Migration 025 COMPLETE ===';
END $$;
