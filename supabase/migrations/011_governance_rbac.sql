-- ============================================================
-- Migration 011: Governance, RBAC hardening, RLHF feedback
-- Run ONCE in Supabase SQL Editor. All statements idempotent.
-- ============================================================

-- ── 1. agent_feedback table (RLHF signal collection) ──────────────────────
CREATE TABLE IF NOT EXISTS public.agent_feedback (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id  UUID         NOT NULL REFERENCES public.executions(id) ON DELETE CASCADE,
  agent_id      UUID         REFERENCES public.agents(id) ON DELETE SET NULL,
  user_id       UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating        SMALLINT     CHECK (rating >= 1 AND rating <= 5),
  thumbs        TEXT         CHECK (thumbs IN ('up','down')),
  comment       TEXT,
  issue_type    TEXT         CHECK (issue_type IN ('wrong_output','too_slow','too_expensive','hallucination','unhelpful','other')),
  created_at    TIMESTAMPTZ  DEFAULT now(),
  updated_at    TIMESTAMPTZ  DEFAULT now(),
  UNIQUE(execution_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_agent   ON public.agent_feedback(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user    ON public.agent_feedback(user_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_rating  ON public.agent_feedback(rating)   WHERE rating IS NOT NULL;

ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='agent_feedback' AND policyname='feedback_own_read') THEN
    CREATE POLICY "feedback_own_read"  ON public.agent_feedback FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY "feedback_own_write" ON public.agent_feedback FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY "feedback_own_update" ON public.agent_feedback FOR UPDATE USING (user_id = auth.uid());
    -- Agent sellers can read feedback on their agents
    CREATE POLICY "feedback_seller_read" ON public.agent_feedback FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.agents WHERE id = agent_feedback.agent_id AND seller_id = auth.uid()));
    -- Admins see everything
    CREATE POLICY "feedback_admin_all" ON public.agent_feedback FOR ALL
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.agent_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_feedback TO service_role;

-- ── 2. governance_events table (structured audit with severity) ───────────
CREATE TABLE IF NOT EXISTS public.governance_events (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type   TEXT         NOT NULL,  -- 'rbac_violation'|'quota_exceeded'|'injection_blocked'|'agent_suspended'
  severity     TEXT         NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  actor_id     TEXT,
  resource     TEXT,
  resource_id  UUID,
  details      JSONB        DEFAULT '{}',
  ip_address   INET,
  created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_type     ON public.governance_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_severity ON public.governance_events(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_user     ON public.governance_events(user_id, created_at DESC);

ALTER TABLE public.governance_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='governance_events' AND policyname='governance_admin_read') THEN
    CREATE POLICY "governance_admin_read" ON public.governance_events FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
    CREATE POLICY "governance_system_insert" ON public.governance_events FOR INSERT WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT ON public.governance_events TO authenticated, service_role;
GRANT SELECT ON public.governance_events TO service_role;

-- ── 3. Add score column to injection_attempts (if missing) ─────────────────
ALTER TABLE public.injection_attempts ADD COLUMN IF NOT EXISTS score NUMERIC DEFAULT 0;

-- ── 4. Add RBAC role enum enforcement ──────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
      CHECK (role IN ('user', 'seller', 'admin'));
  END IF;
END $$;

-- ── 5. Agent seller role auto-promotion ────────────────────────────────────
-- When a user publishes their first agent (status=active), promote to seller.
CREATE OR REPLACE FUNCTION public.auto_promote_to_seller()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    UPDATE public.profiles
      SET role = CASE WHEN role = 'user' THEN 'seller' ELSE role END,
          updated_at = now()
    WHERE id = NEW.seller_id
      AND role = 'user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_activated_promote_seller ON public.agents;
CREATE TRIGGER on_agent_activated_promote_seller
  AFTER UPDATE ON public.agents
  FOR EACH ROW EXECUTE PROCEDURE public.auto_promote_to_seller();

-- ── 6. aggregate_daily_analytics function (missing, needed for cron) ───────
CREATE OR REPLACE FUNCTION public.aggregate_daily_analytics()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count INTEGER := 0;
  v_agent_id UUID;
  v_today DATE := CURRENT_DATE - 1;  -- aggregate yesterday
BEGIN
  FOR v_agent_id IN SELECT DISTINCT agent_id FROM public.executions WHERE DATE(created_at) = v_today LOOP
    INSERT INTO public.agent_analytics (agent_id, date, executions, revenue, avg_latency_ms, success_rate)
    SELECT
      v_agent_id,
      v_today,
      COUNT(*),
      COALESCE(SUM(cost_usd), 0),
      COALESCE(AVG(latency_ms)::INTEGER, 0),
      CASE WHEN COUNT(*) > 0
        THEN ROUND(COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / COUNT(*) * 100, 2)
        ELSE 0 END
    FROM public.executions
    WHERE agent_id = v_agent_id AND DATE(created_at) = v_today
    ON CONFLICT (agent_id, date) DO UPDATE SET
      executions  = EXCLUDED.executions,
      revenue     = EXCLUDED.revenue,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      success_rate   = EXCLUDED.success_rate;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aggregate_daily_analytics() TO service_role;

-- ── 7. Make injection_attempts score column safe ────────────────────────────
UPDATE public.injection_attempts SET score = 0 WHERE score IS NULL;

-- ── 8. Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('agent_feedback','governance_events');
  RAISE NOTICE '✅ New governance tables: % / 2', v_count;

  SELECT COUNT(*) INTO v_count FROM pg_trigger
  WHERE tgname = 'on_agent_activated_promote_seller';
  RAISE NOTICE '✅ Auto-promote trigger: %', CASE WHEN v_count=1 THEN 'OK' ELSE 'MISSING' END;

  RAISE NOTICE '✅ Migration 011 complete';
END $$;
