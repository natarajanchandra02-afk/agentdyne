-- ============================================================
-- AgentDyne Migration 035: WAL-Lite — Step Checkpointing
--
-- Phase 1 pre-launch: minimal Write-Ahead-Log-style protection
-- for pipeline executions. Gives us:
--   1. Pre-step checkpoint (written BEFORE executing each node)
--   2. Resume-from-step capability (skip already-completed nodes)
--   3. Step output storage per-node (not just final output)
--   4. Crash recovery visibility for support team
--
-- This is NOT full WAL. Full WAL (append-only, deterministic replay,
-- Redis Streams) is post-Series-A infrastructure.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================

-- ── 1. pipeline_step_checkpoints table ─────────────────────────────────────
-- Written once BEFORE a node executes (status='started'),
-- updated AFTER it completes (status='completed' | 'failed' | 'skipped').
-- This lets us resume mid-pipeline if the edge function crashes.

CREATE TABLE IF NOT EXISTS public.pipeline_step_checkpoints (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  execution_id    uuid        NOT NULL,
  pipeline_id     uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  node_id         text        NOT NULL,
  agent_id        uuid,
  step_index      integer     NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'started'
                              CHECK (status IN ('started','completed','failed','skipped')),
  input           jsonb,
  output          jsonb,
  error_message   text,
  latency_ms      integer,
  cost_usd        numeric     DEFAULT 0,
  tokens_input    integer     DEFAULT 0,
  tokens_output   integer     DEFAULT 0,
  retry_count     integer     DEFAULT 0,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT pipeline_step_checkpoints_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_step_checkpoints_execution_id_fkey
    FOREIGN KEY (execution_id) REFERENCES public.pipeline_executions(id) ON DELETE CASCADE,
  CONSTRAINT pipeline_step_checkpoints_pipeline_id_fkey
    FOREIGN KEY (pipeline_id)  REFERENCES public.pipelines(id) ON DELETE CASCADE,
  CONSTRAINT pipeline_step_checkpoints_user_id_fkey
    FOREIGN KEY (user_id)      REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- ── 2. Unique constraint: one checkpoint per (execution, node) ──────────────
-- Enables ON CONFLICT upsert for the post-step update.
CREATE UNIQUE INDEX IF NOT EXISTS idx_step_checkpoints_exec_node
  ON public.pipeline_step_checkpoints(execution_id, node_id);

-- ── 3. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_step_checkpoints_execution
  ON public.pipeline_step_checkpoints(execution_id, step_index);

CREATE INDEX IF NOT EXISTS idx_step_checkpoints_user_recent
  ON public.pipeline_step_checkpoints(user_id, started_at DESC);

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.pipeline_step_checkpoints ENABLE ROW LEVEL SECURITY;

-- Users can only read their own checkpoints
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pipeline_step_checkpoints'
      AND policyname='step_checkpoints_owner_read'
  ) THEN
    CREATE POLICY "step_checkpoints_owner_read"
      ON public.pipeline_step_checkpoints FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Service role can insert/update (execute route uses service_role key)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pipeline_step_checkpoints'
      AND policyname='step_checkpoints_service_write'
  ) THEN
    CREATE POLICY "step_checkpoints_service_write"
      ON public.pipeline_step_checkpoints FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT ON public.pipeline_step_checkpoints TO authenticated;
GRANT ALL    ON public.pipeline_step_checkpoints TO service_role;

-- ── 5. get_resumable_execution() RPC ────────────────────────────────────────
-- Called by pipeline execute at the start of a run.
-- Returns the last completed step index so we can skip already-done nodes.
-- Returns NULL if no checkpoints exist (fresh run).
DROP FUNCTION IF EXISTS public.get_resumable_execution(UUID, UUID) CASCADE;

CREATE FUNCTION public.get_resumable_execution(
  execution_id_param UUID,
  pipeline_id_param  UUID
)
RETURNS TABLE(
  node_id          text,
  step_index       integer,
  status           text,
  output           jsonb
) LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT node_id, step_index, status, output
  FROM   public.pipeline_step_checkpoints
  WHERE  execution_id = execution_id_param
    AND  pipeline_id  = pipeline_id_param
    AND  status IN ('completed', 'skipped')
  ORDER BY step_index ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_resumable_execution(UUID, UUID)
  TO authenticated, service_role;

-- ── 6. Input/output hash for tool execution dedup ───────────────────────────
-- Stored on execution_cache: hash = sha256(agent_id + ':' + input_text)
-- Already implemented in src/lib/execution-cache.ts — no schema change needed.

-- ── 7. Verification ─────────────────────────────────────────────────────────
SELECT
  'pipeline_step_checkpoints' AS table_name,
  COUNT(*)                    AS column_count
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pipeline_step_checkpoints';

SELECT
  'idx_step_checkpoints_exec_node' AS index_name,
  COUNT(*)                          AS exists
FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'idx_step_checkpoints_exec_node';

-- Expected: table has 18 columns, index exists (count=1)
-- === Migration 035 COMPLETE ===
