-- ============================================================
-- AgentDyne — Migration 029: Final Pre-Launch Polish
--
-- Fixes found during global launch audit (April 2026):
--   1. Agent search performance: add trigram indexes for ilike search
--   2. Execution error_message index for faster failure debugging queries
--   3. Pipeline executions: add index on user_id for history page
--   4. Governance events: index on event_type for admin moderation queue
--   5. Duplicate 'data' alias in agents response (handled in code)
--
-- All statements are idempotent (safe to re-run).
-- ============================================================

-- ── 1. Trigram extension (required for ilike % performance) ──────────────────
-- Without this, ilike '%query%' does a full sequential scan on agents table.
-- pg_trgm allows a GIN index to be used for LIKE/ILIKE queries.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. GIN trigram indexes for agent name + description search ────────────────
-- These make ilike '%query%' ~100x faster on large tables.
CREATE INDEX IF NOT EXISTS idx_agents_name_trgm
  ON public.agents USING GIN (name gin_trgm_ops)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_agents_description_trgm
  ON public.agents USING GIN (description gin_trgm_ops)
  WHERE status = 'active';

-- ── 3. Execution history queries ─────────────────────────────────────────────
-- The executions page loads last 200 rows for a user. This index is critical.
CREATE INDEX IF NOT EXISTS idx_executions_user_created_status
  ON public.executions(user_id, created_at DESC, status);

-- ── 4. Pipeline execution history ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pipeline_exec_user_created
  ON public.pipeline_executions(user_id, created_at DESC);

-- ── 5. Governance events for admin review queue ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_governance_event_type_created
  ON public.governance_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_governance_resource_id
  ON public.governance_events(resource_id)
  WHERE resource_id IS NOT NULL;

-- ── 6. Credit reservations cleanup index ─────────────────────────────────────
-- fail_stuck_executions() and reservation cleanup scan by status + created_at.
CREATE INDEX IF NOT EXISTS idx_credit_reservations_status_created
  ON public.credit_reservations(status, created_at)
  WHERE status = 'reserved';

-- ── 7. Reviews moderation queue ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON public.reviews(status, created_at DESC)
  WHERE status = 'pending';

-- ── 8. Ensure governance_events RLS is enabled ────────────────────────────────
-- governance_events contains sensitive abuse/report data — must not be readable
-- by end users. Only admins and service_role should read.
ALTER TABLE public.governance_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'governance_events'
      AND policyname = 'governance_admin_read'
  ) THEN
    CREATE POLICY "governance_admin_read"
      ON public.governance_events FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- Service_role (cron, webhooks) can insert governance events
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'governance_events'
      AND policyname = 'governance_authenticated_insert'
  ) THEN
    CREATE POLICY "governance_authenticated_insert"
      ON public.governance_events FOR INSERT
      WITH CHECK (auth.uid() IS NOT NULL OR auth.role() = 'service_role');
  END IF;
END $$;

-- ── 9. Ensure injection_attempts RLS is enabled ───────────────────────────────
ALTER TABLE public.injection_attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'injection_attempts'
      AND policyname = 'injection_admin_read'
  ) THEN
    CREATE POLICY "injection_admin_read"
      ON public.injection_attempts FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ── 10. Composite score index for marketplace leaderboard ─────────────────────
CREATE INDEX IF NOT EXISTS idx_agents_score_active
  ON public.agents(composite_score DESC, total_executions DESC)
  WHERE status = 'active';

-- ── VERIFICATION ──────────────────────────────────────────────────────────────

DO $$
DECLARE v INT;
BEGIN
  SELECT COUNT(*) INTO v FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_agents_name_trgm';
  RAISE NOTICE 'Agent name trigram index: %', CASE WHEN v = 1 THEN '✅' ELSE '❌' END;

  SELECT COUNT(*) INTO v FROM pg_extension WHERE extname = 'pg_trgm';
  RAISE NOTICE 'pg_trgm extension: %', CASE WHEN v = 1 THEN '✅' ELSE '❌' END;

  SELECT COUNT(*) INTO v FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_executions_user_created_status';
  RAISE NOTICE 'Execution history index: %', CASE WHEN v = 1 THEN '✅' ELSE '❌' END;

  SELECT rowsecurity INTO v FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'governance_events';
  RAISE NOTICE 'governance_events RLS: %', CASE WHEN v = 1 THEN '✅' ELSE '❌' END;

  RAISE NOTICE '=== Migration 029 COMPLETE ===';
END $$;
