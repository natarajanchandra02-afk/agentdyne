-- ============================================================
-- AgentDyne Migration 032 — View Fix + API Keys Schema + Codebase Sync
-- FIXED: All function bodies use correct $$ dollar-quote delimiters
-- FIXED: DROP before CREATE for all functions (avoids ERROR 42P13)
-- FIXED: DO block uses DECLARE r RECORD (avoids ERROR 42601)
-- ============================================================

-- ── 1. Drop view before recreating (fixes ERROR 42P16) ───────────────────────
-- CREATE OR REPLACE VIEW cannot change column names or order.
-- Must DROP first. Grants are re-added after.

DROP VIEW IF EXISTS public.agent_leaderboard CASCADE;

CREATE VIEW public.agent_leaderboard AS
SELECT
  a.id,
  a.name,
  a.slug,
  a.description,
  a.category,
  a.pricing_model,
  a.price_per_call,
  a.status,
  a.is_featured,
  a.is_verified,
  a.total_executions,
  a.successful_executions,
  a.average_latency_ms,
  a.average_rating,
  a.total_reviews,
  a.composite_score,
  a.is_top_rated,
  a.is_fastest,
  a.is_cheapest,
  a.is_most_reliable,
  a.evaluation_score,
  a.evaluation_passed,
  a.evaluation_runs,
  a.last_evaluated_at,
  a.auto_disabled_at,
  a.seller_id,
  ags.accuracy_score,
  ags.reliability_score,
  ags.latency_score,
  ags.cost_score,
  ags.popularity_score,
  ags.global_rank,
  ags.category_rank,
  ags.sample_size,
  ags.computed_at      AS score_computed_at,
  CASE
    WHEN COALESCE(a.total_executions, 0) > 0
    THEN ROUND(
      (a.total_executions - COALESCE(a.successful_executions, 0))::NUMERIC
      / a.total_executions * 100, 1
    )
    ELSE 0
  END AS failure_rate,
  a.created_at,
  a.updated_at
FROM public.agents a
LEFT JOIN public.agent_scores ags ON ags.agent_id = a.id;

GRANT SELECT ON public.agent_leaderboard TO authenticated, anon, service_role;

-- ── 2. Add missing api_keys columns ──────────────────────────────────────────

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS last_used_ip       TEXT;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS environment         TEXT    NOT NULL DEFAULT 'production' CHECK (environment IN ('production','test'));
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS allowed_agent_ids  TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS ip_allowlist        TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS hash_algo           TEXT    NOT NULL DEFAULT 'hmac-sha256';
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_day INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS calls_today         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS errors_today        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS cost_total_usd      NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS rotate_before       TIMESTAMPTZ;

-- ── 3. Indexes for api_keys ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix_active
  ON public.api_keys (key_prefix, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_api_keys_user_active
  ON public.api_keys (user_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_keys_rotate_before
  ON public.api_keys (rotate_before)
  WHERE rotate_before IS NOT NULL AND is_active = true;

-- ── 4. reset_api_key_daily_counters ──────────────────────────────────────────
-- DROP before CREATE: avoids ERROR 42P13 "cannot change return type of existing function"
-- Any prior version with different signature is removed first.

DROP FUNCTION IF EXISTS public.reset_api_key_daily_counters() CASCADE;

CREATE FUNCTION public.reset_api_key_daily_counters()
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.api_keys
  SET calls_today  = 0,
      errors_today = 0
  WHERE is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.reset_api_key_daily_counters() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('reset-api-key-counters');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'reset-api-key-counters',
  '0 0 * * *',
  'SELECT public.reset_api_key_daily_counters();'
);

-- ── 5. revoke_rotated_api_keys ────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.revoke_rotated_api_keys() CASCADE;

CREATE FUNCTION public.revoke_rotated_api_keys()
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  WITH revoked AS (
    UPDATE public.api_keys
    SET is_active = false
    WHERE rotate_before < now()
      AND is_active     = true
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM revoked;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_rotated_api_keys() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('revoke-rotated-keys');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'revoke-rotated-keys',
  '*/5 * * * *',
  'SELECT public.revoke_rotated_api_keys();'
);

-- ── 6. compute_agent_score — DROP all overloads then recreate ─────────────────
-- Uses DECLARE r RECORD in the DO loop (fixes ERROR 42601 "loop variable must
-- be a record variable"). Uses named $body$ tag to avoid nesting conflicts.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND p.proname = 'compute_agent_score'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
    RAISE NOTICE 'Dropped: %', r.sig;
  END LOOP;
END
$$;

CREATE FUNCTION public.compute_agent_score(agent_id_param UUID)
RETURNS NUMERIC
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_agent          RECORD;
  v_execs_30d      INTEGER;
  v_success_30d    INTEGER;
  v_uniq_users     INTEGER;
  v_uniq_recent    INTEGER;
  v_execs_total    INTEGER;
  v_avg_lat        NUMERIC;
  v_cat_median     NUMERIC;
  v_quality_score  NUMERIC := 0;
  v_reliability    NUMERIC := 0;
  v_latency_score  NUMERIC := 0;
  v_cost_score     NUMERIC := 0;
  v_adoption_score NUMERIC := 0;
  v_confidence     NUMERIC := 0;
  v_composite      NUMERIC := 0;
  v_price          NUMERIC;
  v_cat_cost       NUMERIC;
  v_weighted       NUMERIC;
BEGIN
  SELECT a.evaluation_score, a.evaluation_passed, a.evaluation_runs,
         a.price_per_call, a.category, a.total_executions,
         a.average_latency_ms, a.seller_id
  INTO v_agent
  FROM public.agents a WHERE a.id = agent_id_param;

  IF NOT FOUND THEN RETURN 0; END IF;
  IF COALESCE(v_agent.total_executions, 0) < 100 THEN RETURN 0; END IF;

  v_execs_total := COALESCE(v_agent.total_executions, 0);

  -- Execution stats excluding seller self-executions (anti-gaming)
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'success'),
    COUNT(DISTINCT user_id)
  INTO v_execs_30d, v_success_30d, v_uniq_users
  FROM public.executions
  WHERE agent_id   = agent_id_param
    AND created_at > now() - INTERVAL '30 days'
    AND user_id   != v_agent.seller_id;

  SELECT COUNT(DISTINCT user_id) INTO v_uniq_recent
  FROM public.executions
  WHERE agent_id   = agent_id_param
    AND created_at > now() - INTERVAL '7 days'
    AND user_id   != v_agent.seller_id;

  -- 1. Quality (30%) — from eval harness
  v_quality_score := CASE
    WHEN COALESCE(v_agent.evaluation_runs, 0) >= 5
    THEN COALESCE(v_agent.evaluation_score, 0)
    ELSE COALESCE(v_agent.evaluation_score, 0) * 0.7
  END;

  -- 2. Reliability (25%) — success rate excl. self-executions
  v_reliability := CASE
    WHEN v_execs_30d > 0
    THEN GREATEST(0, (v_success_30d::NUMERIC / v_execs_30d) * 100)
    ELSE 50
  END;

  -- 3. Latency (20%) — vs category median
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY average_latency_ms)
  INTO v_cat_median
  FROM public.agents
  WHERE category = v_agent.category AND status = 'active' AND total_executions >= 100;

  v_avg_lat       := COALESCE(v_agent.average_latency_ms, 5000);
  v_cat_median    := COALESCE(v_cat_median, 3000);
  v_latency_score := GREATEST(0, LEAST(100,
    100 - ((v_avg_lat - v_cat_median * 0.5) / (v_cat_median * 3)) * 100
  ));

  -- 4. Cost (15%) — vs category median price
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_call)
  INTO v_cat_cost
  FROM public.agents
  WHERE category = v_agent.category AND status = 'active'
    AND pricing_model != 'free' AND total_executions >= 100;

  v_price    := COALESCE(v_agent.price_per_call, 0);
  v_cat_cost := COALESCE(v_cat_cost, 0.01);
  v_cost_score := CASE
    WHEN v_price = 0 THEN 80
    ELSE GREATEST(0, LEAST(100,
      100 - ((v_price - v_cat_cost * 0.5) / (v_cat_cost * 3)) * 100))
  END;

  -- 5. Adoption (10%) — unique users, recency-weighted (anti-gaming)
  v_weighted       := (v_uniq_recent * 2) + GREATEST(0, v_uniq_users - v_uniq_recent);
  v_adoption_score := LEAST(100, (LOG(GREATEST(1, v_weighted)) / LOG(500)) * 100);

  -- Confidence: shrink toward 50 when sample is small
  v_confidence := LEAST(1.0, LOG(GREATEST(1, v_execs_total)) / LOG(10000));

  v_composite :=
    (v_quality_score  * 0.30) +
    (v_reliability    * 0.25) +
    (v_latency_score  * 0.20) +
    (v_cost_score     * 0.15) +
    (v_adoption_score * 0.10);

  -- Blend toward neutral when low-confidence
  v_composite := (v_composite * v_confidence) + (50 * (1 - v_confidence));

  RETURN ROUND(GREATEST(0, LEAST(100, v_composite)), 2);
END
$body$;

GRANT EXECUTE ON FUNCTION public.compute_agent_score(UUID) TO service_role;

-- ── 7. api_keys RLS ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'api_keys' AND c.relrowsecurity
  ) THEN
    ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'RLS enabled on api_keys';
  END IF;
END $$;

DROP POLICY IF EXISTS "api_keys_user_select" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_user_insert" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_user_update" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_user_delete" ON public.api_keys;

CREATE POLICY "api_keys_user_select" ON public.api_keys FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "api_keys_user_insert" ON public.api_keys FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "api_keys_user_update" ON public.api_keys FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "api_keys_user_delete" ON public.api_keys FOR DELETE USING (user_id = auth.uid());

GRANT ALL ON public.api_keys TO service_role;

-- ── Verification (plain SELECT — no DO block needed) ──────────────────────────────────
SELECT
  'api_keys new columns'  AS check_name,
  COUNT(*)                AS found,
  10                      AS expected,
  CASE WHEN COUNT(*) = 10 THEN 'OK' ELSE 'MISSING' END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'api_keys'
  AND column_name IN (
    'last_used_ip', 'environment', 'allowed_agent_ids', 'ip_allowlist',
    'hash_algo', 'rate_limit_per_day', 'calls_today', 'errors_today',
    'cost_total_usd', 'rotate_before'
  );

SELECT
  'api_keys indexes'  AS check_name,
  COUNT(*)            AS found,
  3                   AS expected,
  CASE WHEN COUNT(*) = 3 THEN 'OK' ELSE 'MISSING' END AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename   = 'api_keys'
  AND indexname IN (
    'idx_api_keys_prefix_active',
    'idx_api_keys_user_active',
    'idx_api_keys_rotate_before'
  );

SELECT
  'compute_agent_score function'  AS check_name,
  p.proname                       AS found,
  'exists'                        AS expected,
  'OK'                            AS status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'compute_agent_score'
LIMIT 1;

-- If the above returns 0 rows, compute_agent_score is missing.
-- Expected output: 3 rows, all status = 'OK'.
-- === Migration 032 COMPLETE ===
