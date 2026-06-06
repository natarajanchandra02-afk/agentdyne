-- ============================================================
-- Migration 033: Critical column gaps + model name consistency
-- Run ONCE in Supabase SQL Editor. All statements idempotent.
--
-- Fixes discovered in final pre-launch audit (April 30, 2026):
--
-- 1. profiles missing lifetime_executions_used and free_executions_remaining
--    → execute route reads these, gets undefined → free quota NEVER enforced
-- 2. Backfill lifetime_executions_used from existing executions data
-- 3. Cleanup orphan review policy (reviews default status was 'approved')
-- 4. Unique constraint on reviews(agent_id, user_id) — must exist for upsert
-- ============================================================

-- ── 1. profiles — add lifetime execution tracking columns ─────────────────────
-- The execute route reads profile?.lifetime_executions_used for free plan gate.
-- Without this column, free users get NULL → treated as 0 → all 50 calls work.
-- HOWEVER the column never increments → free users get infinite executions.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lifetime_executions_used   INTEGER DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_executions_remaining  INTEGER DEFAULT 50;

-- Backfill: set lifetime_executions_used from existing execution counts
-- for free users. Paid users: doesn't matter (monthly quota enforced instead).
UPDATE public.profiles p
SET lifetime_executions_used = LEAST(50, COALESCE(
  (SELECT COUNT(*) FROM public.executions e
   WHERE e.user_id = p.id AND e.status = 'success'),
  0
))
WHERE p.subscription_plan = 'free'
  AND p.lifetime_executions_used = 0;

-- Set free_executions_remaining as the derived complement
UPDATE public.profiles
SET free_executions_remaining = GREATEST(0, 50 - lifetime_executions_used)
WHERE subscription_plan = 'free';

-- ── 2. Trigger: auto-update lifetime_executions_used on execution success ──────
-- The execute route calls increment_executions_used() which updates
-- executions_used_this_month. We need a parallel update for lifetime count.

CREATE OR REPLACE FUNCTION public.increment_lifetime_executions(user_id_param UUID)
RETURNS VOID LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    lifetime_executions_used  = COALESCE(lifetime_executions_used, 0) + 1,
    free_executions_remaining = GREATEST(0, COALESCE(free_executions_remaining, 50) - 1),
    updated_at                = now()
  WHERE id = user_id_param
    AND subscription_plan = 'free';  -- only decrement for free users
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_lifetime_executions(UUID)
  TO authenticated, service_role;

-- ── 3. Ensure reviews UNIQUE constraint exists ────────────────────────────────
-- Without this, upsert ON CONFLICT(agent_id, user_id) silently fails and
-- inserts duplicate reviews — inflating rating averages.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_agent_user_unique'
      AND conrelid = 'public.reviews'::regclass
  ) THEN
    -- Remove duplicates first (keep lowest id = oldest review)
    DELETE FROM public.reviews r1
    USING public.reviews r2
    WHERE r1.agent_id = r2.agent_id
      AND r1.user_id  = r2.user_id
      AND r1.id       > r2.id;

    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_agent_user_unique UNIQUE (agent_id, user_id);
    RAISE NOTICE '✅ reviews UNIQUE(agent_id, user_id) added';
  ELSE
    RAISE NOTICE '✅ reviews UNIQUE constraint already exists';
  END IF;
END $$;

-- ── 4. reviews: default status should be 'pending' not 'approved' ─────────────
-- Security fix: new reviews go to moderation first.
ALTER TABLE public.reviews
  ALTER COLUMN status SET DEFAULT 'pending';

-- ── 5. Fix agent_analytics UNIQUE constraint (needed for ON CONFLICT upsert) ──
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_analytics_agent_date_unique'
      AND conrelid = 'public.agent_analytics'::regclass
  ) THEN
    -- Deduplicate first
    DELETE FROM public.agent_analytics a1
    USING public.agent_analytics a2
    WHERE a1.agent_id = a2.agent_id
      AND a1.date     = a2.date
      AND a1.id       > a2.id;

    ALTER TABLE public.agent_analytics
      ADD CONSTRAINT agent_analytics_agent_date_unique UNIQUE (agent_id, date);
    RAISE NOTICE '✅ agent_analytics UNIQUE(agent_id, date) added';
  ELSE
    RAISE NOTICE '✅ agent_analytics UNIQUE constraint already exists';
  END IF;
END $$;

-- Add updated_at if missing (aggregate_daily_analytics writes it)
ALTER TABLE public.agent_analytics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ── 6. Verification ───────────────────────────────────────────────────────────
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles'
    AND column_name IN ('lifetime_executions_used','free_executions_remaining');
  RAISE NOTICE '✅ profiles lifetime columns: % / 2', v_count;

  SELECT COUNT(*) INTO v_count FROM information_schema.columns
  WHERE table_schema='public' AND table_name='agent_analytics' AND column_name='updated_at';
  RAISE NOTICE '✅ agent_analytics.updated_at: %', CASE WHEN v_count=1 THEN 'OK' ELSE 'MISSING' END;

  SELECT COUNT(*) INTO v_count FROM information_schema.routines
  WHERE routine_schema='public' AND routine_name='increment_lifetime_executions';
  RAISE NOTICE '✅ increment_lifetime_executions(): %', CASE WHEN v_count=1 THEN 'OK' ELSE 'MISSING' END;

  RAISE NOTICE '✅ Migration 033 complete';
END $$;
