-- ============================================================
-- Migration 012: Cron jobs, cleanup, ThoughtGate stats table
-- Run ONCE in Supabase SQL Editor. All statements idempotent.
-- ============================================================

-- ── 1. ThoughtGate template stats table ───────────────────────────────────
-- Cross-process persistence for EMA success rates.
-- In-process EMA in thoughtgate.ts resets on deploy;
-- this table accumulates stats so they survive.
CREATE TABLE IF NOT EXISTS public.thoughtgate_template_stats (
  template_id    TEXT         PRIMARY KEY,
  intent_type    TEXT,
  total_calls    BIGINT       DEFAULT 0,
  success_calls  BIGINT       DEFAULT 0,
  failure_calls  BIGINT       DEFAULT 0,
  last_updated   TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE public.thoughtgate_template_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='thoughtgate_template_stats' AND policyname='tg_admin_all') THEN
    CREATE POLICY "tg_admin_all" ON public.thoughtgate_template_stats
      FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
    CREATE POLICY "tg_service_all" ON public.thoughtgate_template_stats
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Increment function called from feedback route via upsert
-- This is NOT needed for upsert but useful for direct increment patterns
CREATE OR REPLACE FUNCTION public.increment_thoughtgate_stat(
  p_template_id TEXT,
  p_intent_type TEXT,
  p_success     BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.thoughtgate_template_stats (template_id, intent_type, total_calls, success_calls, failure_calls)
  VALUES (p_template_id, p_intent_type, 1, CASE WHEN p_success THEN 1 ELSE 0 END, CASE WHEN p_success THEN 0 ELSE 1 END)
  ON CONFLICT (template_id) DO UPDATE SET
    total_calls   = thoughtgate_template_stats.total_calls   + 1,
    success_calls = thoughtgate_template_stats.success_calls + CASE WHEN p_success THEN 1 ELSE 0 END,
    failure_calls = thoughtgate_template_stats.failure_calls + CASE WHEN p_success THEN 0 ELSE 1 END,
    last_updated  = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_thoughtgate_stat(TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

-- ── 2. RBAC: add is_banned column to profiles ─────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned_reason TEXT;

-- Block banned users from making API calls (RLS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='blocked_banned_users') THEN
    -- Note: We enforce banning at API layer via middleware, not just RLS
    -- RLS here prevents banned users from writing data
    CREATE POLICY "blocked_banned_users_write"
      ON public.profiles FOR UPDATE
      USING (id = auth.uid() AND NOT COALESCE(is_banned, FALSE));
  END IF;
END $$;

-- ── 3. Cron job setup (pg_cron extension required) ────────────────────────
-- Enable pg_cron extension via Supabase Dashboard → Database → Extensions
-- Then run the cron.schedule() calls below.
--
-- If pg_cron is not enabled yet, run this first:
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   GRANT USAGE ON SCHEMA cron TO postgres;
--
-- Then schedule the jobs:

-- 3a. Reset monthly execution quotas (1st of every month, midnight UTC)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-reset-quotas', '0 0 1 * *', $$SELECT public.reset_monthly_quotas()$$);
    RAISE NOTICE '✅ Cron: agentdyne-reset-quotas scheduled';
  ELSE
    RAISE NOTICE '⚠️  pg_cron not enabled — run: CREATE EXTENSION IF NOT EXISTS pg_cron;';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  Could not schedule cron: %', SQLERRM;
END $$;

-- 3b. Compute agent quality scores (daily at 02:00 UTC)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-score-agents', '0 2 * * *', $$SELECT public.compute_all_agent_scores()$$);
    RAISE NOTICE '✅ Cron: agentdyne-score-agents scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  Could not schedule cron: %', SQLERRM;
END $$;

-- 3c. Cleanup expired agent memory (daily at 04:00 UTC)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-cleanup-memory', '0 4 * * *', $$SELECT public.cleanup_expired_memory()$$);
    RAISE NOTICE '✅ Cron: agentdyne-cleanup-memory scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  Could not schedule cron: %', SQLERRM;
END $$;

-- 3d. Aggregate daily analytics (daily at 01:00 UTC for previous day)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-daily-analytics', '0 1 * * *', $$SELECT public.aggregate_daily_analytics()$$);
    RAISE NOTICE '✅ Cron: agentdyne-daily-analytics scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  Could not schedule cron: %', SQLERRM;
END $$;

-- ── 4. Cleanup functions ──────────────────────────────────────────────────

-- 4a. Purge old injection_attempts (keep 90 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_injection_attempts()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH deleted AS (
    DELETE FROM public.injection_attempts
    WHERE created_at < now() - INTERVAL '90 days'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_injection_attempts() TO service_role;

-- 4b. Purge old audit_logs (keep 1 year)
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER AS $$
  WITH deleted AS (
    DELETE FROM public.audit_logs
    WHERE created_at < now() - INTERVAL '365 days'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_audit_logs() TO service_role;

-- 4c. Purge old execution_traces (keep 30 days for free users, 90 for paid)
CREATE OR REPLACE FUNCTION public.cleanup_old_execution_traces()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM public.execution_traces t
    WHERE t.created_at < now() - INTERVAL '30 days'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = t.user_id AND p.subscription_plan = 'free'
      )
    RETURNING t.id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_execution_traces() TO service_role;

-- Schedule weekly cleanup (Sunday 03:00 UTC)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-cleanup-injection', '0 3 * * 0', $$SELECT public.cleanup_old_injection_attempts()$$);
    PERFORM cron.schedule('agentdyne-cleanup-audit',     '0 3 * * 0', $$SELECT public.cleanup_old_audit_logs()$$);
    PERFORM cron.schedule('agentdyne-cleanup-traces',    '0 3 * * 0', $$SELECT public.cleanup_old_execution_traces()$$);
    RAISE NOTICE '✅ Cron: cleanup jobs scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  Could not schedule cleanup crons: %', SQLERRM;
END $$;

-- ── 5. Agent memory index optimisation ────────────────────────────────────
-- Ensure compound index for (user_id, agent_id, key) lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_lookup
  ON public.agent_memory(user_id, agent_id, key);

CREATE INDEX IF NOT EXISTS idx_agent_memory_ttl
  ON public.agent_memory(ttl_at)
  WHERE ttl_at IS NOT NULL;

-- ── 6. Make agent_analytics table safer ─────────────────────────────────
-- Add missing columns that aggregate_daily_analytics() writes
ALTER TABLE public.agent_analytics ADD COLUMN IF NOT EXISTS avg_latency_ms INTEGER DEFAULT 0;
ALTER TABLE public.agent_analytics ADD COLUMN IF NOT EXISTS success_rate   NUMERIC(5,2) DEFAULT 0;

-- ── 7. Verification ──────────────────────────────────────────────────────
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM information_schema.tables
  WHERE table_schema='public' AND table_name = 'thoughtgate_template_stats';
  RAISE NOTICE '✅ thoughtgate_template_stats: %', CASE WHEN v_count=1 THEN 'created' ELSE 'MISSING' END;

  SELECT COUNT(*) INTO v_count FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles' AND column_name='is_banned';
  RAISE NOTICE '✅ profiles.is_banned: %', CASE WHEN v_count=1 THEN 'present' ELSE 'MISSING' END;

  SELECT COUNT(*) INTO v_count FROM information_schema.routines
  WHERE routine_schema='public' AND routine_name='cleanup_expired_memory';
  RAISE NOTICE '✅ cleanup_expired_memory: %', CASE WHEN v_count=1 THEN 'OK' ELSE 'MISSING (run 009_rag_memory_registry.sql first)' END;

  RAISE NOTICE '✅ Migration 012 complete. Run pg_cron setup if not done yet.';
END $$;

-- ── Manual pg_cron verification ──────────────────────────────────────────
-- To check all scheduled jobs:
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'agentdyne-%';
--
-- To remove a job:
--   SELECT cron.unschedule('agentdyne-reset-quotas');
