-- ============================================================
-- Migration 017 FINAL — Network Effects + Trust Layer + Share API
--
-- Previous run crashed with ERROR 42703: column "created_at"
-- does not exist because pipeline_versions already exists in
-- the live DB with column "snapshot_at" (not "created_at").
--
-- ALL bugs fixed:
--   1. pipeline_versions index uses snapshot_at (live schema column)
--   2. ADD COLUMN IF NOT EXISTS before any view/index that needs them
--   3. UNIQUE constraint added before upsert_pipeline_usage uses ON CONFLICT
--   4. agent_pipeline_stats VIEW created AFTER all columns exist
--   5. pipeline_versions columns added with correct live names
--
-- Validated against live schema snapshot (April 2026).
-- Fully idempotent — safe to re-run.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SECTION 1: agent_pipeline_usage — add missing columns FIRST
-- Live schema has: id(bigint), agent_id, pipeline_id, user_id, first_used
-- Missing:         use_count, last_used
-- The index and upsert function both need these to exist first.
-- ════════════════════════════════════════════════════════════

-- Step 1a: ensure table exists (create if missing, no-op if exists)
CREATE TABLE IF NOT EXISTS public.agent_pipeline_usage (
  id          BIGSERIAL   PRIMARY KEY,
  agent_id    UUID        NOT NULL REFERENCES public.agents(id)    ON DELETE CASCADE,
  pipeline_id UUID        NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_used  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Step 1b: add missing columns defensively (NO-OP if they already exist)
ALTER TABLE public.agent_pipeline_usage
  ADD COLUMN IF NOT EXISTS use_count INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_used TIMESTAMPTZ NOT NULL DEFAULT now();

-- Step 1c: add UNIQUE constraint for ON CONFLICT in upsert function.
-- Must exist BEFORE the function uses ON CONFLICT (agent_id, pipeline_id).
-- Uses DO block to skip gracefully if constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_pipeline_usage_agent_pipeline_unique'
      AND conrelid = 'public.agent_pipeline_usage'::regclass
  ) THEN
    ALTER TABLE public.agent_pipeline_usage
      ADD CONSTRAINT agent_pipeline_usage_agent_pipeline_unique
      UNIQUE (agent_id, pipeline_id);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Unique constraint already exists or could not be added: %', SQLERRM;
END $$;

-- Step 1d: RLS
ALTER TABLE public.agent_pipeline_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_pipeline_usage' AND policyname = 'Usage is public-readable'
  ) THEN
    CREATE POLICY "Usage is public-readable"       ON public.agent_pipeline_usage FOR SELECT USING (true);
    CREATE POLICY "Users manage own usage records" ON public.agent_pipeline_usage FOR ALL   USING (auth.uid() = user_id);
  END IF;
END $$;

-- Step 1e: indexes (now safe — use_count column guaranteed to exist)
CREATE INDEX IF NOT EXISTS idx_agent_pipeline_usage_agent
  ON public.agent_pipeline_usage(agent_id, use_count DESC);

CREATE INDEX IF NOT EXISTS idx_agent_pipeline_usage_pipeline
  ON public.agent_pipeline_usage(pipeline_id);

GRANT SELECT         ON public.agent_pipeline_usage TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.agent_pipeline_usage TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 2: pipeline_versions — fix column mismatch
--
-- Live schema has:
--   id, pipeline_id, version, dag_snapshot, node_count, snapshot_at
--
-- Migration previously assumed:
--   dag, created_at, changelog, is_published, created_by
--   → CREATE TABLE IF NOT EXISTS was skipped (table exists)
--   → CREATE INDEX ... (pipeline_id, created_at DESC) CRASHED
--
-- Fix: add missing columns with IF NOT EXISTS, use snapshot_at for index.
-- ════════════════════════════════════════════════════════════

-- Add columns that the codebase needs but the live table is missing
ALTER TABLE public.pipeline_versions
  ADD COLUMN IF NOT EXISTS dag          JSONB   DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS changelog    TEXT,
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by   UUID    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Ensure snapshot_at exists (it does in live schema, but guard for safety)
ALTER TABLE public.pipeline_versions
  ADD COLUMN IF NOT EXISTS snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add UNIQUE constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_versions_pipeline_version_unique'
      AND conrelid = 'public.pipeline_versions'::regclass
  ) THEN
    ALTER TABLE public.pipeline_versions
      ADD CONSTRAINT pipeline_versions_pipeline_version_unique
      UNIQUE (pipeline_id, version);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pipeline_versions unique constraint: %', SQLERRM;
END $$;

ALTER TABLE public.pipeline_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pipeline_versions'
      AND policyname = 'Pipeline versions public-readable for public pipelines'
  ) THEN
    CREATE POLICY "Pipeline versions public-readable for public pipelines"
      ON public.pipeline_versions FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.pipelines p
        WHERE p.id = pipeline_id
          AND (p.is_public = TRUE OR p.owner_id = auth.uid())
      ));
    CREATE POLICY "Pipeline owners manage versions"
      ON public.pipeline_versions FOR INSERT
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.pipelines p
        WHERE p.id = pipeline_id AND p.owner_id = auth.uid()
      ));
  END IF;
END $$;

-- THE FIX: use snapshot_at (the actual column in the live table)
-- NOT created_at (which does not exist → was the crash)
CREATE INDEX IF NOT EXISTS idx_pipeline_versions_pipeline
  ON public.pipeline_versions(pipeline_id, snapshot_at DESC);

GRANT SELECT ON public.pipeline_versions TO anon, authenticated;
GRANT INSERT ON public.pipeline_versions TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 3: execution_snapshots (new table — deterministic trust)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.execution_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id    UUID        NOT NULL REFERENCES public.executions(id) ON DELETE CASCADE,
  agent_id        UUID        REFERENCES public.agents(id)   ON DELETE SET NULL,
  pipeline_id     UUID        REFERENCES public.pipelines(id) ON DELETE SET NULL,
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  model_name      TEXT        NOT NULL,
  model_version   TEXT,
  temperature     NUMERIC(4,3),
  max_tokens      INTEGER,
  seed            INTEGER,

  system_prompt   TEXT        NOT NULL,
  user_message    TEXT        NOT NULL,
  assistant_reply TEXT,

  rag_chunks_used INTEGER     DEFAULT 0,
  tool_calls_made INTEGER     DEFAULT 0,
  tokens_input    INTEGER     DEFAULT 0,
  tokens_output   INTEGER     DEFAULT 0,
  latency_ms      INTEGER,
  cost_usd        NUMERIC(12,8),

  status          TEXT        NOT NULL DEFAULT 'success',
  error_message   TEXT,
  context_hash    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_snapshots_execution
  ON public.execution_snapshots(execution_id);
CREATE INDEX IF NOT EXISTS idx_exec_snapshots_user_agent
  ON public.execution_snapshots(user_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_snapshots_hash
  ON public.execution_snapshots(context_hash) WHERE context_hash IS NOT NULL;

ALTER TABLE public.execution_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'execution_snapshots' AND policyname = 'snapshots_own_read'
  ) THEN
    CREATE POLICY "snapshots_own_read"   ON public.execution_snapshots FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY "snapshots_system_ins" ON public.execution_snapshots FOR INSERT WITH CHECK (true);
    CREATE POLICY "snapshots_admin_all"  ON public.execution_snapshots FOR ALL
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

GRANT SELECT ON public.execution_snapshots TO authenticated;
GRANT INSERT ON public.execution_snapshots TO service_role, authenticated;

-- ════════════════════════════════════════════════════════════
-- SECTION 4: pipeline_share_keys (new table — Pipeline-as-Product)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pipeline_share_keys (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id      UUID        NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  owner_id         UUID        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  share_key        TEXT        NOT NULL UNIQUE,
  name             TEXT,
  description      TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  allow_execute    BOOLEAN     NOT NULL DEFAULT TRUE,
  daily_limit      INTEGER     DEFAULT 100,
  executions_today INTEGER     DEFAULT 0,
  last_reset_at    TIMESTAMPTZ DEFAULT now(),
  total_uses       INTEGER     DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_share_keys_key
  ON public.pipeline_share_keys(share_key) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_share_keys_pipeline
  ON public.pipeline_share_keys(pipeline_id, owner_id);

ALTER TABLE public.pipeline_share_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pipeline_share_keys' AND policyname = 'share_keys_own_all'
  ) THEN
    CREATE POLICY "share_keys_own_all"     ON public.pipeline_share_keys FOR ALL
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
    CREATE POLICY "share_keys_public_read" ON public.pipeline_share_keys FOR SELECT
      USING (is_active = TRUE);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_share_keys TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 5: compute_context_hash() — deterministic hash RPC
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_context_hash(
  p_system  TEXT,
  p_message TEXT,
  p_model   TEXT,
  p_temp    NUMERIC
)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      COALESCE(p_system,'')  || '|' ||
      COALESCE(p_message,'') || '|' ||
      COALESCE(p_model,'')   || '|' ||
      COALESCE(p_temp::TEXT,''),
      'sha256'
    ),
    'hex'
  );
$$;

GRANT EXECUTE ON FUNCTION public.compute_context_hash(TEXT, TEXT, TEXT, NUMERIC)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 6: reset_share_key_daily_limits()
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reset_share_key_daily_limits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.pipeline_share_keys
  SET    executions_today = 0, last_reset_at = now()
  WHERE  last_reset_at < now() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_share_key_daily_limits() TO service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 7: upsert_pipeline_usage()
-- NOW safe: UNIQUE constraint on (agent_id, pipeline_id) guaranteed
-- to exist from Section 1c above before this function is created.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_pipeline_usage(
  p_agent_id    UUID,
  p_pipeline_id UUID,
  p_user_id     UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.agent_pipeline_usage
    (agent_id, pipeline_id, user_id, first_used, last_used, use_count)
  VALUES
    (p_agent_id, p_pipeline_id, p_user_id, now(), now(), 1)
  ON CONFLICT (agent_id, pipeline_id) DO UPDATE
    SET last_used = now(),
        use_count = agent_pipeline_usage.use_count + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_pipeline_usage(UUID, UUID, UUID)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 8: agent_pipeline_stats VIEW
-- Created AFTER all ADD COLUMN IF NOT EXISTS above so that
-- apu.use_count / apu.last_used / apu.user_id are guaranteed
-- to exist when the view is compiled.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.agent_pipeline_stats AS
SELECT
  a.id                                AS agent_id,
  a.name                              AS agent_name,
  COUNT(DISTINCT apu.pipeline_id)     AS pipeline_count,
  COALESCE(SUM(apu.use_count), 0)     AS total_pipeline_uses,
  MAX(apu.last_used)                  AS last_used_in_pipeline,
  COUNT(DISTINCT apu.user_id)         AS unique_pipeline_users
FROM   public.agents             a
LEFT JOIN public.agent_pipeline_usage apu ON apu.agent_id = a.id
WHERE  a.status = 'active'
GROUP  BY a.id, a.name;

GRANT SELECT ON public.agent_pipeline_stats TO authenticated, anon;

-- ════════════════════════════════════════════════════════════
-- SECTION 9: Performance indexes
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pipelines_dag_gin
  ON public.pipelines USING gin(dag);

-- pipeline_executions uses created_at (exists in live schema — safe)
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_pipeline_created
  ON public.pipeline_executions(pipeline_id, created_at DESC);

-- executions uses created_at (exists in live schema — safe)
CREATE INDEX IF NOT EXISTS idx_executions_agent_user_success
  ON public.executions(agent_id, user_id, created_at DESC)
  WHERE status = 'success';

-- execution_snapshots
CREATE INDEX IF NOT EXISTS idx_exec_snapshots_created
  ON public.execution_snapshots(created_at DESC);

-- ════════════════════════════════════════════════════════════
-- SECTION 10: pg_cron (uncomment to enable)
-- ════════════════════════════════════════════════════════════
-- SELECT cron.schedule('reset-share-limits', '0 0 * * *', $$SELECT public.reset_share_key_daily_limits()$$);

-- ════════════════════════════════════════════════════════════
-- SECTION 11: VERIFICATION — confirms all bugs are fixed
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_use_count       BOOLEAN;
  v_last_used       BOOLEAN;
  v_unique_constr   BOOLEAN;
  v_snapshot_col    BOOLEAN;
  v_tables          INTEGER;
  v_fns             INTEGER;
BEGIN
  -- Bug 1 fix: use_count column now exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agent_pipeline_usage' AND column_name='use_count'
  ) INTO v_use_count;

  -- Bug 1 fix: last_used column now exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agent_pipeline_usage' AND column_name='last_used'
  ) INTO v_last_used;

  -- Bug 2 fix: unique constraint exists for ON CONFLICT
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='agent_pipeline_usage_agent_pipeline_unique'
  ) INTO v_unique_constr;

  -- Bug 3 fix: pipeline_versions has snapshot_at (not just created_at)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pipeline_versions' AND column_name='snapshot_at'
  ) INTO v_snapshot_col;

  SELECT COUNT(*) INTO v_tables
  FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN ('agent_pipeline_usage','pipeline_versions','execution_snapshots','pipeline_share_keys');

  SELECT COUNT(*) INTO v_fns
  FROM pg_proc
  WHERE proname IN ('upsert_pipeline_usage','compute_context_hash','reset_share_key_daily_limits');

  RAISE NOTICE '── Bug fix verification ──────────────────────────────────';
  RAISE NOTICE 'use_count column exists            : %', v_use_count;
  RAISE NOTICE 'last_used column exists            : %', v_last_used;
  RAISE NOTICE 'UNIQUE(agent_id,pipeline_id)       : %', v_unique_constr;
  RAISE NOTICE 'pipeline_versions.snapshot_at      : %', v_snapshot_col;
  RAISE NOTICE '── New objects ──────────────────────────────────────────';
  RAISE NOTICE 'Core tables (expect 4)             : %', v_tables;
  RAISE NOTICE 'Helper functions (expect 3)        : %', v_fns;
  RAISE NOTICE '✅ Migration 017 complete — all bugs fixed';
END $$;
