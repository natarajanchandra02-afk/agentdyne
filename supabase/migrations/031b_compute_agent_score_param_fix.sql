-- ============================================================
-- AgentDyne Migration 031b: compute_agent_score Parameter Fix
--
-- ERROR: 42P13: cannot change name of input parameter "target_agent_id"
-- HINT:  Use DROP FUNCTION compute_agent_score(uuid) first.
--
-- ROOT CAUSE:
--   An earlier migration created compute_agent_score(target_agent_id UUID).
--   Migration 031 (Leaderboard Anti-Gaming) and 032 both try to CREATE OR REPLACE
--   it with parameter name "agent_id_param" — PostgreSQL forbids renaming
--   parameters on existing functions without a DROP.
--
-- FIX:
--   1. Drop ALL overloads of compute_agent_score (any parameter name/count).
--   2. The canonical version in 032_view_fix_apikeys_schema.sql recreates it
--      with agent_id_param UUID and the full anti-gaming scoring logic.
--
-- RUN ORDER: Run this BEFORE 032_view_fix_apikeys_schema.sql if 032 fails.
--            If you are running migrations in sequence, run this as 031b.
--
-- IDEMPOTENT: Safe to re-run.
-- ============================================================

-- Drop every overload of compute_agent_score regardless of parameter name
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname = 'compute_agent_score'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
    RAISE NOTICE 'Dropped: %', r.sig;
  END LOOP;
END
$$;

-- Also drop refresh_agent_rankings which may depend on compute_agent_score
DROP FUNCTION IF EXISTS public.refresh_agent_rankings() CASCADE;

-- Verify
DO $$
DECLARE
  fn_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'compute_agent_score';

  RAISE NOTICE '=== 031b compute_agent_score param fix ===';
  RAISE NOTICE 'Remaining overloads: % (expected 0)', fn_count;
  IF fn_count = 0 THEN
    RAISE NOTICE '✅ All overloads dropped — run 032_view_fix_apikeys_schema.sql next';
  ELSE
    RAISE WARNING '❌ % overload(s) still exist — check for CASCADE dependencies', fn_count;
  END IF;
END $$;
