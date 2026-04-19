-- ============================================================
-- Migration 013: Production hardening, review queue, security
-- Verified against live schema snapshot (April 2026).
-- All statements fully idempotent — safe to re-run.
-- ============================================================

-- ── 1. review_status enum: add 'pending' + 'rejected' values ─────────────
-- Live schema: reviews.status defaults to 'approved'. The admin review
-- queue requires 'pending' so new submissions are not auto-published.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'pending'
      AND enumtypid = 'public.review_status'::regtype
  ) THEN
    ALTER TYPE public.review_status ADD VALUE IF NOT EXISTS 'pending';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'review_status pending: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'rejected'
      AND enumtypid = 'public.review_status'::regtype
  ) THEN
    ALTER TYPE public.review_status ADD VALUE IF NOT EXISTS 'rejected';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'review_status rejected: %', SQLERRM;
END $$;

-- ── 2. Default new reviews to 'pending' (not 'approved') ─────────────────
ALTER TABLE public.reviews
  ALTER COLUMN status SET DEFAULT 'pending'::review_status;

-- ── 3. agent_analytics: add columns written by aggregate function ─────────
ALTER TABLE public.agent_analytics
  ADD COLUMN IF NOT EXISTS success_rate NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_in    BIGINT        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_out   BIGINT        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd     NUMERIC(10,6) DEFAULT 0;

-- Unique index required for ON CONFLICT (agent_id, date) upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_analytics_agent_date
  ON public.agent_analytics(agent_id, date);

-- ── 4. Executions: guard columns that app code writes ────────────────────
ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS cost_usd     NUMERIC(10,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost         NUMERIC(10,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_saved INTEGER       DEFAULT 0;

-- Back-fill cost from cost_usd where cost is still 0
UPDATE public.executions
SET cost = cost_usd
WHERE cost = 0 AND cost_usd > 0;

-- ── 5. Performance indexes ─────────────────────────────────────────────────
-- Executions
CREATE INDEX IF NOT EXISTS idx_executions_user_status
  ON public.executions(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_agent_status
  ON public.executions(agent_id, status, created_at DESC);

-- Agents (FIFO review queue + admin filters)
CREATE INDEX IF NOT EXISTS idx_agents_status_created
  ON public.agents(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agents_seller_status
  ON public.agents(seller_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_category_status
  ON public.agents(category, status, created_at DESC);

-- Notifications (unread bell badge)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);

-- Reviews (admin moderation queue + marketplace display)
CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON public.reviews(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_reviews_agent_status_created
  ON public.reviews(agent_id, status, created_at DESC);

-- Injection attempts (admin security tab)
CREATE INDEX IF NOT EXISTS idx_injection_action_created
  ON public.injection_attempts(action, created_at DESC);

-- API keys (hash lookup on every execution — must be fast)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active
  ON public.api_keys(key_hash) WHERE is_active = TRUE;

-- Agent subscriptions (checked before every subscription-gated execution)
CREATE INDEX IF NOT EXISTS idx_agent_subs_user_agent
  ON public.agent_subscriptions(user_id, agent_id, status);

-- ── 6. Review RLS policies ─────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reviews' AND policyname = 'reviews_public_read'
  ) THEN
    CREATE POLICY "reviews_public_read" ON public.reviews
      FOR SELECT USING (status = 'approved');

    CREATE POLICY "reviews_own_read" ON public.reviews
      FOR SELECT USING (user_id = auth.uid());

    CREATE POLICY "reviews_own_insert" ON public.reviews
      FOR INSERT WITH CHECK (user_id = auth.uid());

    CREATE POLICY "reviews_own_update" ON public.reviews
      FOR UPDATE USING (user_id = auth.uid());

    CREATE POLICY "reviews_seller_read" ON public.reviews
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.agents
          WHERE id    = reviews.agent_id
            AND seller_id = auth.uid()
        )
      );

    CREATE POLICY "reviews_admin_all" ON public.reviews
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ── 7. Audit logs RLS ─────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs' AND policyname = 'audit_admin_read'
  ) THEN
    CREATE POLICY "audit_admin_read" ON public.audit_logs
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
    CREATE POLICY "audit_system_insert" ON public.audit_logs
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ── 8. increment_executions_used() ───────────────────────────────────────
-- Called by every execute route. DROP first — return type may mismatch.
DROP FUNCTION IF EXISTS public.increment_executions_used(UUID);
CREATE FUNCTION public.increment_executions_used(user_id_param UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET
    executions_used_this_month = executions_used_this_month + 1,
    updated_at = now()
  WHERE id = user_id_param;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_executions_used(UUID)
  TO authenticated, service_role;

-- ── 9. reset_monthly_quotas() ────────────────────────────────────────────
-- Called by pg_cron. Was previously VOID — now returns row count.
-- Must DROP first; PostgreSQL forbids changing return type via REPLACE.
DROP FUNCTION IF EXISTS public.reset_monthly_quotas();
CREATE FUNCTION public.reset_monthly_quotas()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.profiles
  SET
    executions_used_this_month = 0,
    quota_reset_date            = now() + INTERVAL '30 days',
    updated_at                  = now()
  WHERE quota_reset_date <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_monthly_quotas()
  TO service_role;

-- ── 10. cleanup_rate_limit_counters() ────────────────────────────────────
-- Was previously VOID — now returns row count. Must DROP first.
DROP FUNCTION IF EXISTS public.cleanup_rate_limit_counters();
CREATE FUNCTION public.cleanup_rate_limit_counters()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.rate_limit_counters
  WHERE window_end < now() - INTERVAL '1 hour';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_counters()
  TO service_role;

-- ── 11. increment_agent_executions() — trigger ───────────────────────────
-- TRIGGER functions always RETURN TRIGGER — safe to use CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.increment_agent_executions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'success' AND (OLD IS NULL OR OLD.status != 'success') THEN
    UPDATE public.agents
    SET
      total_executions      = total_executions + 1,
      successful_executions = successful_executions + 1,
      updated_at            = now()
    WHERE id = NEW.agent_id;

    UPDATE public.profiles
    SET
      total_spent = total_spent + COALESCE(NEW.cost_usd, 0),
      updated_at  = now()
    WHERE id = NEW.user_id;

  ELSIF NEW.status = 'failed' AND (OLD IS NULL OR OLD.status != 'failed') THEN
    UPDATE public.agents
    SET
      total_executions = total_executions + 1,
      updated_at       = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_execution_completed ON public.executions;
CREATE TRIGGER on_execution_completed
  AFTER INSERT OR UPDATE OF status ON public.executions
  FOR EACH ROW EXECUTE PROCEDURE public.increment_agent_executions();

-- ── 12. refresh_agent_rating() — trigger ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_agent_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_agent_id UUID;
BEGIN
  v_agent_id := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.agent_id ELSE NEW.agent_id END,
    OLD.agent_id
  );

  UPDATE public.agents
  SET
    average_rating = (
      SELECT COALESCE(AVG(rating::NUMERIC), 0)
      FROM   public.reviews
      WHERE  agent_id = v_agent_id
        AND  status   = 'approved'
    ),
    total_reviews = (
      SELECT COUNT(*)
      FROM   public.reviews
      WHERE  agent_id = v_agent_id
        AND  status   = 'approved'
    ),
    updated_at = now()
  WHERE id = v_agent_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_review_change ON public.reviews;
CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE PROCEDURE public.refresh_agent_rating();

-- ── 13. update_seller_earnings() — trigger ───────────────────────────────
CREATE OR REPLACE FUNCTION public.update_seller_earnings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.status = 'succeeded' AND (OLD IS NULL OR OLD.status != 'succeeded') THEN
    UPDATE public.profiles
    SET
      total_earned = total_earned + COALESCE(NEW.seller_amount, 0),
      updated_at   = now()
    WHERE id = NEW.seller_id;

    UPDATE public.agents
    SET
      total_revenue = total_revenue + COALESCE(NEW.seller_amount, 0),
      updated_at    = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_transaction_settled ON public.transactions;
CREATE TRIGGER on_transaction_settled
  AFTER INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE public.update_seller_earnings();

-- ── 14. assign_waitlist_position() — trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_waitlist_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.position := (SELECT COALESCE(MAX(position), 0) + 1 FROM public.waitlist);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_waitlist_insert ON public.waitlist;
CREATE TRIGGER before_waitlist_insert
  BEFORE INSERT ON public.waitlist
  FOR EACH ROW EXECUTE PROCEDURE public.assign_waitlist_position();

-- ── 15. handle_new_user() — trigger ──────────────────────────────────────
-- Auto-creates profile + credits row on auth.users INSERT.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.credits (user_id, balance_usd, total_purchased, total_spent)
  VALUES (NEW.id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ── 16. Admin platform stats view ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.admin_platform_stats AS
SELECT
  (SELECT COUNT(*)
     FROM public.profiles)                                             AS total_users,
  (SELECT COUNT(*)
     FROM public.agents   WHERE status = 'active')                    AS active_agents,
  (SELECT COUNT(*)
     FROM public.agents   WHERE status = 'pending_review')            AS pending_review,
  (SELECT COUNT(*)
     FROM public.executions)                                           AS total_executions,
  (SELECT COALESCE(SUM(amount), 0)
     FROM public.transactions WHERE status = 'succeeded')             AS gross_revenue,
  (SELECT COALESCE(SUM(amount), 0) * 0.20
     FROM public.transactions WHERE status = 'succeeded')             AS platform_revenue,
  (SELECT COUNT(*)
     FROM public.injection_attempts WHERE action = 'blocked')         AS blocked_attempts,
  (SELECT COUNT(*)
     FROM public.injection_attempts WHERE action = 'flagged')         AS flagged_attempts,
  (SELECT COUNT(*)
     FROM public.reviews  WHERE status = 'pending')                   AS pending_reviews,
  (SELECT COUNT(*)
     FROM public.profiles WHERE is_banned = TRUE)                     AS banned_users;

GRANT SELECT ON public.admin_platform_stats TO authenticated;

-- ── 17. Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_pending   TEXT;
  v_rejected  TEXT;
  v_funcs     INT;
  v_triggers  INT;
BEGIN
  SELECT enumlabel INTO v_pending
  FROM pg_enum
  WHERE enumlabel = 'pending'
    AND enumtypid = 'public.review_status'::regtype;

  SELECT enumlabel INTO v_rejected
  FROM pg_enum
  WHERE enumlabel = 'rejected'
    AND enumtypid = 'public.review_status'::regtype;

  RAISE NOTICE 'review_status.pending  : %', COALESCE(v_pending,  '❌ MISSING');
  RAISE NOTICE 'review_status.rejected : %', COALESCE(v_rejected, '❌ MISSING');

  SELECT COUNT(*) INTO v_funcs FROM pg_proc
  WHERE proname IN (
    'increment_executions_used', 'reset_monthly_quotas',
    'refresh_agent_rating',      'update_seller_earnings',
    'increment_agent_executions','cleanup_rate_limit_counters',
    'assign_waitlist_position',  'handle_new_user'
  );
  RAISE NOTICE 'Core functions installed : % / 8', v_funcs;

  SELECT COUNT(*) INTO v_triggers FROM pg_trigger
  WHERE tgname IN (
    'on_execution_completed', 'on_review_change',
    'on_transaction_settled', 'before_waitlist_insert',
    'on_auth_user_created'
  );
  RAISE NOTICE 'Core triggers installed  : % / 5', v_triggers;

  RAISE NOTICE '✅ Migration 013 complete';
END $$;
