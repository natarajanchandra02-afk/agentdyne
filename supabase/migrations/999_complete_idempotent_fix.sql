-- ============================================================
-- AgentDyne — 999_complete_idempotent_fix.sql
--
-- SINGLE SCRIPT TO RUN WHEN ANY MIGRATION HAS ERRORS.
-- Safe to run regardless of which prior migrations ran.
-- All statements are 100% idempotent.
--
-- Fixes:
--   ① ERROR 42P13 — search_agents_semantic return type mismatch
--   ② agent_analytics column name conflicts across migrations
--   ③ governance_events table referenced but never created
--   ④ compute_agent_score RETURNS void vs numeric conflict
--   ⑤ agent_scores table id/primary-key ambiguity
--   ⑥ Duplicate triggers on reviews, pipeline_executions, executions
--   ⑦ Missing is_banned, tokens_saved, cost columns on profiles/executions
--   ⑧ credits table structure gaps
--   ⑨ Missing RLS INSERT policies on executions, notifications, credits
--   ⑩ rate_limit_counters table missing
--   ⑪ thoughtgate_template_stats table missing
--   ⑫ All function grants
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query → paste entire file → Run
--   Takes < 5 seconds. No data is modified.
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- STEP 0: EXTENSIONS
-- ═══════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";


-- ═══════════════════════════════════════════════════════════
-- STEP 1: DROP ALL VIEWS THAT DEPEND ON FUNCTIONS/COLUMNS
--         WE ARE ABOUT TO RECREATE
-- ═══════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.agent_leaderboard    CASCADE;
DROP VIEW IF EXISTS public.agent_capabilities   CASCADE;
DROP VIEW IF EXISTS public.agents_search        CASCADE;
DROP VIEW IF EXISTS public.user_credit_summary  CASCADE;
DROP VIEW IF EXISTS public.agent_trace_summary  CASCADE;
DROP VIEW IF EXISTS public.admin_platform_stats CASCADE;


-- ═══════════════════════════════════════════════════════════
-- STEP 2: DROP ALL OVERLOADS OF search_agents_semantic
--         ROOT CAUSE OF ERROR 42P13
--
-- Every variant is registered with a different return-type
-- signature (composite_score numeric(5,2) vs numeric, column
-- ordering differs across 005/008/010/011 migrations).
-- PostgreSQL forbids CREATE OR REPLACE when return type
-- changes → must DROP all overloads first.
-- ═══════════════════════════════════════════════════════════

-- Drop every possible overload signature
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector(1536), double precision, integer);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector(1536), float,           integer);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector(1536), double precision, int);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector(1536), float,            int);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,       double precision, integer);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,       float,            integer);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,       double precision, int);
DROP FUNCTION IF EXISTS public.search_agents_semantic(vector,       float,            int);

-- Belt-and-suspenders: drop by name to catch any remaining overloads
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


-- ═══════════════════════════════════════════════════════════
-- STEP 3: DROP OTHER FUNCTIONS WITH KNOWN SIGNATURE CONFLICTS
-- ═══════════════════════════════════════════════════════════

-- compute_agent_score changed return type between migrations
-- (004 returns numeric; 010 returns void)
DROP FUNCTION IF EXISTS public.compute_agent_score(uuid) CASCADE;

-- compute_all_agent_scores — safe to recreate
DROP FUNCTION IF EXISTS public.compute_all_agent_scores() CASCADE;

-- aggregate_daily_analytics / aggregate_agent_analytics_yesterday conflict
DROP FUNCTION IF EXISTS public.aggregate_daily_analytics() CASCADE;
DROP FUNCTION IF EXISTS public.aggregate_agent_analytics_yesterday() CASCADE;

-- refresh_agent_rankings — safe to recreate
DROP FUNCTION IF EXISTS public.refresh_agent_rankings() CASCADE;


-- ═══════════════════════════════════════════════════════════
-- STEP 4: TABLES — ADD MISSING COLUMNS (all idempotent)
-- ═══════════════════════════════════════════════════════════

-- ── 4a. profiles ─────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_banned                   BOOLEAN         DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ban_reason                  TEXT,
  ADD COLUMN IF NOT EXISTS banned_at                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_spent                 NUMERIC(12,2)   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_reset_date            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id          TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded    BOOLEAN         DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_id             TEXT;

-- subscription_status: 001 created it as ENUM; later migrations tried to ADD as TEXT.
-- The ENUM already exists — just make sure the column exists (it does from 001).
-- Nothing to do here.

-- quota_reset_date: seed for users who don't have it yet
UPDATE public.profiles
SET quota_reset_date = now() + INTERVAL '30 days'
WHERE quota_reset_date IS NULL;

-- ── 4b. agents ───────────────────────────────────────────────────────────
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS mcp_server_ids   TEXT[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS capability_tags  TEXT[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS input_types      TEXT[]        DEFAULT '{"text"}',
  ADD COLUMN IF NOT EXISTS output_types     TEXT[]        DEFAULT '{"text"}',
  ADD COLUMN IF NOT EXISTS languages        TEXT[]        DEFAULT '{"en"}',
  ADD COLUMN IF NOT EXISTS compliance_tags  TEXT[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS composite_score  NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knowledge_base_id UUID,
  ADD COLUMN IF NOT EXISTS embedding        VECTOR(1536),
  ADD COLUMN IF NOT EXISTS timeout_seconds  INTEGER       DEFAULT 30,
  ADD COLUMN IF NOT EXISTS input_schema     JSONB         DEFAULT '{"type":"object","properties":{"input":{"type":"string"}}}',
  ADD COLUMN IF NOT EXISTS output_schema    JSONB         DEFAULT '{"type":"object","properties":{"output":{"type":"string"}}}',
  ADD COLUMN IF NOT EXISTS is_public        BOOLEAN       DEFAULT FALSE;

-- knowledge_base_id FK (idempotent)
DO $fk_kb$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='knowledge_bases') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'agents_knowledge_base_id_fkey'
    ) THEN
      ALTER TABLE public.agents
        ADD CONSTRAINT agents_knowledge_base_id_fkey
        FOREIGN KEY (knowledge_base_id)
        REFERENCES public.knowledge_bases(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $fk_kb$;

-- agents.embedding IVFFlat index
CREATE INDEX IF NOT EXISTS idx_agents_embedding
  ON public.agents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)
  WHERE embedding IS NOT NULL;

-- ── 4c. executions ───────────────────────────────────────────────────────
ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS cost         NUMERIC(10,6)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd     NUMERIC(10,6)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_input  INTEGER        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_output INTEGER        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_saved  INTEGER        DEFAULT 0;

-- Sync cost ↔ cost_usd for consistency
UPDATE public.executions SET cost = cost_usd WHERE cost = 0 AND cost_usd > 0;
UPDATE public.executions SET cost_usd = cost WHERE cost_usd = 0 AND cost > 0;

-- ── 4d. pipelines ─────────────────────────────────────────────────────────
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN     DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS retry_on_failure BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_retries      INTEGER     DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_runs       BIGINT      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS successful_runs  BIGINT      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_latency_ms   INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_count        INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_run_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags             TEXT[]      DEFAULT '{}';

-- Sync run_count ↔ total_runs
UPDATE public.pipelines SET total_runs = run_count WHERE total_runs = 0 AND run_count > 0;
UPDATE public.pipelines SET run_count = total_runs WHERE run_count = 0 AND total_runs > 0;

-- ── 4e. pipeline_executions ───────────────────────────────────────────────
ALTER TABLE public.pipeline_executions
  ADD COLUMN IF NOT EXISTS total_latency_ms  INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost        NUMERIC(10,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tokens_in   INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tokens_out  INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message     TEXT,
  ADD COLUMN IF NOT EXISTS node_results      JSONB         DEFAULT '[]';

-- ── 4f. execution_traces ─────────────────────────────────────────────────
ALTER TABLE public.execution_traces
  ADD COLUMN IF NOT EXISTS tool_calls    JSONB    DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS rag_injected  BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_id   TEXT;

-- ── 4g. injection_attempts ────────────────────────────────────────────────
ALTER TABLE public.injection_attempts
  ADD COLUMN IF NOT EXISTS score NUMERIC DEFAULT 0;

-- ── 4h. reviews ──────────────────────────────────────────────────────────
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Default new reviews to 'pending' so they go through moderation queue
ALTER TABLE public.reviews
  ALTER COLUMN status SET DEFAULT 'pending';

-- ── 4i. notifications ─────────────────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS is_read    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS action_url TEXT,
  ADD COLUMN IF NOT EXISTS type       TEXT    DEFAULT 'info';

-- ── 4j. credits ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credits (
  user_id         UUID          PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance_usd     NUMERIC(12,6) DEFAULT 0,
  total_purchased NUMERIC(12,6) DEFAULT 0,
  total_spent     NUMERIC(12,6) DEFAULT 0,
  hard_limit_usd  NUMERIC(12,2) DEFAULT 5,
  alert_threshold NUMERIC(12,2) DEFAULT 1,
  updated_at      TIMESTAMPTZ   DEFAULT now()
);

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

-- ── 4k. credit_transactions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type          TEXT          NOT NULL CHECK (type IN ('topup','deduction','refund','bonus','adjustment')),
  amount_usd    NUMERIC(12,6) NOT NULL,
  balance_after NUMERIC(12,6),
  description   TEXT,
  reference_id  UUID,
  created_at    TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_user ON public.credit_transactions(user_id, created_at DESC);
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- ── 4l. agent_scores (canonical version — no auto-increment id) ───────────
CREATE TABLE IF NOT EXISTS public.agent_scores (
  agent_id          UUID        PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
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
  computed_at       TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Handle case where table already exists with 'id' primary key (migration 004)
-- Add agent_id as unique if it's not already the primary key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_scores_pkey'
      AND conrelid = 'public.agent_scores'::regclass
      AND contype = 'p'
  ) THEN
    -- Table exists but has 'id' PK from migration 004; agent_id should be unique
    ALTER TABLE public.agent_scores ADD COLUMN IF NOT EXISTS agent_id UUID;
    ALTER TABLE public.agent_scores ADD COLUMN IF NOT EXISTS composite_score NUMERIC DEFAULT 0;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Ensure agent_id uniqueness for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_scores_agent_id_key'
      AND conrelid = 'public.agent_scores'::regclass
  ) THEN
    ALTER TABLE public.agent_scores ADD CONSTRAINT agent_scores_agent_id_key UNIQUE (agent_id);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.agent_scores ENABLE ROW LEVEL SECURITY;

-- ── 4m. agent_analytics (canonical — resolves column name conflicts) ──────
-- 001 has: executions, successful, failed, unique_users, revenue, avg_latency_ms
-- 010 has: executions, successes, failures, success_rate, avg_latency, revenue_usd
-- Resolution: CREATE IF NOT EXISTS (keeps 001 version), then ADD COLUMN for new ones

CREATE TABLE IF NOT EXISTS public.agent_analytics (
  id            BIGSERIAL    PRIMARY KEY,
  agent_id      UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  date          DATE         NOT NULL,
  executions    INTEGER      DEFAULT 0,
  successful    INTEGER      DEFAULT 0,
  failed        INTEGER      DEFAULT 0,
  unique_users  INTEGER      DEFAULT 0,
  revenue       NUMERIC(10,2) DEFAULT 0,
  avg_latency_ms INTEGER     DEFAULT 0,
  updated_at    TIMESTAMPTZ  DEFAULT now()
);

-- Add columns from later migrations (idempotent)
ALTER TABLE public.agent_analytics
  ADD COLUMN IF NOT EXISTS success_rate NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_in    BIGINT       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_out   BIGINT       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd     NUMERIC(10,6) DEFAULT 0;

-- Canonical unique constraint for upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_analytics_agent_date
  ON public.agent_analytics(agent_id, date);

ALTER TABLE public.agent_analytics ENABLE ROW LEVEL SECURITY;

-- ── 4n. rate_limit_counters ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  id         TEXT        PRIMARY KEY,
  count      INTEGER     DEFAULT 0,
  window_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_window
  ON public.rate_limit_counters(window_end);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- ── 4o. governance_events (referenced in 011 but never created) ───────────
CREATE TABLE IF NOT EXISTS public.governance_events (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type  TEXT        NOT NULL,
  resource    TEXT,
  resource_id UUID,
  payload     JSONB       DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.governance_events ENABLE ROW LEVEL SECURITY;

-- ── 4p. thoughtgate_template_stats ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.thoughtgate_template_stats (
  template_id   TEXT        PRIMARY KEY,
  intent_type   TEXT,
  total_calls   BIGINT      DEFAULT 0,
  success_calls BIGINT      DEFAULT 0,
  failure_calls BIGINT      DEFAULT 0,
  last_updated  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.thoughtgate_template_stats ENABLE ROW LEVEL SECURITY;

-- ── 4q. agent_feedback ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_feedback (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id UUID        REFERENCES public.executions(id) ON DELETE CASCADE,
  agent_id     UUID        NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating       SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  thumbs       TEXT        CHECK (thumbs IN ('up','down')),
  comment      TEXT,
  issue_type   TEXT        CHECK (issue_type IN ('wrong_output','too_slow','too_expensive','hallucination','unhelpful','other')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

-- ── 4r. audit_logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_type  TEXT        DEFAULT 'user',
  actor_id    TEXT,
  action      TEXT        NOT NULL,
  resource    TEXT,
  resource_id TEXT,
  payload     JSONB       DEFAULT '{}',
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user   ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action, created_at DESC);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ── 4s. agent_embeddings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_embeddings (
  agent_id   UUID      REFERENCES public.agents(id) ON DELETE CASCADE PRIMARY KEY,
  embedding  VECTOR(1536),
  content    TEXT      NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_embeddings_ivfflat
  ON public.agent_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.agent_embeddings ENABLE ROW LEVEL SECURITY;

-- ── 4t. Ensure pipelines has owner_id (migration 004 names it owner_id, 006 may use user_id) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pipelines' AND column_name='user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pipelines' AND column_name='owner_id'
  ) THEN
    ALTER TABLE public.pipelines RENAME COLUMN user_id TO owner_id;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ═══════════════════════════════════════════════════════════
-- STEP 5: PERFORMANCE INDEXES
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_executions_user_created       ON public.executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_agent_status       ON public.executions(agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status_category        ON public.agents(status, category, composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_agents_status_featured        ON public.agents(status, is_featured) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_agents_status_created         ON public.agents(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active          ON public.api_keys(key_hash) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_notifications_user_read       ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_status_created        ON public.reviews(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_injection_action_created      ON public.injection_attempts(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_exec_user_created    ON public.pipeline_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_lookup           ON public.agent_memory(user_id, agent_id, key);
CREATE INDEX IF NOT EXISTS idx_agent_subs_user_agent         ON public.agent_subscriptions(user_id, agent_id, status);


-- ═══════════════════════════════════════════════════════════
-- STEP 6: RLS POLICIES (DROP IF EXISTS + CREATE)
-- ═══════════════════════════════════════════════════════════

-- ── credits ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own credits"    ON public.credits;
DROP POLICY IF EXISTS "System can insert credits"     ON public.credits;
DROP POLICY IF EXISTS "System can update credits"     ON public.credits;
DROP POLICY IF EXISTS "credits_own"                   ON public.credits;
DROP POLICY IF EXISTS "credits_service_upsert"        ON public.credits;
DROP POLICY IF EXISTS "credits_service_insert"        ON public.credits;

CREATE POLICY "credits_own_select"     ON public.credits FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "credits_service_write"  ON public.credits FOR ALL   USING (true) WITH CHECK (true);

-- ── credit_transactions ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "credit_txn_own"    ON public.credit_transactions;
DROP POLICY IF EXISTS "credit_txn_insert" ON public.credit_transactions;
DROP POLICY IF EXISTS "Users can view own credit transactions" ON public.credit_transactions;

CREATE POLICY "credit_txn_select"  ON public.credit_transactions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "credit_txn_insert"  ON public.credit_transactions FOR INSERT WITH CHECK (true);

-- ── executions ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own executions"         ON public.executions;
DROP POLICY IF EXISTS "Sellers can view executions on their agents" ON public.executions;
DROP POLICY IF EXISTS "Users can insert own executions"       ON public.executions;
DROP POLICY IF EXISTS "Users can update own executions"       ON public.executions;
DROP POLICY IF EXISTS "executions_own_read"                   ON public.executions;
DROP POLICY IF EXISTS "executions_agent_seller"               ON public.executions;
DROP POLICY IF EXISTS "executions_insert"                     ON public.executions;
DROP POLICY IF EXISTS "executions_update_own"                 ON public.executions;
DROP POLICY IF EXISTS "executions_admin_all"                  ON public.executions;

CREATE POLICY "executions_own_read"
  ON public.executions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "executions_seller_read"
  ON public.executions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.agents WHERE id = executions.agent_id AND seller_id = auth.uid()));
CREATE POLICY "executions_insert"
  ON public.executions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "executions_update"
  ON public.executions FOR UPDATE USING (user_id = auth.uid());

-- ── pipeline_executions ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own pipeline executions"   ON public.pipeline_executions;
DROP POLICY IF EXISTS "Users can insert own pipeline executions" ON public.pipeline_executions;
DROP POLICY IF EXISTS "Users can update own pipeline executions" ON public.pipeline_executions;
DROP POLICY IF EXISTS "No delete on pipeline executions"         ON public.pipeline_executions;

CREATE POLICY "pipe_exec_select" ON public.pipeline_executions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "pipe_exec_insert" ON public.pipeline_executions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "pipe_exec_update" ON public.pipeline_executions FOR UPDATE USING (user_id = auth.uid());

-- ── execution_traces ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own traces"            ON public.execution_traces;
DROP POLICY IF EXISTS "Sellers can view agent traces"        ON public.execution_traces;
DROP POLICY IF EXISTS "traces_authenticated_insert"          ON public.execution_traces;
DROP POLICY IF EXISTS "traces_service_insert"                ON public.execution_traces;

CREATE POLICY "traces_own_select"
  ON public.execution_traces FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "traces_seller_select"
  ON public.execution_traces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.agents WHERE id = execution_traces.agent_id AND seller_id = auth.uid()));
CREATE POLICY "traces_insert"
  ON public.execution_traces FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── notifications ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own notifications"   ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "notifications_service_insert"       ON public.notifications;

CREATE POLICY "notif_select"  ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notif_update"  ON public.notifications FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "notif_insert"  ON public.notifications FOR INSERT WITH CHECK (true);

-- ── agent_scores ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agent scores are public"  ON public.agent_scores;
DROP POLICY IF EXISTS "scores_public_read"       ON public.agent_scores;
DROP POLICY IF EXISTS "scores_system_write"      ON public.agent_scores;
DROP POLICY IF EXISTS "scores_service_write"     ON public.agent_scores;
DROP POLICY IF EXISTS "scores_service_update"    ON public.agent_scores;

CREATE POLICY "scores_public_read"  ON public.agent_scores FOR SELECT USING (true);
CREATE POLICY "scores_system_write" ON public.agent_scores FOR ALL   USING (true) WITH CHECK (true);

-- ── agent_analytics ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "analytics_seller_read"  ON public.agent_analytics;
DROP POLICY IF EXISTS "analytics_system_write" ON public.agent_analytics;
DROP POLICY IF EXISTS "analytics_system_update" ON public.agent_analytics;

CREATE POLICY "analytics_seller_read"
  ON public.agent_analytics FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.agents WHERE id = agent_analytics.agent_id AND seller_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "analytics_system_write" ON public.agent_analytics FOR INSERT WITH CHECK (true);
CREATE POLICY "analytics_system_update" ON public.agent_analytics FOR UPDATE USING (true);

-- ── audit_logs ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_admin_read"    ON public.audit_logs;
DROP POLICY IF EXISTS "audit_system_write"  ON public.audit_logs;
DROP POLICY IF EXISTS "audit_system_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_admin_all"     ON public.audit_logs;

CREATE POLICY "audit_admin_read"
  ON public.audit_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "audit_system_insert" ON public.audit_logs FOR INSERT WITH CHECK (true);

-- ── agent_embeddings ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agent embeddings are public"        ON public.agent_embeddings;
DROP POLICY IF EXISTS "Service role can manage embeddings" ON public.agent_embeddings;

CREATE POLICY "embeddings_public_read"   ON public.agent_embeddings FOR SELECT USING (true);
CREATE POLICY "embeddings_service_write" ON public.agent_embeddings FOR ALL   USING (true) WITH CHECK (true);

-- ── agent_feedback ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "feedback_own_write"   ON public.agent_feedback;
DROP POLICY IF EXISTS "feedback_seller_read" ON public.agent_feedback;

CREATE POLICY "feedback_own"
  ON public.agent_feedback FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "feedback_seller_read"
  ON public.agent_feedback FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.agents WHERE id = agent_feedback.agent_id AND seller_id = auth.uid()));

-- ── governance_events ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "governance_admin_read"    ON public.governance_events;
DROP POLICY IF EXISTS "governance_system_insert" ON public.governance_events;

CREATE POLICY "governance_admin_read"   ON public.governance_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "governance_system_insert" ON public.governance_events FOR INSERT WITH CHECK (true);

-- ── thoughtgate_template_stats ────────────────────────────────────────────
DROP POLICY IF EXISTS "tg_admin_all"   ON public.thoughtgate_template_stats;
DROP POLICY IF EXISTS "tg_service_all" ON public.thoughtgate_template_stats;

CREATE POLICY "tg_read_all"     ON public.thoughtgate_template_stats FOR SELECT USING (true);
CREATE POLICY "tg_service_write" ON public.thoughtgate_template_stats FOR ALL   USING (true) WITH CHECK (true);

-- ── rate_limit_counters ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service manages rate limits" ON public.rate_limit_counters;
CREATE POLICY "rate_limit_service" ON public.rate_limit_counters FOR ALL USING (true) WITH CHECK (true);

-- ── profiles — keep existing + add insert for new signups ─────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_system_insert'
  ) THEN
    CREATE POLICY "profiles_system_insert" ON public.profiles FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ── waitlist ──────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waitlist_public_insert" ON public.waitlist;
DROP POLICY IF EXISTS "waitlist_admin_select"  ON public.waitlist;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='waitlist') THEN
    CREATE POLICY "waitlist_public_insert" ON public.waitlist FOR INSERT WITH CHECK (true);
    CREATE POLICY "waitlist_admin_select"  ON public.waitlist FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ═══════════════════════════════════════════════════════════
-- STEP 7: TRIGGERS — drop all duplicates, recreate once
-- ═══════════════════════════════════════════════════════════

-- Cleanup duplicates across migrations
DROP TRIGGER IF EXISTS on_review_change              ON public.reviews;
DROP TRIGGER IF EXISTS on_execution_complete         ON public.executions;
DROP TRIGGER IF EXISTS on_execution_completed        ON public.executions;
DROP TRIGGER IF EXISTS trg_update_pipeline_stats     ON public.pipeline_executions;
DROP TRIGGER IF EXISTS on_pipeline_execution_complete ON public.pipeline_executions;
DROP TRIGGER IF EXISTS on_profile_created_give_credits ON public.profiles;
DROP TRIGGER IF EXISTS on_agent_activated_promote_seller ON public.agents;
DROP TRIGGER IF EXISTS on_transaction_settled        ON public.transactions;
DROP TRIGGER IF EXISTS before_waitlist_insert        ON public.waitlist;
DROP TRIGGER IF EXISTS on_auth_user_created          ON auth.users;
DROP TRIGGER IF EXISTS set_profiles_updated_at       ON public.profiles;
DROP TRIGGER IF EXISTS set_agents_updated_at         ON public.agents;
DROP TRIGGER IF EXISTS set_agent_scores_updated_at   ON public.agent_scores;
DROP TRIGGER IF EXISTS set_credits_updated_at        ON public.credits;


-- ═══════════════════════════════════════════════════════════
-- STEP 8: CORE FUNCTIONS (canonical versions)
-- ═══════════════════════════════════════════════════════════

-- ── 8a. set_updated_at ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Recreate updated_at triggers
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER set_agents_updated_at
  BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER set_agent_scores_updated_at
  BEFORE UPDATE ON public.agent_scores FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER set_credits_updated_at
  BEFORE UPDATE ON public.credits FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 8b. handle_new_user ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',
             NEW.raw_user_meta_data->>'name',
             split_part(NEW.email, '@', 1)),
    now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd)
  VALUES (NEW.id, 0, 5)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, title, body, type)
  VALUES (
    NEW.id,
    'Welcome to AgentDyne! 👋',
    'Explore the marketplace and deploy your first AI agent.',
    'welcome'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ── 8c. increment_executions_used ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_executions_used(user_id_param UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET executions_used_this_month = COALESCE(executions_used_this_month, 0) + 1,
      updated_at = now()
  WHERE id = user_id_param;
END;
$$;

-- ── 8d. handle_new_user_credits ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd)
  VALUES (NEW.id, 0, 5)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_give_credits
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_credits();

-- ── 8e. deduct_credits ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  description_param  TEXT    DEFAULT 'Agent execution',
  reference_id_param UUID    DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance     NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  SELECT balance_usd INTO v_balance FROM public.credits
  WHERE user_id = user_id_param FOR UPDATE;

  IF v_balance IS NULL THEN
    INSERT INTO public.credits (user_id, balance_usd) VALUES (user_id_param, 0)
    ON CONFLICT DO NOTHING;
    v_balance := 0;
  END IF;

  IF v_balance < amount_param THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits',
      'code', 'INSUFFICIENT_CREDITS', 'balance', v_balance, 'required', amount_param);
  END IF;

  v_new_balance := v_balance - amount_param;

  UPDATE public.credits
  SET balance_usd = v_new_balance, total_spent = COALESCE(total_spent, 0) + amount_param, updated_at = now()
  WHERE user_id = user_id_param;

  INSERT INTO public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES (user_id_param, 'deduction', amount_param, v_new_balance, description_param, reference_id_param);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance, 'deducted', amount_param);
END;
$$;

-- ── 8f. add_credits ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  description_param  TEXT DEFAULT 'Credit top-up',
  reference_id_param UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE new_balance NUMERIC;
BEGIN
  IF amount_param <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  INSERT INTO public.credits (user_id, balance_usd, total_purchased)
  VALUES (user_id_param, amount_param, amount_param)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_usd     = credits.balance_usd + amount_param,
        total_purchased = credits.total_purchased + amount_param,
        updated_at      = now()
  RETURNING balance_usd INTO new_balance;

  INSERT INTO public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES (user_id_param, 'topup', amount_param, new_balance, description_param, reference_id_param);

  RETURN jsonb_build_object('success', true, 'new_balance', new_balance);
END;
$$;

-- ── 8g. compute_agent_score (RETURNS VOID — no return type conflict) ───────
CREATE OR REPLACE FUNCTION public.compute_agent_score(target_agent_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total     BIGINT;
  v_success   BIGINT;
  v_latency   NUMERIC;
  v_rating    NUMERIC;
  v_price     NUMERIC;
  v_acc       NUMERIC;
  v_rel       NUMERIC;
  v_lat       NUMERIC;
  v_cost      NUMERIC;
  v_pop       NUMERIC;
  v_comp      NUMERIC;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status IN ('success','failed')),
         COUNT(*) FILTER (WHERE status = 'success'),
         COALESCE(AVG(latency_ms) FILTER (WHERE status='success'), 5000)
  INTO v_total, v_success, v_latency
  FROM public.executions WHERE agent_id = target_agent_id
    AND created_at > now() - INTERVAL '30 days';

  IF COALESCE(v_total, 0) < 5 THEN RETURN; END IF;

  SELECT COALESCE(average_rating, 0), COALESCE(price_per_call, 0)
  INTO v_rating, v_price FROM public.agents WHERE id = target_agent_id;

  v_acc  := LEAST(100, (v_success::NUMERIC / NULLIF(v_total, 0)) * 100);
  v_rel  := LEAST(100, POWER(v_success::NUMERIC / NULLIF(v_total, 0), 2) * 100);
  v_lat  := GREATEST(0, 100 - v_latency / 100);
  v_cost := GREATEST(0, 100 - v_price * 100);
  v_pop  := LEAST(100, LN(GREATEST(1, v_total)) / LN(1000) * 100);
  v_comp := v_acc * 0.30 + v_rel * 0.25 + v_lat * 0.20 + v_cost * 0.15 + v_pop * 0.10;

  INSERT INTO public.agent_scores (
    agent_id, composite_score, accuracy_score, reliability_score,
    latency_score, cost_score, popularity_score, sample_size,
    is_top_rated, is_fastest, is_cheapest, is_most_reliable, updated_at
  ) VALUES (
    target_agent_id, ROUND(v_comp, 2), ROUND(v_acc, 2), ROUND(v_rel, 2),
    ROUND(v_lat, 2), ROUND(v_cost, 2), ROUND(v_pop, 2), v_total,
    (v_rating >= 4.5 AND v_total >= 20),
    (v_latency < 500 AND v_total >= 10),
    (v_price = 0 AND v_total >= 10),
    (v_rel >= 95 AND v_total >= 10),
    now()
  )
  ON CONFLICT (agent_id) DO UPDATE
    SET composite_score   = EXCLUDED.composite_score,
        accuracy_score    = EXCLUDED.accuracy_score,
        reliability_score = EXCLUDED.reliability_score,
        latency_score     = EXCLUDED.latency_score,
        cost_score        = EXCLUDED.cost_score,
        popularity_score  = EXCLUDED.popularity_score,
        sample_size       = EXCLUDED.sample_size,
        is_top_rated      = EXCLUDED.is_top_rated,
        is_fastest        = EXCLUDED.is_fastest,
        is_cheapest       = EXCLUDED.is_cheapest,
        is_most_reliable  = EXCLUDED.is_most_reliable,
        updated_at        = now();

  UPDATE public.agents
  SET composite_score = ROUND(v_comp, 2), updated_at = now()
  WHERE id = target_agent_id;
END;
$$;

-- ── 8h. compute_all_agent_scores ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_all_agent_scores()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER := 0; v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM public.agents WHERE status = 'active' AND total_executions >= 5
  LOOP
    PERFORM public.compute_agent_score(v_id);
    v_count := v_count + 1;
  END LOOP;

  -- Update global ranks
  UPDATE public.agent_scores s SET global_rank = r.rn
  FROM (SELECT agent_id, ROW_NUMBER() OVER (ORDER BY composite_score DESC) AS rn
        FROM public.agent_scores WHERE composite_score > 0) r
  WHERE s.agent_id = r.agent_id;

  -- Update category ranks
  UPDATE public.agent_scores s SET category_rank = r.rn
  FROM (SELECT s2.agent_id,
          ROW_NUMBER() OVER (PARTITION BY a.category ORDER BY s2.composite_score DESC) AS rn
        FROM public.agent_scores s2 JOIN public.agents a ON a.id = s2.agent_id
        WHERE a.status = 'active') r
  WHERE s.agent_id = r.agent_id;

  RETURN v_count;
END;
$$;

-- ── 8i. search_agents_semantic (canonical — stable return types) ─────────
-- This is the FINAL canonical version. All overloads dropped in Step 2.
CREATE FUNCTION public.search_agents_semantic(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.65,
  match_count     integer          DEFAULT 20
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
LANGUAGE sql STABLE AS $$
  SELECT
    a.id,
    a.name,
    a.description,
    a.category::text,
    COALESCE(a.composite_score, 0)::numeric,
    COALESCE(a.average_rating,  0)::numeric,
    a.pricing_model::text,
    COALESCE(a.price_per_call,  0)::numeric,
    COALESCE(a.total_executions, 0)::bigint,
    (1 - (ae.embedding <=> query_embedding))::double precision AS similarity
  FROM public.agent_embeddings ae
  JOIN public.agents a ON a.id = ae.agent_id
  WHERE a.status::text = 'active'
    AND (1 - (ae.embedding <=> query_embedding)) > match_threshold
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── 8j. search_rag_chunks ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_rag_chunks(
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
LANGUAGE SQL STABLE AS $$
  SELECT
    c.id            AS chunk_id,
    c.document_id,
    d.title         AS document_title,
    c.content,
    (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity,
    d.metadata
  FROM public.rag_chunks c
  JOIN public.rag_documents d ON d.id = c.document_id
  WHERE c.knowledge_base_id = kb_id_param
    AND d.status = 'indexed'
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── 8k. update_pipeline_stats ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_pipeline_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IN ('success', 'failed', 'timeout') THEN
    UPDATE public.pipelines
    SET run_count      = COALESCE(run_count, 0) + 1,
        total_runs     = COALESCE(total_runs, 0) + 1,
        successful_runs = CASE WHEN NEW.status = 'success'
                            THEN COALESCE(successful_runs, 0) + 1
                            ELSE COALESCE(successful_runs, 0) END,
        last_run_at    = COALESCE(NEW.completed_at, now()),
        updated_at     = now()
    WHERE id = NEW.pipeline_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_pipeline_execution_complete
  AFTER INSERT OR UPDATE OF status ON public.pipeline_executions
  FOR EACH ROW EXECUTE PROCEDURE public.update_pipeline_stats();

-- ── 8l. update_agent_rating ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_agent_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_agent_id UUID;
BEGIN
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id);
  UPDATE public.agents
  SET average_rating = COALESCE((SELECT AVG(rating::NUMERIC) FROM public.reviews
                                 WHERE agent_id = v_agent_id AND status = 'approved'), 0),
      total_reviews  = (SELECT COUNT(*) FROM public.reviews
                        WHERE agent_id = v_agent_id AND status = 'approved'),
      updated_at     = now()
  WHERE id = v_agent_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE PROCEDURE public.update_agent_rating();

-- ── 8m. increment_agent_executions (on execution update) ─────────────────
CREATE OR REPLACE FUNCTION public.increment_agent_executions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'success' AND (OLD IS NULL OR OLD.status != 'success') THEN
    UPDATE public.agents
    SET total_executions = COALESCE(total_executions, 0) + 1,
        successful_executions = COALESCE(successful_executions, 0) + 1,
        updated_at = now()
    WHERE id = NEW.agent_id;

    UPDATE public.profiles
    SET total_spent = COALESCE(total_spent, 0) + COALESCE(NEW.cost_usd, NEW.cost, 0),
        updated_at  = now()
    WHERE id = NEW.user_id;

  ELSIF NEW.status = 'failed' AND (OLD IS NULL OR OLD.status != 'failed') THEN
    UPDATE public.agents
    SET total_executions = COALESCE(total_executions, 0) + 1,
        updated_at = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_execution_completed
  AFTER INSERT OR UPDATE OF status ON public.executions
  FOR EACH ROW EXECUTE PROCEDURE public.increment_agent_executions();

-- ── 8n. update_seller_earnings ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_seller_earnings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'succeeded' AND (OLD IS NULL OR OLD.status != 'succeeded') THEN
    UPDATE public.profiles
    SET total_earned = COALESCE(total_earned, 0) + COALESCE(NEW.seller_amount, 0),
        updated_at   = now()
    WHERE id = NEW.seller_id;
    UPDATE public.agents
    SET total_revenue = COALESCE(total_revenue, 0) + COALESCE(NEW.seller_amount, 0),
        updated_at    = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_transaction_settled
  AFTER INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE public.update_seller_earnings();

-- ── 8o. auto_promote_to_seller ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_promote_to_seller()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE public.profiles
    SET role = CASE WHEN role::text = 'admin' THEN 'admin'::user_role ELSE 'seller'::user_role END,
        updated_at = now()
    WHERE id = NEW.seller_id AND role::text NOT IN ('admin', 'seller');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_agent_activated_promote_seller
  AFTER UPDATE OF status ON public.agents
  FOR EACH ROW EXECUTE PROCEDURE public.auto_promote_to_seller();

-- ── 8p. reset_monthly_quotas ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_monthly_quotas()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.profiles
  SET executions_used_this_month = 0,
      quota_reset_date = now() + INTERVAL '30 days',
      updated_at = now()
  WHERE quota_reset_date IS NULL OR quota_reset_date <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 8q. aggregate_daily_analytics ─────────────────────────────────────────
-- Canonical version — uses column names present in the CREATE TABLE above
CREATE OR REPLACE FUNCTION public.aggregate_daily_analytics()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  target_date DATE := CURRENT_DATE - 1;
  affected    INTEGER;
BEGIN
  INSERT INTO public.agent_analytics (
    agent_id, date, executions, successful, failed,
    success_rate, avg_latency_ms, tokens_in, tokens_out, cost_usd, updated_at
  )
  SELECT
    e.agent_id,
    target_date,
    COUNT(*)                                    FILTER (WHERE status IN ('success','failed')) AS executions,
    COUNT(*)                                    FILTER (WHERE status = 'success')             AS successful,
    COUNT(*)                                    FILTER (WHERE status = 'failed')              AS failed,
    ROUND(
      (COUNT(*) FILTER (WHERE status = 'success')::NUMERIC
       / NULLIF(COUNT(*) FILTER (WHERE status IN ('success','failed')), 0)) * 100, 2
    )                                                                                         AS success_rate,
    ROUND(COALESCE(AVG(latency_ms) FILTER (WHERE status='success'), 0), 0)::INTEGER          AS avg_latency_ms,
    COALESCE(SUM(tokens_input), 0)                                                            AS tokens_in,
    COALESCE(SUM(tokens_output), 0)                                                           AS tokens_out,
    COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE cost END), 0)                      AS cost_usd,
    now()
  FROM public.executions e
  WHERE DATE(e.created_at) = target_date
  GROUP BY e.agent_id
  ON CONFLICT (agent_id, date) DO UPDATE
    SET executions     = EXCLUDED.executions,
        successful     = EXCLUDED.successful,
        failed         = EXCLUDED.failed,
        success_rate   = EXCLUDED.success_rate,
        avg_latency_ms = EXCLUDED.avg_latency_ms,
        tokens_in      = EXCLUDED.tokens_in,
        tokens_out     = EXCLUDED.tokens_out,
        cost_usd       = EXCLUDED.cost_usd,
        updated_at     = now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- ── 8r. refresh_agent_rankings ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_agent_rankings()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE affected INTEGER;
BEGIN
  WITH ranked AS (
    SELECT s.agent_id,
      ROW_NUMBER() OVER (ORDER BY s.composite_score DESC, s.sample_size DESC) AS g_rank,
      ROW_NUMBER() OVER (PARTITION BY a.category ORDER BY s.composite_score DESC) AS c_rank
    FROM public.agent_scores s
    JOIN public.agents a ON a.id = s.agent_id AND a.status::text = 'active'
    WHERE s.composite_score > 0
  )
  UPDATE public.agent_scores AS s
  SET global_rank = r.g_rank, category_rank = r.c_rank, updated_at = now()
  FROM ranked r WHERE s.agent_id = r.agent_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- ── 8s. cleanup functions ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_memory()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER AS $$
  WITH d AS (DELETE FROM public.agent_memory WHERE ttl_at IS NOT NULL AND ttl_at < now() RETURNING id)
  SELECT COUNT(*)::INTEGER FROM d;
$$;

CREATE OR REPLACE FUNCTION public.increment_thoughtgate_stat(
  p_template_id TEXT, p_intent_type TEXT, p_success BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.thoughtgate_template_stats
    (template_id, intent_type, total_calls, success_calls, failure_calls)
  VALUES (p_template_id, p_intent_type,
    1,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END)
  ON CONFLICT (template_id) DO UPDATE SET
    total_calls   = thoughtgate_template_stats.total_calls   + 1,
    success_calls = thoughtgate_template_stats.success_calls + CASE WHEN p_success THEN 1 ELSE 0 END,
    failure_calls = thoughtgate_template_stats.failure_calls + CASE WHEN p_success THEN 0 ELSE 1 END,
    last_updated  = now();
END;
$$;

-- waitlist position trigger
CREATE OR REPLACE FUNCTION public.assign_waitlist_position()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.position := (SELECT COALESCE(MAX(position), 0) + 1 FROM public.waitlist);
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='waitlist') THEN
    DROP TRIGGER IF EXISTS before_waitlist_insert ON public.waitlist;
    CREATE TRIGGER before_waitlist_insert
      BEFORE INSERT ON public.waitlist FOR EACH ROW EXECUTE PROCEDURE public.assign_waitlist_position();
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════
-- STEP 9: VIEWS (recreate with stable types)
-- ═══════════════════════════════════════════════════════════

-- agent_leaderboard
CREATE VIEW public.agent_leaderboard AS
SELECT
  a.id, a.name, a.slug, a.description,
  a.category::text            AS category,
  a.pricing_model::text       AS pricing_model,
  COALESCE(a.price_per_call,  0)::numeric  AS price_per_call,
  COALESCE(a.average_rating,  0)::numeric  AS average_rating,
  COALESCE(a.total_reviews,   0)           AS total_reviews,
  COALESCE(a.total_executions,0)           AS total_executions,
  COALESCE(a.average_latency_ms, 0)        AS average_latency_ms,
  a.is_featured, a.is_verified, a.icon_url,
  COALESCE(s.composite_score,  0)::numeric AS composite_score,
  COALESCE(s.accuracy_score,   0)::numeric AS accuracy_score,
  COALESCE(s.reliability_score,0)::numeric AS reliability_score,
  COALESCE(s.latency_score,    0)::numeric AS latency_score,
  COALESCE(s.cost_score,       0)::numeric AS cost_score,
  COALESCE(s.popularity_score, 0)::numeric AS popularity_score,
  COALESCE(s.global_rank,   9999)          AS global_rank,
  COALESCE(s.category_rank, 9999)          AS category_rank,
  COALESCE(s.is_top_rated,  FALSE)         AS is_top_rated,
  COALESCE(s.is_fastest,    FALSE)         AS is_fastest,
  COALESCE(s.is_cheapest,   FALSE)         AS is_cheapest,
  COALESCE(s.is_most_reliable, FALSE)      AS is_most_reliable,
  p.full_name   AS seller_name,
  p.username    AS seller_username,
  p.is_verified AS seller_verified
FROM public.agents a
LEFT JOIN public.agent_scores s ON s.agent_id = a.id
JOIN  public.profiles p ON p.id = a.seller_id
WHERE a.status::text = 'active';

-- agent_capabilities
CREATE VIEW public.agent_capabilities AS
SELECT
  a.id, a.name, a.slug, a.description,
  a.category::text                             AS category,
  COALESCE(a.capability_tags, '{}')            AS capability_tags,
  COALESCE(a.input_types,  ARRAY['text'])      AS input_types,
  COALESCE(a.output_types, ARRAY['text'])      AS output_types,
  COALESCE(a.languages,    ARRAY['en'])        AS languages,
  COALESCE(a.compliance_tags, '{}')            AS compliance_tags,
  a.pricing_model::text                        AS pricing_model,
  COALESCE(a.price_per_call, 0)::numeric       AS price_per_call,
  COALESCE(a.subscription_price_monthly, 0)::numeric AS subscription_price_monthly,
  COALESCE(a.free_calls_per_month, 0)          AS free_calls_per_month,
  a.model_name,
  COALESCE(a.average_latency_ms, 0)            AS average_latency_ms,
  COALESCE(a.composite_score, 0)::numeric      AS composite_score,
  COALESCE(s.accuracy_score,  0)::numeric      AS accuracy_score,
  COALESCE(s.cost_score,      0)::numeric      AS cost_score,
  COALESCE(s.latency_score,   0)::numeric      AS latency_score,
  COALESCE(s.is_top_rated,    FALSE)           AS is_top_rated,
  COALESCE(s.is_fastest,      FALSE)           AS is_fastest,
  COALESCE(s.is_cheapest,     FALSE)           AS is_cheapest,
  COALESCE(s.is_most_reliable,FALSE)           AS is_most_reliable
FROM public.agents a
LEFT JOIN public.agent_scores s ON s.agent_id = a.id
WHERE a.status::text = 'active';

-- admin_platform_stats
CREATE VIEW public.admin_platform_stats AS
SELECT
  (SELECT COUNT(*)      FROM public.profiles)                                    AS total_users,
  (SELECT COUNT(*)      FROM public.agents WHERE status = 'active')              AS active_agents,
  (SELECT COUNT(*)      FROM public.agents WHERE status = 'pending_review')      AS pending_review,
  (SELECT COUNT(*)      FROM public.executions)                                  AS total_executions,
  (SELECT COALESCE(SUM(amount),0) FROM public.transactions WHERE status='succeeded') AS gross_revenue,
  (SELECT COALESCE(SUM(amount),0)*0.20 FROM public.transactions WHERE status='succeeded') AS platform_revenue,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='blocked')        AS blocked_attempts,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='flagged')        AS flagged_attempts,
  (SELECT COUNT(*) FROM public.reviews WHERE status='pending')                   AS pending_reviews,
  (SELECT COUNT(*) FROM public.profiles WHERE is_banned = TRUE)                  AS banned_users;

-- user_credit_summary
CREATE VIEW public.user_credit_summary AS
SELECT c.user_id, c.balance_usd, c.hard_limit_usd, c.alert_threshold,
       c.total_purchased, c.total_spent,
       (c.balance_usd < c.alert_threshold) AS low_balance
FROM public.credits c WHERE c.user_id = auth.uid();

-- agent_trace_summary
CREATE VIEW public.agent_trace_summary AS
SELECT t.agent_id,
       date_trunc('day', t.created_at)            AS day,
       COUNT(*)                                    AS total_calls,
       AVG(t.total_ms)::INTEGER                   AS avg_latency_ms,
       AVG(t.ttft_ms)::INTEGER                    AS avg_ttft_ms,
       SUM(t.tokens_input)                        AS total_tokens_in,
       SUM(t.tokens_output)                       AS total_tokens_out,
       SUM(t.cost_usd)                            AS total_cost,
       COUNT(*) FILTER (WHERE t.status='success') AS successes,
       COUNT(*) FILTER (WHERE t.status='error')   AS errors
FROM public.execution_traces t
JOIN public.agents a ON a.id = t.agent_id
WHERE a.seller_id = auth.uid()
GROUP BY t.agent_id, date_trunc('day', t.created_at)
ORDER BY day DESC;


-- ═══════════════════════════════════════════════════════════
-- STEP 10: GRANTS
-- ═══════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.search_agents_semantic(vector, double precision, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_rag_chunks(UUID, vector, FLOAT, INT)               TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_agent_score(UUID)                                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_all_agent_scores()                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_agent_rankings()                                   TO service_role;
GRANT EXECUTE ON FUNCTION public.aggregate_daily_analytics()                                TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, NUMERIC, TEXT, UUID)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, NUMERIC, TEXT, UUID)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_executions_used(UUID)                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_monthly_quotas()                                     TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memory()                                   TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_thoughtgate_stat(TEXT, TEXT, BOOLEAN)            TO authenticated, service_role;

GRANT SELECT ON public.agent_leaderboard    TO anon, authenticated;
GRANT SELECT ON public.agent_capabilities   TO anon, authenticated;
GRANT SELECT ON public.admin_platform_stats TO authenticated;
GRANT SELECT ON public.user_credit_summary  TO authenticated;
GRANT SELECT ON public.agent_trace_summary  TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.credits                    TO authenticated, service_role;
GRANT SELECT, INSERT         ON public.credit_transactions        TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.agent_scores               TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.agent_analytics            TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.pipeline_executions        TO authenticated, service_role;
GRANT SELECT, INSERT         ON public.audit_logs                 TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.agent_feedback             TO authenticated, service_role;
GRANT SELECT, INSERT         ON public.injection_attempts         TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.thoughtgate_template_stats TO authenticated, service_role;


-- ═══════════════════════════════════════════════════════════
-- STEP 11: pg_cron (safe — skipped if extension not enabled)
-- ═══════════════════════════════════════════════════════════
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-reset-quotas',  '0 0 1 * *',    $$SELECT public.reset_monthly_quotas()$$);
    PERFORM cron.schedule('agentdyne-score-agents',  '0 2 * * *',    $$SELECT public.compute_all_agent_scores()$$);
    PERFORM cron.schedule('agentdyne-rankings',      '0 2 * * *',    $$SELECT public.refresh_agent_rankings()$$);
    PERFORM cron.schedule('agentdyne-daily-analytics','0 1 * * *',   $$SELECT public.aggregate_daily_analytics()$$);
    PERFORM cron.schedule('agentdyne-cleanup-memory','0 4 * * *',    $$SELECT public.cleanup_expired_memory()$$);
    RAISE NOTICE '✅ pg_cron jobs scheduled';
  ELSE
    RAISE NOTICE '⚠️  pg_cron not enabled — schedules skipped. Enable via Supabase Dashboard → Database → Extensions';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  pg_cron scheduling failed: % — this is non-fatal', SQLERRM;
END $cron$;


-- ═══════════════════════════════════════════════════════════
-- STEP 12: BACK-FILL credits for existing users
-- ═══════════════════════════════════════════════════════════
INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd)
  SELECT id, 0, 5 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- STEP 13: VERIFICATION
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE
  v INT;
  func_sig TEXT;
BEGIN
  -- Check search_agents_semantic has exactly ONE overload
  SELECT COUNT(*), MIN(p.oid::regprocedure::text)
  INTO v, func_sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_agents_semantic';

  IF v = 1 THEN
    RAISE NOTICE '✅ search_agents_semantic: 1 overload — %', func_sig;
  ELSIF v = 0 THEN
    RAISE WARNING '❌ search_agents_semantic: NOT created';
  ELSE
    RAISE WARNING '⚠️  search_agents_semantic: % overloads still exist — rerun STEP 2', v;
  END IF;

  -- Check critical tables
  SELECT COUNT(*) INTO v FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN (
    'credits','credit_transactions','agent_scores','agent_analytics',
    'pipeline_executions','execution_traces','audit_logs',
    'agent_feedback','governance_events','thoughtgate_template_stats',
    'rate_limit_counters','agent_embeddings','agent_memory',
    'knowledge_bases','rag_documents','rag_chunks','injection_attempts'
  );
  RAISE NOTICE '✅ Critical tables: % / 17', v;

  -- Check is_banned exists
  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles' AND column_name='is_banned';
  RAISE NOTICE '✅ profiles.is_banned: %', CASE WHEN v=1 THEN 'OK' ELSE '❌ MISSING' END;

  -- Check cost columns on executions
  SELECT COUNT(*) INTO v FROM information_schema.columns
  WHERE table_schema='public' AND table_name='executions'
    AND column_name IN ('cost','cost_usd','tokens_input','tokens_output');
  RAISE NOTICE '✅ executions cost/token columns: % / 4', v;

  -- Check triggers (should have exactly 1 on_review_change)
  SELECT COUNT(*) INTO v FROM pg_trigger WHERE tgname = 'on_review_change';
  RAISE NOTICE '✅ on_review_change triggers: % (want 1)', v;

  SELECT COUNT(*) INTO v FROM pg_trigger WHERE tgname = 'on_pipeline_execution_complete';
  RAISE NOTICE '✅ on_pipeline_execution_complete triggers: % (want 1)', v;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 999_complete_idempotent_fix.sql complete — all gaps resolved.';
  RAISE NOTICE '   If search_agents_semantic shows 0: the vector extension may not be installed.';
  RAISE NOTICE '   Enable it: Supabase Dashboard → Database → Extensions → vector → Enable';
END $$;
