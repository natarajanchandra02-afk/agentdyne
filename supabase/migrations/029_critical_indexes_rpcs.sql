-- ============================================================
-- AgentDyne Migration 029 — Critical Indexes + Missing RPCs
-- Run in Supabase SQL Editor before launch.
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- ── 1. Missing indexes ────────────────────────────────────────────────────────

-- Concurrency check: SELECT COUNT(*) WHERE user_id=? AND status='running'
CREATE INDEX IF NOT EXISTS idx_executions_user_status
  ON public.executions (user_id, status)
  WHERE status IN ('running', 'queued');

-- Execution history page: ORDER BY created_at DESC for a user
CREATE INDEX IF NOT EXISTS idx_executions_user_created
  ON public.executions (user_id, created_at DESC);

-- Idempotency dedup lookup (already unique but needs fast eq scan)
CREATE INDEX IF NOT EXISTS idx_executions_idempotency
  ON public.executions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Navbar notification dropdown
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON public.notifications (user_id, is_read, created_at DESC);

-- Credit reservation balance calc
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_status
  ON public.credit_reservations (user_id, status)
  WHERE status = 'reserved';

-- Rate limit counter expiry cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limit_window_end
  ON public.rate_limit_counters (window_end);

-- Agent lookup by seller (my-agents page)
CREATE INDEX IF NOT EXISTS idx_agents_seller_status
  ON public.agents (seller_id, status, created_at DESC);

-- Execution queue polling
CREATE INDEX IF NOT EXISTS idx_execution_queue_status_priority
  ON public.execution_queue (status, priority DESC, enqueued_at ASC)
  WHERE status IN ('queued', 'processing');

-- ── 2. increment_executions_used RPC ──────────────────────────────────────────
-- Atomically increments monthly + lifetime counters in one DB round-trip.
-- Called after every successful execution.

CREATE OR REPLACE FUNCTION public.increment_executions_used(
  user_id_param UUID
)
RETURNS VOID LANGUAGE PLPGSQL SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET
    executions_used_this_month = COALESCE(executions_used_this_month, 0) + 1,
    lifetime_executions_used   = COALESCE(lifetime_executions_used, 0)   + 1,
    free_executions_remaining  = GREATEST(0, COALESCE(free_executions_remaining, 0) - 1),
    updated_at                 = now()
  WHERE id = user_id_param;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_executions_used(UUID) TO authenticated, service_role;

-- ── 3. increment_lifetime_executions RPC (alias used in some paths) ───────────
CREATE OR REPLACE FUNCTION public.increment_lifetime_executions(
  user_id_param UUID
)
RETURNS VOID LANGUAGE PLPGSQL SECURITY DEFINER AS $$
BEGIN
  -- No-op: covered by increment_executions_used above.
  -- Kept as alias so existing call sites don't error.
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_lifetime_executions(UUID) TO authenticated, service_role;

-- ── 4. get_concurrent_executions RPC ─────────────────────────────────────────
-- Returns count of user's executions with status='running' in last 15 minutes.
-- 15-minute stale guard prevents phantom-running rows from blocking users forever.

CREATE OR REPLACE FUNCTION public.get_concurrent_executions(
  user_id_param UUID
)
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.executions
  WHERE user_id   = user_id_param
    AND status    = 'running'
    AND created_at > now() - INTERVAL '15 minutes';
$$;

GRANT EXECUTE ON FUNCTION public.get_concurrent_executions(UUID) TO authenticated, service_role;

-- ── 5. increment_rate_limit RPC ───────────────────────────────────────────────
-- Upserts a rate-limit counter and returns whether the request is blocked.
-- Used by checkUserRateLimit in anti-abuse.ts for global distributed limiting.

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  key_param        TEXT,
  window_end_param TIMESTAMPTZ,
  limit_param      INTEGER
)
RETURNS JSONB LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_count     INTEGER;
  v_window    TIMESTAMPTZ;
  v_blocked   BOOLEAN;
BEGIN
  INSERT INTO public.rate_limit_counters (id, count, window_end)
  VALUES (key_param, 1, window_end_param)
  ON CONFLICT (id) DO UPDATE
    SET count      = CASE
                       WHEN rate_limit_counters.window_end < now()
                       THEN 1                                    -- expired window: reset
                       ELSE rate_limit_counters.count + 1
                     END,
        window_end = CASE
                       WHEN rate_limit_counters.window_end < now()
                       THEN window_end_param                     -- new window timestamp
                       ELSE rate_limit_counters.window_end
                     END
  RETURNING count, window_end INTO v_count, v_window;

  v_blocked := v_count > limit_param;

  RETURN jsonb_build_object(
    'count',      v_count,
    'window_end', v_window,
    'blocked',    v_blocked
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;

-- ── 6. Auto-disable degraded agents (quality gate) ───────────────────────────
-- Cron job: runs hourly, disables agents with >40% failure rate in last 24h
-- (min 20 executions sample to avoid false positives on new agents).

CREATE OR REPLACE FUNCTION public.auto_disable_degraded_agents()
RETURNS INTEGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH degraded AS (
    SELECT
      e.agent_id,
      COUNT(*)                                                           AS total,
      COUNT(*) FILTER (WHERE e.status = 'failed')                       AS failures,
      COUNT(*) FILTER (WHERE e.status = 'failed')::NUMERIC / COUNT(*)   AS failure_rate
    FROM public.executions e
    WHERE e.created_at > now() - INTERVAL '24 hours'
      AND e.agent_id IS NOT NULL
    GROUP BY e.agent_id
    HAVING COUNT(*) >= 20
       AND (COUNT(*) FILTER (WHERE e.status = 'failed')::NUMERIC / COUNT(*)) > 0.40
  )
  UPDATE public.agents a
  SET
    status            = 'suspended',
    auto_disabled_at  = now(),
    auto_disable_reason = 'Failure rate > 40% over last 24h (auto-disabled)'
  FROM degraded d
  WHERE a.id     = d.agent_id
    AND a.status = 'active'
  RETURNING a.id INTO v_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_disable_degraded_agents() TO service_role;

-- Schedule hourly quality check (removes duplicate if exists first)
SELECT cron.unschedule(jobname)
FROM cron.job WHERE jobname = 'auto-disable-degraded-agents';

SELECT cron.schedule(
  'auto-disable-degraded-agents',
  '0 * * * *',
  $$SELECT public.auto_disable_degraded_agents();$$
);

-- ── 7. Cleanup expired rate limit counters ───────────────────────────────────
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

SELECT cron.unschedule(jobname)
FROM cron.job WHERE jobname = 'cleanup-rate-limits';

SELECT cron.schedule(
  'cleanup-rate-limits',
  '15 * * * *',
  $$SELECT public.cleanup_rate_limit_counters();$$
);

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  idx_count  INTEGER;
  rpc_count  INTEGER;
BEGIN
  SELECT COUNT(*) INTO idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_executions_user_status','idx_executions_user_created',
      'idx_executions_idempotency','idx_notifications_user_read',
      'idx_credit_reservations_user_status','idx_rate_limit_window_end',
      'idx_agents_seller_status','idx_execution_queue_status_priority'
    );

  SELECT COUNT(*) INTO rpc_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'increment_executions_used','get_concurrent_executions',
      'increment_rate_limit','auto_disable_degraded_agents',
      'cleanup_rate_limit_counters'
    );

  RAISE NOTICE '=== Migration 029 Verification ===';
  RAISE NOTICE 'Indexes created: % / 8', idx_count;
  RAISE NOTICE 'RPCs created:    % / 5', rpc_count;
  IF idx_count = 8 AND rpc_count = 5 THEN
    RAISE NOTICE '=== Migration 029 COMPLETE ✅ ===';
  ELSE
    RAISE WARNING '=== Migration 029 INCOMPLETE — check above output ===';
  END IF;
END $$;
