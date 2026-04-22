-- ============================================================
-- Migration 013: Pipeline versioning + agent usage analytics
-- Run ONCE in Supabase SQL Editor. All statements idempotent.
-- ============================================================

-- ── 1. pipeline_versions (immutable snapshots) ───────────────────────────
-- execute/route.ts upserts here fire-and-forget after every successful run.
CREATE TABLE IF NOT EXISTS public.pipeline_versions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id  UUID        NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  version      TEXT        NOT NULL DEFAULT '1.0.0',
  dag_snapshot JSONB       NOT NULL DEFAULT '{}',
  node_count   INTEGER     DEFAULT 0,
  snapshot_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(pipeline_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pv_pipeline
  ON public.pipeline_versions(pipeline_id, snapshot_at DESC);

ALTER TABLE public.pipeline_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='pipeline_versions' AND policyname='pv_owner_read'
  ) THEN
    CREATE POLICY "pv_owner_read" ON public.pipeline_versions FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.pipelines
        WHERE pipelines.id = pipeline_versions.pipeline_id
          AND (pipelines.owner_id = auth.uid() OR pipelines.is_public)
      ));
    CREATE POLICY "pv_system_insert" ON public.pipeline_versions FOR INSERT WITH CHECK (true);
    CREATE POLICY "pv_service_all"   ON public.pipeline_versions FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT ON public.pipeline_versions TO authenticated, service_role;

-- ── 2. version + pipeline_use_count on pipelines ─────────────────────────
ALTER TABLE public.pipelines ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0.0';

-- ── 3. pipeline_use_count on agents (for marketplace "used in pipelines") ──
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS pipeline_use_count INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_agent_pipeline_use(agent_id_param UUID)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER AS $$
  UPDATE public.agents
  SET pipeline_use_count = COALESCE(pipeline_use_count, 0) + 1
  WHERE id = agent_id_param;
$$;
GRANT EXECUTE ON FUNCTION public.increment_agent_pipeline_use(UUID) TO service_role;

-- ── 4. agent_pipeline_usage — tracks which agents are used in pipelines ──
-- Powers the "used in X pipelines" badge on marketplace detail pages
CREATE TABLE IF NOT EXISTS public.agent_pipeline_usage (
  id          BIGSERIAL   PRIMARY KEY,
  agent_id    UUID        NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  pipeline_id UUID        NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_used  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, pipeline_id)
);

CREATE INDEX IF NOT EXISTS idx_apu_agent    ON public.agent_pipeline_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_apu_pipeline ON public.agent_pipeline_usage(pipeline_id);

ALTER TABLE public.agent_pipeline_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='agent_pipeline_usage' AND policyname='apu_public_read'
  ) THEN
    CREATE POLICY "apu_public_read" ON public.agent_pipeline_usage FOR SELECT USING (true);
    CREATE POLICY "apu_insert"      ON public.agent_pipeline_usage FOR INSERT WITH CHECK (true);
  END IF;
END $$;
GRANT SELECT, INSERT ON public.agent_pipeline_usage TO authenticated, service_role;

-- ── 5. Verification ──────────────────────────────────────────────────────
DO $$
DECLARE v INT;
BEGIN
  SELECT COUNT(*) INTO v FROM information_schema.tables
  WHERE table_schema='public' AND table_name='pipeline_versions';
  RAISE NOTICE '✅ pipeline_versions: %', CASE WHEN v=1 THEN 'created' ELSE 'MISSING' END;

  SELECT COUNT(*) INTO v FROM information_schema.tables
  WHERE table_schema='public' AND table_name='agent_pipeline_usage';
  RAISE NOTICE '✅ agent_pipeline_usage: %', CASE WHEN v=1 THEN 'created' ELSE 'MISSING' END;

  RAISE NOTICE '✅ Migration 013 complete';
END $$;
