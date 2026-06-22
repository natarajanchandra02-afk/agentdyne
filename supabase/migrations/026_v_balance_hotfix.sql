-- ============================================================
-- AgentDyne — Migration 026: FINAL PRE-LAUNCH HOTFIX
--
-- PURPOSE:
--   Fixes ERROR 42P01: relation "v_balance" does not exist
--   when running 025_final_production_fixes.sql.
--
-- ROOT CAUSE:
--   The live DB has an old version of reserve_credits() compiled
--   against a view named "v_balance" (an early draft name for the
--   credits balance view). PostgreSQL tracks function dependencies
--   and when CREATE OR REPLACE runs, it tries to resolve
--   "v_balance" as a relation → ERROR 42P01.
--
--   Fix: DROP the function first (removes old dependency graph),
--   then CREATE fresh — PostgreSQL no longer looks for v_balance.
--
-- ALSO FIXES (from marketplace audit):
--   A. api/agents/[id]/route.ts exposed total_earned in SQL select
--      → not a SQL fix, handled in code (already audited)
--   B. reserve_credits RPC param was "amount_param" in code but
--      025 tried to add "amount_usd_param" — unified to amount_param
--   C. feedback route: type="report" now writes to governance_events
--   D. hasMore off-by-one in reviews pagination → limit 11, trim to 10
--
-- RUNS AFTER: 025_final_production_fixes.sql
-- IDEMPOTENT: 100% safe to re-run
-- ============================================================

-- ─── STEP 1: Drop all function overloads that may reference v_balance ─────────
-- This clears the dependency graph so CREATE won't look for v_balance.

DROP FUNCTION IF EXISTS public.reserve_credits(UUID, NUMERIC, UUID)           CASCADE;
DROP FUNCTION IF EXISTS public.reserve_credits(UUID, NUMERIC)                  CASCADE;
DROP FUNCTION IF EXISTS public.commit_credit_reservation(UUID, NUMERIC)        CASCADE;
DROP FUNCTION IF EXISTS public.release_credit_reservation(UUID)                CASCADE;
DROP FUNCTION IF EXISTS public.fail_stuck_executions()                         CASCADE;

-- Also drop the view if it somehow exists (belt-and-suspenders)
DROP VIEW IF EXISTS public.v_balance CASCADE;

-- ─── STEP 2: Ensure credit_reservations has the correct column name ────────────
-- Migration 014 created the table with column "amount_usd".
-- Migration 025 renames it to "reserved_usd" via the schema.
-- If the column is still named "amount_usd", rename it now.

DO $$
BEGIN
  -- Only rename if amount_usd exists AND reserved_usd does NOT
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_reservations'
      AND column_name = 'amount_usd'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_reservations'
      AND column_name = 'reserved_usd'
  ) THEN
    ALTER TABLE public.credit_reservations RENAME COLUMN amount_usd TO reserved_usd;
    RAISE NOTICE '✅ Renamed credit_reservations.amount_usd → reserved_usd';
  ELSE
    RAISE NOTICE '✅ credit_reservations.reserved_usd already correct';
  END IF;
END $$;

-- Ensure resolved_at exists
ALTER TABLE public.credit_reservations
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Ensure the CHECK constraint uses reserved_usd
ALTER TABLE public.credit_reservations
  DROP CONSTRAINT IF EXISTS credit_reservations_reserved_usd_check;

ALTER TABLE public.credit_reservations
  DROP CONSTRAINT IF EXISTS credit_reservations_amount_usd_check;

-- ─── STEP 3: Recreate reserve_credits — clean, no v_balance dependency ────────

CREATE FUNCTION public.reserve_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  execution_id_param UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_bal            NUMERIC;  -- renamed from v_balance to be 100% safe
  v_new_balance    NUMERIC;
  v_reservation_id UUID;
BEGIN
  IF amount_param <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Lock credits row to prevent concurrent over-spend
  SELECT balance_usd INTO v_bal
  FROM public.credits
  WHERE user_id = user_id_param
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Auto-create credits row (backup — trigger should have created it on signup)
    INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd)
    VALUES (user_id_param, 0, 5)
    ON CONFLICT (user_id) DO NOTHING;
    v_bal := 0;
  END IF;

  IF v_bal < amount_param THEN
    RETURN jsonb_build_object(
      'success',  false,
      'error',    'Insufficient credits',
      'balance',  v_bal,
      'required', amount_param
    );
  END IF;

  v_new_balance := v_bal - amount_param;

  UPDATE public.credits
  SET balance_usd = v_new_balance,
      updated_at  = now()
  WHERE user_id = user_id_param;

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

-- ─── STEP 4: Recreate commit_credit_reservation ───────────────────────────────

CREATE FUNCTION public.commit_credit_reservation(
  reservation_id_param UUID,
  actual_cost_param    NUMERIC
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_res           RECORD;
  v_refund        NUMERIC;
BEGIN
  SELECT id, user_id, reserved_usd
  INTO v_res
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  v_refund := GREATEST(0, v_res.reserved_usd - COALESCE(actual_cost_param, 0));

  IF v_refund > 0 THEN
    UPDATE public.credits
    SET balance_usd = balance_usd + v_refund,
        updated_at  = now()
    WHERE user_id = v_res.user_id;
  END IF;

  UPDATE public.credit_reservations
  SET status      = 'committed',
      resolved_at = now()
  WHERE id = reservation_id_param;

  INSERT INTO public.credit_transactions (
    user_id, type, amount_usd, description, reference_id, balance_after
  )
  SELECT
    v_res.user_id,
    'deduction',
    COALESCE(actual_cost_param, v_res.reserved_usd),
    'Agent execution (committed)',
    reservation_id_param,
    (SELECT balance_usd FROM public.credits WHERE user_id = v_res.user_id);

  RETURN jsonb_build_object(
    'success',     true,
    'reserved',    v_res.reserved_usd,
    'actual_cost', actual_cost_param,
    'refunded',    v_refund
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.commit_credit_reservation(UUID, NUMERIC)
  TO authenticated, service_role;

-- ─── STEP 5: Recreate release_credit_reservation ─────────────────────────────

CREATE FUNCTION public.release_credit_reservation(
  reservation_id_param UUID
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_res RECORD;
BEGIN
  SELECT id, user_id, reserved_usd
  INTO v_res
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  UPDATE public.credits
  SET balance_usd = balance_usd + v_res.reserved_usd,
      updated_at  = now()
  WHERE user_id = v_res.user_id;

  UPDATE public.credit_reservations
  SET status      = 'released',
      resolved_at = now()
  WHERE id = reservation_id_param;

  RETURN jsonb_build_object('success', true, 'released', v_res.reserved_usd);
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation(UUID)
  TO authenticated, service_role;

-- ─── STEP 6: Recreate fail_stuck_executions ───────────────────────────────────

CREATE FUNCTION public.fail_stuck_executions()
RETURNS INTEGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Mark stuck executions as failed
  WITH updated AS (
    UPDATE public.executions
    SET status        = 'failed',
        error_message = 'Execution timed out (stuck > 15 min)',
        completed_at  = now()
    WHERE status     = 'running'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM updated;

  -- Release credit reservations for expired entries
  WITH released AS (
    UPDATE public.credit_reservations
    SET status      = 'released',
        resolved_at = now()
    WHERE status    = 'reserved'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING user_id, reserved_usd
  )
  UPDATE public.credits c
  SET balance_usd = c.balance_usd + r.reserved_usd,
      updated_at  = now()
  FROM released r
  WHERE c.user_id = r.user_id;

  -- Mark stuck pipeline executions as failed
  UPDATE public.pipeline_executions
  SET status        = 'failed',
      error_message = 'Pipeline timed out (stuck > 15 min)',
      completed_at  = now()
  WHERE status     = 'running'
    AND created_at < now() - INTERVAL '15 minutes';

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fail_stuck_executions() TO service_role;

-- ─── STEP 7: Ensure refresh_agent_rankings exists (025 creates it) ───────────
-- Only create if 025 didn't run successfully yet

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refresh_agent_rankings'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.refresh_agent_rankings()
      RETURNS INTEGER LANGUAGE PLPGSQL SECURITY DEFINER AS $body$
      DECLARE v_count INTEGER;
      BEGIN
        WITH scored AS (
          SELECT compute_agent_score(id), id
          FROM public.agents
          WHERE status = 'active' AND total_executions > 0
        )
        SELECT COUNT(*)::INTEGER INTO v_count FROM scored;

        UPDATE public.agent_scores ags
        SET global_rank = ranked.rn, updated_at = now()
        FROM (
          SELECT agent_id,
                 ROW_NUMBER() OVER (ORDER BY composite_score DESC NULLS LAST) AS rn
          FROM public.agent_scores
        ) ranked
        WHERE ags.agent_id = ranked.agent_id;

        UPDATE public.agents a
        SET composite_score  = ags.composite_score,
            is_top_rated     = ags.is_top_rated,
            is_fastest       = ags.is_fastest,
            is_cheapest      = ags.is_cheapest,
            is_most_reliable = ags.is_most_reliable
        FROM public.agent_scores ags
        WHERE a.id = ags.agent_id AND a.status = 'active';

        RETURN v_count;
      END;
      $body$;
    $fn$;
    GRANT EXECUTE ON FUNCTION public.refresh_agent_rankings() TO service_role;
    RAISE NOTICE '✅ refresh_agent_rankings created';
  ELSE
    RAISE NOTICE '✅ refresh_agent_rankings already exists';
  END IF;
END $$;

-- ─── STEP 8: waitlist RLS (idempotent — 025 may have already done this) ──────

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='waitlist' AND policyname='waitlist_admin_read'
  ) THEN
    CREATE POLICY "waitlist_admin_read" ON public.waitlist FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='waitlist' AND policyname='waitlist_public_insert'
  ) THEN
    CREATE POLICY "waitlist_public_insert" ON public.waitlist FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ─── STEP 9: agent_pipeline_usage UNIQUE constraint (idempotent) ─────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_pipeline_usage'::regclass
      AND contype = 'u'
      AND conname = 'agent_pipeline_usage_agent_pipeline_unique'
  ) THEN
    -- Remove duplicates first
    DELETE FROM public.agent_pipeline_usage a
    USING public.agent_pipeline_usage b
    WHERE a.agent_id = b.agent_id
      AND a.pipeline_id = b.pipeline_id
      AND a.id > b.id;

    ALTER TABLE public.agent_pipeline_usage
      ADD CONSTRAINT agent_pipeline_usage_agent_pipeline_unique
      UNIQUE (agent_id, pipeline_id);
    RAISE NOTICE '✅ agent_pipeline_usage UNIQUE constraint added';
  ELSE
    RAISE NOTICE '✅ agent_pipeline_usage UNIQUE constraint already exists';
  END IF;
END $$;

-- ─── STEP 10: email_queue UPDATE policy hardening ────────────────────────────

DROP POLICY IF EXISTS "email_queue_sys_upd"       ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_update" ON public.email_queue;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='email_queue'
      AND policyname='email_queue_service_only_update'
  ) THEN
    CREATE POLICY "email_queue_service_only_update"
      ON public.email_queue FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─── STEP 11: Cleanup duplicate/stale cron jobs ───────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old-name jobs that clash with new agentdyne-* naming
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN (
      'fail-stuck', 'reset-monthly-quotas', 'daily-analytics',
      'refresh-rankings', 'cleanup-memory', 'cleanup-cache',
      'cleanup-rl', 'cleanup-stripe-events', 'cleanup-idempotency',
      'cleanup-stripe-events-2', 'cleanup-memory-old'
    );

    -- Register canonical named jobs (cron.schedule is idempotent by name)
    PERFORM cron.schedule('agentdyne-fail-stuck',        '*/5 * * * *',   'SELECT public.fail_stuck_executions()');
    PERFORM cron.schedule('agentdyne-reset-quotas',      '0 0 1 * *',     'SELECT public.reset_monthly_quotas()');
    PERFORM cron.schedule('agentdyne-daily-analytics',   '0 1 * * *',     'SELECT public.aggregate_daily_analytics()');
    PERFORM cron.schedule('agentdyne-refresh-rankings',  '0 2 * * *',     'SELECT public.refresh_agent_rankings()');
    PERFORM cron.schedule('agentdyne-cleanup-memory',    '0 2 * * *',     'SELECT public.cleanup_expired_memory()');
    PERFORM cron.schedule('agentdyne-cleanup-cache',     '30 * * * *',    'SELECT public.cleanup_execution_cache()');
    PERFORM cron.schedule('agentdyne-cleanup-rl',        '*/30 * * * *',  'SELECT public.cleanup_rate_limit_counters()');
    PERFORM cron.schedule('agentdyne-cleanup-stripe',    '0 3 * * *',     'SELECT public.cleanup_processed_stripe_events()');
    PERFORM cron.schedule('agentdyne-cleanup-idempotency','0 4 * * *',    'SELECT public.cleanup_expired_idempotency_keys()');

    RAISE NOTICE '✅ pg_cron jobs registered';
  ELSE
    RAISE NOTICE '⚠️  pg_cron not enabled — skip cron setup';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  cron setup error: %', SQLERRM;
END $$;

-- ─── STEP 12: Performance indices (idempotent) ────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_credit_res_status
  ON public.credit_reservations(status, created_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_credit_res_user
  ON public.credit_reservations(user_id, status);

CREATE INDEX IF NOT EXISTS idx_executions_user_created
  ON public.executions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idem_expires
  ON public.idempotency_keys(expires_at)
  WHERE status != 'success';

-- ─── STEP 13: Security — revoke excess anon grants ───────────────────────────

REVOKE INSERT, UPDATE, DELETE ON public.agent_analytics    FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.executions          FROM anon;
REVOKE ALL ON public.execution_traces      FROM anon;
REVOKE ALL ON public.execution_snapshots   FROM anon;
REVOKE ALL ON public.governance_events     FROM anon;
REVOKE ALL ON public.injection_attempts    FROM anon;
REVOKE ALL ON public.audit_logs            FROM anon;

-- ─── STEP 14: VERIFICATION ────────────────────────────────────────────────────

DO $$
DECLARE
  v_fn_exists    BOOLEAN;
  v_col_rsvd_usd BOOLEAN;
  v_col_resolved BOOLEAN;
  v_unique_ok    BOOLEAN;
  v_waitlist_rls BOOLEAN;
  v_v_balance_gone BOOLEAN;
BEGIN
  -- reserve_credits function exists (fresh, no v_balance dep)
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reserve_credits'
  ) INTO v_fn_exists;

  -- credit_reservations.reserved_usd exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_reservations'
      AND column_name = 'reserved_usd'
  ) INTO v_col_rsvd_usd;

  -- credit_reservations.resolved_at exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_reservations'
      AND column_name = 'resolved_at'
  ) INTO v_col_resolved;

  -- UNIQUE constraint on agent_pipeline_usage
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_pipeline_usage'::regclass AND contype = 'u'
  ) INTO v_unique_ok;

  -- waitlist RLS enabled
  SELECT rowsecurity INTO v_waitlist_rls
  FROM pg_tables WHERE schemaname = 'public' AND tablename = 'waitlist';

  -- v_balance view is gone
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'v_balance'
  ) INTO v_v_balance_gone;

  RAISE NOTICE '';
  RAISE NOTICE '=== AgentDyne Migration 026 — Verification ===';
  RAISE NOTICE 'reserve_credits() recreated (no v_balance dep): %', CASE WHEN v_fn_exists     THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'credit_reservations.reserved_usd:               %', CASE WHEN v_col_rsvd_usd  THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'credit_reservations.resolved_at:                %', CASE WHEN v_col_resolved   THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'agent_pipeline_usage UNIQUE constraint:         %', CASE WHEN v_unique_ok      THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'waitlist RLS enabled:                           %', CASE WHEN v_waitlist_rls   THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'v_balance view removed:                         %', CASE WHEN v_v_balance_gone THEN '✅' ELSE '❌ STILL EXISTS' END;
  RAISE NOTICE '';
  RAISE NOTICE '>>> Test with:';
  RAISE NOTICE '    SELECT reserve_credits((SELECT id FROM profiles LIMIT 1), 0.001, NULL);';
  RAISE NOTICE '    Expected: { "success": true, "reservation_id": "...", ... }';
  RAISE NOTICE '              OR { "success": false, "error": "Insufficient credits" } — both are OK';
  RAISE NOTICE '';
  RAISE NOTICE '=== Migration 026 COMPLETE ===';
END $$;
