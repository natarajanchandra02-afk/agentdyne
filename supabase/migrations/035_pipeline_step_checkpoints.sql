-- =============================================================================
-- AgentDyne — Migration 035: Pipeline Step Checkpoints + Resume RPC
--
-- The pipeline execute route writes to pipeline_step_checkpoints before and
-- after every node execution (WAL-lite pattern). Without this table,
-- all those upserts fail silently and resume/replay is impossible.
--
-- Also creates get_resumable_execution() RPC called by the execute route
-- to load checkpoint data when resuming a failed/crashed pipeline run.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: pipeline_step_checkpoints
-- One row per (execution, node) — upserted before + after each step.
-- Enables WAL-lite resume: "skip completed steps, restart from last_failed"
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pipeline_step_checkpoints (
  id             BIGSERIAL PRIMARY KEY,
  execution_id   UUID        NOT NULL REFERENCES public.pipeline_executions(id) ON DELETE CASCADE,
  pipeline_id    UUID        NOT NULL REFERENCES public.pipelines(id)           ON DELETE CASCADE,
  user_id        UUID        REFERENCES public.profiles(id),
  node_id        TEXT        NOT NULL,
  agent_id       UUID        REFERENCES public.agents(id),
  step_index     INTEGER     NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'started'
                             CHECK (status IN ('started','success','failed','skipped')),
  input          JSONB,
  output         JSONB,
  error_message  TEXT,
  latency_ms     INTEGER     DEFAULT 0,
  cost_usd       NUMERIC     DEFAULT 0,
  tokens_input   INTEGER     DEFAULT 0,
  tokens_output  INTEGER     DEFAULT 0,
  retry_count    INTEGER     DEFAULT 0,
  confidence     NUMERIC,            -- future: confidence gating
  started_at     TIMESTAMPTZ DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per (execution, node) — upsert target
  CONSTRAINT uq_checkpoint_exec_node UNIQUE (execution_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_psc_execution
  ON public.pipeline_step_checkpoints(execution_id, step_index);
CREATE INDEX IF NOT EXISTS idx_psc_pipeline_status
  ON public.pipeline_step_checkpoints(pipeline_id, status);
CREATE INDEX IF NOT EXISTS idx_psc_user_created
  ON public.pipeline_step_checkpoints(user_id, created_at DESC);

-- RLS
ALTER TABLE public.pipeline_step_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "psc_owner_read"
  ON public.pipeline_step_checkpoints FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "psc_service_write"
  ON public.pipeline_step_checkpoints FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_resumable_execution
-- Called by the pipeline execute route to load prior checkpoints.
-- Returns all COMPLETED steps so the executor can skip them and
-- seed nodeOutputs with their outputs (resume from last_completed_step).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_resumable_execution(
  execution_id_param UUID,
  pipeline_id_param  UUID
)
RETURNS TABLE (
  node_id      TEXT,
  agent_id     UUID,
  step_index   INTEGER,
  status       TEXT,
  output       JSONB,
  cost_usd     NUMERIC,
  latency_ms   INTEGER,
  retry_count  INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    node_id, agent_id, step_index, status, output, cost_usd, latency_ms, retry_count
  FROM pipeline_step_checkpoints
  WHERE execution_id = execution_id_param
    AND pipeline_id  = pipeline_id_param
    AND status IN ('success', 'skipped')  -- only return completed steps
  ORDER BY step_index ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_resumable_execution(UUID, UUID)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER VIEW: pipeline_run_summary
-- Used by the pipeline editor History tab to show step-level timeline.
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.pipeline_run_summary;
CREATE VIEW public.pipeline_run_summary
  WITH (security_invoker = on)
AS
SELECT
  pe.id                                              AS execution_id,
  pe.pipeline_id,
  pe.user_id,
  pe.status,
  pe.total_cost,
  pe.total_latency_ms,
  pe.created_at,
  pe.completed_at,
  COUNT(psc.id)                                      AS total_steps,
  COUNT(psc.id) FILTER (WHERE psc.status='success')  AS steps_success,
  COUNT(psc.id) FILTER (WHERE psc.status='failed')   AS steps_failed,
  COUNT(psc.id) FILTER (WHERE psc.status='skipped')  AS steps_skipped,
  SUM(psc.retry_count)                               AS total_retries,
  -- For History tab: ordered step details as JSON array
  COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'node_id',     psc.node_id,
        'step_index',  psc.step_index,
        'status',      psc.status,
        'latency_ms',  psc.latency_ms,
        'cost_usd',    psc.cost_usd,
        'retry_count', psc.retry_count,
        'error',       psc.error_message
      ) ORDER BY psc.step_index
    ) FILTER (WHERE psc.id IS NOT NULL),
    '[]'::JSONB
  ) AS steps
FROM public.pipeline_executions pe
LEFT JOIN public.pipeline_step_checkpoints psc ON psc.execution_id = pe.id
WHERE pe.user_id = auth.uid()
GROUP BY pe.id, pe.pipeline_id, pe.user_id, pe.status,
         pe.total_cost, pe.total_latency_ms, pe.created_at, pe.completed_at;

GRANT SELECT ON public.pipeline_run_summary TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- CLEANUP: pg_cron — purge old checkpoints after 30 days (keep DB lean)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'agentdyne-cleanup-checkpoints',
      '0 5 * * *',
      'DELETE FROM public.pipeline_step_checkpoints WHERE created_at < now() - INTERVAL ''30 days'''
    );
    RAISE NOTICE '✅ Checkpoint cleanup cron registered';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_table_ok BOOLEAN;
  v_rpc_ok   BOOLEAN;
  v_view_ok  BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'pipeline_step_checkpoints'
  ) INTO v_table_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_resumable_execution'
  ) INTO v_rpc_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'pipeline_run_summary'
  ) INTO v_view_ok;

  RAISE NOTICE '=== Migration 035 Verification ===';
  RAISE NOTICE 'pipeline_step_checkpoints table: %', CASE WHEN v_table_ok THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'get_resumable_execution() RPC:   %', CASE WHEN v_rpc_ok   THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'pipeline_run_summary view:       %', CASE WHEN v_view_ok  THEN '✅' ELSE '❌' END;
  RAISE NOTICE '=== Migration 035 COMPLETE ===';
END $$;
