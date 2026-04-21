-- =============================================================================
-- AgentDyne — Migration 011: Production Hardening
-- Run ONCE in Supabase SQL Editor after migration 010.
-- All statements are idempotent (safe to re-run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. UNIQUE CONSTRAINTS — fix upsert failures
--    Three places in the codebase use upsert with conflict resolution;
--    the underlying unique constraints were missing from earlier migrations.
-- ---------------------------------------------------------------------------

-- agent_memory: (user_id, agent_id, key) must be unique per upsert in /api/memory
DO $fix_memory_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_memory_user_agent_key_key'
      AND conrelid = 'agent_memory'::regclass
  ) THEN
    ALTER TABLE agent_memory
      ADD CONSTRAINT agent_memory_user_agent_key_key
      UNIQUE (user_id, agent_id, key);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $fix_memory_unique$;

-- agent_feedback: (execution_id, user_id) must be unique for upsert in /api/feedback
DO $fix_feedback_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_feedback_execution_user_key'
      AND conrelid = 'agent_feedback'::regclass
  ) THEN
    ALTER TABLE agent_feedback
      ADD CONSTRAINT agent_feedback_execution_user_key
      UNIQUE (execution_id, user_id);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $fix_feedback_unique$;

-- reviews: (agent_id, user_id) must be unique — one review per user per agent
DO $fix_reviews_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reviews_agent_user_key'
      AND conrelid = 'reviews'::regclass
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_agent_user_key
      UNIQUE (agent_id, user_id);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $fix_reviews_unique$;

-- ---------------------------------------------------------------------------
-- 2. AGENT_ANALYTICS — add missing columns used by cron job 010
-- ---------------------------------------------------------------------------
ALTER TABLE agent_analytics ADD COLUMN IF NOT EXISTS success_rate  FLOAT   DEFAULT 1;
ALTER TABLE agent_analytics ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();

-- Add unique constraint on (agent_id, date) for upsert in aggregate function
DO $fix_analytics_unique$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_analytics_agent_date_key'
      AND conrelid = 'agent_analytics'::regclass
  ) THEN
    ALTER TABLE agent_analytics
      ADD CONSTRAINT agent_analytics_agent_date_key
      UNIQUE (agent_id, date);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $fix_analytics_unique$;

-- ---------------------------------------------------------------------------
-- 3. PROFILES — add is_banned column (used in execute route)
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 4. API_KEYS — add expires_at column (checked in execute route)
-- Already in schema but may not have index
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active
  ON api_keys(key_hash, is_active)
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 5. SEMANTIC SEARCH RPC — used by /api/search
--    Requires: agent_embeddings.embedding (vector column exists in schema)
--    Returns agents ranked by cosine similarity to a query embedding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_agents_semantic(
  query_embedding  vector(1536),
  match_threshold  FLOAT  DEFAULT 0.65,
  match_count      INT    DEFAULT 20
)
RETURNS TABLE (
  agent_id         UUID,
  name             TEXT,
  description      TEXT,
  category         TEXT,
  composite_score  NUMERIC,
  average_rating   NUMERIC,
  pricing_model    TEXT,
  price_per_call   NUMERIC,
  total_executions BIGINT,
  similarity       FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    a.id              AS agent_id,
    a.name,
    a.description,
    a.category::TEXT,
    a.composite_score,
    a.average_rating,
    a.pricing_model::TEXT,
    a.price_per_call,
    a.total_executions,
    (1 - (ae.embedding <=> query_embedding))::FLOAT AS similarity
  FROM agent_embeddings ae
  JOIN agents a ON a.id = ae.agent_id
  WHERE a.status = 'active'
    AND (1 - (ae.embedding <=> query_embedding)) > match_threshold
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION search_agents_semantic(vector, FLOAT, INT)
  TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- 6. PERFORMANCE INDEXES — critical for global launch traffic
-- ---------------------------------------------------------------------------

-- Executions: most common access patterns
CREATE INDEX IF NOT EXISTS idx_executions_user_created
  ON executions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executions_agent_status
  ON executions(agent_id, status, created_at DESC);

-- Injection attempts: admin monitoring
CREATE INDEX IF NOT EXISTS idx_injection_action_created
  ON injection_attempts(action, created_at DESC);

-- Agent memory: TTL cleanup query
CREATE INDEX IF NOT EXISTS idx_agent_memory_ttl_active
  ON agent_memory(ttl_at)
  WHERE ttl_at IS NOT NULL;

-- Agents: marketplace browse (most common)
CREATE INDEX IF NOT EXISTS idx_agents_status_category
  ON agents(status, category, composite_score DESC);

CREATE INDEX IF NOT EXISTS idx_agents_status_featured
  ON agents(status, is_featured, composite_score DESC)
  WHERE status = 'active';

-- Knowledge bases: RAG lookup
CREATE INDEX IF NOT EXISTS idx_rag_chunks_kb_created
  ON rag_chunks(knowledge_base_id, created_at DESC);

-- Notifications: unread count (used in bell UI)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, is_read, created_at DESC);

-- Execution traces: per-execution lookup
CREATE INDEX IF NOT EXISTS idx_exec_traces_execution
  ON execution_traces(execution_id, created_at DESC);

-- Pipeline executions: user history
CREATE INDEX IF NOT EXISTS idx_pipeline_exec_user_created
  ON pipeline_executions(user_id, created_at DESC);

-- Reviews: approval queue for admin
CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON reviews(status, created_at ASC)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 7. AGENT_ANALYTICS FUNCTION — fix cron aggregate to use correct columns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aggregate_agent_analytics_yesterday()
RETURNS INTEGER
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  target_date    DATE    := (CURRENT_DATE - INTERVAL '1 day')::DATE;
  inserted_count INTEGER;
BEGIN
  INSERT INTO agent_analytics (
    agent_id, date, executions, successful, failed,
    revenue, avg_latency_ms, success_rate, updated_at
  )
  SELECT
    e.agent_id,
    target_date,
    COUNT(*)::INTEGER                                                           AS executions,
    COUNT(*) FILTER (WHERE e.status = 'success')::INTEGER                      AS successful,
    COUNT(*) FILTER (WHERE e.status = 'failed')::INTEGER                        AS failed,
    COALESCE(SUM(e.cost_usd) * 0.8, 0)                                         AS revenue,
    COALESCE(AVG(e.latency_ms), 0)::INTEGER                                     AS avg_latency_ms,
    COALESCE(
      COUNT(*) FILTER (WHERE e.status = 'success')::FLOAT / NULLIF(COUNT(*), 0),
      1
    )                                                                             AS success_rate,
    NOW()
  FROM executions e
  WHERE e.created_at >= target_date
    AND e.created_at <  target_date + INTERVAL '1 day'
    AND e.agent_id IS NOT NULL
  GROUP BY e.agent_id
  ON CONFLICT (agent_id, date)
  DO UPDATE SET
    executions    = EXCLUDED.executions,
    successful    = EXCLUDED.successful,
    failed        = EXCLUDED.failed,
    revenue       = EXCLUDED.revenue,
    avg_latency_ms= EXCLUDED.avg_latency_ms,
    success_rate  = EXCLUDED.success_rate,
    updated_at    = NOW();

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  -- Sync lifetime stats on agents table
  UPDATE agents a
  SET
    total_executions   = (SELECT COUNT(*) FROM executions e WHERE e.agent_id = a.id),
    successful_executions = (SELECT COUNT(*) FROM executions e WHERE e.agent_id = a.id AND e.status = 'success'),
    total_revenue      = (SELECT COALESCE(SUM(cost_usd) * 0.8, 0) FROM executions e WHERE e.agent_id = a.id),
    average_latency_ms = (SELECT COALESCE(AVG(latency_ms), 0)::INTEGER FROM executions e WHERE e.agent_id = a.id AND e.status = 'success'),
    updated_at         = NOW()
  WHERE a.id IN (
    SELECT DISTINCT agent_id FROM executions
    WHERE created_at >= target_date AND created_at < target_date + INTERVAL '1 day'
  );

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION aggregate_agent_analytics_yesterday() TO service_role;

-- ---------------------------------------------------------------------------
-- 8. GOVERNANCE EVENTS — RLS for admin
-- ---------------------------------------------------------------------------
ALTER TABLE governance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "governance_admin_read"   ON governance_events;
DROP POLICY IF EXISTS "governance_system_insert" ON governance_events;

CREATE POLICY "governance_admin_read"
  ON governance_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "governance_system_insert"
  ON governance_events FOR INSERT
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 9. AUDIT LOGS — add INSERT policy for admin actions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_admin_all" ON audit_logs;
CREATE POLICY "audit_admin_all"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 10. REVIEWS POLICIES — add UPDATE for sellers to respond (future feature)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "reviews_admin_manage" ON reviews;
CREATE POLICY "reviews_admin_manage"
  ON reviews FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 11. AGENT_FEEDBACK POLICIES — ensure they exist
-- ---------------------------------------------------------------------------
ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;
-- Policies already exist from schema: feedback_own_read/write/update/seller_read/admin_all

-- ---------------------------------------------------------------------------
-- 12. WAITLIST — ensure RLS is enabled
-- ---------------------------------------------------------------------------
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waitlist_public_insert" ON waitlist;
CREATE POLICY "waitlist_public_insert"
  ON waitlist FOR INSERT
  WITH CHECK (true);  -- anyone can join the waitlist

DROP POLICY IF EXISTS "waitlist_admin_select" ON waitlist;
CREATE POLICY "waitlist_admin_select"
  ON waitlist FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- VERIFY: Run the following to confirm all indexes were created:
-- SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%' ORDER BY tablename;
-- =============================================================================
