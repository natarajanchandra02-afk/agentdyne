-- ============================================================
-- AgentDyne Migration 030 — Cron Job Deduplication + Performance
-- Fixes:
--   1. Duplicate fail_stuck_executions cron jobs (causes 2× DB load)
--   2. fail_stuck_queue_jobs running too frequently (3933 calls seen)
--   3. Adds missing index to speed up fail_stuck_executions scan
--   4. Reduces unnecessary cron verbosity in job_run_details
-- ============================================================

-- ── 1. Remove ALL existing variants of each cron job ─────────────────────────
-- Both with and without 'public.' prefix, any schedule.
-- We re-add them once with the correct schedule below.

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT jobname FROM cron.job
    WHERE command ILIKE ANY (ARRAY[
      '%fail_stuck_executions%',
      '%fail_stuck_queue_jobs%',
      '%auto_disable%',
      '%refresh_agent_rankings%',
      '%cleanup_rate_limit%',
      '%cleanup_execution_cache%',
      '%cleanup_expired_memory%',
      '%send_quota_warning%',
      '%refresh_agent%',
      '%auto-disable-degraded%'
    ])
  LOOP
    PERFORM cron.unschedule(rec.jobname);
    RAISE NOTICE 'Removed cron job: %', rec.jobname;
  END LOOP;
END $$;

-- ── 2. Re-add cron jobs with correct schedules ────────────────────────────────
-- fail_stuck_executions: every 5 minutes (was every 1 minute causing 1633 calls)
SELECT cron.schedule(
  'fail-stuck-executions',
  '*/5 * * * *',
  $$SELECT public.fail_stuck_executions();$$
);

-- fail_stuck_queue_jobs: every 5 minutes (was extremely frequent causing 3933 calls)
SELECT cron.schedule(
  'fail-stuck-queue-jobs',
  '*/5 * * * *',
  $$SELECT public.fail_stuck_queue_jobs();$$
);

-- auto_disable_degraded_agents: hourly (quality gate)
SELECT cron.schedule(
  'auto-disable-degraded-agents',
  '0 * * * *',
  $$SELECT public.auto_disable_degraded_agents();$$
);

-- refresh_agent_rankings: 2 AM daily (expensive, 171ms each)
SELECT cron.schedule(
  'refresh-agent-rankings',
  '0 2 * * *',
  $$SELECT public.refresh_agent_rankings();$$
);

-- cleanup_rate_limit_counters: every 15 minutes
SELECT cron.schedule(
  'cleanup-rate-limits',
  '*/15 * * * *',
  $$SELECT public.cleanup_rate_limit_counters();$$
);

-- cleanup_execution_cache: every 30 minutes
SELECT cron.schedule(
  'cleanup-execution-cache',
  '*/30 * * * *',
  $$SELECT public.cleanup_execution_cache();$$
);

-- cleanup_expired_memory: every 30 minutes
SELECT cron.schedule(
  'cleanup-expired-memory',
  '*/30 * * * *',
  $$SELECT cleanup_expired_memory();$$
);

-- send_quota_warning_notifications: hourly at :30
SELECT cron.schedule(
  'quota-warning-notifications',
  '30 * * * *',
  $$SELECT send_quota_warning_notifications();$$
);

-- ── 3. Add index to speed up fail_stuck_executions ───────────────────────────
-- fail_stuck_executions does: WHERE status = 'running' AND created_at < now() - 15min
-- The existing idx_executions_user_status covers (user_id, status) but not created_at.
-- This partial index covers the exact WHERE clause in fail_stuck_executions.

CREATE INDEX IF NOT EXISTS idx_executions_stuck
  ON public.executions (status, created_at)
  WHERE status = 'running';

-- Same for credit_reservations (released by fail_stuck_executions too)
CREATE INDEX IF NOT EXISTS idx_credit_reservations_stuck
  ON public.credit_reservations (status, created_at)
  WHERE status = 'reserved';

-- ── 4. Prune old pg_cron job_run_details (keeps table small) ─────────────────
-- job_run_details was accumulating 6566+ rows of cron audit logs.
-- Keep only last 7 days.

DELETE FROM cron.job_run_details
WHERE end_time < now() - INTERVAL '7 days';

-- Auto-prune going forward: runs nightly at 3 AM
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-cron-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-cron-logs',
  '0 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - INTERVAL '7 days';$$
);

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE job_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO job_count FROM cron.job WHERE active;
  RAISE NOTICE '=== Migration 030 Complete ===';
  RAISE NOTICE 'Active cron jobs: %', job_count;
  RAISE NOTICE 'fail_stuck_executions: now every 5 min (was every 1 min)';
  RAISE NOTICE 'fail_stuck_queue_jobs: now every 5 min (was running ~65x/min)';
  RAISE NOTICE 'Duplicate jobs removed, stuck-execution indexes added';
END $$;
