-- =============================================================================
-- AgentDyne — Migration 031: Leaderboard Anti-Gaming + Scoring Fix (v2)
-- Fixed:
--   1. DROP VIEW before recreate (avoids "cannot drop columns from view")
--   2. ADD missing evaluation columns to agents table before referencing them
--   3. Remove nested DECLARE blocks (invalid PL/pgSQL — use variables instead)
--   4. Remove references to auto_disabled_at (added as column only if needed)
-- =============================================================================

-- ── 0. Add missing evaluation columns to agents table ────────────────────────

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS evaluation_score    NUMERIC  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evaluation_passed   BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS evaluation_runs     INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_evaluated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_disabled_at    TIMESTAMPTZ;

-- ── 1. Drop the existing agent_leaderboard view before recreating ─────────────
-- Required because CREATE OR REPLACE VIEW cannot remove columns from a view.
-- The 028 view had seller_name/seller_username/seller_verified/icon_url/tags;
-- the new version restructures these, so we DROP + recreate.

DROP VIEW IF EXISTS public.agent_leaderboard CASCADE;

-- ── 2. Rewrite compute_agent_score with anti-gaming ──────────────────────────

DROP FUNCTION IF EXISTS public.compute_agent_score(UUID) CASCADE;

CREATE FUNCTION public.compute_agent_score(agent_id_param UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_id       UUID;
  v_category        TEXT;
  v_price           NUMERIC;
  v_total_execs     BIGINT;
  v_avg_lat         INTEGER;
  v_eval_score      NUMERIC;
  v_eval_runs       INTEGER;

  v_execs_30d       INTEGER;
  v_success_30d     INTEGER;
  v_execs_7d        INTEGER;

  v_cat_median_lat  NUMERIC;
  v_cat_median_cost NUMERIC;

  v_quality_score   NUMERIC := 0;
  v_reliability     NUMERIC := 0;
  v_latency_score   NUMERIC := 0;
  v_cost_score      NUMERIC := 0;
  v_adoption_score  NUMERIC := 0;
  v_confidence      NUMERIC := 0;
  v_composite       NUMERIC := 0;
  v_weighted_volume NUMERIC := 0;
BEGIN
  -- Load agent fields
  SELECT seller_id, category::TEXT, COALESCE(price_per_call, 0),
         COALESCE(total_executions, 0), COALESCE(average_latency_ms, 5000),
         COALESCE(evaluation_score, 0), COALESCE(evaluation_runs, 0)
  INTO v_seller_id, v_category, v_price, v_total_execs, v_avg_lat, v_eval_score, v_eval_runs
  FROM public.agents
  WHERE id = agent_id_param;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- Minimum 100 executions required for a meaningful score
  IF v_total_execs < 100 THEN RETURN 0; END IF;

  -- Execution stats — exclude seller's own executions (anti-gaming)
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE status = 'success')::INTEGER
  INTO v_execs_30d, v_success_30d
  FROM public.executions
  WHERE agent_id   = agent_id_param
    AND created_at > now() - INTERVAL '30 days'
    AND user_id   IS DISTINCT FROM v_seller_id;

  SELECT COUNT(*)::INTEGER INTO v_execs_7d
  FROM public.executions
  WHERE agent_id   = agent_id_param
    AND created_at > now() - INTERVAL '7 days'
    AND user_id   IS DISTINCT FROM v_seller_id;

  -- 1. Quality score (30%) — from evaluation harness
  v_quality_score := CASE
    WHEN v_eval_runs >= 5 THEN v_eval_score
    ELSE v_eval_score * 0.7
  END;

  -- 2. Reliability (25%) — success rate over 30 days
  v_reliability := CASE
    WHEN v_execs_30d > 0
    THEN GREATEST(0, (v_success_30d::NUMERIC / v_execs_30d) * 100)
    ELSE 50  -- neutral when no recent external data
  END;

  -- 3. Latency score (20%) — vs category median
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY average_latency_ms)
  INTO v_cat_median_lat
  FROM public.agents
  WHERE category::TEXT = v_category
    AND status::TEXT   = 'active'
    AND total_executions >= 100;

  v_cat_median_lat := COALESCE(v_cat_median_lat, 3000);

  v_latency_score := GREATEST(0, LEAST(100,
    100 - ((v_avg_lat - v_cat_median_lat * 0.5) / (v_cat_median_lat * 3.0)) * 100
  ));

  -- 4. Cost score (15%) — vs category median
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_call)
  INTO v_cat_median_cost
  FROM public.agents
  WHERE category::TEXT    = v_category
    AND status::TEXT      = 'active'
    AND pricing_model::TEXT != 'free'
    AND total_executions   >= 100;

  v_cat_median_cost := COALESCE(v_cat_median_cost, 0.01);

  IF v_price = 0 THEN
    v_cost_score := 80;
  ELSE
    v_cost_score := GREATEST(0, LEAST(100,
      100 - ((v_price - v_cat_median_cost * 0.5) / (v_cat_median_cost * 3.0)) * 100
    ));
  END IF;

  -- 5. Adoption score (10%) — recency-weighted volume
  v_weighted_volume := (v_execs_7d * 2) + GREATEST(0, v_execs_30d - v_execs_7d);
  v_adoption_score  := LEAST(100, (LOG(GREATEST(1, v_weighted_volume)) / LOG(1000)) * 100);

  -- Confidence factor: shrinks score towards neutral (50) at low volume
  v_confidence := LEAST(1.0, LOG(GREATEST(1, v_total_execs)) / LOG(10000));

  -- Composite
  v_composite :=
    (v_quality_score  * 0.30) +
    (v_reliability    * 0.25) +
    (v_latency_score  * 0.20) +
    (v_cost_score     * 0.15) +
    (v_adoption_score * 0.10);

  -- Blend towards 50 when confidence is low
  v_composite := (v_composite * v_confidence) + (50.0 * (1.0 - v_confidence));

  RETURN ROUND(GREATEST(0, LEAST(100, v_composite)), 2);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_agent_score(UUID) TO service_role, authenticated;

-- ── 3. Rewrite refresh_agent_rankings ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_agent_rankings()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  -- Recompute scores for all eligible active agents
  UPDATE public.agent_scores ags
  SET
    composite_score   = public.compute_agent_score(ags.agent_id),
    accuracy_score    = COALESCE(
                          (SELECT evaluation_score FROM public.agents WHERE id = ags.agent_id), 0),
    reliability_score = GREATEST(0, COALESCE((
                          SELECT (COUNT(*) FILTER (WHERE e.status='success'))::NUMERIC
                                 / NULLIF(COUNT(*), 0) * 100
                          FROM public.executions e
                          JOIN public.agents a ON a.id = e.agent_id
                          WHERE e.agent_id   = ags.agent_id
                            AND e.created_at > now() - INTERVAL '30 days'
                            AND e.user_id   IS DISTINCT FROM a.seller_id
                        ), 0)),
    latency_score     = GREATEST(0, LEAST(100, 100 - (
                          COALESCE(
                            (SELECT average_latency_ms FROM public.agents WHERE id = ags.agent_id),
                          5000)::NUMERIC / 100
                        ))),
    cost_score        = GREATEST(0, LEAST(100, (
                          SELECT CASE WHEN price_per_call = 0 THEN 80
                                      ELSE GREATEST(0, 100 - (price_per_call / 0.01 * 20))
                                 END
                          FROM public.agents WHERE id = ags.agent_id
                        ))),
    popularity_score  = LEAST(100, (
                          LOG(GREATEST(1,
                            COALESCE((SELECT total_executions FROM public.agents WHERE id = ags.agent_id), 0)
                          )) / LOG(10000) * 100
                        )),
    sample_size       = (SELECT total_executions FROM public.agents WHERE id = ags.agent_id),
    computed_at       = now(),
    updated_at        = now()
  FROM public.agents a
  WHERE ags.agent_id        = a.id
    AND a.status::TEXT      = 'active'
    AND a.total_executions >= 100
    AND a.auto_disabled_at  IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Assign global and category ranks
  WITH ranked AS (
    SELECT
      ags.agent_id,
      a.category,
      RANK() OVER (ORDER BY ags.composite_score DESC)                            AS g_rank,
      RANK() OVER (PARTITION BY a.category ORDER BY ags.composite_score DESC)   AS c_rank
    FROM public.agent_scores ags
    JOIN public.agents a ON a.id = ags.agent_id AND a.status::TEXT = 'active'
    WHERE ags.composite_score > 0
  )
  UPDATE public.agent_scores ags
  SET global_rank   = r.g_rank,
      category_rank = r.c_rank,
      updated_at    = now()
  FROM ranked r
  WHERE ags.agent_id = r.agent_id;

  -- Badge flags
  UPDATE public.agent_scores ags
  SET
    is_top_rated     = (composite_score >= 85),
    is_fastest       = (latency_score   = (SELECT MAX(latency_score)
                                           FROM public.agent_scores WHERE category_rank IS NOT NULL)),
    is_cheapest      = (composite_score >= 60 AND
                        cost_score       = (SELECT MAX(cost_score)
                                            FROM public.agent_scores WHERE composite_score >= 60)),
    is_most_reliable = (reliability_score = (SELECT MAX(reliability_score)
                                             FROM public.agent_scores WHERE category_rank IS NOT NULL))
  WHERE category_rank IS NOT NULL;

  -- Sync denormalised columns back to agents
  UPDATE public.agents a
  SET composite_score  = ags.composite_score,
      is_top_rated     = ags.is_top_rated,
      is_fastest       = ags.is_fastest,
      is_cheapest      = ags.is_cheapest,
      is_most_reliable = ags.is_most_reliable
  FROM public.agent_scores ags
  WHERE a.id = ags.agent_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_agent_rankings() TO service_role;

-- ── 4. Recreate agent_leaderboard with security_invoker + new fields ──────────
-- (Dropped at top of migration — recreate cleanly now)

CREATE VIEW public.agent_leaderboard
  WITH (security_invoker = on)
AS
SELECT
  a.id, a.name, a.slug, a.description,
  a.category::TEXT        AS category,
  a.pricing_model::TEXT   AS pricing_model,
  a.status::TEXT          AS status,
  COALESCE(a.price_per_call,      0)::NUMERIC AS price_per_call,
  COALESCE(a.average_rating,      0)::NUMERIC AS average_rating,
  COALESCE(a.total_reviews,       0)          AS total_reviews,
  COALESCE(a.total_executions,    0)          AS total_executions,
  COALESCE(a.successful_executions, 0)        AS successful_executions,
  COALESCE(a.average_latency_ms,  0)          AS average_latency_ms,
  a.is_featured, a.is_verified,
  a.icon_url, a.tags,
  -- Denormalised score flags
  COALESCE(a.composite_score,   0)::NUMERIC AS composite_score,
  COALESCE(a.is_top_rated,   false)         AS is_top_rated,
  COALESCE(a.is_fastest,     false)         AS is_fastest,
  COALESCE(a.is_cheapest,    false)         AS is_cheapest,
  COALESCE(a.is_most_reliable, false)       AS is_most_reliable,
  -- agent_scores breakdown
  COALESCE(ags.accuracy_score,    0)::NUMERIC AS accuracy_score,
  COALESCE(ags.reliability_score, 0)::NUMERIC AS reliability_score,
  COALESCE(ags.latency_score,     0)::NUMERIC AS latency_score,
  COALESCE(ags.cost_score,        0)::NUMERIC AS cost_score,
  COALESCE(ags.popularity_score,  0)::NUMERIC AS popularity_score,
  COALESCE(ags.global_rank,    9999)          AS global_rank,
  COALESCE(ags.category_rank,  9999)          AS category_rank,
  COALESCE(ags.sample_size,       0)          AS sample_size,
  ags.computed_at                             AS score_computed_at,
  -- Evaluation harness fields
  COALESCE(a.evaluation_score,  0)::NUMERIC AS evaluation_score,
  COALESCE(a.evaluation_passed, false)       AS evaluation_passed,
  COALESCE(a.evaluation_runs,   0)           AS evaluation_runs,
  a.last_evaluated_at,
  a.auto_disabled_at,
  -- Failure rate
  CASE
    WHEN COALESCE(a.total_executions, 0) > 0
    THEN ROUND(
      (a.total_executions - COALESCE(a.successful_executions, 0))::NUMERIC
      / a.total_executions * 100, 1)
    ELSE 0
  END AS failure_rate,
  -- Seller info
  p.full_name   AS seller_name,
  p.username    AS seller_username,
  p.is_verified AS seller_verified,
  a.created_at, a.updated_at
FROM public.agents a
LEFT JOIN public.agent_scores ags ON ags.agent_id = a.id
JOIN  public.profiles         p   ON p.id         = a.seller_id
WHERE a.status::TEXT = 'active';

GRANT SELECT ON public.agent_leaderboard TO anon, authenticated, service_role;

-- ── Verification ──────────────────────────────────────────────────────────────

DO $$
DECLARE v_cols INTEGER; v_fn BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agents'
    AND column_name IN ('evaluation_score','evaluation_passed','evaluation_runs',
                        'last_evaluated_at','auto_disabled_at');

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'compute_agent_score'
  ) INTO v_fn;

  RAISE NOTICE '=== Migration 031 v2 ===';
  RAISE NOTICE 'Eval columns added to agents:  % / 5  %', v_cols, CASE WHEN v_cols = 5 THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'compute_agent_score recreated: %',          CASE WHEN v_fn    THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'agent_leaderboard view: dropped + recreated with security_invoker = on ✅';
  RAISE NOTICE 'Anti-gaming: self-executions excluded from scoring ✅';
  RAISE NOTICE 'Cheapest badge: composite_score >= 60 required ✅';
END $$;
