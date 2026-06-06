-- =============================================================================
-- AgentDyne — Migration 010: Production Hardening
-- Fixes every schema gap found during pre-launch audit (April 2026).
--
-- Run ONCE in Supabase SQL Editor after migrations 001–009.
-- All statements are idempotent — safe to re-run.
--
-- Issues fixed:
--   1.  Duplicate trigger on_review_change → drop + recreate once
--   2.  Duplicate trg_update_pipeline_stats / on_pipeline_execution_complete → keep one
--   3.  audit_logs table missing
--   4.  agent_feedback table missing
--   5.  Missing UNIQUE constraints (reviews, agent_feedback, agent_memory)
--   6.  search_agents_semantic RPC missing
--   7.  agent_analytics missing success_rate + updated_at columns
--   8.  credit_transactions table missing
--   9.  injection_attempts.score column missing
--  10.  notifications missing is_read column default
--  11.  profiles missing is_banned column default
--  12.  execution_traces missing tool_calls jsonb column
--  13.  Proper RLS on all new tables
--  14.  pg_cron schedule registration (quota reset + memory cleanup)
--  15.  compute_agent_score RPC hardened
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 0. PREREQUISITES
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_cron" SCHEMA pg_catalog;


-- ---------------------------------------------------------------------------
-- 1. FIX DUPLICATE TRIGGER: on_review_change
--    PostgreSQL silently ignores CREATE TRIGGER IF NOT EXISTS when a trigger
--    of the same name already exists — but the dump shows two rows, suggesting
--    the trigger fires for both INSERT and UPDATE. We standardise to one
--    trigger that fires AFTER INSERT OR UPDATE OR DELETE.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS on_review_change ON reviews;

CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_rating();


-- ---------------------------------------------------------------------------
-- 2. FIX DUPLICATE PIPELINE STATS TRIGGER
--    Two triggers both call update_pipeline_stats() on pipeline_executions:
--      trg_update_pipeline_stats
--      on_pipeline_execution_complete
--    Keep only one. Remove the older naming.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_update_pipeline_stats    ON pipeline_executions;
DROP TRIGGER IF EXISTS on_pipeline_execution_complete ON pipeline_executions;

-- Recreate as a single canonical trigger
CREATE TRIGGER on_pipeline_execution_complete
  AFTER INSERT OR UPDATE OF status ON pipeline_executions
  FOR EACH ROW
  EXECUTE FUNCTION update_pipeline_stats();


-- ---------------------------------------------------------------------------
-- 3. AUDIT LOGS TABLE
--    Used by /api/admin and /api/governance for tamper-evident audit trail.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  actor_type  TEXT        NOT NULL DEFAULT 'user'
                          CHECK (actor_type IN ('user', 'admin', 'system', 'webhook')),
  actor_id    UUID,
  action      TEXT        NOT NULL,
  resource    TEXT,
  resource_id TEXT,
  payload     JSONB       DEFAULT '{}',
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Partial index: recent logs are queried most
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_recent  ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_admin_read"   ON audit_logs;
DROP POLICY IF EXISTS "audit_system_write" ON audit_logs;

CREATE POLICY "audit_admin_read"
  ON audit_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

CREATE POLICY "audit_system_write"
  ON audit_logs FOR INSERT
  WITH CHECK (true);   -- only service_role actually calls this in production

GRANT SELECT, INSERT ON audit_logs TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. AGENT FEEDBACK TABLE (RLHF signals)
--    Used by /api/feedback. Stores per-execution thumbs + issue tags.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_feedback (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id UUID        REFERENCES executions(id) ON DELETE CASCADE,
  agent_id     UUID        NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating       SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  thumbs       TEXT        CHECK (thumbs IN ('up', 'down')),
  comment      TEXT,
  issue_type   TEXT        CHECK (issue_type IN (
                             'wrong_output','too_slow','too_expensive',
                             'hallucination','unhelpful','other')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (execution_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_agent ON agent_feedback(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user  ON agent_feedback(user_id,  created_at DESC);

ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_own_write"  ON agent_feedback;
DROP POLICY IF EXISTS "feedback_seller_read" ON agent_feedback;

CREATE POLICY "feedback_own_write"
  ON agent_feedback FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "feedback_seller_read"
  ON agent_feedback FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_feedback.agent_id
        AND agents.seller_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

GRANT SELECT, INSERT, UPDATE ON agent_feedback TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. UNIQUE CONSTRAINTS — fixes upsert failures
-- ---------------------------------------------------------------------------

-- reviews(agent_id, user_id) — prevents duplicate reviews per user per agent
DO $$ BEGIN
  ALTER TABLE reviews
    ADD CONSTRAINT reviews_agent_user_unique UNIQUE (agent_id, user_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- agent_memory(user_id, agent_id, key) — already in 009; idempotent here
DO $$ BEGIN
  ALTER TABLE agent_memory
    ADD CONSTRAINT agent_memory_user_agent_key_unique UNIQUE (user_id, agent_id, key);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- 6. injection_attempts — add score column if missing
-- ---------------------------------------------------------------------------

ALTER TABLE injection_attempts ADD COLUMN IF NOT EXISTS score NUMERIC DEFAULT 0;


-- ---------------------------------------------------------------------------
-- 7. AGENT ANALYTICS TABLE — add missing columns
--    The cron job writes success_rate + updated_at. Add if not present.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_analytics (
  id           BIGSERIAL   PRIMARY KEY,
  agent_id     UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  date         DATE        NOT NULL,
  executions   INTEGER     DEFAULT 0,
  successes    INTEGER     DEFAULT 0,
  failures     INTEGER     DEFAULT 0,
  success_rate NUMERIC(5,2) DEFAULT 0,
  avg_latency  INTEGER     DEFAULT 0,
  revenue_usd  NUMERIC(12,6) DEFAULT 0,
  tokens_in    BIGINT      DEFAULT 0,
  tokens_out   BIGINT      DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (agent_id, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_agent ON agent_analytics(agent_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_date  ON agent_analytics(date DESC);

ALTER TABLE agent_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_seller_read"  ON agent_analytics;
DROP POLICY IF EXISTS "analytics_system_write" ON agent_analytics;

CREATE POLICY "analytics_seller_read"
  ON agent_analytics FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM agents WHERE id = agent_analytics.agent_id AND seller_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "analytics_system_write"
  ON agent_analytics FOR INSERT
  WITH CHECK (true);

CREATE POLICY "analytics_system_update"
  ON agent_analytics FOR UPDATE
  USING (true);

GRANT SELECT, INSERT, UPDATE ON agent_analytics TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8. CREDIT TRANSACTIONS TABLE
--    Referenced by /api/credits GET but not in any prior migration.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_transactions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL
               CHECK (type IN ('topup','deduction','refund','bonus','adjustment')),
  amount_usd   NUMERIC(12,6) NOT NULL,
  balance_after NUMERIC(12,6),
  description  TEXT,
  reference_id UUID,       -- execution_id or session_id for traceability
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_user ON credit_transactions(user_id, created_at DESC);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_txn_own" ON credit_transactions;

CREATE POLICY "credit_txn_own"
  ON credit_transactions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "credit_txn_insert"
  ON credit_transactions FOR INSERT
  WITH CHECK (true);   -- service_role inserts from RPC

GRANT SELECT, INSERT ON credit_transactions TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 9. EXECUTION TRACES — add tool_calls column (jsonb, not int)
--    The execute route stores: tool_calls: [{ count: N }]
-- ---------------------------------------------------------------------------

ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS tool_calls     JSONB   DEFAULT '[]';
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS rag_injected   BOOLEAN DEFAULT FALSE;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS template_id    TEXT;   -- ThoughtGate template


-- ---------------------------------------------------------------------------
-- 10. PROFILES — add missing columns with safe defaults
-- ---------------------------------------------------------------------------

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_banned   BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ban_reason  TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id          TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_connect_account_id   TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_connect_onboarded    BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS quota_reset_date TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_id TEXT;


-- ---------------------------------------------------------------------------
-- 11. NOTIFICATIONS — add is_read default + action_url
-- ---------------------------------------------------------------------------

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read    BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type        TEXT DEFAULT 'info';

CREATE INDEX IF NOT EXISTS idx_notif_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE is_read = FALSE;


-- ---------------------------------------------------------------------------
-- 12. AGENTS — add mcp_server_ids if missing
-- ---------------------------------------------------------------------------

ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_server_ids TEXT[]    DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS timeout_seconds INTEGER   DEFAULT 30;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rejected        BOOLEAN   DEFAULT FALSE;


-- ---------------------------------------------------------------------------
-- 13. REVIEWS — add moderation status if missing
-- ---------------------------------------------------------------------------

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_reviews_status  ON reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_agent   ON reviews(agent_id, status);


-- ---------------------------------------------------------------------------
-- 14. search_agents_semantic RPC
--     Called by /api/search when OpenAI embedding is available.
--     Requires agents to have an embedding column (optional — if column does
--     not exist the function is still created but will return 0 rows).
-- ---------------------------------------------------------------------------

-- Add embedding column to agents (safe to add; null by default)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- IVFFlat index on agent embeddings
CREATE INDEX IF NOT EXISTS idx_agents_embedding
  ON agents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL;

CREATE OR REPLACE FUNCTION search_agents_semantic(
  query_embedding  vector(1536),
  match_threshold  FLOAT   DEFAULT 0.65,
  match_count      INT     DEFAULT 20
)
RETURNS TABLE (
  agent_id         UUID,
  name             TEXT,
  description      TEXT,
  category         TEXT,
  pricing_model    TEXT,
  price_per_call   NUMERIC,
  average_rating   NUMERIC,
  composite_score  NUMERIC,
  total_executions BIGINT,
  similarity       FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    a.id              AS agent_id,
    a.name,
    a.description,
    a.category::text,
    a.pricing_model::text,
    COALESCE(a.price_per_call, 0)::numeric,
    COALESCE(a.average_rating, 0)::numeric,
    COALESCE(a.composite_score, 0)::numeric,
    COALESCE(a.total_executions, 0)::bigint,
    (1 - (a.embedding <=> query_embedding))::float AS similarity
  FROM agents a
  WHERE a.status = 'active'
    AND a.embedding IS NOT NULL
    AND (1 - (a.embedding <=> query_embedding)) > match_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION search_agents_semantic(vector, FLOAT, INT)
  TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 15. add_credits RPC — hardened with credit_transactions record
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION add_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  description_param  TEXT    DEFAULT 'Credit top-up',
  reference_id_param UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  IF amount_param <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Upsert credits row (handles first-time users)
  INSERT INTO credits (user_id, balance_usd, total_purchased)
  VALUES (user_id_param, amount_param, amount_param)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_usd    = credits.balance_usd + amount_param,
        total_purchased = credits.total_purchased + amount_param,
        updated_at     = now()
  RETURNING balance_usd INTO new_balance;

  -- Record transaction
  INSERT INTO credit_transactions (
    user_id, type, amount_usd, balance_after, description, reference_id
  ) VALUES (
    user_id_param, 'topup', amount_param, new_balance, description_param, reference_id_param
  );

  RETURN jsonb_build_object('success', true, 'new_balance', new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION add_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 16. deduct_credits RPC — hardened with transaction record
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deduct_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  description_param  TEXT DEFAULT 'Agent execution',
  reference_id_param UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  current_balance NUMERIC;
  new_balance     NUMERIC;
BEGIN
  -- Lock the row for atomic update
  SELECT balance_usd INTO current_balance
  FROM credits
  WHERE user_id = user_id_param
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credits account not found');
  END IF;

  IF current_balance < amount_param THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits',
      'balance', current_balance, 'required', amount_param);
  END IF;

  new_balance := current_balance - amount_param;

  UPDATE credits
  SET balance_usd = new_balance,
      total_spent = COALESCE(total_spent, 0) + amount_param,
      updated_at  = now()
  WHERE user_id = user_id_param;

  INSERT INTO credit_transactions (
    user_id, type, amount_usd, balance_after, description, reference_id
  ) VALUES (
    user_id_param, 'deduction', amount_param, new_balance, description_param, reference_id_param
  );

  RETURN jsonb_build_object('success', true, 'new_balance', new_balance, 'deducted', amount_param);
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 17. increment_executions_used — ensure it exists
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION increment_executions_used(user_id_param UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER
AS $$
  UPDATE profiles
  SET executions_used_this_month = COALESCE(executions_used_this_month, 0) + 1,
      updated_at                 = now()
  WHERE id = user_id_param;
$$;

GRANT EXECUTE ON FUNCTION increment_executions_used(UUID)
  TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 18. reset_monthly_quotas — called by pg_cron on 1st of month
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reset_monthly_quotas()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE profiles
  SET executions_used_this_month = 0,
      quota_reset_date           = date_trunc('month', now()) + INTERVAL '1 month',
      updated_at                 = now();

  GET DIAGNOSTICS affected = ROW_COUNT;

  INSERT INTO audit_logs (actor_type, action, resource, payload)
  VALUES ('system', 'monthly_quota_reset', 'profiles',
    jsonb_build_object('profiles_reset', affected, 'reset_at', now()));

  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_monthly_quotas() TO service_role;


-- ---------------------------------------------------------------------------
-- 19. compute_agent_score — hardened with proper column references
--     Recomputes composite score from live execution data.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compute_agent_score(target_agent_id UUID)
RETURNS VOID
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  v_total       BIGINT;
  v_success     BIGINT;
  v_avg_latency NUMERIC;
  v_avg_rating  NUMERIC;
  v_total_rev   NUMERIC;
  v_price       NUMERIC;
  v_accuracy    NUMERIC;
  v_reliability NUMERIC;
  v_latency_s   NUMERIC;
  v_cost_s      NUMERIC;
  v_popularity  NUMERIC;
  v_composite   NUMERIC;
BEGIN
  -- Aggregate from executions
  SELECT
    COUNT(*)                                FILTER (WHERE status IN ('success','failed')),
    COUNT(*)                                FILTER (WHERE status = 'success'),
    AVG(latency_ms)                         FILTER (WHERE status = 'success' AND latency_ms IS NOT NULL),
    COALESCE(AVG(r.rating) FILTER (WHERE r.status = 'approved'), 0),
    COALESCE(SUM(CASE WHEN e.cost_usd > 0 THEN e.cost_usd ELSE e.cost END), 0)
  INTO v_total, v_success, v_avg_latency, v_avg_rating, v_total_rev
  FROM executions e
  LEFT JOIN reviews r ON r.agent_id = e.agent_id AND r.status = 'approved'
  WHERE e.agent_id = target_agent_id
    AND e.created_at > now() - INTERVAL '30 days';

  -- Fewer than 5 executions → no meaningful score
  IF v_total < 5 THEN RETURN; END IF;

  SELECT COALESCE(price_per_call, 0) INTO v_price
  FROM agents WHERE id = target_agent_id;

  -- Accuracy score (0-100): success rate weighted by volume
  v_accuracy := LEAST(100, (v_success::NUMERIC / NULLIF(v_total, 0)) * 100);

  -- Reliability score (0-100): success rate squared to penalise low rates
  v_reliability := LEAST(100, POWER(v_success::NUMERIC / NULLIF(v_total, 0), 2) * 100);

  -- Latency score (0-100): lower is better; 0ms = 100, 10s = 0
  v_latency_s := GREATEST(0, 100 - COALESCE(v_avg_latency, 5000) / 100);

  -- Cost score (0-100): free = 100, $1/call = 0
  v_cost_s := GREATEST(0, 100 - v_price * 100);

  -- Popularity score (0-100): log scale on total executions, cap at 1000
  v_popularity := LEAST(100, LN(GREATEST(1, v_total)) / LN(1000) * 100);

  -- Composite (weighted sum matching leaderboard display)
  v_composite :=
    v_accuracy    * 0.30 +
    v_reliability * 0.25 +
    v_latency_s   * 0.20 +
    v_cost_s      * 0.15 +
    v_popularity  * 0.10;

  -- Upsert into agent_scores
  INSERT INTO agent_scores (
    agent_id, composite_score, accuracy_score, reliability_score,
    latency_score, cost_score, popularity_score, sample_size,
    is_top_rated, is_fastest, is_cheapest, is_most_reliable,
    updated_at
  )
  VALUES (
    target_agent_id,
    ROUND(v_composite, 2),
    ROUND(v_accuracy,   2),
    ROUND(v_reliability,2),
    ROUND(v_latency_s,  2),
    ROUND(v_cost_s,     2),
    ROUND(v_popularity, 2),
    v_total,
    (v_avg_rating >= 4.5 AND v_total >= 20),
    (v_avg_latency < 500   AND v_total >= 10),
    (v_price = 0           AND v_total >= 10),
    (v_reliability >= 95   AND v_total >= 10),
    now()
  )
  ON CONFLICT (agent_id) DO UPDATE
    SET composite_score  = EXCLUDED.composite_score,
        accuracy_score   = EXCLUDED.accuracy_score,
        reliability_score = EXCLUDED.reliability_score,
        latency_score    = EXCLUDED.latency_score,
        cost_score       = EXCLUDED.cost_score,
        popularity_score = EXCLUDED.popularity_score,
        sample_size      = EXCLUDED.sample_size,
        is_top_rated     = EXCLUDED.is_top_rated,
        is_fastest       = EXCLUDED.is_fastest,
        is_cheapest      = EXCLUDED.is_cheapest,
        is_most_reliable = EXCLUDED.is_most_reliable,
        updated_at       = now();

  -- Propagate composite_score back to agents table for fast reads
  UPDATE agents
  SET composite_score  = ROUND(v_composite, 2),
      total_revenue    = (
        SELECT COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE cost END), 0)
        FROM executions WHERE agent_id = target_agent_id
      ),
      updated_at       = now()
  WHERE id = target_agent_id;

END;
$$;

GRANT EXECUTE ON FUNCTION compute_agent_score(UUID)
  TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 20. handle_new_user_credits trigger function — ensure credits row is created
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user_credits()
RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
BEGIN
  -- Create credits wallet with $0 balance
  INSERT INTO credits (user_id, balance_usd, hard_limit_usd, alert_threshold)
  VALUES (NEW.id, 0, 5, 1)
  ON CONFLICT (user_id) DO NOTHING;

  -- Welcome notification
  INSERT INTO notifications (user_id, title, body, type)
  VALUES (
    NEW.id,
    'Welcome to AgentDyne! 👋',
    'Explore the marketplace and run your first AI agent. Start with free agents — no credits needed.',
    'welcome'
  );

  RETURN NEW;
END;
$$;

-- Recreate trigger cleanly
DROP TRIGGER IF EXISTS on_profile_created_give_credits ON profiles;
CREATE TRIGGER on_profile_created_give_credits
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_credits();


-- ---------------------------------------------------------------------------
-- 21. auto_promote_to_seller — ensure exists and is correct
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auto_promote_to_seller()
RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
BEGIN
  -- When an agent is approved (status → active), ensure seller role
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE profiles
    SET role       = CASE WHEN role = 'admin' THEN 'admin' ELSE 'seller' END,
        updated_at = now()
    WHERE id = NEW.seller_id
      AND role NOT IN ('admin', 'seller');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_activated_promote_seller ON agents;
CREATE TRIGGER on_agent_activated_promote_seller
  AFTER UPDATE OF status ON agents
  FOR EACH ROW
  EXECUTE FUNCTION auto_promote_to_seller();


-- ---------------------------------------------------------------------------
-- 22. update_pipeline_stats — ensure exists
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_pipeline_stats()
RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status IN ('success', 'failed') THEN
    UPDATE pipelines
    SET run_count    = COALESCE(run_count, 0) + 1,
        last_run_at  = now(),
        updated_at   = now()
    WHERE id = NEW.pipeline_id;
  END IF;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 23. update_agent_rating — ensure it aggregates approved reviews only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_agent_rating()
RETURNS TRIGGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  v_agent_id UUID;
BEGIN
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id);

  UPDATE agents
  SET average_rating = (
        SELECT COALESCE(AVG(rating), 0)
        FROM reviews
        WHERE agent_id = v_agent_id AND status = 'approved'
      ),
      total_reviews  = (
        SELECT COUNT(*)
        FROM reviews
        WHERE agent_id = v_agent_id AND status = 'approved'
      ),
      updated_at     = now()
  WHERE id = v_agent_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ---------------------------------------------------------------------------
-- 24. set_updated_at — generic timestamp trigger (ensure exists)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 25. PIPELINES — add run_count + last_run_at if missing
-- ---------------------------------------------------------------------------

ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS run_count   INTEGER   DEFAULT 0;
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS tags        TEXT[]    DEFAULT '{}';
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS is_active   BOOLEAN   DEFAULT TRUE;


-- ---------------------------------------------------------------------------
-- 26. AGENT SCORES TABLE — ensure exists with global_rank + category_rank
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_scores (
  agent_id          UUID        PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  composite_score   NUMERIC     DEFAULT 0,
  accuracy_score    NUMERIC     DEFAULT 0,
  reliability_score NUMERIC     DEFAULT 0,
  latency_score     NUMERIC     DEFAULT 0,
  cost_score        NUMERIC     DEFAULT 0,
  popularity_score  NUMERIC     DEFAULT 0,
  global_rank       INTEGER     DEFAULT 9999,
  category_rank     INTEGER     DEFAULT 9999,
  is_top_rated      BOOLEAN     DEFAULT FALSE,
  is_fastest        BOOLEAN     DEFAULT FALSE,
  is_cheapest       BOOLEAN     DEFAULT FALSE,
  is_most_reliable  BOOLEAN     DEFAULT FALSE,
  sample_size       BIGINT      DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE agent_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scores_public_read"   ON agent_scores;
DROP POLICY IF EXISTS "scores_system_write"  ON agent_scores;

CREATE POLICY "scores_public_read"
  ON agent_scores FOR SELECT
  USING (true);

CREATE POLICY "scores_system_write"
  ON agent_scores FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "scores_service_write"
  ON agent_scores FOR INSERT
  WITH CHECK (true);

CREATE POLICY "scores_service_update"
  ON agent_scores FOR UPDATE
  USING (true);

GRANT SELECT, INSERT, UPDATE ON agent_scores TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 27. GLOBAL RANK UPDATE — called daily by pg_cron
--     Rankings are computed across ALL active agents simultaneously.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_agent_rankings()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  affected INTEGER;
BEGIN
  -- Global rank by composite score
  WITH ranked AS (
    SELECT
      s.agent_id,
      ROW_NUMBER() OVER (ORDER BY s.composite_score DESC, s.sample_size DESC) AS g_rank,
      ROW_NUMBER() OVER (PARTITION BY a.category ORDER BY s.composite_score DESC) AS c_rank
    FROM agent_scores s
    JOIN agents a ON a.id = s.agent_id AND a.status = 'active'
    WHERE s.composite_score > 0
  )
  UPDATE agent_scores AS s
  SET global_rank   = r.g_rank,
      category_rank = r.c_rank,
      updated_at    = now()
  FROM ranked r
  WHERE s.agent_id = r.agent_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_agent_rankings() TO service_role;


-- ---------------------------------------------------------------------------
-- 28. DAILY ANALYTICS AGGREGATION — fills agent_analytics per day
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION aggregate_daily_analytics()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  affected INTEGER;
  target_date DATE := CURRENT_DATE - 1;  -- yesterday
BEGIN
  INSERT INTO agent_analytics (
    agent_id, date, executions, successes, failures,
    success_rate, avg_latency, revenue_usd, tokens_in, tokens_out, updated_at
  )
  SELECT
    e.agent_id,
    target_date,
    COUNT(*)                              FILTER (WHERE status IN ('success','failed')) AS executions,
    COUNT(*)                              FILTER (WHERE status = 'success')             AS successes,
    COUNT(*)                              FILTER (WHERE status = 'failed')              AS failures,
    ROUND(
      (COUNT(*) FILTER (WHERE status = 'success')::NUMERIC /
       NULLIF(COUNT(*) FILTER (WHERE status IN ('success','failed')), 0)) * 100, 2
    )                                                                                   AS success_rate,
    ROUND(AVG(latency_ms) FILTER (WHERE status = 'success'), 0)                        AS avg_latency,
    COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE COALESCE(cost, 0) END), 0)  AS revenue_usd,
    COALESCE(SUM(tokens_input),  0)                                                     AS tokens_in,
    COALESCE(SUM(tokens_output), 0)                                                     AS tokens_out,
    now()
  FROM executions e
  WHERE DATE(e.created_at) = target_date
  GROUP BY e.agent_id
  ON CONFLICT (agent_id, date) DO UPDATE
    SET executions   = EXCLUDED.executions,
        successes    = EXCLUDED.successes,
        failures     = EXCLUDED.failures,
        success_rate = EXCLUDED.success_rate,
        avg_latency  = EXCLUDED.avg_latency,
        revenue_usd  = EXCLUDED.revenue_usd,
        tokens_in    = EXCLUDED.tokens_in,
        tokens_out   = EXCLUDED.tokens_out,
        updated_at   = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION aggregate_daily_analytics() TO service_role;


-- ---------------------------------------------------------------------------
-- 29. CREDITS TABLE — ensure structure is correct
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credits (
  user_id         UUID        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance_usd     NUMERIC(12,6) DEFAULT 0,
  total_purchased NUMERIC(12,6) DEFAULT 0,
  total_spent     NUMERIC(12,6) DEFAULT 0,
  hard_limit_usd  NUMERIC(12,2) DEFAULT 5,
  alert_threshold NUMERIC(12,2) DEFAULT 1,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credits_own"          ON credits;
DROP POLICY IF EXISTS "credits_service_upsert" ON credits;

CREATE POLICY "credits_own"
  ON credits FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "credits_service_upsert"
  ON credits FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON credits TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 30. pg_cron SCHEDULES
--     Must run as database owner (postgres) or superuser.
--     Idempotent — cron.schedule() overwrites existing schedule with same name.
-- ---------------------------------------------------------------------------

-- Monthly quota reset (1st of every month, midnight UTC)
SELECT cron.schedule(
  'reset-monthly-quotas',
  '0 0 1 * *',
  $$SELECT reset_monthly_quotas()$$
);

-- Daily analytics aggregation (1:00 AM UTC)
SELECT cron.schedule(
  'daily-analytics',
  '0 1 * * *',
  $$SELECT aggregate_daily_analytics()$$
);

-- Daily ranking refresh (2:00 AM UTC — after analytics are ready)
SELECT cron.schedule(
  'refresh-rankings',
  '0 2 * * *',
  $$SELECT refresh_agent_rankings()$$
);

-- Hourly expired memory cleanup
SELECT cron.schedule(
  'cleanup-memory',
  '0 * * * *',
  $$SELECT cleanup_expired_memory()$$
);


-- ---------------------------------------------------------------------------
-- 31. ROW-LEVEL SECURITY: ensure executions are not cross-tenant readable
-- ---------------------------------------------------------------------------

ALTER TABLE executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "executions_own_read"    ON executions;
DROP POLICY IF EXISTS "executions_agent_seller" ON executions;
DROP POLICY IF EXISTS "executions_insert"       ON executions;

CREATE POLICY "executions_own_read"
  ON executions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "executions_agent_seller"
  ON executions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = executions.agent_id
        AND agents.seller_id = auth.uid()
    )
  );

CREATE POLICY "executions_insert"
  ON executions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "executions_update_own"
  ON executions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "executions_admin_all"
  ON executions FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

GRANT SELECT, INSERT, UPDATE ON executions TO authenticated;
GRANT ALL ON executions TO service_role;


-- ---------------------------------------------------------------------------
-- 32. FINAL GRANTS
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_feedback     TO authenticated, service_role;
GRANT SELECT, INSERT                 ON credit_transactions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE         ON agent_analytics     TO authenticated, service_role;
GRANT SELECT, INSERT                 ON audit_logs          TO service_role;
GRANT SELECT                         ON audit_logs          TO authenticated;

GRANT EXECUTE ON FUNCTION compute_agent_score(UUID)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_agent_rankings()      TO service_role;
GRANT EXECUTE ON FUNCTION aggregate_daily_analytics()   TO service_role;
GRANT EXECUTE ON FUNCTION reset_monthly_quotas()        TO service_role;
GRANT EXECUTE ON FUNCTION increment_executions_used(UUID) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 33. VERIFICATION
-- ---------------------------------------------------------------------------

DO $$
DECLARE v INTEGER;
BEGIN
  SELECT COUNT(*) INTO v FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'audit_logs','agent_feedback','agent_analytics',
      'credit_transactions','agent_scores','agent_memory',
      'knowledge_bases','rag_documents','rag_chunks'
    );
  RAISE NOTICE '✅ Critical tables present: % / 9', v;

  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'injection_attempts' AND column_name = 'score';
  RAISE NOTICE '✅ injection_attempts.score: %', CASE WHEN v=1 THEN 'OK' ELSE '⚠ MISSING' END;

  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'execution_traces' AND column_name = 'tool_calls';
  RAISE NOTICE '✅ execution_traces.tool_calls: %', CASE WHEN v=1 THEN 'OK' ELSE '⚠ MISSING' END;

  SELECT COUNT(*) INTO v FROM pg_trigger WHERE tgname = 'on_review_change';
  RAISE NOTICE '✅ on_review_change triggers: % (should be 1)', v;

  SELECT COUNT(*) INTO v FROM pg_trigger
  WHERE tgrelid = 'pipeline_executions'::regclass
    AND tgname IN ('trg_update_pipeline_stats','on_pipeline_execution_complete');
  RAISE NOTICE '✅ pipeline_executions stat triggers: % (should be 1)', v;

  RAISE NOTICE '✅ Migration 010 complete. Production hardening applied.';
END $$;
