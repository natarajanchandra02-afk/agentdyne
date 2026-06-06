-- ============================================================
-- AgentDyne Migration 034 — Final Pre-Launch Hardening (FIXED)
-- 
-- FIX: All cron.schedule calls now use PERFORM inside DO blocks
--      (not $$SELECT...$$, which terminates the outer DO $$ block)
-- ============================================================

-- ── 1. Fix increment_executions_used ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_executions_used(user_id_param UUID)
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.profiles
  SET
    executions_used_this_month = COALESCE(executions_used_this_month, 0) + 1,
    lifetime_executions_used   = COALESCE(lifetime_executions_used, 0) + 1,
    free_executions_remaining  = CASE
      WHEN subscription_plan::text = 'free'
      THEN GREATEST(0, COALESCE(free_executions_remaining, 50) - 1)
      ELSE free_executions_remaining
    END,
    updated_at = now()
  WHERE id = user_id_param;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.increment_executions_used(UUID) TO authenticated, service_role;

-- ── 2. Missing profiles columns for billing page ──────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS monthly_spent_usd  NUMERIC(12,6) DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS compute_cap_usd    NUMERIC(12,2) DEFAULT 5.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_compute_usd  NUMERIC(12,6) DEFAULT 0;

UPDATE public.profiles SET compute_cap_usd =
  CASE subscription_plan::text
    WHEN 'starter'    THEN 10.00
    WHEN 'pro'        THEN 50.00
    WHEN 'enterprise' THEN 9999.00
    ELSE 5.00
  END
WHERE compute_cap_usd IS NULL OR compute_cap_usd = 5.00;

-- ── 3. record_execution_spend RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_execution_spend(
  user_id_param UUID,
  amount_usd    NUMERIC
)
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.profiles
  SET
    monthly_spent_usd = COALESCE(monthly_spent_usd, 0) + amount_usd,
    total_compute_usd = COALESCE(total_compute_usd, 0) + amount_usd,
    updated_at        = now()
  WHERE id = user_id_param;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.record_execution_spend(UUID, NUMERIC) TO authenticated, service_role;

-- ── 4. reset_monthly_quotas — also resets monthly_spent_usd ──────────────────
CREATE OR REPLACE FUNCTION public.reset_monthly_quotas()
RETURNS INTEGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.profiles
  SET
    executions_used_this_month = 0,
    monthly_spent_usd          = 0,
    quota_reset_date           = date_trunc('month', now()) + INTERVAL '1 month',
    updated_at                 = now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.reset_monthly_quotas() TO service_role;

-- ── 5. Idempotency UNIQUE constraint ─────────────────────────────────────────
DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'executions_idempotency_key_unique'
      AND conrelid = 'public.executions'::regclass
  ) THEN
    DELETE FROM public.executions e1
    USING public.executions e2
    WHERE e1.idempotency_key = e2.idempotency_key
      AND e1.idempotency_key IS NOT NULL
      AND e1.created_at < e2.created_at;

    ALTER TABLE public.executions
      ADD CONSTRAINT executions_idempotency_key_unique UNIQUE (idempotency_key);
    RAISE NOTICE 'executions.idempotency_key UNIQUE constraint added';
  END IF;
END;
$block$;

-- ── 6. cleanup_expired_memory ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_memory()
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH deleted AS (
    DELETE FROM public.agent_memory
    WHERE ttl_at IS NOT NULL AND ttl_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$fn$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memory() TO service_role;

-- ── 7. fail_stuck_executions ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_stuck_executions()
RETURNS INTEGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE public.executions
    SET status        = 'failed',
        error_message = 'Execution timed out (stuck > 15 minutes). Credits refunded.',
        completed_at  = now()
    WHERE status = 'running'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM updated;

  UPDATE public.pipeline_executions
  SET status        = 'failed',
      error_message = 'Pipeline timed out (stuck > 15 minutes)',
      completed_at  = now()
  WHERE status = 'running'
    AND created_at < now() - INTERVAL '15 minutes';

  WITH stuck_res AS (
    UPDATE public.credit_reservations
    SET status      = 'released',
        resolved_at = now()
    WHERE status = 'reserved'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING user_id, reserved_usd
  )
  UPDATE public.credits c
  SET balance_usd = c.balance_usd + sr.reserved_usd,
      updated_at  = now()
  FROM stuck_res sr
  WHERE c.user_id = sr.user_id;

  RETURN v_count;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.fail_stuck_executions() TO service_role;

-- ── 8. fail_stuck_queue_jobs — referenced by cron but may not exist ───────────
-- Create if missing so cron job doesn't error every 5 minutes
CREATE OR REPLACE FUNCTION public.fail_stuck_queue_jobs()
RETURNS INTEGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_count INTEGER;
BEGIN
  -- Mark execution_queue jobs stuck > 10 minutes as failed
  WITH updated AS (
    UPDATE public.execution_queue
    SET status        = 'failed',
        error_message = 'Job timed out (stuck in processing > 10 minutes)',
        completed_at  = now()
    WHERE status = 'processing'
      AND started_at < now() - INTERVAL '10 minutes'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM updated;

  -- Re-queue jobs eligible for retry
  UPDATE public.execution_queue
  SET status        = 'queued',
      next_retry_at = now() + INTERVAL '30 seconds',
      attempts      = attempts + 1
  WHERE status = 'failed'
    AND attempts < max_attempts
    AND (next_retry_at IS NULL OR next_retry_at <= now());

  RETURN v_count;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.fail_stuck_queue_jobs() TO service_role;

-- ── 9. check_compute_cap ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_compute_cap(user_id_param UUID)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_spent NUMERIC;
  v_cap   NUMERIC;
BEGIN
  SELECT
    COALESCE(monthly_spent_usd, 0),
    COALESCE(compute_cap_usd, 5)
  INTO v_spent, v_cap
  FROM public.profiles
  WHERE id = user_id_param;

  IF v_cap < 0 OR v_cap >= 9999 THEN
    RETURN jsonb_build_object('within_cap', true, 'spent', v_spent, 'cap', null);
  END IF;

  IF v_spent >= v_cap THEN
    RETURN jsonb_build_object(
      'within_cap', false, 'spent', v_spent, 'cap', v_cap,
      'error', format('Monthly compute cap of $%s reached. Upgrade or wait for next billing cycle.', v_cap)
    );
  END IF;

  RETURN jsonb_build_object('within_cap', true, 'spent', v_spent, 'cap', v_cap);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.check_compute_cap(UUID) TO authenticated, service_role;

-- ── 10. Performance indexes for cron functions ────────────────────────────────

-- fail_stuck_executions scans running executions older than 15 min
CREATE INDEX IF NOT EXISTS idx_executions_running_old
  ON public.executions(status, created_at)
  WHERE status = 'running';

-- fail_stuck_queue_jobs scans processing queue jobs
CREATE INDEX IF NOT EXISTS idx_exec_queue_processing
  ON public.execution_queue(status, started_at)
  WHERE status = 'processing';

-- send_quota_warning_notifications scans profiles by plan + quota usage
CREATE INDEX IF NOT EXISTS idx_profiles_quota_warning
  ON public.profiles(subscription_plan, executions_used_this_month, monthly_execution_quota)
  WHERE is_banned = false;

-- auto_disable_low_quality_agents scans agents by score + execution count
CREATE INDEX IF NOT EXISTS idx_agents_quality_check
  ON public.agents(status, composite_score, total_executions)
  WHERE status::text = 'active';

-- credit_reservations cleanup
CREATE INDEX IF NOT EXISTS idx_credit_res_stuck
  ON public.credit_reservations(status, created_at)
  WHERE status = 'reserved';

-- ── 11. FIX: Register/update cron jobs — use PERFORM inside DO block ──────────
-- CRITICAL: never use $$SELECT...$$  inside DO $$...$$
-- That causes the outer DO block to terminate at the inner $$ delimiter.
-- Correct pattern: PERFORM cron.schedule(..., 'SELECT fn()') inside DO block.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Core maintenance
    PERFORM cron.schedule('agentdyne-fail-stuck',          '*/5 * * * *',    'SELECT public.fail_stuck_executions()');
    PERFORM cron.schedule('agentdyne-fail-queue-jobs',     '*/5 * * * *',    'SELECT public.fail_stuck_queue_jobs()');
    PERFORM cron.schedule('agentdyne-reset-quotas',        '0 0 1 * *',      'SELECT public.reset_monthly_quotas()');
    PERFORM cron.schedule('agentdyne-daily-analytics',     '0 1 * * *',      'SELECT public.aggregate_daily_analytics()');
    PERFORM cron.schedule('agentdyne-refresh-rankings',    '0 2 * * *',      'SELECT public.refresh_agent_rankings()');

    -- Cleanup jobs
    PERFORM cron.schedule('agentdyne-cleanup-memory',      '0 4 * * *',      'SELECT public.cleanup_expired_memory()');
    PERFORM cron.schedule('agentdyne-cleanup-cache',       '30 * * * *',     'SELECT public.cleanup_execution_cache()');
    PERFORM cron.schedule('agentdyne-cleanup-rl',          '*/30 * * * *',   'SELECT public.cleanup_rate_limit_counters()');
    PERFORM cron.schedule('agentdyne-cleanup-stripe',      '0 3 * * *',      'SELECT public.cleanup_processed_stripe_events()');
    PERFORM cron.schedule('agentdyne-cleanup-idempotency', '0 4 * * *',      'SELECT public.cleanup_expired_idempotency_keys()');
    PERFORM cron.schedule('agentdyne-cleanup-injection',   '0 3 * * 0',      'SELECT public.cleanup_old_injection_attempts()');

    -- Business logic
    PERFORM cron.schedule('agentdyne-quota-warnings',      '0 */6 * * *',    'SELECT public.send_quota_warning_notifications()');
    PERFORM cron.schedule('agentdyne-hitl-expire',         '0 * * * *',      'SELECT public.expire_hitl_approvals()');
    PERFORM cron.schedule('agentdyne-share-key-reset',     '0 0 * * *',      'SELECT public.reset_share_key_daily_limits()');

    RAISE NOTICE '14 cron jobs registered';
  ELSE
    RAISE NOTICE 'pg_cron not enabled — skip cron registration';
  END IF;
END;
$cron$;

-- ── 12. Verification ─────────────────────────────────────────────────────────
DO $verify$
DECLARE v INT;
BEGIN
  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND column_name IN ('monthly_spent_usd', 'compute_cap_usd', 'lifetime_executions_used', 'free_executions_remaining');
  RAISE NOTICE 'profiles billing columns: % / 4', v;

  SELECT COUNT(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'increment_executions_used', 'record_execution_spend',
    'reset_monthly_quotas', 'fail_stuck_executions',
    'fail_stuck_queue_jobs', 'check_compute_cap'
  );
  RAISE NOTICE 'Critical RPCs: % / 6', v;

  SELECT COUNT(*) INTO v FROM pg_constraint WHERE conname = 'executions_idempotency_key_unique';
  RAISE NOTICE 'idempotency_key UNIQUE: %', CASE WHEN v = 1 THEN 'OK' ELSE 'MISSING' END;

  RAISE NOTICE '=== Migration 034 COMPLETE ===';
END;
$verify$;
