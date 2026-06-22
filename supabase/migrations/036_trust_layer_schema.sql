-- ============================================================
-- AgentDyne Migration 036: Trust Layer Schema
--
-- Adds hashing + confidence columns to pipeline_step_checkpoints
-- and creates the anonymous sandbox tracking table.
--
-- Part of the Trust Layer Lite implementation:
--   - intent_hash: SHA-256 of original pipeline input, constant across all steps
--   - input_hash:  SHA-256 of each step's actual input
--   - output_hash: SHA-256 of each step's output (enables replay dedup)
--   - confidence:  Agent-reported confidence score (0.0–1.0)
--   - drift_score: Intent drift detection result
--   - envelope:    Full step envelope JSON for audit trail
--
-- Also creates sandbox_runs for anonymous "Try without login" feature.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================

-- ── 1. Extend pipeline_step_checkpoints with trust layer columns ──────────────

ALTER TABLE public.pipeline_step_checkpoints
  ADD COLUMN IF NOT EXISTS intent_hash   text,
  ADD COLUMN IF NOT EXISTS input_hash    text,
  ADD COLUMN IF NOT EXISTS output_hash   text,
  ADD COLUMN IF NOT EXISTS confidence    numeric,
  ADD COLUMN IF NOT EXISTS drift_score   numeric,
  ADD COLUMN IF NOT EXISTS drift_flagged boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS envelope      jsonb;

-- Index for replay dedup: given an input_hash, find if we already ran this step
CREATE INDEX IF NOT EXISTS idx_step_checkpoints_input_hash
  ON public.pipeline_step_checkpoints(input_hash)
  WHERE status = 'completed' AND input_hash IS NOT NULL;

-- Index for intent tracking: find all steps in a pipeline with a given intent
CREATE INDEX IF NOT EXISTS idx_step_checkpoints_intent_hash
  ON public.pipeline_step_checkpoints(intent_hash)
  WHERE intent_hash IS NOT NULL;

-- ── 2. sandbox_runs — anonymous execution tracking ────────────────────────────
-- Tracks "Try without login" runs by device fingerprint.
-- Limit: 2 runs per device (enforced by execute route + DB count).

CREATE TABLE IF NOT EXISTS public.sandbox_runs (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  fingerprint     text        NOT NULL,   -- device fingerprint hash
  ip_prefix       text,                  -- first 3 octets of IP (e.g. "192.168.1")
  agent_id        uuid,
  input_text      text,                  -- truncated input for abuse review
  output_text     text,                  -- truncated output
  model_used      text        NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  tokens_in       integer     DEFAULT 0,
  tokens_out      integer     DEFAULT 0,
  cost_usd        numeric     DEFAULT 0,
  cache_hit       boolean     DEFAULT false,
  converted       boolean     DEFAULT false,   -- did this lead to signup?
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sandbox_runs_pkey PRIMARY KEY (id)
);

-- Fast lookup: how many runs has this fingerprint made?
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_fingerprint
  ON public.sandbox_runs(fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sandbox_runs_ip
  ON public.sandbox_runs(ip_prefix, created_at DESC)
  WHERE ip_prefix IS NOT NULL;

-- ── 3. RLS on sandbox_runs ────────────────────────────────────────────────────
-- No user auth → no user-level policies. Service role only.
-- Admins can read via service_role key for abuse monitoring.
ALTER TABLE public.sandbox_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sandbox_runs'
      AND policyname = 'sandbox_service_all'
  ) THEN
    CREATE POLICY "sandbox_service_all"
      ON public.sandbox_runs FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

GRANT ALL ON public.sandbox_runs TO service_role;

-- ── 4. Whitelisted sandbox agents ─────────────────────────────────────────────
-- Only agents with sandbox_enabled = true can be run anonymously.
-- Add the column to agents table.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS sandbox_enabled boolean DEFAULT false;

-- Index: fast lookup of sandbox-eligible agents
CREATE INDEX IF NOT EXISTS idx_agents_sandbox_active
  ON public.agents(sandbox_enabled, status)
  WHERE sandbox_enabled = true AND status = 'active';

-- Enable sandbox on all currently active agents (seed data / platform agents)
-- Admins can disable per-agent as needed
UPDATE public.agents
SET sandbox_enabled = true
WHERE status = 'active';

-- ── 5. Verification ──────────────────────────────────────────────────────────

SELECT
  'pipeline_step_checkpoints trust columns' AS check_name,
  COUNT(*)                                   AS found,
  7                                          AS expected,
  CASE WHEN COUNT(*) >= 7 THEN 'OK' ELSE 'MISSING' END AS status
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pipeline_step_checkpoints'
  AND column_name IN (
    'intent_hash', 'input_hash', 'output_hash',
    'confidence', 'drift_score', 'drift_flagged', 'envelope'
  );

SELECT
  'sandbox_runs table' AS check_name,
  COUNT(*)             AS found,
  1                    AS expected,
  CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING' END AS status
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'sandbox_runs';

SELECT
  'agents.sandbox_enabled column' AS check_name,
  COUNT(*)                         AS found,
  1                                AS expected,
  CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING' END AS status
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'agents'
  AND column_name = 'sandbox_enabled';

-- Expected: all 3 rows show status = 'OK'
-- === Migration 036 COMPLETE ===
