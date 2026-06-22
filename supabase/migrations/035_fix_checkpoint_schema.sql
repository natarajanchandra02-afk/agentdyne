-- =============================================================================
-- AgentDyne — Migration 035 FIX: Reconcile pipeline_step_checkpoints schema
--
-- ROOT CAUSE:
--   035_wal_lite_step_checkpoints.sql ran first and created the table
--   WITHOUT a `created_at` column (only `started_at` exists).
--   035_pipeline_step_checkpoints.sql then failed with:
--     ERROR 42703: column "created_at" does not exist
--   because it tried to CREATE INDEX ... (user_id, created_at DESC).
--
-- THIS FILE (safe to run after either 035 file):
--   1. Adds created_at if missing (backfilled from started_at)
--   2. Adds missing columns if the wal_lite version ran
--   3. Creates correct indexes (using started_at which always exists)
--   4. Creates get_resumable_execution() RPC
--   5. Creates pipeline_run_summary view
--   6. Registers pg_cron cleanup
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Add missing columns (idempotent — IF NOT EXISTS)
-- The wal_lite version omitted: created_at, confidence, agent_id FK
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pipeline_step_checkpoints
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS confidence  NUMERIC,
  ADD COLUMN IF NOT EXISTS tokens_in   INTEGER      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_out  INTEGER      DEFAULT 0;

-- Backfill created_at from started_at for existing rows
UPDATE public.pipeline_step_checkpoints
SET created_at = started_at
WHERE created_at IS NULL OR created_at = '1970-01-01';

-- Fix the status CHECK — wal_lite used 'completed', pipeline version uses 'success'
-- Add 'completed' as accepted value if 'success' is not yet in the check constraint
DO $$
BEGIN
  -- Drop old constraint if it only had 'completed' and not 'success'
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name LIKE '%pipeline_step_checkpoints%status%'
  ) THEN
    ALTER TABLE public.pipeline_step_checkpoints
      DROP CONSTRAINT IF EXISTS pipeline_step_checkpoints_status_check;
    ALTER TABLE public.pipeline_step_checkpoints
      ADD CONSTRAINT pipeline_step_checkpoints_status_check
      CHECK (status IN ('started','completed','success','failed','skipped'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'status constraint update skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Indexes — use started_at (always exists) not created_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_psc_execution
  ON public.pipeline_step_checkpoints(execution_id, step_index);

CREATE INDEX IF NOT EXISTS idx_psc_pipeline_status
  ON public.pipeline_step_checkpoints(pipeline_id, status);

-- Use started_at (always exists) — was created_at in the broken version
CREATE INDEX IF NOT EXISTS idx_psc_user_started
  ON public.pipeline_step_checkpoints(user_id, started_at DESC);

-- Also index created_at now that it exists
CREATE INDEX IF NOT EXISTS idx_psc_created
  ON public.pipeline_step_checkpoints(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: RLS policies (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pipeline_step_checkpoints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Owner read
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'pipeline_step_checkpoints'
      AND policyname IN ('psc_owner_read', 'step_checkpoints_owner_read')
  ) THEN
    CREATE POLICY "psc_owner_read"
      ON public.pipeline_step_checkpoints FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  -- Service write
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'pipeline_step_checkpoints'
      AND policyname IN ('psc_service_write', 'step_checkpoints_service_write')
  ) THEN
    CREATE POLICY "psc_service_write"
      ON public.pipeline_step_checkpoints FOR ALL
      USING     (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT ON public.pipeline_step_checkpoints TO authenticated;
GRANT ALL    ON public.pipeline_step_checkpoints TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: get_resumable_execution() RPC
-- Accepts both 'completed' (wal_lite) and 'success' (new) status values
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_resumable_execution(UUID, UUID) CASCADE;

CREATE FUNCTION public.get_resumable_execution(
  execution_id_param UUID,
  pipeline_id_param  UUID
)
RETURNS TABLE (
  node_id     TEXT,
  agent_id    UUID,
  step_index  INTEGER,
  status      TEXT,
  output      JSONB,
  cost_usd    NUMERIC,
  latency_ms  INTEGER,
  retry_count INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    node_id,
    agent_id,
    step_index,
    status,
    output,
    cost_usd,
    latency_ms,
    retry_count
  FROM public.pipeline_step_checkpoints
  WHERE execution_id = execution_id_param
    AND pipeline_id  = pipeline_id_param
    AND status IN ('completed', 'success', 'skipped')   -- accept both naming conventions
  ORDER BY step_index ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_resumable_execution(UUID, UUID)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: pipeline_run_summary view
-- References pipeline_executions columns confirmed to exist in live schema
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.pipeline_run_summary CASCADE;

CREATE VIEW public.pipeline_run_summary
  WITH (security_invoker = on)
AS
SELECT
  pe.id                AS execution_id,
  pe.pipeline_id,
  pe.user_id,
  pe.status,
  pe.total_cost,
  pe.total_latency_ms,
  pe.created_at,
  pe.completed_at,
  pe.node_results,
  COUNT(psc.id)                                           AS total_steps,
  COUNT(psc.id) FILTER (WHERE psc.status IN ('success','completed')) AS steps_success,
  COUNT(psc.id) FILTER (WHERE psc.status = 'failed')     AS steps_failed,
  COUNT(psc.id) FILTER (WHERE psc.status = 'skipped')    AS steps_skipped,
  COALESCE(SUM(psc.retry_count), 0)                      AS total_retries,
  COALESCE(SUM(psc.cost_usd),    0)                      AS steps_total_cost,
  -- Step-level timeline as JSON array for the History tab UI
  COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'node_id',     psc.node_id,
        'step_index',  psc.step_index,
        'status',      psc.status,
        'latency_ms',  psc.latency_ms,
        'cost_usd',    psc.cost_usd,
        'retry_count', psc.retry_count,
        'error',       psc.error_message,
        'started_at',  psc.started_at,
        'completed_at',psc.completed_at
      ) ORDER BY psc.step_index
    ) FILTER (WHERE psc.id IS NOT NULL),
    '[]'::JSONB
  ) AS steps
FROM public.pipeline_executions pe
LEFT JOIN public.pipeline_step_checkpoints psc ON psc.execution_id = pe.id
WHERE pe.user_id = auth.uid()
GROUP BY
  pe.id, pe.pipeline_id, pe.user_id, pe.status,
  pe.total_cost, pe.total_latency_ms,
  pe.created_at, pe.completed_at, pe.node_results;

GRANT SELECT ON public.pipeline_run_summary TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: pg_cron cleanup — use started_at (always exists)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Use started_at which is guaranteed to exist in both table versions
    PERFORM cron.schedule(
      'agentdyne-cleanup-checkpoints',
      '0 5 * * *',
      'DELETE FROM public.pipeline_step_checkpoints WHERE started_at < now() - INTERVAL ''30 days'''
    );
    RAISE NOTICE '✅ Checkpoint cleanup cron registered (using started_at)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️ Cron registration skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_created_at BOOLEAN;
  v_has_started_at BOOLEAN;
  v_rpc_ok         BOOLEAN;
  v_view_ok        BOOLEAN;
  v_col_count      INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_step_checkpoints'
      AND column_name = 'created_at'
  ) INTO v_has_created_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_step_checkpoints'
      AND column_name = 'started_at'
  ) INTO v_has_started_at;

  SELECT COUNT(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'pipeline_step_checkpoints';

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_resumable_execution'
  ) INTO v_rpc_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'pipeline_run_summary'
  ) INTO v_view_ok;

  RAISE NOTICE '';
  RAISE NOTICE '=== Migration 035 FIX — Verification ===';
  RAISE NOTICE 'pipeline_step_checkpoints columns: %', v_col_count;
  RAISE NOTICE 'created_at column exists: %',  CASE WHEN v_has_created_at THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'started_at column exists: %',  CASE WHEN v_has_started_at THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'get_resumable_execution(): %',  CASE WHEN v_rpc_ok        THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'pipeline_run_summary view: %',  CASE WHEN v_view_ok       THEN '✅' ELSE '❌' END;
  RAISE NOTICE '=== Migration 035 FIX COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'Run smoke test:';
  RAISE NOTICE '  SELECT column_name FROM information_schema.columns';
  RAISE NOTICE '  WHERE table_name = ''pipeline_step_checkpoints'' ORDER BY ordinal_position;';
END $$;
