-- =============================================================================
-- AgentDyne — Complete Production SQL Setup
-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- All statements use IF NOT EXISTS / OR REPLACE — safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- text search on agent names


-- ---------------------------------------------------------------------------
-- 1. ENUMS (safe: skipped if already exist)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user','seller','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_status AS ENUM ('draft','pending_review','active','suspended','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pricing_model AS ENUM ('free','per_call','subscription','freemium');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE execution_status AS ENUM ('queued','running','success','failed','timeout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_plan AS ENUM ('free','starter','pro','enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active','canceled','past_due','trialing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM ('pending','processing','paid','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE review_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- 2. MISSING COLUMNS ON EXISTING TABLES
-- ---------------------------------------------------------------------------

-- agents: columns added by API but not in original schema
ALTER TABLE agents ADD COLUMN IF NOT EXISTS composite_score    NUMERIC  DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS capability_tags    TEXT[]   DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS input_types        TEXT[]   DEFAULT '{text}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS output_types       TEXT[]   DEFAULT '{text}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS languages          TEXT[]   DEFAULT '{en}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_top_rated       BOOLEAN  DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_fastest         BOOLEAN  DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_cheapest        BOOLEAN  DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_most_reliable   BOOLEAN  DEFAULT FALSE;

-- executions: schema had cost_usd, execute API writes cost; support both
ALTER TABLE executions ADD COLUMN IF NOT EXISTS cost      NUMERIC DEFAULT 0;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS cost_usd  NUMERIC DEFAULT 0;

-- profiles: notification prefs (already added in previous session, idempotent)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}';


-- ---------------------------------------------------------------------------
-- 3. agent_scores TABLE
-- Stores computed quality scores per agent (populated by compute_agent_score RPC).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_scores (
  id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id          uuid        NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  composite_score   NUMERIC     DEFAULT 0 CHECK (composite_score >= 0 AND composite_score <= 100),
  accuracy_score    NUMERIC     DEFAULT 0,
  reliability_score NUMERIC     DEFAULT 0,
  latency_score     NUMERIC     DEFAULT 0,
  cost_score        NUMERIC     DEFAULT 0,
  popularity_score  NUMERIC     DEFAULT 0,
  sample_size       INTEGER     DEFAULT 0,
  is_top_rated      BOOLEAN     DEFAULT FALSE,
  is_fastest        BOOLEAN     DEFAULT FALSE,
  is_cheapest       BOOLEAN     DEFAULT FALSE,
  is_most_reliable  BOOLEAN     DEFAULT FALSE,
  global_rank       INTEGER,
  category_rank     INTEGER,
  computed_at       TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_scores_composite ON agent_scores(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_agent_scores_agent_id  ON agent_scores(agent_id);


-- ---------------------------------------------------------------------------
-- 4. pipeline_executions TABLE
-- The pipeline execute API writes here (not pipeline_runs which is dead code).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_executions (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id uuid        NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  status      TEXT        NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running','success','failed','timeout')),
  input       JSONB,
  output      JSONB,
  error       TEXT,
  latency_ms  INTEGER,
  node_results JSONB      DEFAULT '[]',   -- per-node execution trace
  created_at  TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pipeline_executions_pipeline ON pipeline_executions(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_user     ON pipeline_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_created  ON pipeline_executions(created_at DESC);


-- ---------------------------------------------------------------------------
-- 5. agent_leaderboard VIEW
-- Used by GET /api/leaderboard — joins agents + agent_scores.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW agent_leaderboard AS
SELECT
  a.id,
  a.name,
  a.description,
  a.category,
  a.pricing_model,
  a.price_per_call,
  a.average_rating,
  a.total_reviews,
  a.total_executions,
  a.average_latency_ms,
  a.is_featured,
  a.is_verified,
  COALESCE(s.composite_score,   0) AS composite_score,
  COALESCE(s.accuracy_score,    0) AS accuracy_score,
  COALESCE(s.reliability_score, 0) AS reliability_score,
  COALESCE(s.latency_score,     0) AS latency_score,
  COALESCE(s.cost_score,        0) AS cost_score,
  COALESCE(s.popularity_score,  0) AS popularity_score,
  COALESCE(s.is_top_rated,      FALSE) AS is_top_rated,
  COALESCE(s.is_fastest,        FALSE) AS is_fastest,
  COALESCE(s.is_cheapest,       FALSE) AS is_cheapest,
  COALESCE(s.is_most_reliable,  FALSE) AS is_most_reliable,
  COALESCE(s.global_rank,       9999)  AS global_rank,
  COALESCE(s.category_rank,     9999)  AS category_rank,
  COALESCE(s.sample_size,       0)     AS sample_size
FROM agents a
LEFT JOIN agent_scores s ON s.agent_id = a.id
WHERE a.status = 'active'
  AND a.total_executions >= 10;   -- minimum 10 runs to qualify for leaderboard


-- ---------------------------------------------------------------------------
-- 6. RPCs (stored functions)
-- ---------------------------------------------------------------------------

-- 6a. increment_executions_used — called after every successful execution
CREATE OR REPLACE FUNCTION increment_executions_used(user_id_param uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET
    executions_used_this_month = executions_used_this_month + 1,
    updated_at = now()
  WHERE id = user_id_param;
END;
$$;

-- 6b. compute_agent_score — called by POST /api/agents/[id]/score
-- Weights: accuracy 30%, reliability 25%, speed 20%, cost 15%, adoption 10%
CREATE OR REPLACE FUNCTION compute_agent_score(target_agent_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total        bigint;
  v_success      bigint;
  v_avg_latency  numeric;
  v_avg_cost     numeric;
  v_avg_rating   numeric;

  v_accuracy     numeric;
  v_reliability  numeric;
  v_latency_sc   numeric;
  v_cost_sc      numeric;
  v_popularity   numeric;
  v_composite    numeric;

  v_global_rank     integer;
  v_category_rank   integer;
  v_agent_category  text;
BEGIN
  -- Gather raw metrics
  SELECT
    total_executions,
    successful_executions,
    average_latency_ms,
    average_rating,
    category
  INTO v_total, v_success, v_avg_latency, v_avg_rating, v_agent_category
  FROM agents WHERE id = target_agent_id;

  -- Need at least 10 executions
  IF v_total < 10 THEN RETURN 0; END IF;

  -- Average cost from recent executions
  SELECT COALESCE(AVG(cost), 0)
  INTO v_avg_cost
  FROM executions
  WHERE agent_id = target_agent_id
    AND status = 'success'
    AND created_at > now() - interval '30 days';

  -- Component scores (0-100)
  v_accuracy    := LEAST(100, (v_success::numeric / NULLIF(v_total, 0)) * 100);
  v_reliability := v_accuracy;  -- same base; could diverge with uptime data later
  v_latency_sc  := GREATEST(0, LEAST(100, 100 - (v_avg_latency / 50)));  -- 0ms=100, 5000ms=0
  v_cost_sc     := GREATEST(0, LEAST(100, 100 - (v_avg_cost * 10000)));   -- $0=100, $0.01=0
  v_popularity  := LEAST(100, (v_total / 1000.0) * 100);                  -- 1000 runs = 100

  v_composite :=
      (v_accuracy    * 0.30)
    + (v_reliability * 0.25)
    + (v_latency_sc  * 0.20)
    + (v_cost_sc     * 0.15)
    + (v_popularity  * 0.10);

  -- Compute global rank (position among all scored agents)
  SELECT COUNT(*) + 1 INTO v_global_rank
  FROM agent_scores
  WHERE composite_score > v_composite;

  -- Compute category rank
  SELECT COUNT(*) + 1 INTO v_category_rank
  FROM agent_scores s
  JOIN agents a ON a.id = s.agent_id
  WHERE a.category = v_agent_category
    AND s.composite_score > v_composite;

  -- Upsert into agent_scores
  INSERT INTO agent_scores (
    agent_id, composite_score,
    accuracy_score, reliability_score, latency_score, cost_score, popularity_score,
    sample_size, global_rank, category_rank,
    is_top_rated, is_fastest, is_cheapest, is_most_reliable,
    computed_at, updated_at
  ) VALUES (
    target_agent_id, ROUND(v_composite, 2),
    ROUND(v_accuracy, 2), ROUND(v_reliability, 2),
    ROUND(v_latency_sc, 2), ROUND(v_cost_sc, 2), ROUND(v_popularity, 2),
    v_total, v_global_rank, v_category_rank,
    (v_avg_rating >= 4.5 AND v_total >= 100),          -- top_rated
    (v_avg_latency < 500 AND v_total >= 50),            -- fastest
    (v_avg_cost < 0.001  AND v_total >= 50),            -- cheapest
    (v_accuracy >= 95    AND v_total >= 50),            -- most_reliable
    now(), now()
  )
  ON CONFLICT (agent_id) DO UPDATE SET
    composite_score   = EXCLUDED.composite_score,
    accuracy_score    = EXCLUDED.accuracy_score,
    reliability_score = EXCLUDED.reliability_score,
    latency_score     = EXCLUDED.latency_score,
    cost_score        = EXCLUDED.cost_score,
    popularity_score  = EXCLUDED.popularity_score,
    sample_size       = EXCLUDED.sample_size,
    global_rank       = EXCLUDED.global_rank,
    category_rank     = EXCLUDED.category_rank,
    is_top_rated      = EXCLUDED.is_top_rated,
    is_fastest        = EXCLUDED.is_fastest,
    is_cheapest       = EXCLUDED.is_cheapest,
    is_most_reliable  = EXCLUDED.is_most_reliable,
    computed_at       = EXCLUDED.computed_at,
    updated_at        = EXCLUDED.updated_at;

  -- Sync badge flags back to agents table
  UPDATE agents SET
    composite_score   = ROUND(v_composite, 2),
    is_top_rated      = (v_avg_rating >= 4.5 AND v_total >= 100),
    is_fastest        = (v_avg_latency < 500  AND v_total >= 50),
    is_cheapest       = (v_avg_cost < 0.001   AND v_total >= 50),
    is_most_reliable  = (v_accuracy >= 95     AND v_total >= 50),
    updated_at        = now()
  WHERE id = target_agent_id;

  RETURN ROUND(v_composite, 2);
END;
$$;

-- 6c. update_pipeline_stats — called after each pipeline execution
CREATE OR REPLACE FUNCTION update_pipeline_stats()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE pipelines
  SET
    run_count   = COALESCE(run_count, 0) + 1,
    last_run_at = now(),
    status      = NEW.status,
    updated_at  = now()
  WHERE id = NEW.pipeline_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_pipeline_stats ON pipeline_executions;
CREATE TRIGGER trg_update_pipeline_stats
  AFTER INSERT ON pipeline_executions
  FOR EACH ROW EXECUTE FUNCTION update_pipeline_stats();

-- 6d. reset_monthly_quotas — run via Supabase cron (pg_cron) monthly
--   SELECT cron.schedule('reset-quotas', '0 0 1 * *', $$SELECT reset_monthly_quotas()$$);
CREATE OR REPLACE FUNCTION reset_monthly_quotas()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET
    executions_used_this_month = 0,
    quota_reset_date           = now() + interval '30 days',
    updated_at                 = now();
END;
$$;


-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

-- agent_scores: public read, no direct user write (written only by RPC)
ALTER TABLE agent_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_scores_select" ON agent_scores;
CREATE POLICY "agent_scores_select"
  ON agent_scores FOR SELECT USING (true);

-- pipeline_executions: users see only their own executions
ALTER TABLE pipeline_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_exec_select" ON pipeline_executions;
CREATE POLICY "pipeline_exec_select"
  ON pipeline_executions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "pipeline_exec_insert" ON pipeline_executions;
CREATE POLICY "pipeline_exec_insert"
  ON pipeline_executions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- No DELETE on pipeline_executions — audit log must be immutable
DROP POLICY IF EXISTS "pipeline_exec_no_delete" ON pipeline_executions;

-- Agents: sellers manage their own, public read active ones
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_public_read"  ON agents;
DROP POLICY IF EXISTS "agents_seller_write" ON agents;
DROP POLICY IF EXISTS "agents_admin_all"    ON agents;

CREATE POLICY "agents_public_read"
  ON agents FOR SELECT USING (status = 'active');

CREATE POLICY "agents_seller_own"
  ON agents FOR ALL
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Executions: users see only their own
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "executions_user_select" ON executions;
DROP POLICY IF EXISTS "executions_user_insert" ON executions;

CREATE POLICY "executions_user_select"
  ON executions FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "executions_user_insert"
  ON executions FOR INSERT WITH CHECK (user_id = auth.uid());

-- Profiles: users see their own, public sees basic info
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_own"    ON profiles;
DROP POLICY IF EXISTS "profiles_public" ON profiles;

CREATE POLICY "profiles_own"
  ON profiles FOR ALL USING (id = auth.uid());

CREATE POLICY "profiles_public_read"
  ON profiles FOR SELECT USING (true);

-- API keys: only owner
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_own" ON api_keys;
CREATE POLICY "api_keys_own"
  ON api_keys FOR ALL USING (user_id = auth.uid());

-- Pipelines: owner or public
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipelines_own"    ON pipelines;
DROP POLICY IF EXISTS "pipelines_public" ON pipelines;

CREATE POLICY "pipelines_own"
  ON pipelines FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "pipelines_public_read"
  ON pipelines FOR SELECT USING (is_public = true);

-- Reviews: public read, owner write
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_public_read" ON reviews;
DROP POLICY IF EXISTS "reviews_user_write"  ON reviews;

CREATE POLICY "reviews_public_read"
  ON reviews FOR SELECT USING (status = 'approved');

CREATE POLICY "reviews_user_write"
  ON reviews FOR INSERT WITH CHECK (user_id = auth.uid());

-- Agent analytics: seller sees own
ALTER TABLE agent_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_seller" ON agent_analytics;
CREATE POLICY "analytics_seller"
  ON agent_analytics FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM agents WHERE seller_id = auth.uid()
    )
  );

-- Notifications: own only
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_own" ON notifications;
CREATE POLICY "notifications_own"
  ON notifications FOR ALL USING (user_id = auth.uid());

-- Transactions: buyer or seller
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions_participant" ON transactions;
CREATE POLICY "transactions_participant"
  ON transactions FOR SELECT
  USING (user_id = auth.uid() OR seller_id = auth.uid());

-- Agent subscriptions: own only
ALTER TABLE agent_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_subs_own" ON agent_subscriptions;
CREATE POLICY "agent_subs_own"
  ON agent_subscriptions FOR ALL USING (user_id = auth.uid());

-- Payouts: seller only
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payouts_seller" ON payouts;
CREATE POLICY "payouts_seller"
  ON payouts FOR SELECT USING (seller_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. STORAGE — avatars bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', true,
  2097152,  -- 2 MB limit
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies for avatars
DROP POLICY IF EXISTS "avatars_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;

CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "avatars_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "avatars_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- ---------------------------------------------------------------------------
-- 9. INDEXES FOR PERFORMANCE
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agents_status          ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_category        ON agents(category);
CREATE INDEX IF NOT EXISTS idx_agents_seller_id       ON agents(seller_id);
CREATE INDEX IF NOT EXISTS idx_agents_composite_score ON agents(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_agents_executions      ON agents(total_executions DESC);
CREATE INDEX IF NOT EXISTS idx_agents_rating          ON agents(average_rating DESC);
CREATE INDEX IF NOT EXISTS idx_agents_name_trgm       ON agents USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_executions_user_id     ON executions(user_id);
CREATE INDEX IF NOT EXISTS idx_executions_agent_id    ON executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_executions_created_at  ON executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_status      ON executions(status);

CREATE INDEX IF NOT EXISTS idx_pipelines_owner        ON pipelines(owner_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_public       ON pipelines(is_public) WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_reviews_agent          ON reviews(agent_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status         ON reviews(status);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash          ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user          ON api_keys(user_id);

CREATE INDEX IF NOT EXISTS idx_analytics_agent_date   ON agent_analytics(agent_id, date);


-- ---------------------------------------------------------------------------
-- 10. profiles trigger — auto-create profile row on signup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, role,
    subscription_plan, monthly_execution_quota,
    executions_used_this_month, quota_reset_date
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'user',
    'free',
    100,
    0,
    now() + interval '30 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ---------------------------------------------------------------------------
-- 11. GRANT execute on RPCs to authenticated users
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION increment_executions_used(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION compute_agent_score(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION reset_monthly_quotas()           TO service_role;


-- ---------------------------------------------------------------------------
-- DONE — verify with:
--   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
--   SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public';
--   SELECT * FROM storage.buckets;
-- ---------------------------------------------------------------------------
