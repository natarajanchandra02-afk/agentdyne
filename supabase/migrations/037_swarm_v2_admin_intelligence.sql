-- ============================================================
-- Migration 037: Swarm v2 + Admin Intelligence Layer
-- GPT Founder Audit implementation
-- Adds: swarm_templates, swarm_v2_config, agent_genome,
--       swarm_intelligence_metrics, post_execution_insights
-- ============================================================

-- ── Swarm templates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swarm_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid        REFERENCES profiles(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  description   text,
  mode          text        NOT NULL DEFAULT 'orchestrate' CHECK (mode IN ('orchestrate','debate','parallel','dynamic')),
  agent_roles   jsonb       NOT NULL DEFAULT '[]',
  config        jsonb       NOT NULL DEFAULT '{}',
  is_public     boolean     NOT NULL DEFAULT false,
  use_count     integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Seed default templates
INSERT INTO swarm_templates (owner_id, name, description, mode, agent_roles, is_public)
VALUES
  (NULL, 'Investment Research Swarm',  'Research + Analyst + Fact Checker + Writer', 'orchestrate', '["researcher","analyst","fact_checker","writer"]', true),
  (NULL, 'Content Creation Swarm',     'Researcher + Writer + Editor + SEO', 'orchestrate', '["researcher","writer","critic","seo"]', true),
  (NULL, 'Due Diligence Swarm',        'Financial + Legal + Market + Risk analyst', 'parallel', '["financial_analyst","legal_analyst","market_analyst","risk_analyst"]', true),
  (NULL, 'Market Analysis Swarm',      'Research + Analysis + Report Generation', 'orchestrate', '["researcher","analyst","writer"]', true)
ON CONFLICT DO NOTHING;

-- ── Swarm v2 enhanced config ──────────────────────────────────
ALTER TABLE multi_agent_sessions
  ADD COLUMN IF NOT EXISTS budget_usd       numeric(10,4),
  ADD COLUMN IF NOT EXISTS max_runtime_sec  integer,
  ADD COLUMN IF NOT EXISTS accuracy_cost    integer CHECK (accuracy_cost BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS consensus_method text    DEFAULT 'Majority',
  ADD COLUMN IF NOT EXISTS final_arbiter    text,
  ADD COLUMN IF NOT EXISTS conflict_res     text    DEFAULT 'High Confidence Wins',
  ADD COLUMN IF NOT EXISTS early_stopping   boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS dynamic_swarm    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS remember_learns  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id      uuid    REFERENCES swarm_templates(id),
  ADD COLUMN IF NOT EXISTS outcome_score    integer,
  ADD COLUMN IF NOT EXISTS suggested_agents jsonb   DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS v2_created       boolean DEFAULT false;

-- ── Post-execution insights ───────────────────────────────────
CREATE TABLE IF NOT EXISTS swarm_insights (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        REFERENCES multi_agent_sessions(id) ON DELETE CASCADE,
  outcome_score   integer     NOT NULL CHECK (outcome_score BETWEEN 0 AND 100),
  key_strengths   text[]      NOT NULL DEFAULT '{}',
  improvements    text[]      NOT NULL DEFAULT '{}',
  suggested_agents text[]     NOT NULL DEFAULT '{}',
  execution_trace jsonb       DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swarm_insights_session ON swarm_insights(session_id);

-- ── Agent Genome (Tier 7 — best performing configurations) ──
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

-- ── Swarm Intelligence Dashboard metrics ─────────────────────
CREATE TABLE IF NOT EXISTS swarm_run_metrics (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        REFERENCES multi_agent_sessions(id) ON DELETE CASCADE,
  mode              text        NOT NULL,
  agent_count       integer     NOT NULL,
  success           boolean     NOT NULL DEFAULT false,
  consensus_reached boolean     DEFAULT false,
  consensus_round   integer,
  debate_rounds     integer,
  parallel_workers  integer,
  runtime_sec       numeric(8,2),
  cost_usd          numeric(10,4),
  outcome_score     integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swarm_metrics_mode    ON swarm_run_metrics(mode);
CREATE INDEX IF NOT EXISTS idx_swarm_metrics_created ON swarm_run_metrics(created_at DESC);

-- ── RPC: get_swarm_dashboard_stats ───────────────────────────
CREATE OR REPLACE FUNCTION get_swarm_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_runs',          COUNT(*),
    'success_rate',        ROUND(AVG(CASE WHEN success THEN 100.0 ELSE 0.0 END), 1),
    'avg_agents_per_swarm',ROUND(AVG(agent_count), 1),
    'avg_outcome_score',   ROUND(AVG(outcome_score), 0),
    'consensus_failures',  COUNT(*) FILTER (WHERE mode = 'debate' AND NOT COALESCE(consensus_reached, false)),
    'mode_stats', jsonb_build_object(
      'debate',      jsonb_build_object(
        'count',        COUNT(*) FILTER (WHERE mode = 'debate'),
        'success_rate', ROUND(AVG(CASE WHEN mode = 'debate'    AND success THEN 100.0 ELSE 0.0 END FILTER (WHERE mode = 'debate')),1)
      ),
      'parallel',    jsonb_build_object(
        'count',        COUNT(*) FILTER (WHERE mode = 'parallel'),
        'success_rate', ROUND(AVG(CASE WHEN mode = 'parallel'  AND success THEN 100.0 ELSE 0.0 END FILTER (WHERE mode = 'parallel')),1)
      ),
      'orchestrate', jsonb_build_object(
        'count',        COUNT(*) FILTER (WHERE mode = 'orchestrate'),
        'success_rate', ROUND(AVG(CASE WHEN mode = 'orchestrate' AND success THEN 100.0 ELSE 0.0 END FILTER (WHERE mode = 'orchestrate')),1)
      )
    )
  ) INTO v_result
  FROM swarm_run_metrics
  WHERE created_at > NOW() - INTERVAL '30 days';

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ── RPC: get_agent_genome_leaderboard ────────────────────────
CREATE OR REPLACE FUNCTION get_agent_genome_leaderboard(p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(g) ORDER BY g.success_rate DESC, g.total_runs DESC)
  INTO v_result
  FROM (
    SELECT config_hash, mode, agent_roles, models_used,
           has_rag, has_memory, total_runs, success_rate, avg_outcome, avg_cost
    FROM agent_genome
    ORDER BY success_rate DESC, total_runs DESC
    LIMIT p_limit
  ) g;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ── Helper: record swarm run metric ──────────────────────────
CREATE OR REPLACE FUNCTION record_swarm_run(
  p_session_id      uuid,
  p_mode            text,
  p_agent_count     integer,
  p_success         boolean,
  p_runtime_sec     numeric,
  p_cost_usd        numeric,
  p_outcome_score   integer DEFAULT NULL,
  p_consensus_reached boolean DEFAULT NULL,
  p_debate_rounds   integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO swarm_run_metrics (
    session_id, mode, agent_count, success, runtime_sec, cost_usd,
    outcome_score, consensus_reached, debate_rounds, parallel_workers
  ) VALUES (
    p_session_id, p_mode, p_agent_count, p_success, p_runtime_sec, p_cost_usd,
    p_outcome_score, p_consensus_reached, p_debate_rounds,
    CASE WHEN p_mode = 'parallel' THEN p_agent_count ELSE NULL END
  );
END;
$$;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE swarm_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_insights    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_genome      ENABLE ROW LEVEL SECURITY;
ALTER TABLE swarm_run_metrics ENABLE ROW LEVEL SECURITY;

-- swarm_templates: public ones visible to all auth users
DROP POLICY IF EXISTS "swarm_templates_read"   ON swarm_templates;
DROP POLICY IF EXISTS "swarm_templates_write"  ON swarm_templates;

CREATE POLICY "swarm_templates_read"  ON swarm_templates
  FOR SELECT USING (is_public OR owner_id = auth.uid());

CREATE POLICY "swarm_templates_write" ON swarm_templates
  FOR ALL USING (owner_id = auth.uid());

-- swarm_insights: owner only
DROP POLICY IF EXISTS "swarm_insights_read" ON swarm_insights;
CREATE POLICY "swarm_insights_read" ON swarm_insights
  FOR SELECT USING (
    session_id IN (
      SELECT id FROM multi_agent_sessions WHERE owner_id = auth.uid()
    )
  );

-- agent_genome: admin read-only
DROP POLICY IF EXISTS "genome_admin_read" ON agent_genome;
CREATE POLICY "genome_admin_read" ON agent_genome
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- swarm_run_metrics: admin only
DROP POLICY IF EXISTS "swarm_metrics_admin" ON swarm_run_metrics;
CREATE POLICY "swarm_metrics_admin" ON swarm_run_metrics
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Admin /api/admin/swarm route data view ────────────────────
CREATE OR REPLACE VIEW admin_swarm_stats AS
SELECT
  COUNT(*)                                                     AS total_swarm_runs,
  COUNT(*) FILTER (WHERE status = 'completed')                 AS completed,
  COUNT(*) FILTER (WHERE status = 'failed')                    AS failed,
  ROUND(AVG(jsonb_array_length(COALESCE(agent_ids,'[]'::jsonb))), 1) AS avg_agents,
  COUNT(*) FILTER (
    WHERE (shared_context->>'mode') = 'debate'
  )                                                            AS debate_runs,
  COUNT(*) FILTER (
    WHERE (shared_context->>'mode') = 'parallel'
  )                                                            AS parallel_runs,
  COUNT(*) FILTER (
    WHERE (shared_context->>'mode') = 'orchestrate'
  )                                                            AS orchestrate_runs
FROM multi_agent_sessions
WHERE created_at > NOW() - INTERVAL '30 days';

GRANT SELECT ON admin_swarm_stats TO authenticated;

-- ── Update timestamp trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS swarm_templates_touch   ON swarm_templates;
DROP TRIGGER IF EXISTS agent_genome_touch      ON agent_genome;

CREATE TRIGGER swarm_templates_touch
  BEFORE UPDATE ON swarm_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER agent_genome_touch
  BEFORE UPDATE ON agent_genome
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Self-improving platform: worst performing agent recs ──────
CREATE OR REPLACE VIEW admin_agent_improvement_recs AS
SELECT
  a.id, a.name, a.model_name,
  COUNT(e.id)                                     AS total_execs,
  ROUND(AVG(CASE WHEN e.status='success' THEN 100.0 ELSE 0.0 END),1) AS success_rate,
  ROUND(AVG(e.rating_score),2)                    AS avg_rating,
  ROUND(AVG(e.total_cost_usd),5)                  AS avg_cost,
  ROUND(AVG(e.latency_ms),0)                      AS avg_latency_ms,
  ARRAY_AGG(DISTINCT e.failure_reason ORDER BY e.failure_reason) FILTER (WHERE e.failure_reason IS NOT NULL) AS failure_reasons,
  jsonb_build_array(
    CASE WHEN AVG(e.rating_score) < 3.5 THEN 'Lower temperature for consistency' END,
    CASE WHEN COUNT(e.id) FILTER (WHERE e.status='failed') > 5 THEN 'Increase timeout' END,
    CASE WHEN AVG(e.total_cost_usd) > 0.05 THEN 'Switch to Haiku for cost savings' END,
    CASE WHEN AVG(e.latency_ms) > 8000 THEN 'Enable RAG for faster retrieval' END
  ) - 'null'::jsonb                               AS ai_recommendations
FROM agents a
LEFT JOIN executions e ON e.agent_id = a.id AND e.created_at > NOW() - INTERVAL '30 days'
WHERE a.status = 'active'
GROUP BY a.id, a.name, a.model_name
HAVING COUNT(e.id) > 2
ORDER BY success_rate ASC, avg_rating ASC
LIMIT 20;

GRANT SELECT ON admin_agent_improvement_recs TO authenticated;
