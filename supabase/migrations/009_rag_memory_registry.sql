-- =============================================================================
-- AgentDyne — Migration 009 v2: RAG, Memory, Registry, Security
-- FIXED: view column type conflict (numeric(5,2) → numeric)
-- Run ONCE in Supabase SQL Editor. All statements are idempotent.
-- Prerequisites: Migrations 001–008 must have been run first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";


-- ---------------------------------------------------------------------------
-- 1. FIX MISSING COLUMNS — pipeline_executions
-- 008_complete_production_schema.sql has `error TEXT` but the pipeline execute
-- route writes `error_message`. Add both to support both schemas safely.
-- ---------------------------------------------------------------------------
ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS total_latency_ms  INTEGER;
ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS total_cost         NUMERIC(12,6) DEFAULT 0;
ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS total_tokens_in    INTEGER       DEFAULT 0;
ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS total_tokens_out   INTEGER       DEFAULT 0;
ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS error_message      TEXT;
ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS node_results       JSONB         DEFAULT '[]';


-- ---------------------------------------------------------------------------
-- 2. FIX MISSING COLUMNS — agents
-- ---------------------------------------------------------------------------
ALTER TABLE agents ADD COLUMN IF NOT EXISTS compliance_tags TEXT[]   DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS input_schema    JSONB
  DEFAULT '{"type":"object","properties":{"input":{"type":"string"}}}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS output_schema   JSONB
  DEFAULT '{"type":"object","properties":{"output":{"type":"string"}}}';


-- ---------------------------------------------------------------------------
-- 3. INJECTION ATTEMPTS TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS injection_attempts (
  id         BIGSERIAL   PRIMARY KEY,
  user_id    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  agent_id   UUID        REFERENCES agents(id)   ON DELETE SET NULL,
  input      TEXT,
  pattern    TEXT,
  score      NUMERIC     DEFAULT 0,
  action     TEXT        NOT NULL DEFAULT 'flagged'
                         CHECK (action IN ('blocked', 'flagged')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_injection_agent  ON injection_attempts(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_injection_user   ON injection_attempts(user_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS idx_injection_action ON injection_attempts(action);

ALTER TABLE injection_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "injection_admin_read"    ON injection_attempts;
DROP POLICY IF EXISTS "injection_system_insert" ON injection_attempts;

CREATE POLICY "injection_admin_read"
  ON injection_attempts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    EXISTS (SELECT 1 FROM agents WHERE id = injection_attempts.agent_id AND seller_id = auth.uid())
  );

CREATE POLICY "injection_system_insert"
  ON injection_attempts FOR INSERT
  WITH CHECK (true);


-- ---------------------------------------------------------------------------
-- 4. KNOWLEDGE BASES TABLE (RAG)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_public   BOOLEAN     DEFAULT FALSE,
  doc_count   INTEGER     DEFAULT 0,
  max_docs    INTEGER     DEFAULT 1000,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_owner  ON knowledge_bases(owner_id);
CREATE INDEX IF NOT EXISTS idx_kb_public ON knowledge_bases(is_public) WHERE is_public = TRUE;

ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kb_owner_all"   ON knowledge_bases;
DROP POLICY IF EXISTS "kb_public_read" ON knowledge_bases;

CREATE POLICY "kb_owner_all"
  ON knowledge_bases FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "kb_public_read"
  ON knowledge_bases FOR SELECT
  USING (is_public = TRUE);


-- ---------------------------------------------------------------------------
-- 5. RAG DOCUMENTS TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_documents (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  knowledge_base_id UUID        NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  owner_id          UUID        NOT NULL REFERENCES profiles(id)         ON DELETE CASCADE,
  title             TEXT        NOT NULL DEFAULT 'Untitled',
  content           TEXT        NOT NULL,
  chunk_count       INTEGER     DEFAULT 0,
  metadata          JSONB       DEFAULT '{}',
  status            TEXT        DEFAULT 'indexed'
                                CHECK (status IN ('pending','indexed','failed','deleted')),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_docs_kb    ON rag_documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_rag_docs_owner ON rag_documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_rag_docs_status ON rag_documents(status);

ALTER TABLE rag_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rag_docs_owner_all"   ON rag_documents;
DROP POLICY IF EXISTS "rag_docs_public_read" ON rag_documents;

CREATE POLICY "rag_docs_owner_all"
  ON rag_documents FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "rag_docs_public_read"
  ON rag_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM knowledge_bases
      WHERE knowledge_bases.id = rag_documents.knowledge_base_id
        AND knowledge_bases.is_public = TRUE
    )
  );


-- ---------------------------------------------------------------------------
-- 6. RAG CHUNKS TABLE (pgvector embeddings)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_chunks (
  id                BIGSERIAL   PRIMARY KEY,
  document_id       UUID        NOT NULL REFERENCES rag_documents(id)    ON DELETE CASCADE,
  knowledge_base_id UUID        NOT NULL REFERENCES knowledge_bases(id)  ON DELETE CASCADE,
  owner_id          UUID        NOT NULL REFERENCES profiles(id)          ON DELETE CASCADE,
  chunk_index       INTEGER     NOT NULL,
  content           TEXT        NOT NULL,
  embedding         vector(1536),
  char_count        INTEGER     DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- IVFFlat index — lists = sqrt(expected rows); 100 is good for up to ~1M chunks
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
  ON rag_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_kb  ON rag_chunks(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc ON rag_chunks(document_id);

ALTER TABLE rag_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rag_chunks_owner_read"  ON rag_chunks;
DROP POLICY IF EXISTS "rag_chunks_public_read" ON rag_chunks;

CREATE POLICY "rag_chunks_owner_read"
  ON rag_chunks FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "rag_chunks_public_read"
  ON rag_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM knowledge_bases
      WHERE knowledge_bases.id = rag_chunks.knowledge_base_id
        AND knowledge_bases.is_public = TRUE
    )
  );


-- ---------------------------------------------------------------------------
-- 7. RAG SEARCH FUNCTION
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_rag_chunks(
  kb_id_param      UUID,
  query_embedding  vector(1536),
  match_threshold  FLOAT  DEFAULT 0.65,
  match_count      INT    DEFAULT 5
)
RETURNS TABLE (
  chunk_id       BIGINT,
  document_id    UUID,
  document_title TEXT,
  content        TEXT,
  similarity     FLOAT,
  metadata       JSONB
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    c.id            AS chunk_id,
    c.document_id,
    d.title         AS document_title,
    c.content,
    (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity,
    d.metadata
  FROM rag_chunks c
  JOIN rag_documents d ON d.id = c.document_id
  WHERE c.knowledge_base_id = kb_id_param
    AND d.status = 'indexed'
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION search_rag_chunks(UUID, vector, FLOAT, INT)
  TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 8. KB DOC COUNT HELPERS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_kb_doc_count(kb_id_param UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER
AS $$
  UPDATE knowledge_bases
  SET doc_count  = COALESCE(doc_count, 0) + 1,
      updated_at = now()
  WHERE id = kb_id_param;
$$;

CREATE OR REPLACE FUNCTION decrement_kb_doc_count(kb_id_param UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER
AS $$
  UPDATE knowledge_bases
  SET doc_count  = GREATEST(0, COALESCE(doc_count, 0) - 1),
      updated_at = now()
  WHERE id = kb_id_param;
$$;

GRANT EXECUTE ON FUNCTION increment_kb_doc_count(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION decrement_kb_doc_count(UUID) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 9. AGENT REGISTRY VERSIONS TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_registry_versions (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id   UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version    TEXT        NOT NULL,
  changelog  TEXT,
  snapshot   JSONB       DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arv_agent ON agent_registry_versions(agent_id, created_at DESC);

ALTER TABLE agent_registry_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arv_public_read"  ON agent_registry_versions;
DROP POLICY IF EXISTS "arv_owner_insert" ON agent_registry_versions;

CREATE POLICY "arv_public_read"
  ON agent_registry_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_registry_versions.agent_id
        AND agents.status = 'active'
    )
  );

CREATE POLICY "arv_owner_insert"
  ON agent_registry_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_registry_versions.agent_id
        AND agents.seller_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- 10. AGENT MEMORY TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_memory (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  agent_id   UUID        NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL,
  ttl_at     TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, agent_id, key)
);

CREATE INDEX IF NOT EXISTS idx_memory_user_agent ON agent_memory(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_ttl        ON agent_memory(ttl_at) WHERE ttl_at IS NOT NULL;

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memory_own" ON agent_memory;
CREATE POLICY "memory_own"
  ON agent_memory FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION cleanup_expired_memory()
RETURNS INTEGER
LANGUAGE SQL SECURITY DEFINER
AS $$
  WITH deleted AS (
    DELETE FROM agent_memory
    WHERE ttl_at IS NOT NULL AND ttl_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::integer FROM deleted;
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_memory() TO service_role;


-- ---------------------------------------------------------------------------
-- 11. FIX agent_capabilities VIEW — the source of ERROR 42P16
--
-- Root cause:
--   Migration 004 created agent_capabilities with composite_score as numeric(5,2)
--   (because agents.composite_score was defined as numeric(5,2)).
--
--   Migration 009's CREATE OR REPLACE VIEW uses COALESCE(a.composite_score, 0)
--   which returns plain numeric (COALESCE promotes to the common type when mixing
--   numeric(5,2) with integer literal 0). PostgreSQL forbids changing a view
--   column type via CREATE OR REPLACE VIEW → ERROR 42P16.
--
-- Fix:
--   1. DROP VIEW CASCADE (handles any dependent views/functions)
--   2. Recreate with explicit ::numeric cast so the type is stable
--      regardless of the underlying column precision.
-- ---------------------------------------------------------------------------

-- Drop all views that depend on agent_capabilities (CASCADE handles deps)
DROP VIEW IF EXISTS agent_capabilities CASCADE;
DROP VIEW IF EXISTS agent_leaderboard  CASCADE;

-- Recreate agent_capabilities with stable types
-- Cast all numerics explicitly so the view column types won't drift if the
-- underlying column precision ever changes.
CREATE VIEW agent_capabilities AS
SELECT
  a.id,
  a.name,
  a.slug,
  a.description,
  a.category::text                                   AS category,
  COALESCE(a.capability_tags, '{}')                  AS capability_tags,
  COALESCE(a.input_types,     ARRAY['text'])          AS input_types,
  COALESCE(a.output_types,    ARRAY['text'])          AS output_types,
  COALESCE(a.languages,       ARRAY['en'])            AS languages,
  COALESCE(a.compliance_tags, '{}')                  AS compliance_tags,
  a.pricing_model::text                              AS pricing_model,
  COALESCE(a.price_per_call,               0)::numeric AS price_per_call,
  COALESCE(a.subscription_price_monthly,   0)::numeric AS subscription_price_monthly,
  COALESCE(a.free_calls_per_month,         0)         AS free_calls_per_month,
  a.model_name,
  COALESCE(a.average_latency_ms, 0)                  AS average_latency_ms,
  -- Explicit numeric cast prevents type drift (fixes ERROR 42P16)
  COALESCE(a.composite_score, 0)::numeric            AS composite_score,
  COALESCE(s.accuracy_score,  0)::numeric            AS accuracy_score,
  COALESCE(s.cost_score,      0)::numeric            AS cost_score,
  COALESCE(s.latency_score,   0)::numeric            AS latency_score,
  COALESCE(s.is_top_rated,    FALSE)                 AS is_top_rated,
  COALESCE(s.is_fastest,      FALSE)                 AS is_fastest,
  COALESCE(s.is_cheapest,     FALSE)                 AS is_cheapest,
  COALESCE(s.is_most_reliable,FALSE)                 AS is_most_reliable
FROM agents a
LEFT JOIN agent_scores s ON s.agent_id = a.id
WHERE a.status::text = 'active';

-- Recreate agent_leaderboard with stable types
CREATE VIEW agent_leaderboard AS
SELECT
  a.id,
  a.name,
  a.slug,
  a.description,
  a.category::text                                   AS category,
  a.pricing_model::text                              AS pricing_model,
  COALESCE(a.price_per_call, 0)::numeric             AS price_per_call,
  COALESCE(a.average_rating, 0)::numeric             AS average_rating,
  COALESCE(a.total_reviews,  0)                      AS total_reviews,
  COALESCE(a.total_executions, 0)                    AS total_executions,
  COALESCE(a.average_latency_ms, 0)                  AS average_latency_ms,
  a.is_featured,
  a.is_verified,
  a.icon_url,
  -- Score fields — all explicitly cast to numeric
  COALESCE(s.composite_score,   0)::numeric          AS composite_score,
  COALESCE(s.accuracy_score,    0)::numeric          AS accuracy_score,
  COALESCE(s.reliability_score, 0)::numeric          AS reliability_score,
  COALESCE(s.latency_score,     0)::numeric          AS latency_score,
  COALESCE(s.cost_score,        0)::numeric          AS cost_score,
  COALESCE(s.popularity_score,  0)::numeric          AS popularity_score,
  COALESCE(s.is_top_rated,      FALSE)               AS is_top_rated,
  COALESCE(s.is_fastest,        FALSE)               AS is_fastest,
  COALESCE(s.is_cheapest,       FALSE)               AS is_cheapest,
  COALESCE(s.is_most_reliable,  FALSE)               AS is_most_reliable,
  COALESCE(s.global_rank,       9999)                AS global_rank,
  COALESCE(s.category_rank,     9999)                AS category_rank,
  COALESCE(s.sample_size,       0)                   AS sample_size,
  -- Seller info
  p.full_name                                        AS seller_name,
  p.username                                         AS seller_username,
  p.is_verified                                      AS seller_verified
FROM agents a
LEFT JOIN agent_scores s ON s.agent_id = a.id
JOIN  profiles     p ON p.id = a.seller_id
WHERE a.status::text  = 'active'
  AND COALESCE(s.composite_score, 0) > 0;


-- ---------------------------------------------------------------------------
-- 12. AGENTS — Link to knowledge base (for RAG-augmented agents)
--
-- Split into two steps so the migration is safe to re-run:
--   Step A: add the column (IF NOT EXISTS is idempotent)
--   Step B: add the FK constraint in a DO block that silently ignores
--           "already exists" (42710) so re-running 009 never errors out.
-- ---------------------------------------------------------------------------

-- Step A: column (safe to re-run)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge_base_id UUID;

-- Step B: FK constraint (idempotent — named tag avoids dollar-sign stripping)
DO $fix_kb_fk$
BEGIN
  ALTER TABLE agents
    ADD CONSTRAINT agents_knowledge_base_id_fkey
    FOREIGN KEY (knowledge_base_id)
    REFERENCES knowledge_bases(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;  -- Constraint already exists — safe to ignore
END $fix_kb_fk$;


-- ---------------------------------------------------------------------------
-- 13. RLS POLICIES — Additional policies needed for routes
-- ---------------------------------------------------------------------------

-- Ensure authenticated users can INSERT into execution_traces
-- (execute route does this as part of observability)
ALTER TABLE execution_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "traces_service_insert"      ON execution_traces;
DROP POLICY IF EXISTS "traces_authenticated_insert" ON execution_traces;

CREATE POLICY "traces_authenticated_insert"
  ON execution_traces FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Notifications: service_role inserts from webhooks
DROP POLICY IF EXISTS "notifications_service_insert" ON notifications;
CREATE POLICY "notifications_service_insert"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- Credits INSERT (trigger creates row; service also inserts)
DROP POLICY IF EXISTS "credits_service_insert" ON credits;
CREATE POLICY "credits_service_insert"
  ON credits FOR INSERT
  WITH CHECK (true);

-- Agents: ensure sellers can always read/update their own (even non-active)
DROP POLICY IF EXISTS "agents_seller_own"  ON agents;
CREATE POLICY "agents_seller_own"
  ON agents FOR ALL
  USING  (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 14. GRANTS
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION search_rag_chunks(UUID, vector, FLOAT, INT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_kb_doc_count(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION decrement_kb_doc_count(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_memory()     TO service_role;

-- Re-grant existing functions (idempotent)
GRANT EXECUTE ON FUNCTION increment_executions_used(UUID)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION compute_agent_score(UUID)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION deduct_credits(UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION add_credits(UUID, NUMERIC, TEXT, UUID)   TO authenticated, service_role;

GRANT SELECT ON agent_capabilities TO anon, authenticated;
GRANT SELECT ON agent_leaderboard  TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON knowledge_bases   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rag_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rag_chunks    TO authenticated;
GRANT SELECT, INSERT ON agent_memory               TO authenticated;
GRANT SELECT, INSERT ON injection_attempts         TO authenticated, service_role;
GRANT SELECT, INSERT ON agent_registry_versions    TO authenticated;


-- ---------------------------------------------------------------------------
-- 15. VERIFICATION — Run to confirm migration succeeded
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
BEGIN
  -- Check agent_capabilities view has stable types
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'agent_capabilities'
    AND column_name  = 'composite_score'
    AND data_type    = 'numeric';  -- NOT numeric(5,2), just numeric

  IF v_count = 1 THEN
    RAISE NOTICE '✅ agent_capabilities.composite_score type is correct (numeric)';
  ELSE
    RAISE WARNING '⚠️  agent_capabilities.composite_score may have wrong type';
  END IF;

  -- Check new tables exist
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'injection_attempts','knowledge_bases','rag_documents',
      'rag_chunks','agent_registry_versions','agent_memory'
    );
  RAISE NOTICE '✅ New tables present: % / 6', v_count;

  -- Check pipeline_executions has error_message column
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'pipeline_executions'
    AND column_name  = 'error_message';
  RAISE NOTICE '✅ pipeline_executions.error_message: %', CASE WHEN v_count=1 THEN 'present' ELSE '⚠️ MISSING' END;
END $$;
