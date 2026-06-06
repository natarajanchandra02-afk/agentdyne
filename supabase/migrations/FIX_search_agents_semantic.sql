-- ============================================================
-- PATCH: Fix search_agents_semantic return type conflict
--
-- ERROR:  42P13: cannot change return type of existing function
-- DETAIL: Row type defined by OUT parameters is different.
-- HINT:   Use DROP FUNCTION search_agents_semantic(vector,double
--         precision,integer) first.
--
-- ROOT CAUSE
-- ─────────────────────────────────────────────────────────────
-- PostgreSQL binds a SQL-language function's return row type to
-- the exact column types returned by the SELECT body at creation
-- time. Migration 005 created search_agents_semantic when
-- agents.composite_score was numeric(5,2). A later migration
-- changed the column to plain numeric (no precision). Now the
-- stored return type (numeric(5,2)) no longer matches the new
-- body's return type (numeric), so CREATE OR REPLACE fails with
-- ERROR 42P13 even though the declared RETURNS TABLE says numeric.
--
-- FIX
-- ─────────────────────────────────────────────────────────────
-- DROP all overloads of the function (there may be one or two
-- variants registered), then recreate with the canonical
-- signature. Safe to run multiple times — all statements are
-- idempotent.
--
-- HOW TO RUN
-- ─────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New query → paste → Run
-- Takes < 1 second. No data is affected.
-- ============================================================

-- ── Step 1: Drop ALL overloads (belt-and-suspenders) ─────────────────────
-- We drop by full signature to avoid touching other functions.
-- If a variant doesn't exist the IF EXISTS makes it a no-op.

DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,  double precision, integer);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,  float,            integer);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,  double precision, int);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,  float,            int);
-- Extra safety: drop by name only (catches any remaining overloads)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_agents_semantic'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
    RAISE NOTICE 'Dropped function: %', r.sig;
  END LOOP;
END $$;

-- ── Step 2: Recreate with canonical signature ─────────────────────────────
-- Uses explicit casts on all numeric columns so the return type is
-- stable regardless of the underlying column precision.

CREATE FUNCTION public.search_agents_semantic(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.7,
  match_count     integer          DEFAULT 10
)
RETURNS TABLE (
  agent_id         uuid,
  name             text,
  description      text,
  category         text,
  composite_score  numeric,
  average_rating   numeric,
  pricing_model    text,
  price_per_call   numeric,
  total_executions bigint,
  similarity       double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.id,
    a.name,
    a.description,
    a.category::text,
    COALESCE(a.composite_score, 0)::numeric,
    COALESCE(a.average_rating,  0)::numeric,
    a.pricing_model::text,
    COALESCE(a.price_per_call,  0)::numeric,
    a.total_executions,
    (1 - (e.embedding <=> query_embedding))::double precision AS similarity
  FROM public.agent_embeddings e
  JOIN public.agents a ON a.id = e.agent_id
  WHERE a.status::text = 'active'
    AND (1 - (e.embedding <=> query_embedding)) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── Step 3: Restore grants ────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION
  public.search_agents_semantic(vector, double precision, integer)
  TO anon, authenticated, service_role;

-- ── Step 4: Verify ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count INT;
  v_sig   TEXT;
BEGIN
  SELECT COUNT(*), MIN(p.oid::regprocedure::text)
    INTO v_count, v_sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'search_agents_semantic';

  IF v_count = 1 THEN
    RAISE NOTICE '✅ search_agents_semantic recreated: %', v_sig;
  ELSIF v_count = 0 THEN
    RAISE WARNING '⚠️  search_agents_semantic was NOT created — check for errors above';
  ELSE
    RAISE WARNING '⚠️  Multiple overloads still exist (%) — run the DROP block again', v_count;
  END IF;
END $$;

-- ============================================================
-- DONE — you can now re-run 008_complete_fix.sql safely.
-- The Section 10h CREATE OR REPLACE will succeed because the
-- old function with mismatched return type is gone.
-- ============================================================
