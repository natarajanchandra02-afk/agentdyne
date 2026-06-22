-- ============================================================
-- 028 LINE 99 HOTFIX
-- Error: "loop variable of loop over rows must be a record variable"
-- Root cause: DO block uses FOR r IN (...) without DECLARE r RECORD
-- AND wraps the SELECT in parentheses (non-standard in some PG versions)
--
-- Run THIS file in Supabase SQL Editor to complete the DROP phase
-- that 028 was trying to do at line 99.
-- After this runs successfully, re-run the REST of 028 from Section 1 onward.
-- ============================================================

-- ── Drop all overloads of search_agents_semantic ─────────────────────────────
DO $$
DECLARE
  r RECORD;  -- required: loop variable must be declared
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname = 'search_agents_semantic'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
    RAISE NOTICE 'Dropped: %', r.sig;
  END LOOP;
END
$$;

-- ── Drop all overloads of search_rag_chunks ──────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname = 'search_rag_chunks'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
    RAISE NOTICE 'Dropped: %', r.sig;
  END LOOP;
END
$$;

-- Verify both are gone
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('search_agents_semantic','search_rag_chunks');
  RAISE NOTICE '✅ Remaining overloads after drop: % (should be 0)', v_count;
END
$$;
