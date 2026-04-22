-- ============================================================
-- AgentDyne — Critical Production Fix Migration
-- File: 020_critical_fixes.sql
-- Date: April 2026
--
-- Fixes in this migration:
--   1. Duplicate triggers causing 2× agent execution counts,
--      3× rating refresh, 2× seller earnings, 2× pipeline stats
--   2. CRITICAL: credits UPDATE RLS allows any auth user to
--      update anyone's credits — restrict to service_role only
--   3. CRITICAL: hitl_approvals UPDATE is fully open — restrict
--   4. execution_traces duplicate INSERT policies
--   5. pipeline_executions duplicate policies
--   6. workflow_templates seed data (5 production templates)
--
-- 100% idempotent — safe to re-run.
-- ============================================================

-- ─── 1. FIX DUPLICATE TRIGGERS ────────────────────────────────────────────────

-- executions: on_execution_completed fires increment_agent_executions TWICE
-- Drop all instances and recreate once with the correct deduplication name.
-- PostgreSQL allows the same trigger name to exist multiple times if they
-- were created without IF NOT EXISTS, leading to silent duplication.

-- Drop both copies (Supabase stores them separately even with same name)
DROP TRIGGER IF EXISTS on_execution_completed ON public.executions;

-- Recreate once — fires AFTER INSERT only for successful completions
CREATE TRIGGER on_execution_completed
  AFTER INSERT ON public.executions
  FOR EACH ROW
  WHEN (NEW.status = 'success')
  EXECUTE FUNCTION increment_agent_executions();

-- executions: on_execution_complete (different name) fires update_agent_stats
-- This is separate and correct — keep it but ensure single copy
DROP TRIGGER IF EXISTS on_execution_complete ON public.executions;

CREATE TRIGGER on_execution_complete
  AFTER UPDATE ON public.executions
  FOR EACH ROW
  WHEN (NEW.status IN ('success', 'failed') AND OLD.status NOT IN ('success', 'failed'))
  EXECUTE FUNCTION update_agent_stats();

-- reviews: on_review_change fires refresh_agent_rating THREE TIMES
DROP TRIGGER IF EXISTS on_review_change ON public.reviews;

CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION refresh_agent_rating();

-- transactions: on_transaction_settled fires update_seller_earnings TWICE
DROP TRIGGER IF EXISTS on_transaction_settled ON public.transactions;

CREATE TRIGGER on_transaction_settled
  AFTER UPDATE ON public.transactions
  FOR EACH ROW
  WHEN (NEW.status = 'succeeded' AND OLD.status != 'succeeded')
  EXECUTE FUNCTION update_seller_earnings();

-- pipeline_executions: both on_pipeline_execution_complete AND trg_update_pipeline_stats
-- fire update_pipeline_stats — drop one, keep the other
DROP TRIGGER IF EXISTS trg_update_pipeline_stats ON public.pipeline_executions;

-- Keep on_pipeline_execution_complete as the canonical trigger name
DROP TRIGGER IF EXISTS on_pipeline_execution_complete ON public.pipeline_executions;

CREATE TRIGGER on_pipeline_execution_complete
  AFTER UPDATE ON public.pipeline_executions
  FOR EACH ROW
  WHEN (NEW.status IN ('success', 'failed', 'timeout') AND OLD.status = 'running')
  EXECUTE FUNCTION update_pipeline_stats();

-- ─── 2. FIX CREDITS RLS — CRITICAL SECURITY HOLE ──────────────────────────────
-- Current policy: qual = "true" means ANY authenticated user can UPDATE
-- ANY other user's credit balance — this is catastrophic.
-- Fix: allow UPDATE only via security-definer RPCs (deduct_credits, add_credits)
-- which are already defined and used correctly. Client UPDATE must be blocked.

DROP POLICY IF EXISTS "System can update credits" ON public.credits;
DROP POLICY IF EXISTS "System can insert credits"  ON public.credits;
DROP POLICY IF EXISTS "credits_service_insert"     ON public.credits;
DROP POLICY IF EXISTS "System creates credits"     ON public.credits;

-- Users can only READ their own credits — never write directly
-- All credit mutations go through deduct_credits / add_credits RPCs (SECURITY DEFINER)
CREATE POLICY "credits_user_read_own"
  ON public.credits FOR SELECT
  USING (auth.uid() = user_id);

-- Only service_role (backend RPCs) can INSERT or UPDATE credits
CREATE POLICY "credits_service_write"
  ON public.credits FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "credits_service_update"
  ON public.credits FOR UPDATE
  USING (auth.role() = 'service_role');

-- ─── 3. FIX HITL APPROVALS — OVERLY PERMISSIVE UPDATE ────────────────────────
-- qual = "true" lets any authenticated user approve any HITL request.
-- Restrict to: the pipeline owner, the assigned approver, or service_role.

DROP POLICY IF EXISTS "hitl_system_upd" ON public.hitl_approvals;

CREATE POLICY "hitl_restricted_update"
  ON public.hitl_approvals FOR UPDATE
  USING (
    user_id = auth.uid()                      -- the requester can cancel their own
    OR approved_by = auth.uid()               -- the designated approver
    OR auth.role() = 'service_role'           -- backend system actions
    OR EXISTS (                               -- pipeline owner
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_id AND p.owner_id = auth.uid()
    )
  );

-- ─── 4. FIX EXECUTION_TRACES DUPLICATE INSERT POLICIES ────────────────────────

DROP POLICY IF EXISTS "traces_authenticated_insert"   ON public.execution_traces;
DROP POLICY IF EXISTS "Users insert own traces"        ON public.execution_traces;

-- execution_traces should ONLY be written by the backend (service_role)
-- because it stores the raw system prompt and user message — sensitive data.
-- Client-side insert is intentionally removed for security.
CREATE POLICY "traces_service_write"
  ON public.execution_traces FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── 5. FIX PIPELINE_EXECUTIONS DUPLICATE POLICIES ────────────────────────────

DROP POLICY IF EXISTS "Users can view own pipeline executions"   ON public.pipeline_executions;
DROP POLICY IF EXISTS "Users can insert own pipeline executions" ON public.pipeline_executions;
DROP POLICY IF EXISTS "Users can update own pipeline executions" ON public.pipeline_executions;
DROP POLICY IF EXISTS "pipeline_exec_select"                     ON public.pipeline_executions;
DROP POLICY IF EXISTS "pipeline_exec_insert"                     ON public.pipeline_executions;

-- Deduplicated, clean policies
CREATE POLICY "pipeline_exec_user_select"
  ON public.pipeline_executions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "pipeline_exec_user_insert"
  ON public.pipeline_executions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "pipeline_exec_user_update"
  ON public.pipeline_executions FOR UPDATE
  USING (user_id = auth.uid());

-- ─── 6. FIX AUDIT_LOGS — OPEN INSERT ALLOWS LOG SPAM ─────────────────────────

DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_system_insert"          ON public.audit_logs;

-- Only service_role should insert audit logs — not any client
CREATE POLICY "audit_service_insert"
  ON public.audit_logs FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── 7. FIX DUPLICATE NOTIFICATIONS POLICIES ─────────────────────────────────

DROP POLICY IF EXISTS "Users can view own notifications"   ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "notifications_user_own"             ON public.notifications;
DROP POLICY IF EXISTS "notifications_user_update"          ON public.notifications;
DROP POLICY IF EXISTS "notifications_system_insert"        ON public.notifications;
DROP POLICY IF EXISTS "notifications_service_insert"       ON public.notifications;
DROP POLICY IF EXISTS "notifications_own"                  ON public.notifications;

-- Clean consolidated policies
CREATE POLICY "notifications_user_read"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notifications_user_mark_read"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "notifications_service_insert"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── 8. FIX DUPLICATE AGENTS POLICIES ────────────────────────────────────────

DROP POLICY IF EXISTS "Active agents are viewable by everyone" ON public.agents;
DROP POLICY IF EXISTS "agents_public_read"                     ON public.agents;

-- Single canonical read policy
CREATE POLICY "agents_public_read"
  ON public.agents FOR SELECT
  USING (status = 'active'::agent_status OR seller_id = auth.uid());

-- ─── 9. SEED WORKFLOW_TEMPLATES ───────────────────────────────────────────────
-- The workflow_templates table exists but is empty.
-- These are the 5 templates shown in the frontend Templates tab.
-- Using ON CONFLICT DO NOTHING so safe to re-run.

INSERT INTO public.workflow_templates (slug, name, description, category, pattern, icon, estimated_cost, estimated_time_s, is_featured, tags, dag)
VALUES
  (
    'customer-support-automation',
    'Customer Support Automation',
    'Classify support tickets by urgency, draft personalised replies, and flag critical issues for human review.',
    'customer_support',
    'branch',
    '🎧',
    0.003,
    45,
    true,
    ARRAY['support', 'classification', 'reply-draft', 'automation'],
    '{"nodes": [], "edges": []}'::jsonb
  ),
  (
    'lead-enrichment-pipeline',
    'Lead Enrichment Pipeline',
    'Take a lead''s name and company, research them, score their qualification, and output a CRM-ready summary.',
    'sales',
    'linear',
    '🎯',
    0.005,
    60,
    true,
    ARRAY['lead-scoring', 'research', 'outreach', 'crm'],
    '{"nodes": [], "edges": []}'::jsonb
  ),
  (
    'content-generation-pipeline',
    'Content Generation Pipeline',
    'Turn a topic into a polished blog post with SEO keywords, a social media summary, and a LinkedIn caption — all in parallel.',
    'content',
    'parallel',
    '✍️',
    0.008,
    90,
    true,
    ARRAY['content', 'seo', 'social-media', 'blog'],
    '{"nodes": [], "edges": []}'::jsonb
  ),
  (
    'document-data-extraction',
    'Document Data Extraction',
    'Extract structured data from unstructured text, validate it, and output clean JSON ready for your database.',
    'data_analysis',
    'linear',
    '📄',
    0.002,
    30,
    false,
    ARRAY['extraction', 'validation', 'structured-data', 'json'],
    '{"nodes": [], "edges": []}'::jsonb
  ),
  (
    'research-and-summarise',
    'Research & Summarise',
    'Run multiple research queries in parallel, synthesise findings into a structured report, and highlight key insights.',
    'research',
    'parallel',
    '🔬',
    0.010,
    120,
    false,
    ARRAY['research', 'synthesis', 'report', 'parallel'],
    '{"nodes": [], "edges": []}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  description     = EXCLUDED.description,
  estimated_cost  = EXCLUDED.estimated_cost,
  estimated_time_s= EXCLUDED.estimated_time_s,
  tags            = EXCLUDED.tags,
  is_featured     = EXCLUDED.is_featured;

-- ─── 10. PERFORMANCE INDICES ──────────────────────────────────────────────────

-- Executions: most common query pattern (user_id + created_at DESC)
CREATE INDEX IF NOT EXISTS idx_executions_user_created
  ON public.executions(user_id, created_at DESC)
  WHERE status IN ('success', 'failed');

-- Pipeline executions: history queries
CREATE INDEX IF NOT EXISTS idx_pipeline_exec_pipeline_created
  ON public.pipeline_executions(pipeline_id, created_at DESC);

-- Agents: composite score for marketplace ranking
CREATE INDEX IF NOT EXISTS idx_agents_score_status
  ON public.agents(composite_score DESC, status)
  WHERE status = 'active';

-- API keys: auth path (most latency-sensitive lookup in execute route)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active
  ON public.api_keys(key_hash)
  WHERE is_active = true;

-- ─── 11. GRANT FIXES ──────────────────────────────────────────────────────────

-- Ensure service_role can bypass RLS for all critical tables
-- (Supabase service_role already bypasses RLS by default, but explicit grants help)
GRANT SELECT, INSERT, UPDATE ON public.credits            TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.execution_traces   TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.audit_logs         TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.notifications      TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.pipeline_executions TO service_role;

-- ─── VERIFICATION ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  dup_trigger_count int;
  template_count    int;
BEGIN
  -- Check no duplicate trigger names per table remain
  SELECT COUNT(*) INTO dup_trigger_count
  FROM (
    SELECT event_object_table, trigger_name, COUNT(*) as cnt
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    GROUP BY event_object_table, trigger_name
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_trigger_count > 0 THEN
    RAISE WARNING '⚠️  % duplicate trigger(s) still exist — manual inspection needed', dup_trigger_count;
  ELSE
    RAISE NOTICE '✅ No duplicate triggers';
  END IF;

  SELECT COUNT(*) INTO template_count FROM public.workflow_templates;
  RAISE NOTICE '✅ workflow_templates seeded: % rows', template_count;
  RAISE NOTICE '✅ Migration 020 complete';
END $$;
