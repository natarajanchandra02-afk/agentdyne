-- =============================================================================
-- AgentDyne — Migration 034: Observability + Replay API Schema
--
-- 1. Add depth_assessment column to execution_traces
--    (stores cognitive routing metadata per execution)
-- 2. Add selected_model + routing_reason to executions
--    (for analytics: "% of executions routed to Haiku")
-- 3. Replay API migration (extends execution_wal from 032)
-- =============================================================================

-- execution_traces: store routing depth assessment per call
ALTER TABLE public.execution_traces
  ADD COLUMN IF NOT EXISTS depth_assessment JSONB,
  ADD COLUMN IF NOT EXISTS selected_model   TEXT,
  ADD COLUMN IF NOT EXISTS routing_reason   TEXT;

-- executions: store which model was actually used + why
ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS selected_model   TEXT,
  ADD COLUMN IF NOT EXISTS routing_reason   TEXT,
  ADD COLUMN IF NOT EXISTS cost_saved_pct   NUMERIC DEFAULT 0;

-- Index for analytics: "how often did we route to Haiku vs Sonnet?"
CREATE INDEX IF NOT EXISTS idx_executions_model
  ON public.executions(selected_model, created_at DESC)
  WHERE selected_model IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_traces_depth
  ON public.execution_traces(created_at DESC)
  WHERE depth_assessment IS NOT NULL;

-- execution_wal: ensure depth_assessment extension is supported
-- (already created in 032 with event_payload jsonb — no changes needed)

-- View: routing analytics (which model gets used most, cost savings)
DROP VIEW IF EXISTS public.routing_analytics;
CREATE VIEW public.routing_analytics
  WITH (security_invoker = on)
AS
SELECT
  e.agent_id,
  e.selected_model,
  COUNT(*)                                AS executions,
  AVG(e.cost_usd)::NUMERIC(10,6)         AS avg_cost_usd,
  AVG(e.cost_saved_pct)::NUMERIC(10,2)   AS avg_cost_saved_pct,
  AVG(e.latency_ms)                      AS avg_latency_ms,
  DATE_TRUNC('day', e.created_at)        AS day
FROM public.executions e
WHERE e.selected_model IS NOT NULL
  AND e.user_id = auth.uid()
GROUP BY e.agent_id, e.selected_model, DATE_TRUNC('day', e.created_at);

GRANT SELECT ON public.routing_analytics TO authenticated;

-- Admin view: platform-wide model routing breakdown
DROP VIEW IF EXISTS public.admin_routing_stats;
CREATE VIEW public.admin_routing_stats
  WITH (security_invoker = on)
AS
SELECT
  selected_model,
  COUNT(*)                        AS total_executions,
  ROUND(AVG(cost_usd)::NUMERIC, 6) AS avg_cost,
  ROUND(AVG(cost_saved_pct)::NUMERIC, 1) AS avg_saved_pct,
  ROUND(SUM(cost_usd)::NUMERIC, 4)  AS total_cost
FROM public.executions
WHERE selected_model IS NOT NULL
GROUP BY selected_model
ORDER BY total_executions DESC;

GRANT SELECT ON public.admin_routing_stats TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 034 COMPLETE ===';
  RAISE NOTICE 'execution_traces.depth_assessment: ✅';
  RAISE NOTICE 'executions.selected_model + routing_reason: ✅';
  RAISE NOTICE 'routing_analytics view: ✅';
END $$;
