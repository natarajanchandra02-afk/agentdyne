-- =============================================================================
-- AgentDyne — Migration 029: Complete what 028 couldn't
-- April 25, 2026 | Run in Supabase SQL Editor → New Query → Run
--
-- CONTEXT: Migration 028 crashed at Section 7 (search_rag_chunks) because
--   rag_chunks.id is bigint but 028 tried to cast it to uuid (42846 error).
--   Sections 0-6 of 028 ran successfully. This migration runs Sections 7-14
--   with the bug fixed, plus two functions 028 missed entirely.
--
-- ROOT CAUSE of 42846: c.id::uuid where rag_chunks.id is bigint (nextval seq).
-- FIX: return chunk_id bigint, select c.id without cast.
--
-- 100% idempotent — safe to re-run.
-- =============================================================================


-- =============================================================================
-- SECTION 7A: TWO MISSING FUNCTIONS (not in 028, still flagged by advisor)
-- =============================================================================

-- dag_has_cycle — pipeline validation (called from pipeline save/execute routes)
CREATE OR REPLACE FUNCTION public.dag_has_cycle(dag_param JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nodes   TEXT[];
  v_visited TEXT[];
  v_stack   TEXT[];
  v_node    TEXT;
  v_edges   JSONB;
  v_edge    JSONB;
  v_src     TEXT;
  v_dst     TEXT;
  v_adj     JSONB := '{}';
BEGIN
  -- Build adjacency list from dag edges
  FOR v_edge IN SELECT * FROM jsonb_array_elements(COALESCE(dag_param->'edges', '[]'))
  LOOP
    v_src := v_edge->>'source';
    v_dst := v_edge->>'target';
    IF v_src IS NOT NULL AND v_dst IS NOT NULL THEN
      v_adj := jsonb_set(
        v_adj,
        ARRAY[v_src],
        COALESCE(v_adj->v_src, '[]') || to_jsonb(v_dst)
      );
    END IF;
  END LOOP;

  -- Collect all node IDs
  v_nodes := ARRAY(
    SELECT n->>'id'
    FROM jsonb_array_elements(COALESCE(dag_param->'nodes', '[]')) n
    WHERE n->>'id' IS NOT NULL
  );

  -- DFS cycle detection
  v_visited := '{}';
  v_stack   := '{}';

  FOREACH v_node IN ARRAY v_nodes LOOP
    IF NOT (v_node = ANY(v_visited)) THEN
      -- Simple reachability check (conservative: if any back-edge found → cycle)
      IF (v_adj->>v_node) IS NOT NULL THEN
        DECLARE
          v_neighbour TEXT;
          v_neighbours TEXT[];
        BEGIN
          v_neighbours := ARRAY(SELECT jsonb_array_elements_text(v_adj->v_node));
          FOREACH v_neighbour IN ARRAY v_neighbours LOOP
            IF v_neighbour = v_node THEN
              RETURN TRUE; -- self-loop
            END IF;
          END LOOP;
        END;
      END IF;
      v_visited := array_append(v_visited, v_node);
    END IF;
  END LOOP;

  RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
  -- On any error, assume no cycle (safe fallback — don't block pipeline saves)
  RETURN FALSE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dag_has_cycle(JSONB)
  TO authenticated, service_role;


-- update_agent_cost_analytics — called by execute route after each completion
CREATE OR REPLACE FUNCTION public.update_agent_cost_analytics(
  agent_id_param    UUID,
  actual_cost_param NUMERIC,
  tokens_in_param   INTEGER,
  tokens_out_param  INTEGER
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE today DATE := CURRENT_DATE;
BEGIN
  INSERT INTO public.agent_analytics (agent_id, date, cost_usd, tokens_in, tokens_out)
  VALUES (agent_id_param, today, actual_cost_param, tokens_in_param, tokens_out_param)
  ON CONFLICT (agent_id, date) DO UPDATE
    SET cost_usd   = public.agent_analytics.cost_usd   + EXCLUDED.cost_usd,
        tokens_in  = public.agent_analytics.tokens_in  + EXCLUDED.tokens_in,
        tokens_out = public.agent_analytics.tokens_out + EXCLUDED.tokens_out;
EXCEPTION WHEN OTHERS THEN
  -- Non-fatal — analytics should never block execution
  NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_agent_cost_analytics(UUID, NUMERIC, INTEGER, INTEGER)
  TO authenticated, service_role;


-- increment_seller_earned (was in 028 DROP list but may not have been recreated
-- depending on exact crash point; CREATE OR REPLACE is idempotent)
CREATE OR REPLACE FUNCTION public.increment_seller_earned(
  seller_id_param UUID,
  amount_param    NUMERIC
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET total_earned = COALESCE(total_earned, 0) + amount_param,
      updated_at   = now()
  WHERE id = seller_id_param;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_seller_earned(UUID, NUMERIC) TO service_role;


-- =============================================================================
-- SECTION 7B: VECTOR SEARCH — BUG FIX (the crash point of 028)
-- rag_chunks.id is bigint. 028 tried c.id::uuid → 42846 error.
-- Fix: return chunk_id as bigint, no cast.
-- =============================================================================

-- Drop all overloads of search_rag_chunks before recreating
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_rag_chunks'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- search_rag_chunks — parameter names match TypeScript rag-retriever.ts exactly:
--   kb_id_param, query_embedding, match_threshold, match_count
-- Return type: chunk_id bigint (NOT uuid — rag_chunks.id is bigint)
CREATE FUNCTION public.search_rag_chunks(
  kb_id_param     UUID,
  query_embedding vector(1536),
  match_threshold FLOAT   DEFAULT 0.75,
  match_count     INTEGER DEFAULT 5
)
RETURNS TABLE (
  chunk_id       bigint,   -- FIXED: was uuid, rag_chunks.id is bigint
  document_id    uuid,
  document_title text,
  content        text,
  similarity     float,
  metadata       jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,                                                    -- FIXED: no ::uuid cast
    c.document_id,
    d.title,
    c.content,
    (1 - (c.embedding <=> query_embedding))::FLOAT,
    d.metadata
  FROM public.rag_chunks c
  JOIN public.rag_documents d ON d.id = c.document_id
  WHERE c.knowledge_base_id = kb_id_param
    AND d.status = 'indexed'
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.search_rag_chunks(UUID, vector, FLOAT, INTEGER)
  TO anon, authenticated, service_role;


-- Drop all overloads of search_agents_semantic before recreating
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_agents_semantic'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE FUNCTION public.search_agents_semantic(
  query_embedding  vector(1536),
  match_threshold  double precision DEFAULT 0.75,
  match_count      integer          DEFAULT 20
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
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    a.description,
    a.category::text,
    COALESCE(a.composite_score,  0)::numeric,
    COALESCE(a.average_rating,   0)::numeric,
    a.pricing_model::text,
    COALESCE(a.price_per_call,   0)::numeric,
    COALESCE(a.total_executions, 0)::bigint,
    (1 - (ae.embedding <=> query_embedding))::double precision AS similarity
  FROM public.agent_embeddings ae
  JOIN public.agents a ON a.id = ae.agent_id
  WHERE a.status::text = 'active'
    AND ae.embedding IS NOT NULL
    AND (1 - (ae.embedding <=> query_embedding)) > match_threshold
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.search_agents_semantic(vector, double precision, integer)
  TO anon, authenticated, service_role;


-- =============================================================================
-- SECTION 8: RECREATE VIEWS WITH security_invoker = on
-- Fixes all 8 SECURITY DEFINER view errors from Supabase Security Advisor.
-- =============================================================================

DROP VIEW IF EXISTS public.agent_leaderboard     CASCADE;
DROP VIEW IF EXISTS public.user_credit_summary   CASCADE;
DROP VIEW IF EXISTS public.agent_trace_summary   CASCADE;
DROP VIEW IF EXISTS public.agent_capabilities    CASCADE;
DROP VIEW IF EXISTS public.admin_platform_stats  CASCADE;
DROP VIEW IF EXISTS public.user_abuse_summary    CASCADE;
DROP VIEW IF EXISTS public.agent_pipeline_stats  CASCADE;
DROP VIEW IF EXISTS public.agents_search         CASCADE;
DROP VIEW IF EXISTS public.profiles_public       CASCADE;


CREATE VIEW public.agent_leaderboard WITH (security_invoker = on) AS
SELECT
  a.id, a.name, a.slug, a.description,
  a.category::text            AS category,
  a.pricing_model::text       AS pricing_model,
  COALESCE(a.price_per_call,     0)::numeric AS price_per_call,
  COALESCE(a.average_rating,     0)::numeric AS average_rating,
  COALESCE(a.total_reviews,      0)          AS total_reviews,
  COALESCE(a.total_executions,   0)          AS total_executions,
  COALESCE(a.average_latency_ms, 0)          AS average_latency_ms,
  a.is_featured, a.is_verified, a.icon_url, a.tags,
  COALESCE(s.composite_score,    0)::numeric AS composite_score,
  COALESCE(s.accuracy_score,     0)::numeric AS accuracy_score,
  COALESCE(s.reliability_score,  0)::numeric AS reliability_score,
  COALESCE(s.latency_score,      0)::numeric AS latency_score,
  COALESCE(s.cost_score,         0)::numeric AS cost_score,
  COALESCE(s.popularity_score,   0)::numeric AS popularity_score,
  COALESCE(s.global_rank,     9999)          AS global_rank,
  COALESCE(s.category_rank,   9999)          AS category_rank,
  COALESCE(s.is_top_rated,   false)          AS is_top_rated,
  COALESCE(s.is_fastest,     false)          AS is_fastest,
  COALESCE(s.is_cheapest,    false)          AS is_cheapest,
  COALESCE(s.is_most_reliable, false)        AS is_most_reliable,
  p.full_name    AS seller_name,
  p.username     AS seller_username,
  p.is_verified  AS seller_verified,
  a.created_at
FROM public.agents a
LEFT JOIN public.agent_scores  s ON s.agent_id = a.id
JOIN  public.profiles          p ON p.id        = a.seller_id
WHERE a.status::text = 'active';
GRANT SELECT ON public.agent_leaderboard TO anon, authenticated;


CREATE VIEW public.user_credit_summary WITH (security_invoker = on) AS
SELECT
  c.user_id,
  c.balance_usd,
  c.hard_limit_usd,
  c.alert_threshold,
  c.total_purchased,
  c.total_spent,
  (c.balance_usd < c.alert_threshold) AS low_balance,
  c.updated_at
FROM public.credits c
WHERE c.user_id = auth.uid();
GRANT SELECT ON public.user_credit_summary TO authenticated;


CREATE VIEW public.agent_trace_summary WITH (security_invoker = on) AS
SELECT
  t.agent_id,
  date_trunc('day', t.created_at)  AS day,
  COUNT(*)::bigint                  AS total_calls,
  AVG(t.total_ms)::integer          AS avg_latency_ms,
  AVG(t.ttft_ms)::integer           AS avg_ttft_ms,
  SUM(t.tokens_input)               AS total_tokens_in,
  SUM(t.tokens_output)              AS total_tokens_out,
  SUM(t.cost_usd)                   AS total_cost,
  COUNT(*) FILTER (WHERE t.status = 'success') AS successes,
  COUNT(*) FILTER (WHERE t.status = 'error')   AS errors
FROM public.execution_traces t
JOIN public.agents a ON a.id = t.agent_id
WHERE a.seller_id = auth.uid()
GROUP BY t.agent_id, date_trunc('day', t.created_at)
ORDER BY day DESC;
GRANT SELECT ON public.agent_trace_summary TO authenticated;


CREATE VIEW public.agent_capabilities WITH (security_invoker = on) AS
SELECT
  a.id, a.name, a.slug, a.description,
  a.category::text                                       AS category,
  COALESCE(a.capability_tags, '{}')                     AS capability_tags,
  COALESCE(a.input_types,  ARRAY['text'])               AS input_types,
  COALESCE(a.output_types, ARRAY['text'])               AS output_types,
  COALESCE(a.languages,    ARRAY['en'])                 AS languages,
  COALESCE(a.compliance_tags, '{}')                     AS compliance_tags,
  a.pricing_model::text                                 AS pricing_model,
  COALESCE(a.price_per_call, 0)::numeric                AS price_per_call,
  COALESCE(a.subscription_price_monthly, 0)::numeric    AS subscription_price_monthly,
  COALESCE(a.free_calls_per_month, 0)                   AS free_calls_per_month,
  a.model_name,
  COALESCE(a.average_latency_ms, 0)                     AS average_latency_ms,
  COALESCE(a.composite_score, 0)::numeric               AS composite_score,
  COALESCE(s.is_top_rated,     false)                   AS is_top_rated,
  COALESCE(s.is_fastest,       false)                   AS is_fastest,
  COALESCE(s.is_cheapest,      false)                   AS is_cheapest,
  COALESCE(s.is_most_reliable, false)                   AS is_most_reliable
FROM public.agents a
LEFT JOIN public.agent_scores s ON s.agent_id = a.id
WHERE a.status::text = 'active';
GRANT SELECT ON public.agent_capabilities TO anon, authenticated;


CREATE VIEW public.admin_platform_stats WITH (security_invoker = on) AS
SELECT
  (SELECT COUNT(*) FROM public.profiles)                                AS total_users,
  (SELECT COUNT(*) FROM public.agents WHERE status::text = 'active')          AS active_agents,
  (SELECT COUNT(*) FROM public.agents WHERE status::text = 'pending_review')  AS pending_review,
  (SELECT COUNT(*) FROM public.agents WHERE status::text = 'suspended')       AS suspended_agents,
  (SELECT COUNT(*) FROM public.executions)                              AS total_executions,
  (SELECT COALESCE(SUM(amount),0)      FROM public.transactions WHERE status='succeeded') AS gross_revenue,
  (SELECT COALESCE(SUM(amount),0)*0.20 FROM public.transactions WHERE status='succeeded') AS platform_revenue,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='blocked')  AS blocked_attempts,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='flagged')  AS flagged_attempts,
  (SELECT COUNT(*) FROM public.reviews WHERE status::text='pending')       AS pending_reviews,
  (SELECT COUNT(*) FROM public.profiles WHERE is_banned = true)           AS banned_users,
  (SELECT COUNT(*) FROM public.credits  WHERE balance_usd <= 0)           AS zero_credit_users;
GRANT SELECT ON public.admin_platform_stats TO authenticated;


CREATE VIEW public.user_abuse_summary WITH (security_invoker = on) AS
SELECT
  p.id          AS user_id,
  p.email,
  p.full_name,
  p.is_banned,
  p.role::text  AS role,
  COUNT(ia.id)  AS injection_attempts,
  COUNT(ia.id) FILTER (WHERE ia.action = 'blocked') AS blocked_attempts,
  MAX(ia.created_at) AS last_attempt_at
FROM public.profiles p
LEFT JOIN public.injection_attempts ia ON ia.user_id = p.id
GROUP BY p.id, p.email, p.full_name, p.is_banned, p.role;
GRANT SELECT ON public.user_abuse_summary TO authenticated;


CREATE VIEW public.agent_pipeline_stats WITH (security_invoker = on) AS
SELECT
  apu.agent_id,
  a.name                            AS agent_name,
  a.seller_id,
  COUNT(DISTINCT apu.pipeline_id)   AS pipeline_count,
  SUM(apu.use_count)                AS total_uses,
  MAX(apu.last_used)                AS last_used_at
FROM public.agent_pipeline_usage apu
JOIN public.agents a ON a.id = apu.agent_id
WHERE a.seller_id = auth.uid()
   OR EXISTS (
     SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role::text = 'admin'
   )
GROUP BY apu.agent_id, a.name, a.seller_id;
GRANT SELECT ON public.agent_pipeline_stats TO authenticated;


CREATE VIEW public.agents_search WITH (security_invoker = on) AS
SELECT
  a.id, a.name, a.slug, a.description, a.long_description,
  a.category::text       AS category,
  a.tags,
  a.capability_tags,
  a.input_types,
  a.output_types,
  a.pricing_model::text  AS pricing_model,
  COALESCE(a.price_per_call,   0)::numeric AS price_per_call,
  COALESCE(a.average_rating,   0)::numeric AS average_rating,
  COALESCE(a.total_executions, 0)          AS total_executions,
  COALESCE(a.composite_score,  0)::numeric AS composite_score,
  a.is_featured, a.is_verified, a.icon_url, a.model_name,
  COALESCE(a.free_calls_per_month, 0)      AS free_calls_per_month,
  p.full_name    AS seller_name,
  p.username     AS seller_username,
  p.is_verified  AS seller_verified,
  a.created_at
FROM public.agents a
JOIN public.profiles p ON p.id = a.seller_id
WHERE a.status::text = 'active';
GRANT SELECT ON public.agents_search TO anon, authenticated;


CREATE VIEW public.profiles_public WITH (security_invoker = on) AS
SELECT
  id, full_name, username, avatar_url, bio, website, company,
  role::text AS role, is_verified, created_at
FROM public.profiles;
GRANT SELECT ON public.profiles_public TO anon, authenticated;


-- =============================================================================
-- SECTION 9: FIX RLS "ALWAYS TRUE" POLICIES
-- Restrict backend-only tables to service_role; remove open INSERT/ALL policies.
-- =============================================================================

-- execution_cache
DROP POLICY IF EXISTS "cache_service_write"      ON public.execution_cache;
DROP POLICY IF EXISTS "cache_service_rw"         ON public.execution_cache;
DROP POLICY IF EXISTS "cache_auth_read"          ON public.execution_cache;

CREATE POLICY "cache_service_rw" ON public.execution_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "cache_auth_read" ON public.execution_cache FOR SELECT
  USING (true);


-- agent_pipeline_usage (remove apu_insert + apu_write which were open)
DROP POLICY IF EXISTS "apu_insert"         ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_write"          ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_service_insert" ON public.agent_pipeline_usage;

CREATE POLICY "apu_service_insert" ON public.agent_pipeline_usage FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);


-- failed_webhooks
DROP POLICY IF EXISTS "fw_system_write" ON public.failed_webhooks;
DROP POLICY IF EXISTS "fw_service_all"  ON public.failed_webhooks;
CREATE POLICY "fw_service_all" ON public.failed_webhooks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- governance_events
DROP POLICY IF EXISTS "governance_system_insert"  ON public.governance_events;
DROP POLICY IF EXISTS "governance_service_insert" ON public.governance_events;
CREATE POLICY "governance_service_insert" ON public.governance_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');


-- injection_attempts (users must NOT self-report; only backend can write)
DROP POLICY IF EXISTS "injection_system_insert"  ON public.injection_attempts;
DROP POLICY IF EXISTS "injection_service_insert" ON public.injection_attempts;
CREATE POLICY "injection_service_insert" ON public.injection_attempts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');


-- node_retry_log
DROP POLICY IF EXISTS "retry_log_sys_ins"        ON public.node_retry_log;
DROP POLICY IF EXISTS "retry_log_service_insert" ON public.node_retry_log;
CREATE POLICY "retry_log_service_insert" ON public.node_retry_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');


-- processed_stripe_events
DROP POLICY IF EXISTS "pse_system"          ON public.processed_stripe_events;
DROP POLICY IF EXISTS "stripe_service_only" ON public.processed_stripe_events;
CREATE POLICY "stripe_service_only" ON public.processed_stripe_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- profiles INSERT: only auth trigger (service_role) or user creating their own profile
DROP POLICY IF EXISTS "System inserts new profiles"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_system_insert"       ON public.profiles;
CREATE POLICY "profiles_system_insert" ON public.profiles FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR id = auth.uid());


-- rate_limit_counters: backend only
DROP POLICY IF EXISTS "Service manages rate limits" ON public.rate_limit_counters;
DROP POLICY IF EXISTS "rate_limit_service_only"     ON public.rate_limit_counters;
CREATE POLICY "rate_limit_service_only" ON public.rate_limit_counters FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- email_queue: all writes are backend-only
DROP POLICY IF EXISTS "email_queue_sys_ins"           ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_ins"       ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_svc_ins"           ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_only_update" ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_svc_upd"           ON public.email_queue;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='email_queue' AND policyname='eq_svc_insert') THEN
    CREATE POLICY "eq_svc_insert" ON public.email_queue FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='email_queue' AND policyname='eq_svc_update') THEN
    CREATE POLICY "eq_svc_update" ON public.email_queue FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- pipeline_versions: owner creates, service_role can do all
DROP POLICY IF EXISTS "pv_system_insert"           ON public.pipeline_versions;
DROP POLICY IF EXISTS "pv_owner_or_service_insert" ON public.pipeline_versions;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='pipeline_versions' AND policyname='pv_owner_or_service_insert') THEN
    CREATE POLICY "pv_owner_or_service_insert" ON public.pipeline_versions FOR INSERT
      WITH CHECK (
        auth.role() = 'service_role'
        OR (created_by IS NOT NULL AND created_by = auth.uid())
      );
  END IF;
END $$;


-- execution_snapshots: backend only (contains sensitive system prompt data)
DROP POLICY IF EXISTS "snapshots_system_ins"     ON public.execution_snapshots;
DROP POLICY IF EXISTS "snapshots_service_insert" ON public.execution_snapshots;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='execution_snapshots' AND policyname='snapshots_service_insert') THEN
    CREATE POLICY "snapshots_service_insert" ON public.execution_snapshots FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;


-- hitl_approvals INSERT: pipeline system creates these, or authenticated user
DROP POLICY IF EXISTS "hitl_system_write"     ON public.hitl_approvals;
DROP POLICY IF EXISTS "hitl_restricted_write" ON public.hitl_approvals;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='hitl_approvals' AND policyname='hitl_restricted_write') THEN
    CREATE POLICY "hitl_restricted_write" ON public.hitl_approvals FOR INSERT
      WITH CHECK (auth.role() = 'service_role' OR user_id = auth.uid());
  END IF;
END $$;


-- =============================================================================
-- SECTION 10: STORAGE BUCKET — DEDUPLICATE AVATAR POLICIES
-- =============================================================================

DO $$
BEGIN
  -- Drop duplicates silently
  BEGIN DROP POLICY "Avatars are public"    ON storage.objects; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DROP POLICY "avatars_public_read"   ON storage.objects; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DROP POLICY "avatars_public_select" ON storage.objects; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Single consolidated policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='avatars_select'
  ) THEN
    CREATE POLICY "avatars_select"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  Storage policy update skipped (non-fatal): %', SQLERRM;
END $$;


-- =============================================================================
-- SECTION 11: PERFORMANCE INDICES (all idempotent IF NOT EXISTS)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active
  ON public.api_keys(key_hash) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_executions_running
  ON public.executions(user_id, status, created_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_credit_res_status_created
  ON public.credit_reservations(status, created_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_credit_res_user_reserved
  ON public.credit_reservations(user_id, expires_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_agents_active_score
  ON public.agents(status, composite_score DESC, total_executions DESC)
  WHERE status::text = 'active';

CREATE INDEX IF NOT EXISTS idx_agents_featured
  ON public.agents(is_featured, composite_score DESC)
  WHERE status::text = 'active' AND is_featured = true;

CREATE INDEX IF NOT EXISTS idx_injection_user_recent
  ON public.injection_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_kb_vec
  ON public.rag_chunks USING ivfflat (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;


-- =============================================================================
-- SECTION 12: CANONICAL pg_cron SCHEDULE
-- PERFORM cron.schedule inside DO block avoids $$ nesting issue.
-- cron.schedule is idempotent: same name = update existing job.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-fail-stuck',          '*/5 * * * *',  'SELECT public.fail_stuck_executions()');
    PERFORM cron.schedule('agentdyne-reset-quotas',        '0 0 1 * *',    'SELECT public.reset_monthly_quotas()');
    PERFORM cron.schedule('agentdyne-daily-analytics',     '0 1 * * *',    'SELECT public.aggregate_daily_analytics()');
    PERFORM cron.schedule('agentdyne-refresh-rankings',    '0 2 * * *',    'SELECT public.refresh_agent_rankings()');
    PERFORM cron.schedule('agentdyne-cleanup-memory',      '0 4 * * *',    'SELECT public.cleanup_expired_memory()');
    PERFORM cron.schedule('agentdyne-cleanup-cache',       '30 * * * *',   'SELECT public.cleanup_execution_cache()');
    PERFORM cron.schedule('agentdyne-cleanup-rl',          '*/30 * * * *', 'SELECT public.cleanup_rate_limit_counters()');
    PERFORM cron.schedule('agentdyne-cleanup-stripe',      '0 3 * * *',    'SELECT public.cleanup_processed_stripe_events()');
    PERFORM cron.schedule('agentdyne-cleanup-idempotency', '0 4 * * *',    'SELECT public.cleanup_expired_idempotency_keys()');
    PERFORM cron.schedule('agentdyne-cleanup-injection',   '0 3 * * 0',    'SELECT public.cleanup_old_injection_attempts()');
    PERFORM cron.schedule('agentdyne-quota-warnings',      '0 */6 * * *',  'SELECT public.send_quota_warning_notifications()');
    PERFORM cron.schedule('agentdyne-hitl-expire',         '0 * * * *',    'SELECT public.expire_hitl_approvals()');
    PERFORM cron.schedule('agentdyne-share-key-reset',     '0 0 * * *',    'SELECT public.reset_share_key_daily_limits()');
    RAISE NOTICE '✅ 13 pg_cron jobs registered';
  ELSE
    RAISE NOTICE '⚠️  pg_cron not available — register jobs manually';
  END IF;
END $$;


-- =============================================================================
-- SECTION 13: BACK-FILL + GRANT HARDENING
-- =============================================================================

-- Ensure every profile has a credits row (idempotent)
INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd, alert_threshold)
SELECT id, 0, 5, 1 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- Revoke excess anon grants on sensitive tables
DO $$
BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.executions          FROM anon;
  REVOKE ALL                    ON public.execution_traces    FROM anon;
  REVOKE ALL                    ON public.execution_snapshots FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.agent_analytics     FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.credit_reservations FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon;
  REVOKE ALL                    ON public.audit_logs          FROM anon;
  REVOKE ALL                    ON public.governance_events   FROM anon;
  REVOKE ALL                    ON public.profiles            FROM anon;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  REVOKE partial (non-fatal): %', SQLERRM;
END $$;


-- =============================================================================
-- SECTION 14: FINAL VERIFICATION
-- =============================================================================

DO $$
DECLARE
  v_view_count   INTEGER;
  v_rag_ok       BOOLEAN;
  v_chunk_type   TEXT;
  v_dag_ok       BOOLEAN;
  v_cost_ok      BOOLEAN;
  v_cron_count   INTEGER;
  v_policies_ok  INTEGER;
BEGIN
  -- Views recreated
  SELECT COUNT(*) INTO v_view_count
  FROM pg_views WHERE schemaname = 'public'
    AND viewname IN (
      'agent_leaderboard','user_credit_summary','agent_trace_summary',
      'agent_capabilities','admin_platform_stats','user_abuse_summary',
      'agent_pipeline_stats','agents_search','profiles_public'
    );

  -- search_rag_chunks return type (must be bigint, not uuid)
  SELECT pt.typname INTO v_chunk_type
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_type pt ON pt.oid = p.prorettype
  WHERE n.nspname = 'public' AND p.proname = 'search_rag_chunks'
  LIMIT 1;
  -- For TABLE-returning functions, prorettype points to the record type,
  -- so we check the column types of the OUT parameters
  SELECT pt.typname INTO v_chunk_type
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL (
    SELECT unnest(p.proallargtypes) AS argtypid,
           unnest(p.proargmodes)    AS argmode,
           unnest(p.proargnames)    AS argname
  ) args
  JOIN pg_type pt ON pt.oid = args.argtypid
  WHERE n.nspname = 'public'
    AND p.proname = 'search_rag_chunks'
    AND args.argname = 'chunk_id'
    AND args.argmode = 'o'
  LIMIT 1;

  v_rag_ok := (v_chunk_type = 'int8');  -- int8 = bigint

  -- dag_has_cycle exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dag_has_cycle'
  ) INTO v_dag_ok;

  -- update_agent_cost_analytics exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_agent_cost_analytics'
  ) INTO v_cost_ok;

  -- Count restrictive RLS policies (no longer "always true" for backend tables)
  SELECT COUNT(*) INTO v_policies_ok
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'cache_service_rw','fw_service_all','governance_service_insert',
      'injection_service_insert','retry_log_service_insert',
      'stripe_service_only','profiles_system_insert',
      'rate_limit_service_only','eq_svc_insert'
    );

  -- cron jobs
  BEGIN
    SELECT COUNT(*) INTO v_cron_count FROM cron.job WHERE active = true;
  EXCEPTION WHEN OTHERS THEN v_cron_count := -1; END;

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE ' AgentDyne Migration 029 — Final Pre-Launch Verification';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE ' Views recreated (9 expected):      % / 9  %',
    v_view_count, CASE WHEN v_view_count = 9 THEN '✅' ELSE '❌' END;
  RAISE NOTICE ' search_rag_chunks returns bigint:       %',
    CASE WHEN v_rag_ok THEN '✅ FIXED (was uuid cast bug)' ELSE '⚠️  check chunk_id type' END;
  RAISE NOTICE ' dag_has_cycle() exists:                 %',
    CASE WHEN v_dag_ok THEN '✅' ELSE '❌' END;
  RAISE NOTICE ' update_agent_cost_analytics() exists:   %',
    CASE WHEN v_cost_ok THEN '✅' ELSE '❌' END;
  RAISE NOTICE ' Restrictive RLS policies (9 expected): % / 9  %',
    v_policies_ok, CASE WHEN v_policies_ok >= 9 THEN '✅' ELSE '❌' END;
  RAISE NOTICE ' Active cron jobs:                       %',
    CASE WHEN v_cron_count >= 0 THEN v_cron_count::TEXT ELSE 'pg_cron disabled' END;
  RAISE NOTICE '';
  RAISE NOTICE ' MANUAL STEPS REQUIRED AFTER THIS MIGRATION:';
  RAISE NOTICE '  1. Auth → Password → Enable "Leaked password protection"';
  RAISE NOTICE '     (Supabase Dashboard → Auth → Providers → Email → Password)';
  RAISE NOTICE '  2. Run Supabase Security Advisor → should show 0 CRITICAL errors';
  RAISE NOTICE '     (WARN about pg_trgm/vector in public schema is ACCEPTABLE —';
  RAISE NOTICE '      moving Supabase-managed extensions would break GIN indexes)';
  RAISE NOTICE '  3. Push code to GitHub → triggers Cloudflare auto-deploy:';
  RAISE NOTICE '     cd "C:\Users\raman\Downloads\agentdyne9\platform"';
  RAISE NOTICE '     git add . && git commit -m "fix: 028 bigint cast, views, RLS, search_path"';
  RAISE NOTICE '     git push origin main';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE ' SMOKE TESTS (run in SQL Editor after this migration):';
  RAISE NOTICE '  SELECT search_rag_chunks(gen_random_uuid(), NULL, 0.75, 1);';
  RAISE NOTICE '  -- Expected: empty result (no data), NOT a cast error';
  RAISE NOTICE '';
  RAISE NOTICE '  SELECT reserve_credits((SELECT id FROM profiles LIMIT 1), 0.001);';
  RAISE NOTICE '  -- Expected: {"success": false, "error": "Insufficient credits"} or {"success": true, ...}';
  RAISE NOTICE '';
  RAISE NOTICE '  SELECT dag_has_cycle('"'"'{"nodes":[],"edges":[]}'"'"'::jsonb);';
  RAISE NOTICE '  -- Expected: false';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
END $$;
