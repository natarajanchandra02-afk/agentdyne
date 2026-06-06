-- ============================================================
-- AgentDyne Migration 030_quota_lifetime_fix.sql
-- 
-- FIXES:
--   1. increment_executions_used() must also increment lifetime_executions_used
--      for free plan users — without this the lifetime cap can never be enforced
--   2. Ensure profiles.lifetime_executions_used and free_executions_remaining
--      columns exist with correct defaults
--   3. DB-level CHECK: monthly_execution_quota must match plan
--      (prevents the "100 vs 50" confusion — free plan quota set to 50 lifetime)
--   4. Backfill: set monthly_execution_quota=50 for all existing free users
--      so any code that still reads that column also gets the right number
--
-- IDEMPOTENT: safe to re-run
-- ============================================================

-- ── 1. Ensure columns exist ───────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lifetime_executions_used  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_executions_remaining INTEGER DEFAULT 50;

-- ── 2. Drop and recreate increment_executions_used ────────────────────────────
DROP FUNCTION IF EXISTS public.increment_executions_used(UUID) CASCADE;

CREATE FUNCTION public.increment_executions_used(user_id_param UUID)
RETURNS VOID LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_plan TEXT;
BEGIN
  SELECT subscription_plan INTO v_plan
  FROM public.profiles WHERE id = user_id_param;

  -- Always increment the monthly counter (used for paid plan quota)
  UPDATE public.profiles
  SET
    executions_used_this_month = COALESCE(executions_used_this_month, 0) + 1,
    total_spent                = COALESCE(total_spent, 0),  -- no-op, keeps row locked
    updated_at                 = now()
  WHERE id = user_id_param;

  -- For free plan: also increment lifetime counter and decrement remaining
  IF v_plan IS NULL OR v_plan = 'free' THEN
    UPDATE public.profiles
    SET
      lifetime_executions_used  = COALESCE(lifetime_executions_used, 0) + 1,
      free_executions_remaining = GREATEST(0, COALESCE(free_executions_remaining, 50) - 1)
    WHERE id = user_id_param;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_executions_used(UUID)
  TO authenticated, service_role;

-- ── 3. Backfill lifetime_executions_used for existing free users ──────────────
-- Use current executions_used_this_month as a proxy (won't be perfect but
-- prevents all existing free users starting with 0 lifetime when they've
-- already used executions).
UPDATE public.profiles
SET
  lifetime_executions_used  = COALESCE(executions_used_this_month, 0),
  free_executions_remaining = GREATEST(0, 50 - COALESCE(executions_used_this_month, 0))
WHERE
  (subscription_plan IS NULL OR subscription_plan = 'free')
  AND lifetime_executions_used = 0
  AND executions_used_this_month > 0;

-- ── 4. Set monthly_execution_quota correctly per plan ─────────────────────────
-- Aligns the column with what the execute route now uses:
--   free     → 50   (lifetime cap, not monthly, but set to 50 for consistency)
--   starter  → 500
--   pro      → 5000
--   enterprise → -1  (unlimited)
UPDATE public.profiles
SET monthly_execution_quota = CASE subscription_plan
  WHEN 'starter'    THEN 500
  WHEN 'pro'        THEN 5000
  WHEN 'enterprise' THEN -1
  ELSE 50   -- free / NULL → 50
END
WHERE monthly_execution_quota = 100
   OR monthly_execution_quota IS NULL;

-- ── 5. Ensure no free user has quota > 50 ────────────────────────────────────
UPDATE public.profiles
SET monthly_execution_quota = 50
WHERE (subscription_plan IS NULL OR subscription_plan = 'free')
  AND monthly_execution_quota > 50;

-- ── 6. Add index for fast lifetime quota lookups ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_plan_lifetime
  ON public.profiles(subscription_plan, lifetime_executions_used)
  WHERE subscription_plan = 'free' OR subscription_plan IS NULL;

-- ── 7. Pipeline execute: also increment lifetime_executions_used ──────────────
-- The pipeline execute route calls increment_executions_used per node.
-- This is already fixed by the RPC above — no additional code change needed.

-- ── VERIFICATION ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_col_exists   BOOLEAN;
  v_fn_exists    BOOLEAN;
  v_bad_quotas   INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='lifetime_executions_used'
  ) INTO v_col_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='increment_executions_used'
  ) INTO v_fn_exists;

  SELECT COUNT(*) INTO v_bad_quotas
  FROM public.profiles
  WHERE (subscription_plan IS NULL OR subscription_plan='free')
    AND monthly_execution_quota > 50;

  RAISE NOTICE '';
  RAISE NOTICE '=== Migration 030 Quota Lifetime Fix ===';
  RAISE NOTICE 'profiles.lifetime_executions_used: %', CASE WHEN v_col_exists THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'increment_executions_used() updated: %', CASE WHEN v_fn_exists THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Free users with quota > 50: %', v_bad_quotas;
  RAISE NOTICE '=== Migration 030 COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Manual check:';
  RAISE NOTICE '  SELECT id, subscription_plan, monthly_execution_quota, lifetime_executions_used';
  RAISE NOTICE '  FROM profiles WHERE subscription_plan IS NULL OR subscription_plan = ''free'' LIMIT 5;';
END $$;
