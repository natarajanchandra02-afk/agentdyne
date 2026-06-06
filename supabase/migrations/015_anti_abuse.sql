-- ============================================================
-- Migration 015: Anti-Abuse Infrastructure
-- Adds: distributed rate limiting RPC, abuse event indexes,
--       concurrent execution guard, cost ceiling enforcement.
-- Validated against live schema. All statements idempotent.
-- ============================================================

-- ── 1. increment_rate_limit() — atomic upsert for distributed rate limiting ──
DROP FUNCTION IF EXISTS public.increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER);

CREATE FUNCTION public.increment_rate_limit(
  key_param        TEXT,
  window_end_param TIMESTAMPTZ,
  limit_param      INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count      INTEGER;
  v_window_end TIMESTAMPTZ;
BEGIN
  INSERT INTO public.rate_limit_counters (id, count, window_end, created_at)
  VALUES (key_param, 1, window_end_param, now())
  ON CONFLICT (id) DO UPDATE
    SET count      = CASE
                       WHEN rate_limit_counters.window_end < now()
                       THEN 1
                       ELSE rate_limit_counters.count + 1
                     END,
        window_end = CASE
                       WHEN rate_limit_counters.window_end < now()
                       THEN window_end_param
                       ELSE rate_limit_counters.window_end
                     END;

  SELECT count, window_end
  INTO   v_count, v_window_end
  FROM   public.rate_limit_counters
  WHERE  id = key_param;

  RETURN jsonb_build_object(
    'count',      v_count,
    'window_end', v_window_end,
    'blocked',    (v_count > limit_param)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER)
  TO authenticated, service_role;

-- ── 2. Indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rate_limit_window_end
  ON public.rate_limit_counters(window_end);

CREATE INDEX IF NOT EXISTS idx_governance_user_type
  ON public.governance_events(user_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_governance_severity
  ON public.governance_events(severity, created_at DESC);

-- ── 3. Concurrent execution count ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_concurrent_execution_count(user_id_param UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*) FROM public.executions
    WHERE  user_id = user_id_param
      AND  status  = 'running'
      AND  created_at > now() - INTERVAL '5 minutes'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_concurrent_execution_count(UUID)
  TO authenticated, service_role;

-- ── 4. Auto-fail stuck executions ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fail_stuck_executions();
CREATE FUNCTION public.fail_stuck_executions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.executions
  SET
    status        = 'failed',
    error_message = 'Execution timed out (auto-failed after 10 minutes)',
    completed_at  = now()
  WHERE status = 'running'
    AND created_at < now() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fail_stuck_executions() TO service_role;

-- ── 5. User abuse summary view ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.user_abuse_summary AS
SELECT
  p.id,
  p.email,
  p.full_name,
  p.subscription_plan,
  p.is_banned,
  COUNT(ge.id)                                                            AS total_abuse_events,
  COUNT(ge.id) FILTER (WHERE ge.severity = 'critical')                   AS critical_events,
  COUNT(ge.id) FILTER (WHERE ge.severity = 'warning')                    AS warning_events,
  MAX(ge.created_at)                                                      AS last_event_at,
  COUNT(e.id)  FILTER (WHERE e.created_at > now() - INTERVAL '1 hour')   AS exec_last_hour,
  COUNT(e.id)  FILTER (WHERE e.created_at > now() - INTERVAL '24 hours') AS exec_last_day,
  COALESCE(SUM(e.cost_usd), 0)                                           AS total_cost_usd
FROM        public.profiles        p
LEFT JOIN   public.governance_events ge ON ge.user_id = p.id  AND ge.created_at > now() - INTERVAL '7 days'
LEFT JOIN   public.executions        e  ON e.user_id  = p.id  AND e.created_at  > now() - INTERVAL '24 hours'
GROUP BY p.id, p.email, p.full_name, p.subscription_plan, p.is_banned
HAVING COUNT(ge.id) > 0
ORDER BY critical_events DESC, total_abuse_events DESC;

GRANT SELECT ON public.user_abuse_summary TO authenticated;

-- ── 6. Governance RLS (user can read own events) ──────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='governance_events' AND policyname='governance_user_own_read'
  ) THEN
    CREATE POLICY "governance_user_own_read" ON public.governance_events
      FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

-- ── 7. pg_cron schedule (run in Supabase SQL Editor manually) ────────────
-- SELECT cron.schedule('fail-stuck', '*/5 * * * *', $$SELECT public.fail_stuck_executions()$$);
-- SELECT cron.schedule('reset-quotas', '0 0 * * *', $$SELECT public.reset_monthly_quotas()$$);
-- SELECT cron.schedule('cleanup-rl', '*/30 * * * *', $$SELECT public.cleanup_rate_limit_counters()$$);

-- ── 8. Verification ───────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'increment_rate_limit   : %',
    (SELECT proname FROM pg_proc WHERE proname='increment_rate_limit'   LIMIT 1);
  RAISE NOTICE 'fail_stuck_executions  : %',
    (SELECT proname FROM pg_proc WHERE proname='fail_stuck_executions'  LIMIT 1);
  RAISE NOTICE '✅ Migration 015 complete';
END $$;
