-- ============================================================
-- AgentDyne Migration 033 — RLS Policies + Builder Flow Fix
-- FIX: removed 'rejected' from agent_status enum (not a valid value)
-- Valid agent_status values: draft, pending_review, active, suspended, archived
-- ============================================================

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_public_read"       ON public.agents;
DROP POLICY IF EXISTS "agents_seller_insert"     ON public.agents;
DROP POLICY IF EXISTS "agents_seller_update"     ON public.agents;
DROP POLICY IF EXISTS "agents_seller_delete"     ON public.agents;
DROP POLICY IF EXISTS "agents_seller_read_own"   ON public.agents;
DROP POLICY IF EXISTS "agents_seller_own"        ON public.agents;
DROP POLICY IF EXISTS "Active agents are viewable by everyone" ON public.agents;
DROP POLICY IF EXISTS "Sellers can insert agents"             ON public.agents;
DROP POLICY IF EXISTS "Sellers can update own agents"         ON public.agents;
DROP POLICY IF EXISTS "agents_public_read"                    ON public.agents;

-- Public can read active agents
CREATE POLICY "agents_public_read" ON public.agents
  FOR SELECT USING (status = 'active');

-- Sellers read their own agents regardless of status
CREATE POLICY "agents_seller_read_own" ON public.agents
  FOR SELECT USING (seller_id = auth.uid());

-- Authenticated users can insert their own agents
CREATE POLICY "agents_seller_insert" ON public.agents
  FOR INSERT WITH CHECK (
    seller_id = auth.uid()
    AND auth.uid() IS NOT NULL
  );

-- Sellers can update their own agents
CREATE POLICY "agents_seller_update" ON public.agents
  FOR UPDATE USING (seller_id = auth.uid());

-- Sellers can delete their own non-active agents
-- FIX: 'rejected' is NOT a valid agent_status enum value → removed
-- Valid: draft, pending_review, active, suspended, archived
CREATE POLICY "agents_seller_delete" ON public.agents
  FOR DELETE USING (
    seller_id = auth.uid()
    AND status IN ('draft', 'suspended', 'archived')
  );

-- ── executions ───────────────────────────────────────────────────────────────
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "executions_user_read"   ON public.executions;

CREATE POLICY "executions_user_read" ON public.executions
  FOR SELECT USING (user_id = auth.uid());

-- ── profiles ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_public_read" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"            ON public.profiles;

CREATE POLICY "profiles_public_read" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- ── notifications ─────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_user_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_user_update" ON public.notifications;

CREATE POLICY "notifications_user_select" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_user_update" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

-- ── credits ──────────────────────────────────────────────────────────────────
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credits_user_read" ON public.credits;

CREATE POLICY "credits_user_read" ON public.credits
  FOR SELECT USING (user_id = auth.uid());

-- ── credit_reservations ───────────────────────────────────────────────────────
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_reservations_user_read" ON public.credit_reservations;

CREATE POLICY "credit_reservations_user_read" ON public.credit_reservations
  FOR SELECT USING (user_id = auth.uid());

-- ── pipelines ─────────────────────────────────────────────────────────────────
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipelines_public_read" ON public.pipelines;
DROP POLICY IF EXISTS "pipelines_owner_all"   ON public.pipelines;

CREATE POLICY "pipelines_public_read" ON public.pipelines
  FOR SELECT USING (is_public = true);

CREATE POLICY "pipelines_owner_all" ON public.pipelines
  FOR ALL USING (owner_id = auth.uid());

-- ── agent_feedback ────────────────────────────────────────────────────────────
ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_feedback_user_insert" ON public.agent_feedback;
DROP POLICY IF EXISTS "agent_feedback_user_read"   ON public.agent_feedback;

CREATE POLICY "agent_feedback_user_insert" ON public.agent_feedback
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "agent_feedback_user_read" ON public.agent_feedback
  FOR SELECT USING (true);

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
DECLARE pol_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pol_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'agents_public_read','agents_seller_insert','agents_seller_update',
      'agents_seller_delete','agents_seller_read_own',
      'executions_user_read',
      'notifications_user_select','notifications_user_update',
      'credits_user_read',
      'pipelines_public_read','pipelines_owner_all',
      'agent_feedback_user_insert','agent_feedback_user_read'
    );
  RAISE NOTICE '=== Migration 033 ===';
  RAISE NOTICE 'RLS policies verified: %', pol_count;
  RAISE NOTICE 'agents DELETE policy: uses draft/suspended/archived (no rejected - not in enum)';
  RAISE NOTICE '=== Migration 033 COMPLETE ===';
END $$;
