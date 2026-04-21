-- ============================================================
-- FIX: 010_network_effects.sql — ERROR 42703: column "use_count" does not exist
--
-- ROOT CAUSE:
--   Migration 013_pipeline_versioning.sql creates agent_pipeline_usage
--   WITHOUT use_count + last_used columns. If 013 ran before 010, or
--   if 010 is re-run after 013, CREATE TABLE IF NOT EXISTS skips the
--   table creation, leaving use_count/last_used missing. Then the index:
--     CREATE INDEX ... ON agent_pipeline_usage(agent_id, use_count DESC)
--   fails with ERROR 42703.
--
-- FIX: Add missing columns idempotently BEFORE creating any index
--      that references them.
--
-- ALSO FIXES:
--   - agent_pipeline_usage: adds use_count, last_used, created_at
--   - pipeline_versions: reconciles 013 vs 010/016 column name differences
--     (013 uses dag_snapshot; 010/016 use dag — add both)
--   - All indexes recreated safely
--
-- Run in Supabase SQL Editor. 100% idempotent — safe to re-run.
-- ============================================================

-- ── 1. Ensure agent_pipeline_usage has all required columns ────────────────
ALTER TABLE public.agent_pipeline_usage
  ADD COLUMN IF NOT EXISTS use_count  INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_used  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 2. Drop and recreate the index that references use_count ────────────────
DROP INDEX IF EXISTS public.idx_agent_pipeline_usage_agent;
CREATE INDEX IF NOT EXISTS idx_agent_pipeline_usage_agent
  ON public.agent_pipeline_usage(agent_id, use_count DESC);

CREATE INDEX IF NOT EXISTS idx_agent_pipeline_usage_pipeline
  ON public.agent_pipeline_usage(pipeline_id);

-- ── 3. Ensure pipeline_versions has both dag_snapshot AND dag columns ────────
-- Migration 013 uses dag_snapshot; Migration 010/016 use dag.
-- Add both so all migrations work regardless of run order.
ALTER TABLE public.pipeline_versions
  ADD COLUMN IF NOT EXISTS dag           JSONB       DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dag_snapshot  JSONB       DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS changelog     TEXT,
  ADD COLUMN IF NOT EXISTS is_published  BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS node_count    INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snapshot_at   TIMESTAMPTZ DEFAULT now();

-- Sync dag ↔ dag_snapshot for rows that have one but not the other
UPDATE public.pipeline_versions
SET dag = dag_snapshot
WHERE dag = '{}' AND dag_snapshot != '{}';

UPDATE public.pipeline_versions
SET dag_snapshot = dag
WHERE dag_snapshot = '{}' AND dag != '{}';

-- ── 4. Upsert function for agent_pipeline_usage ────────────────────────────
-- Called by /api/pipelines/[id]/execute to track "used in X pipelines"
CREATE OR REPLACE FUNCTION public.upsert_agent_pipeline_usage(
  agent_id_param    UUID,
  pipeline_id_param UUID,
  user_id_param     UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.agent_pipeline_usage
    (agent_id, pipeline_id, user_id, first_used, last_used, use_count)
  VALUES
    (agent_id_param, pipeline_id_param, user_id_param, now(), now(), 1)
  ON CONFLICT (agent_id, pipeline_id) DO UPDATE
    SET last_used = now(),
        use_count = agent_pipeline_usage.use_count + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_agent_pipeline_usage(UUID, UUID, UUID)
  TO authenticated, service_role;

-- ── 5. Ensure pipeline_use_count on agents (from 013) ─────────────────────
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS pipeline_use_count INTEGER DEFAULT 0;

-- ── 6. Verification ────────────────────────────────────────────────────────
DO $$
DECLARE v INT;
BEGIN
  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema='public' AND table_name='agent_pipeline_usage'
    AND column_name='use_count';
  RAISE NOTICE 'agent_pipeline_usage.use_count: %', CASE WHEN v=1 THEN '✅ OK' ELSE '❌ MISSING' END;

  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema='public' AND table_name='agent_pipeline_usage'
    AND column_name='last_used';
  RAISE NOTICE 'agent_pipeline_usage.last_used: %', CASE WHEN v=1 THEN '✅ OK' ELSE '❌ MISSING' END;

  SELECT COUNT(*) INTO v FROM pg_indexes
  WHERE schemaname='public' AND tablename='agent_pipeline_usage'
    AND indexname='idx_agent_pipeline_usage_agent';
  RAISE NOTICE 'idx_agent_pipeline_usage_agent: %', CASE WHEN v=1 THEN '✅ OK' ELSE '❌ MISSING' END;

  RAISE NOTICE '✅ 010_network_effects_fix.sql complete — column error resolved';
END $$;
