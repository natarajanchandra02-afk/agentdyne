-- ============================================================
-- Migration 038: Swarm v5 — Definitive Schema
-- Matches swarm-client.tsx v5 exact feature set
-- ============================================================

-- ── Extend multi_agent_sessions ──────────────────────────────
ALTER TABLE multi_agent_sessions
  ADD COLUMN IF NOT EXISTS budget_usd          numeric(10,4),
  ADD COLUMN IF NOT EXISTS max_runtime_sec     integer        DEFAULT 60,
  ADD COLUMN IF NOT EXISTS accuracy_cost_pct   integer        DEFAULT 50 CHECK (accuracy_cost_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS consensus_method    text           DEFAULT 'Majority Vote',
  ADD COLUMN IF NOT EXISTS final_arbiter       text           DEFAULT 'Planner Agent',
  ADD COLUMN IF NOT EXISTS conflict_resolution text           DEFAULT 'High Confidence Wins',
  ADD COLUMN IF NOT EXISTS early_stopping      boolean        DEFAULT true,
  ADD COLUMN IF NOT EXISTS dynamic_swarm       boolean        DEFAULT false,
  ADD COLUMN IF NOT EXISTS remember_learnings  boolean        DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_assembled      boolean        DEFAULT false,
  ADD COLUMN IF NOT EXISTS outcome_score       integer        CHECK (outcome_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS template_id         uuid,
  ADD COLUMN IF NOT EXISTS v2_parent_id        uuid           REFERENCES multi_agent_sessions(id),
  ADD COLUMN IF NOT EXISTS runtime_sec         numeric(8,2),
  ADD COLUMN IF NOT EXISTS total_cost_usd      numeric(10,4),
  ADD COLUMN IF NOT EXISTS agent_confidence    jsonb          DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS execution_trace     jsonb          DEFAULT '[]';

-- ── Swarm templates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swarm_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid        REFERENCES profiles(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  description  text,
  mode         text        NOT NULL DEFAULT 'orchestrate'
                           CHECK (mode IN ('orchestrate','debate','parallel','dynamic')),
  agent_roles  jsonb       NOT NULL DEFAULT '[]',
  config       jsonb       NOT NULL DEFAULT '{}',
  is_public    boolean     NOT NULL DEFAULT false,
  use_count    integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Seed public templates (idempotent)
INSERT INTO swarm_templates (owner_id, name, description, mode, agent_roles, is_public)
VALUES
  (NULL,'Investment Research Swarm',  'Research + Financial Analyst + Fact Checker + Writer','orchestrate','["researcher","financial_analyst","fact_checker","writer"]',true),
  (NULL,'Content Creation Swarm',     'Researcher + Writer + Editor + SEO Analyst',           'orchestrate','["researcher","writer","editor","seo_analyst"]',true),
  (NULL,'Due Diligence Swarm',        'Financial + Legal + Market + Risk analysts in parallel','parallel',  '["financial_analyst","legal_analyst","market_analyst","risk_analyst"]',true),
  (NULL,'Market Analysis Swarm',      'Research + Analysis + Report pipeline',                 'orchestrate','["researcher","analyst","writer"]',true)
ON CONFLICT DO NOTHING;

-- ── Post-execution insights ───────────────────────────────────
CREATE TABLE IF NOT EXISTS swarm_insights (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid        UNIQUE REFERENCES multi_agent_sessions(id) ON DELETE CASCADE,
  outcome_score    integer     NOT NULL CHECK (outcome_score BETWEEN 0 AND 100),
  key_strengths    text[]      NOT NULL DEFAULT '{}',
  improvements     text[]      NOT NULL DEFAULT '{}',
  suggested_agents text[]      NOT NULL DEFAULT '{}',
  execution_trace  jsonb       DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swarm_insights_session ON swarm_insights(session_id);

-- ── Swarm run metrics (admin intelligence) ───────────────────
CREATE TABLE IF NOT EXISTS swarm_run_metrics (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        REFERENCES multi_agent_sessions(id) ON DELETE CASCADE,
  mode              text        NOT NULL,
  agent_count       integer     NOT NULL,
  success           boolean     NOT NULL DEFAULT false,
  consensus_reached boolean,
  debate_rounds     integer,
  parallel_workers  integer,
  runtime_sec       numeric(8,2),
  cost_usd          numeric(10,4),
  outcome_score     integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swarm_metrics_mode    ON swarm_run_metrics(mode);
CREATE INDEX IF NOT EXISTS idx_swarm_metrics_created ON swarm_run_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swarm_metrics_session ON swarm_run_metrics(session_id);

-- ── Agent genome (Tier 7 — best performing configs) ──────────
CREATE TABLE IF NOT EXISTS agent_genome (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  config_hash     text        UNIQUE NOT NULL,
  mode            text        NOT NULL,
  agent_roles     text[]      NOT NULL,
  models_used     text[]      NOT NULL,
  has_rag         boolean     DEFAULT false,
  has_memory      boolean     DEFAULT false,
  total_runs      integer     NOT NULL DEFAULT 0,
  success_rate    numeric(5,2) NOT NULL DEFAULT 0,
  avg_outcome     numeric(5,2) NOT NULL DEFAULT 0,
  avg_cost        numeric(10,4) NOT NULL DEFAULT 0,
  avg_latency_ms  integer     NOT NULL DEFAULT 0,
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_genome_success ON agent_genome(success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_genome_runs    ON agent_genome(total_runs DESC);

-- ── RPC: upsert_swarm_insight ────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_swarm_insight(
  p_session_id     uuid,
  p_outcome_score  integer,
  p_key_strengths  text[],
  p_improvements   text[],
  p_suggested_agents text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO swarm_insights (session_id, outcome_score, key_strengths, improvements, suggested_agents)
  VALUES (p_session_id, p_outcome_score, p_key_strengths, p_improvements, p_suggested_agents)
  ON CONFLICT (session_id) DO UPDATE SET
    outcome_score    = EXCLUDED.outcome_score,
    key_strengths    = EXCLUDED.key_strengths,
    improvements     = EXCLUDED.improvements,
    suggested_agents = EXCLUDED.suggested_agents
  RETURNING id INTO v_id;
  -- Back-fill outcome_score on session
  UPDATE multi_agent_sessions SET outcome_score = p_outcome_score WHERE id = p_session_id;
  RETURN v_id;
END;
$$;

-- ── RPC: record_swarm_run ────────────────────────────────────
CREATE OR REPLACE FUNCTION record_swarm_run(
  p_session_id       uuid,
  p_mode             text,
  p_agent_count      integer,
  p_success          boolean,
  p_runtime_sec      numeric DEFAULT NULL,
  p_cost_usd         numeric DEFAULT NULL,
  p_outcome_score    integer DEFAULT NULL,
  p_consensus_reached boolean DEFAULT NULL,
  p_debate_rounds    integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  INSERT INTO swarm_run_metrics (
    session_id, mode, agent_count, success, runtime_sec, cost_usd,
    outcome_score, consensus_reached, debate_rounds,
    parallel_workers
  ) VALUES (
    p_session_id, p_mode, p_agent_count, p_success, p_runtime_sec, p_cost_usd,
    p_outcome_score, p_consensus_reached, p_debate_rounds,
    CASE WHEN p_mode = 'parallel' THEN p_agent_count ELSE NULL END
  );
END;
$$;

-- ── RPC: get_swarm_dashboard_stats ───────────────────────────
CREATE OR REPLACE FUNCTION get_swarm_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_runs',           COUNT(*),
    'success_rate',         ROUND(AVG(CASE WHEN success THEN 100.0 ELSE 0 END), 1),
    'avg_agents_per_swarm', ROUND(AVG(agent_count), 1),
    'avg_outcome_score',    ROUND(AVG(outcome_score), 0),
    'consensus_failures',   COUNT(*) FILTER (WHERE mode='debate' AND NOT COALESCE(consensus_reached,false)),
    'mode_stats', jsonb_build_object(
      'debate',       COUNT(*) FILTER (WHERE mode='debate'),
      'parallel',     COUNT(*) FILTER (WHERE mode='parallel'),
      'orchestrate',  COUNT(*) FILTER (WHERE mode='orchestrate'),
      'debate_sr',    ROUND(AVG(CASE WHEN mode='debate'       AND success THEN 100.0 ELSE 0 END),1),
      'parallel_sr',  ROUND(AVG(CASE WHEN mode='parallel'     AND success THEN 100.0 ELSE 0 END),1),
      'orchestrate_sr',ROUND(AVG(CASE WHEN mode='orchestrate' AND success THEN 100.0 ELSE 0 END),1)
    )
  ) INTO v
  FROM swarm_run_metrics
  WHERE created_at > NOW() - INTERVAL '30 days';
  RETURN COALESCE(v, '{}'::jsonb);
END;
$$;

-- ── RPC: get_agent_genome_leaderboard ────────────────────────
CREATE OR REPLACE FUNCTION get_agent_genome_leaderboard(p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(g) ORDER BY g.success_rate DESC, g.total_runs DESC)
  INTO v
  FROM (
    SELECT config_hash, mode, agent_roles, models_used,
           has_rag, has_memory, total_runs, success_rate, avg_outcome, avg_cost
    FROM agent_genome
    ORDER BY success_rate DESC, total_runs DESC
    LIMIT p_limit
  ) g;
  RETURN COALESCE(v, '[]'::jsonb);
END;
$$;

-- ── RPC: get_user_swarm_sessions ─────────────────────────────
CREATE OR REPLACE FUNCTION get_user_swarm_sessions(p_user_id uuid, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(s) ORDER BY s.created_at DESC)
  INTO v
  FROM (
    SELECT mas.id, mas.name, mas.status, mas.mode,
           (mas.shared_context->>'mode') AS mode_ctx,
           jsonb_array_length(COALESCE(mas.agent_ids,'[]'::jsonb)) AS agent_count,
           mas.outcome_score, mas.runtime_sec, mas.total_cost_usd,
           mas.created_at,
           si.key_strengths, si.improvements
    FROM multi_agent_sessions mas
    LEFT JOIN swarm_insights si ON si.session_id = mas.id
    WHERE mas.owner_id = p_user_id
    ORDER BY mas.created_at DESC
    LIMIT p_limit
  ) s;
  RETURN COALESCE(v, '[]'::jsonb);
END;
$$;

-- ── Admin view: swarm intelligence stats ─────────────────────
CREATE OR REPLACE VIEW admin_swarm_intelligence AS
SELECT
  COUNT(*)                                                        AS total_runs_30d,
  ROUND(AVG(CASE WHEN success THEN 100.0 ELSE 0 END), 1)        AS overall_success_rate,
  ROUND(AVG(agent_count), 1)                                     AS avg_agents_per_swarm,
  ROUND(AVG(outcome_score), 0)                                   AS avg_outcome_score,
  COUNT(*) FILTER (WHERE mode='debate' AND NOT COALESCE(consensus_reached,false)) AS consensus_failures,
  -- per-mode success
  ROUND(AVG(CASE WHEN mode='debate'       AND success THEN 100.0 ELSE 0 END), 1) AS debate_success_rate,
  ROUND(AVG(CASE WHEN mode='parallel'     AND success THEN 100.0 ELSE 0 END), 1) AS parallel_success_rate,
  ROUND(AVG(CASE WHEN mode='orchestrate'  AND success THEN 100.0 ELSE 0 END), 1) AS orchestrate_success_rate,
  -- counts
  COUNT(*) FILTER (WHERE mode='debate')      AS debate_count,
  COUNT(*) FILTER (WHERE mode='parallel')    AS parallel_count,
  COUNT(*) FILTER (WHERE mode='orchestrate') AS orchestrate_count,
  -- cost & perf
  ROUND(AVG(cost_usd), 5)                                        AS avg_cost_usd,
  ROUND(AVG(runtime_sec), 1)                                     AS avg_runtime_sec
FROM swarm_run_metrics
WHERE created_at > NOW() - INTERVAL '30 days';

GRANT SELECT ON admin_swarm_intelligence TO authenticated;

-- ── Admin view: agent improvement recommendations ─────────────
CREATE OR REPLACE VIEW admin_agent_improvement_recs AS
SELECT
  a.id, a.name, a.model_name,
  COUNT(e.id)                                                      AS total_execs,
  ROUND(AVG(CASE WHEN e.status='success' THEN 100.0 ELSE 0.0 END),1) AS success_rate,
  ROUND(AVG(e.rating_score), 2)                                    AS avg_rating,
  ROUND(AVG(e.total_cost_usd), 5)                                  AS avg_cost,
  ROUND(AVG(e.latency_ms), 0)                                      AS avg_latency_ms,
  jsonb_build_array(
    CASE WHEN AVG(e.rating_score) < 3.5       THEN 'Lower temperature for consistency'    END,
    CASE WHEN COUNT(*) FILTER (WHERE e.status='failed') > 5 THEN 'Increase timeout'       END,
    CASE WHEN AVG(e.total_cost_usd) > 0.05   THEN 'Switch to Haiku for cost savings'     END,
    CASE WHEN AVG(e.latency_ms) > 8000        THEN 'Enable RAG for faster retrieval'      END,
    CASE WHEN AVG(e.rating_score) < 3.0       THEN 'Switch to Sonnet for deeper analysis' END
  ) - 'null'::jsonb                                                AS ai_recommendations
FROM agents a
LEFT JOIN executions e ON e.agent_id = a.id
  AND e.created_at > NOW() - INTERVAL '30 days'
WHERE a.status = 'active'
GROUP BY a.id, a.name, a.model_name
HAVING COUNT(e.id) > 2
ORDER BY success_rate ASC, avg_rating ASC NULLS LAST
LIMIT 25;

GRANT SELECT ON admin_agent_improvement_recs TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE swarm_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_insights    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_genome      ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_run_metrics ENABLE ROW LEVEL SECURITY;

-- swarm_templates
DROP POLICY IF EXISTS "swarm_templates_select" ON swarm_templates;
DROP POLICY IF EXISTS "swarm_templates_insert" ON swarm_templates;
DROP POLICY IF EXISTS "swarm_templates_update" ON swarm_templates;
DROP POLICY IF EXISTS "swarm_templates_delete" ON swarm_templates;

CREATE POLICY "swarm_templates_select" ON swarm_templates
  FOR SELECT USING (is_public OR owner_id = auth.uid());
CREATE POLICY "swarm_templates_insert" ON swarm_templates
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "swarm_templates_update" ON swarm_templates
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "swarm_templates_delete" ON swarm_templates
  FOR DELETE USING (owner_id = auth.uid());

-- swarm_insights: user sees own session insights
DROP POLICY IF EXISTS "swarm_insights_select" ON swarm_insights;
CREATE POLICY "swarm_insights_select" ON swarm_insights
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM multi_agent_sessions WHERE owner_id = auth.uid()
    )
  );
CREATE POLICY "swarm_insights_insert" ON swarm_insights
  FOR INSERT WITH CHECK (
    session_id IN (
      SELECT id FROM multi_agent_sessions WHERE owner_id = auth.uid()
    )
  );

-- agent_genome + swarm_run_metrics: admin read only
DROP POLICY IF EXISTS "genome_admin_read"   ON agent_genome;
DROP POLICY IF EXISTS "metrics_admin_read"  ON swarm_run_metrics;

CREATE POLICY "genome_admin_read" ON agent_genome
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
CREATE POLICY "metrics_admin_read" ON swarm_run_metrics
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Triggers: updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION _touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS swarm_templates_touch ON swarm_templates;
DROP TRIGGER IF EXISTS agent_genome_touch    ON agent_genome;

CREATE TRIGGER swarm_templates_touch
  BEFORE UPDATE ON swarm_templates
  FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

CREATE TRIGGER agent_genome_touch
  BEFORE UPDATE ON agent_genome
  FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mas_owner_created  ON multi_agent_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mas_status         ON multi_agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_mas_mode           ON multi_agent_sessions((shared_context->>'mode'));
CREATE INDEX IF NOT EXISTS idx_swarm_templates_pub ON swarm_templates(is_public) WHERE is_public = true;

-- ── Seed agent genome with representative configs ─────────────
INSERT INTO agent_genome (config_hash, mode, agent_roles, models_used, has_rag, has_memory, total_runs, success_rate, avg_outcome, avg_cost)
VALUES
  ('rag-sonnet-mcp-orchestrate',  'orchestrate', ARRAY['researcher','analyst','writer'],          ARRAY['claude-sonnet-4-6'],                     true,  true,  234, 97.2, 91.4, 0.031),
  ('parallel-haiku-rag',          'parallel',    ARRAY['researcher','fact_checker','analyst'],    ARRAY['claude-haiku-4-5'],                       true,  false, 189, 94.3, 87.1, 0.008),
  ('debate-sonnet-haiku',         'debate',      ARRAY['researcher','critic','writer'],           ARRAY['claude-sonnet-4-6','claude-haiku-4-5'],   false, true,  156, 91.0, 85.2, 0.019),
  ('norag-haiku-parallel',        'parallel',    ARRAY['analyst','writer'],                       ARRAY['claude-haiku-4-5'],                       false, false, 98,  72.4, 74.0, 0.005),
  ('opus-full-orchestrate',       'orchestrate', ARRAY['researcher','analyst','critic','writer'], ARRAY['claude-opus-4-6'],                        true,  true,  67,  98.5, 96.2, 0.142),
  ('gpt4-research-orchestrate',   'orchestrate', ARRAY['researcher','analyst','writer'],          ARRAY['gpt-4o'],                                 true,  false, 112, 88.7, 83.5, 0.045),
  ('gemini-parallel',             'parallel',    ARRAY['researcher','writer'],                    ARRAY['gemini-1.5-pro'],                         false, false, 45,  79.1, 76.3, 0.012),
  ('mixed-sonnet-haiku-debate',   'debate',      ARRAY['researcher','critic','analyst','writer'], ARRAY['claude-sonnet-4-6','claude-haiku-4-5'],   true,  true,  203, 93.6, 89.0, 0.024)
ON CONFLICT (config_hash) DO NOTHING;
