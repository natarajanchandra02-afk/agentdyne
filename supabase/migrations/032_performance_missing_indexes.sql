-- =============================================================================
-- Migration 032: Performance — Missing FK indexes + hot-path compound indexes
-- AgentDyne | April 27 2026 | Safe to re-run (all IF NOT EXISTS)
-- =============================================================================

-- ── Missing FK indexes (slow joins + RLS scans) ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_executions_api_key    ON public.executions (api_key_id) WHERE api_key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_agent_id ON public.transactions (agent_id);
CREATE INDEX IF NOT EXISTS idx_payouts_seller_id     ON public.payouts (seller_id);
CREATE INDEX IF NOT EXISTS idx_collections_user_id   ON public.collections (user_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_owner_id   ON public.rag_chunks (owner_id);
CREATE INDEX IF NOT EXISTS idx_hitl_approved_by      ON public.hitl_approvals (approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hitl_pipeline_id      ON public.hitl_approvals (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_hitl_execution_id     ON public.hitl_approvals (execution_id);
CREATE INDEX IF NOT EXISTS idx_webhook_triggers_uid  ON public.webhook_triggers (user_id);
CREATE INDEX IF NOT EXISTS idx_pv_created_by         ON public.pipeline_versions (created_by);
CREATE INDEX IF NOT EXISTS idx_apu_user_id           ON public.agent_pipeline_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_exec_snaps_pipeline   ON public.execution_snapshots (pipeline_id) WHERE pipeline_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idem_user_id          ON public.idempotency_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_evals_evaluator_id    ON public.agent_evaluations (evaluator_id) WHERE evaluator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_kb_id          ON public.agents (knowledge_base_id) WHERE knowledge_base_id IS NOT NULL;

-- ── Critical hot-path compound indexes ───────────────────────────────────

-- Monthly quota counter: every execution pre-flight queries this
CREATE INDEX IF NOT EXISTS idx_executions_user_monthly ON public.executions (user_id, created_at DESC);

-- Concurrent execution check (running count per user, pre-flight)
CREATE INDEX IF NOT EXISTS idx_executions_user_running ON public.executions (user_id) WHERE status = 'running';

-- Agent analytics aggregation (compute_agent_score cron, leaderboard)
CREATE INDEX IF NOT EXISTS idx_executions_agent_cost ON public.executions (agent_id, cost_usd, created_at DESC) WHERE status = 'success';

-- ── Remove genuinely duplicate indexes ───────────────────────────────────
DROP INDEX IF EXISTS public.idx_pv_pipeline;
DROP INDEX IF EXISTS public.idx_pver_pipeline;
DROP INDEX IF EXISTS public.idx_apu_agent;
DROP INDEX IF EXISTS public.idx_apu_pipeline;
