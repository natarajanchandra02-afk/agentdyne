-- =============================================================================
-- AgentDyne — Migration 028: DEFINITIVE SECURITY & STABILITY FIX
-- April 25, 2026 | Run in Supabase SQL Editor → New Query → Run
-- 026 must have already run (v_balance credit functions fixed).
-- This migration is 100% idempotent — safe to re-run.
--
-- FIXES IN THIS VERSION (v3 — corrected):
--   ✅ 42601 error  — FOR loop needs DECLARE r RECORD; and no parentheses
--   ✅ search_rag_chunks param names — must match TypeScript callers exactly
--   ✅ Missing UNIQUE constraints for ON CONFLICT clauses
--   ✅ 8 SECURITY DEFINER views → recreated with security_invoker = on
--   ✅ 44+ functions missing SET search_path → all recreated
--   ✅ RLS "always true" policies → scoped to service_role
--   ✅ Duplicate avatar storage policies → deduplicated
--   ✅ Performance indices
--   ✅ Canonical pg_cron schedule
-- =============================================================================

-- ===========================================================================
-- SECTION 0: PRE-FLIGHT — DROP EVERYTHING THAT WILL BE RECREATED
-- Must drop before CREATE because PostgreSQL 42P13 prohibits renaming
-- parameters via CREATE OR REPLACE. DROP first removes old dependency graph.
-- ===========================================================================

-- Drop credit + execution functions (all overloads)
DROP FUNCTION IF EXISTS public.reserve_credits(UUID, NUMERIC, UUID)             CASCADE;
DROP FUNCTION IF EXISTS public.reserve_credits(UUID, NUMERIC)                    CASCADE;
DROP FUNCTION IF EXISTS public.commit_credit_reservation(UUID, NUMERIC)          CASCADE;
DROP FUNCTION IF EXISTS public.release_credit_reservation(UUID)                  CASCADE;
DROP FUNCTION IF EXISTS public.fail_stuck_executions()                           CASCADE;
DROP FUNCTION IF EXISTS public.add_credits(UUID, NUMERIC, TEXT, UUID)            CASCADE;
DROP FUNCTION IF EXISTS public.deduct_credits(UUID, NUMERIC, TEXT, UUID)         CASCADE;
DROP FUNCTION IF EXISTS public.get_concurrent_executions(UUID)                   CASCADE;
DROP FUNCTION IF EXISTS public.get_concurrent_execution_count(UUID)              CASCADE;
DROP FUNCTION IF EXISTS public.increment_executions_used(UUID)                   CASCADE;
DROP FUNCTION IF EXISTS public.increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER)  CASCADE;
DROP FUNCTION IF EXISTS public.increment_cache_hits(TEXT)                        CASCADE;
DROP FUNCTION IF EXISTS public.compute_agent_score(UUID)                         CASCADE;
DROP FUNCTION IF EXISTS public.refresh_agent_rankings()                          CASCADE;
DROP FUNCTION IF EXISTS public.compute_all_agent_scores()                        CASCADE;
DROP FUNCTION IF EXISTS public.aggregate_daily_analytics()                       CASCADE;
DROP FUNCTION IF EXISTS public.aggregate_agent_analytics_yesterday()             CASCADE;
DROP FUNCTION IF EXISTS public.reset_monthly_quotas()                            CASCADE;
DROP FUNCTION IF EXISTS public.reset_monthly_execution_quotas()                  CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_expired_memory()                          CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_expired_memories()                        CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_execution_cache()                         CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_expired_cache()                           CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_rate_limit_counters()                     CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_processed_stripe_events()                 CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_old_stripe_events()                       CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_expired_idempotency_keys()                CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_old_injection_attempts()                  CASCADE;
DROP FUNCTION IF EXISTS public.send_quota_warning_notifications()                CASCADE;
DROP FUNCTION IF EXISTS public.upsert_agent_memory(UUID, UUID, TEXT, JSONB, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.increment_agent_pipeline_use(UUID, UUID, UUID)   CASCADE;
DROP FUNCTION IF EXISTS public.upsert_pipeline_usage(UUID, UUID, UUID)          CASCADE;
DROP FUNCTION IF EXISTS public.upsert_agent_pipeline_usage(UUID, UUID, UUID)    CASCADE;
DROP FUNCTION IF EXISTS public.increment_kb_doc_count(UUID)                     CASCADE;
DROP FUNCTION IF EXISTS public.decrement_kb_doc_count(UUID)                     CASCADE;
DROP FUNCTION IF EXISTS public.compute_context_hash(UUID, TEXT)                 CASCADE;
DROP FUNCTION IF EXISTS public.is_email_verified(UUID)                          CASCADE;
DROP FUNCTION IF EXISTS public.sync_email_confirmed()                           CASCADE;
DROP FUNCTION IF EXISTS public.assign_waitlist_position()                       CASCADE;
DROP FUNCTION IF EXISTS public.dag_has_cycle(JSONB)                             CASCADE;
DROP FUNCTION IF EXISTS public.expire_hitl_approvals()                          CASCADE;
DROP FUNCTION IF EXISTS public.reset_share_key_daily_limits()                   CASCADE;
DROP FUNCTION IF EXISTS public.enqueue_agent_status_email()                     CASCADE;
DROP FUNCTION IF EXISTS public.increment_agent_executions_count(UUID)           CASCADE;
DROP FUNCTION IF EXISTS public.update_agent_cost_analytics()                    CASCADE;
DROP FUNCTION IF EXISTS public.increment_seller_earned(UUID, NUMERIC)           CASCADE;

-- Drop views (will recreate with security_invoker = on)
DROP VIEW IF EXISTS public.agent_leaderboard     CASCADE;
DROP VIEW IF EXISTS public.user_credit_summary   CASCADE;
DROP VIEW IF EXISTS public.agent_trace_summary   CASCADE;
DROP VIEW IF EXISTS public.agent_capabilities    CASCADE;
DROP VIEW IF EXISTS public.admin_platform_stats  CASCADE;
DROP VIEW IF EXISTS public.user_abuse_summary    CASCADE;
DROP VIEW IF EXISTS public.agent_pipeline_stats  CASCADE;
DROP VIEW IF EXISTS public.agents_search         CASCADE;
DROP VIEW IF EXISTS public.profiles_public       CASCADE;

-- Drop trigger functions (need search_path added)
DROP FUNCTION IF EXISTS public.handle_new_user()             CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user_credits()     CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at()              CASCADE;
DROP FUNCTION IF EXISTS public.increment_agent_executions()  CASCADE;
DROP FUNCTION IF EXISTS public.update_agent_stats()          CASCADE;
DROP FUNCTION IF EXISTS public.update_agent_rating()         CASCADE;
DROP FUNCTION IF EXISTS public.refresh_agent_rating()        CASCADE;
DROP FUNCTION IF EXISTS public.update_seller_earnings()      CASCADE;
DROP FUNCTION IF EXISTS public.update_pipeline_stats()       CASCADE;
DROP FUNCTION IF EXISTS public.auto_promote_to_seller()      CASCADE;

-- FIX 42601: FOR loop variable MUST be declared as RECORD, and no parentheses
-- Correct syntax: FOR r IN SELECT ... (not FOR r IN (SELECT ...))
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_agents_semantic'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_rag_chunks'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;


-- ===========================================================================
-- SECTION 0B: ENSURE MISSING UNIQUE CONSTRAINTS EXIST
-- These are required for ON CONFLICT clauses to work.
-- Using CREATE UNIQUE INDEX IF NOT EXISTS — fully idempotent.
-- ===========================================================================

-- agent_analytics(agent_id, date): required by aggregate_daily_analytics ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_analytics'::regclass
      AND contype   = 'u'
      AND conname   IN ('agent_analytics_agent_id_date_key', 'uq_agent_analytics_agent_date')
  ) THEN
    -- Deduplicate first (keep latest per agent+date)
    DELETE FROM public.agent_analytics a
    WHERE a.id NOT IN (
      SELECT DISTINCT ON (agent_id, date) id
      FROM public.agent_analytics
      ORDER BY agent_id, date, id DESC
    );
    ALTER TABLE public.agent_analytics
      ADD CONSTRAINT uq_agent_analytics_agent_date UNIQUE (agent_id, date);
    RAISE NOTICE '✅ Added UNIQUE(agent_id, date) on agent_analytics';
  ELSE
    RAISE NOTICE '✅ agent_analytics UNIQUE constraint already exists';
  END IF;
END $$;

-- agent_memory(user_id, agent_id, key): required by upsert_agent_memory ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_memory'::regclass
      AND contype   = 'u'
  ) THEN
    -- Deduplicate first
    DELETE FROM public.agent_memory a
    WHERE a.id NOT IN (
      SELECT DISTINCT ON (user_id, agent_id, key) id
      FROM public.agent_memory
      ORDER BY user_id, agent_id, key, updated_at DESC NULLS LAST
    );
    ALTER TABLE public.agent_memory
      ADD CONSTRAINT uq_agent_memory_user_agent_key UNIQUE (user_id, agent_id, key);
    RAISE NOTICE '✅ Added UNIQUE(user_id, agent_id, key) on agent_memory';
  ELSE
    RAISE NOTICE '✅ agent_memory UNIQUE constraint already exists';
  END IF;
END $$;

-- agent_pipeline_usage(agent_id, pipeline_id): required by increment_agent_pipeline_use ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_pipeline_usage'::regclass
      AND contype   = 'u'
  ) THEN
    -- Deduplicate first (keep row with highest use_count)
    DELETE FROM public.agent_pipeline_usage a
    WHERE a.id NOT IN (
      SELECT DISTINCT ON (agent_id, pipeline_id) id
      FROM public.agent_pipeline_usage
      ORDER BY agent_id, pipeline_id, use_count DESC, id DESC
    );
    ALTER TABLE public.agent_pipeline_usage
      ADD CONSTRAINT uq_agent_pipeline_usage_agent_pipeline UNIQUE (agent_id, pipeline_id);
    RAISE NOTICE '✅ Added UNIQUE(agent_id, pipeline_id) on agent_pipeline_usage';
  ELSE
    RAISE NOTICE '✅ agent_pipeline_usage UNIQUE constraint already exists';
  END IF;
END $$;

-- pipeline_versions(pipeline_id, version): required by pipeline execute route upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pipeline_versions'::regclass
      AND contype   = 'u'
      AND conname  != 'pipeline_versions_pkey'
  ) THEN
    DELETE FROM public.pipeline_versions a
    WHERE a.id NOT IN (
      SELECT DISTINCT ON (pipeline_id, version) id
      FROM public.pipeline_versions
      ORDER BY pipeline_id, version, snapshot_at DESC NULLS LAST
    );
    ALTER TABLE public.pipeline_versions
      ADD CONSTRAINT uq_pipeline_versions_pipeline_version UNIQUE (pipeline_id, version);
    RAISE NOTICE '✅ Added UNIQUE(pipeline_id, version) on pipeline_versions';
  ELSE
    RAISE NOTICE '✅ pipeline_versions UNIQUE constraint already exists';
  END IF;
END $$;


-- ===========================================================================
-- SECTION 1: TRIGGER FUNCTIONS (with SET search_path = public)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    now(), now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd, alert_threshold)
  VALUES (NEW.id, 0, 5, 1)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, title, body, type)
  VALUES (
    NEW.id,
    'Welcome to AgentDyne! 👋',
    'Explore the marketplace and run your first AI agent.',
    'welcome'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_give_credits ON public.profiles;
CREATE TRIGGER on_profile_created_give_credits
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_credits();


CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.increment_agent_executions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'success' THEN
    UPDATE public.agents
    SET total_executions      = COALESCE(total_executions, 0) + 1,
        successful_executions = COALESCE(successful_executions, 0) + 1,
        updated_at            = now()
    WHERE id = NEW.agent_id;

    UPDATE public.profiles
    SET total_spent = COALESCE(total_spent, 0) + COALESCE(NEW.cost_usd, NEW.cost, 0),
        updated_at  = now()
    WHERE id = NEW.user_id;

  ELSIF NEW.status = 'failed' THEN
    UPDATE public.agents
    SET total_executions = COALESCE(total_executions, 0) + 1,
        updated_at       = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_execution_completed ON public.executions;
CREATE TRIGGER on_execution_completed
  AFTER INSERT ON public.executions
  FOR EACH ROW
  WHEN (NEW.status = 'success')
  EXECUTE FUNCTION public.increment_agent_executions();


CREATE OR REPLACE FUNCTION public.update_agent_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('success', 'failed')
     AND OLD.status NOT IN ('success', 'failed')
  THEN
    UPDATE public.agents
    SET average_latency_ms = (
          SELECT COALESCE(AVG(latency_ms), 0)::INTEGER
          FROM public.executions
          WHERE agent_id  = NEW.agent_id
            AND status    = 'success'
            AND latency_ms IS NOT NULL
        ),
        updated_at = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_execution_complete ON public.executions;
CREATE TRIGGER on_execution_complete
  AFTER UPDATE ON public.executions
  FOR EACH ROW
  WHEN (NEW.status IN ('success','failed') AND OLD.status NOT IN ('success','failed'))
  EXECUTE FUNCTION public.update_agent_stats();


CREATE OR REPLACE FUNCTION public.update_agent_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id UUID;
BEGIN
  v_agent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.agent_id ELSE NEW.agent_id END;
  IF v_agent_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE public.agents
  SET average_rating = COALESCE(
        (SELECT AVG(rating::NUMERIC) FROM public.reviews
         WHERE agent_id = v_agent_id AND status = 'approved'), 0),
      total_reviews  = (
        SELECT COUNT(*) FROM public.reviews
        WHERE agent_id = v_agent_id AND status = 'approved'),
      updated_at = now()
  WHERE id = v_agent_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- alias used by some older migrations
CREATE OR REPLACE FUNCTION public.refresh_agent_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id UUID;
BEGIN
  v_agent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.agent_id ELSE NEW.agent_id END;
  IF v_agent_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.agents
  SET average_rating = COALESCE(
        (SELECT AVG(rating::NUMERIC) FROM public.reviews
         WHERE agent_id = v_agent_id AND status = 'approved'), 0),
      total_reviews  = (
        SELECT COUNT(*) FROM public.reviews
        WHERE agent_id = v_agent_id AND status = 'approved'),
      updated_at = now()
  WHERE id = v_agent_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_review_change ON public.reviews;
CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_agent_rating();


CREATE OR REPLACE FUNCTION public.update_seller_earnings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'succeeded' AND OLD.status IS DISTINCT FROM 'succeeded' THEN
    IF NEW.seller_id IS NOT NULL THEN
      UPDATE public.profiles
      SET total_earned = COALESCE(total_earned, 0) + COALESCE(NEW.seller_amount, 0),
          updated_at   = now()
      WHERE id = NEW.seller_id;
    END IF;
    IF NEW.agent_id IS NOT NULL THEN
      UPDATE public.agents
      SET total_revenue = COALESCE(total_revenue, 0) + COALESCE(NEW.seller_amount, 0),
          updated_at    = now()
      WHERE id = NEW.agent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_transaction_settled ON public.transactions;
CREATE TRIGGER on_transaction_settled
  AFTER UPDATE ON public.transactions
  FOR EACH ROW
  WHEN (NEW.status = 'succeeded' AND OLD.status != 'succeeded')
  EXECUTE FUNCTION public.update_seller_earnings();


CREATE OR REPLACE FUNCTION public.update_pipeline_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('success', 'failed', 'timeout') THEN
    UPDATE public.pipelines
    SET run_count       = COALESCE(run_count, 0) + 1,
        total_runs      = COALESCE(total_runs, 0) + 1,
        successful_runs = CASE WHEN NEW.status = 'success'
                               THEN COALESCE(successful_runs, 0) + 1
                               ELSE COALESCE(successful_runs, 0) END,
        last_run_at     = COALESCE(NEW.completed_at, now()),
        updated_at      = now()
    WHERE id = NEW.pipeline_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_pipeline_execution_complete ON public.pipeline_executions;
DROP TRIGGER IF EXISTS trg_update_pipeline_stats      ON public.pipeline_executions;
CREATE TRIGGER on_pipeline_execution_complete
  AFTER UPDATE OF status ON public.pipeline_executions
  FOR EACH ROW
  WHEN (NEW.status IN ('success','failed','timeout') AND OLD.status = 'running')
  EXECUTE FUNCTION public.update_pipeline_stats();


CREATE OR REPLACE FUNCTION public.auto_promote_to_seller()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE public.profiles
    SET role       = CASE WHEN role::text = 'admin' THEN 'admin'::user_role
                          ELSE 'seller'::user_role END,
        updated_at = now()
    WHERE id = NEW.seller_id
      AND role::text NOT IN ('admin', 'seller');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_activated_promote_seller ON public.agents;
CREATE TRIGGER on_agent_activated_promote_seller
  AFTER UPDATE OF status ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.auto_promote_to_seller();


CREATE OR REPLACE FUNCTION public.assign_waitlist_position()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.position := (SELECT COALESCE(MAX(position), 0) + 1 FROM public.waitlist);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_waitlist_insert ON public.waitlist;
CREATE TRIGGER before_waitlist_insert
  BEFORE INSERT ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION public.assign_waitlist_position();


CREATE OR REPLACE FUNCTION public.sync_email_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.profiles
    SET email_verified     = true,
        email_confirmed_at = NEW.email_confirmed_at,
        updated_at         = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.enqueue_agent_status_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email TEXT; v_name TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('active', 'rejected', 'suspended')
  THEN
    SELECT p.email, p.full_name INTO v_email, v_name
    FROM public.profiles p WHERE p.id = NEW.seller_id;

    IF v_email IS NOT NULL THEN
      INSERT INTO public.email_queue (to_address, template, payload)
      VALUES (
        v_email,
        CASE NEW.status
          WHEN 'active'    THEN 'agent_approved'
          WHEN 'rejected'  THEN 'agent_rejected'
          WHEN 'suspended' THEN 'agent_suspended'
        END,
        jsonb_build_object(
          'agent_name',  NEW.name,
          'agent_id',    NEW.id,
          'seller_name', v_name,
          'status',      NEW.status
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_status_change ON public.agents;
CREATE TRIGGER on_agent_status_change
  AFTER UPDATE OF status ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_agent_status_email();


-- ===========================================================================
-- SECTION 2: CREDIT FUNCTIONS
-- Parameter names MUST match TypeScript callers in execute/route.ts exactly.
-- Verified against: src/app/api/agents/[id]/execute/route.ts
--   reserve_credits:            { user_id_param, amount_param, execution_id_param }
--   commit_credit_reservation:  { reservation_id_param, actual_cost_param }
--   release_credit_reservation: { reservation_id_param }
--   increment_executions_used:  { user_id_param }
--   deduct_credits:             { user_id_param, amount_param, description_param, reference_id_param }
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.reserve_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  execution_id_param UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance        NUMERIC;
  v_new_balance    NUMERIC;
  v_reservation_id UUID;
BEGIN
  IF amount_param <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  -- Auto-release stale reservations before checking balance
  UPDATE public.credit_reservations
  SET status = 'released', resolved_at = now()
  WHERE user_id  = user_id_param
    AND status   = 'reserved'
    AND expires_at < now();

  SELECT balance_usd INTO v_balance
  FROM public.credits
  WHERE user_id = user_id_param
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd)
    VALUES (user_id_param, 0, 5)
    ON CONFLICT (user_id) DO NOTHING;
    v_balance := 0;
  END IF;

  IF v_balance < amount_param THEN
    RETURN jsonb_build_object(
      'success',  false,
      'error',    'Insufficient credits',
      'balance',  v_balance,
      'required', amount_param
    );
  END IF;

  v_new_balance := v_balance - amount_param;

  UPDATE public.credits
  SET balance_usd = v_new_balance, updated_at = now()
  WHERE user_id = user_id_param;

  INSERT INTO public.credit_reservations (user_id, reserved_usd, status, execution_id)
  VALUES (user_id_param, amount_param, 'reserved', execution_id_param)
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'success',         true,
    'reservation_id',  v_reservation_id,
    'reserved_amount', amount_param,
    'new_balance',     v_new_balance
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, NUMERIC, UUID)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.commit_credit_reservation(
  reservation_id_param UUID,
  actual_cost_param    NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res         RECORD;
  v_refund      NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  SELECT id, user_id, reserved_usd
  INTO v_res
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  v_refund := GREATEST(0, v_res.reserved_usd - COALESCE(actual_cost_param, 0));

  IF v_refund > 0 THEN
    UPDATE public.credits
    SET balance_usd = balance_usd + v_refund, updated_at = now()
    WHERE user_id = v_res.user_id;
  END IF;

  UPDATE public.credit_reservations
  SET status = 'committed', resolved_at = now()
  WHERE id = reservation_id_param;

  SELECT balance_usd INTO v_new_balance
  FROM public.credits WHERE user_id = v_res.user_id;

  INSERT INTO public.credit_transactions
    (user_id, type, amount_usd, description, reference_id, balance_after)
  VALUES (
    v_res.user_id, 'deduction',
    COALESCE(actual_cost_param, v_res.reserved_usd),
    'Agent execution (committed)',
    reservation_id_param,
    COALESCE(v_new_balance, 0)
  );

  RETURN jsonb_build_object(
    'success',     true,
    'reserved',    v_res.reserved_usd,
    'actual_cost', actual_cost_param,
    'refunded',    v_refund
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.commit_credit_reservation(UUID, NUMERIC)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.release_credit_reservation(
  reservation_id_param UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_res RECORD;
BEGIN
  SELECT id, user_id, reserved_usd
  INTO v_res
  FROM public.credit_reservations
  WHERE id = reservation_id_param AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  UPDATE public.credits
  SET balance_usd = balance_usd + v_res.reserved_usd, updated_at = now()
  WHERE user_id = v_res.user_id;

  UPDATE public.credit_reservations
  SET status = 'released', resolved_at = now()
  WHERE id = reservation_id_param;

  RETURN jsonb_build_object('success', true, 'released', v_res.reserved_usd);
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation(UUID)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.add_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  description_param  TEXT DEFAULT 'Credit top-up',
  reference_id_param UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new_balance NUMERIC;
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
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES
    (user_id_param, 'topup', amount_param, v_new_balance, description_param, reference_id_param);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.deduct_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  description_param  TEXT DEFAULT 'Agent execution',
  reference_id_param UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance     NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  SELECT balance_usd INTO v_balance
  FROM public.credits
  WHERE user_id = user_id_param
  FOR UPDATE;

  IF v_balance IS NULL THEN
    INSERT INTO public.credits (user_id, balance_usd)
    VALUES (user_id_param, 0)
    ON CONFLICT DO NOTHING;
    v_balance := 0;
  END IF;

  IF v_balance < amount_param THEN
    RETURN jsonb_build_object(
      'success',  false,
      'error',    'Insufficient credits',
      'balance',  v_balance,
      'required', amount_param
    );
  END IF;

  v_new_balance := v_balance - amount_param;

  UPDATE public.credits
  SET balance_usd = v_new_balance,
      total_spent = COALESCE(total_spent, 0) + amount_param,
      updated_at  = now()
  WHERE user_id = user_id_param;

  INSERT INTO public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES
    (user_id_param, 'deduction', amount_param, v_new_balance, description_param, reference_id_param);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance, 'deducted', amount_param);
END;
$$;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;


-- ===========================================================================
-- SECTION 3: EXECUTION & RATE-LIMIT FUNCTIONS
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.fail_stuck_executions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE public.executions
    SET status        = 'failed',
        error_message = 'Execution timed out (stuck > 15 minutes)',
        completed_at  = now()
    WHERE status     = 'running'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM updated;

  -- Release stuck reservations (uses correct column: reserved_usd)
  WITH stuck AS (
    UPDATE public.credit_reservations
    SET status = 'released', resolved_at = now()
    WHERE status   = 'reserved'
      AND created_at < now() - INTERVAL '15 minutes'
    RETURNING user_id, reserved_usd
  )
  UPDATE public.credits c
  SET balance_usd = c.balance_usd + s.reserved_usd, updated_at = now()
  FROM stuck s WHERE c.user_id = s.user_id;

  UPDATE public.pipeline_executions
  SET status        = 'failed',
      error_message = 'Pipeline timed out (stuck > 15 minutes)',
      completed_at  = now()
  WHERE status     = 'running'
    AND created_at < now() - INTERVAL '15 minutes';

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fail_stuck_executions() TO service_role;


-- Param name matches TS caller: supabase.rpc("increment_executions_used", { user_id_param: userId })
CREATE OR REPLACE FUNCTION public.increment_executions_used(user_id_param UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET executions_used_this_month = COALESCE(executions_used_this_month, 0) + 1,
      updated_at                 = now()
  WHERE id = user_id_param;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_executions_used(UUID)
  TO authenticated, service_role;


-- Param name matches TS caller: supabase.rpc("get_concurrent_executions", { user_id_param: userId })
CREATE OR REPLACE FUNCTION public.get_concurrent_executions(user_id_param UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.executions
  WHERE user_id  = user_id_param
    AND status   = 'running'
    AND created_at > now() - INTERVAL '10 minutes';
$$;
GRANT EXECUTE ON FUNCTION public.get_concurrent_executions(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_concurrent_execution_count(user_id_param UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_concurrent_executions(user_id_param);
$$;
GRANT EXECUTE ON FUNCTION public.get_concurrent_execution_count(UUID)
  TO authenticated, service_role;


-- Param names match TS caller: supabase.rpc("increment_rate_limit", { key_param, window_end_param, limit_param })
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  key_param        TEXT,
  window_end_param TIMESTAMPTZ,
  limit_param      INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count      INTEGER;
  v_window_end TIMESTAMPTZ;
BEGIN
  SELECT count, window_end INTO v_count, v_window_end
  FROM public.rate_limit_counters
  WHERE id = key_param
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND OR now() > v_window_end THEN
    INSERT INTO public.rate_limit_counters (id, count, window_end)
    VALUES (key_param, 1, window_end_param)
    ON CONFLICT (id) DO UPDATE
      SET count      = 1,
          window_end = window_end_param;
    v_count      := 1;
    v_window_end := window_end_param;
  ELSE
    UPDATE public.rate_limit_counters
    SET count = count + 1
    WHERE id  = key_param
    RETURNING count INTO v_count;
  END IF;

  RETURN jsonb_build_object(
    'count',      v_count,
    'window_end', v_window_end,
    'blocked',    v_count > limit_param
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER)
  TO authenticated, service_role;


-- Param name matches TS caller: supabase.rpc("increment_cache_hits", { key: cacheKey })
CREATE OR REPLACE FUNCTION public.increment_cache_hits(key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.execution_cache
  SET hit_count = hit_count + 1
  WHERE cache_key = key;
$$;
GRANT EXECUTE ON FUNCTION public.increment_cache_hits(TEXT)
  TO authenticated, service_role;


-- ===========================================================================
-- SECTION 4: ANALYTICS & SCORING FUNCTIONS
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.compute_agent_score(target_agent_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total   BIGINT;
  v_success BIGINT;
  v_latency NUMERIC;
  v_rating  NUMERIC;
  v_price   NUMERIC;
  v_acc  NUMERIC; v_rel  NUMERIC; v_lat  NUMERIC;
  v_cost NUMERIC; v_pop  NUMERIC; v_comp NUMERIC;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status IN ('success','failed')),
    COUNT(*) FILTER (WHERE status = 'success'),
    COALESCE(AVG(latency_ms) FILTER (WHERE status='success'), 5000)
  INTO v_total, v_success, v_latency
  FROM public.executions
  WHERE agent_id  = target_agent_id
    AND created_at > now() - INTERVAL '30 days';

  IF COALESCE(v_total, 0) < 5 THEN RETURN; END IF;

  SELECT COALESCE(average_rating, 0), COALESCE(price_per_call, 0)
  INTO v_rating, v_price
  FROM public.agents WHERE id = target_agent_id;

  v_acc  := LEAST(100, (v_success::NUMERIC / NULLIF(v_total,0)) * 100);
  v_rel  := LEAST(100, POWER(v_success::NUMERIC / NULLIF(v_total,0), 2) * 100);
  v_lat  := GREATEST(0, 100 - v_latency / 100);
  v_cost := GREATEST(0, 100 - v_price * 100);
  v_pop  := LEAST(100, LN(GREATEST(1, v_total)) / LN(1000) * 100);
  v_comp := v_acc*0.30 + v_rel*0.25 + v_lat*0.20 + v_cost*0.15 + v_pop*0.10;

  INSERT INTO public.agent_scores (
    agent_id, composite_score, accuracy_score, reliability_score,
    latency_score, cost_score, popularity_score, sample_size,
    is_top_rated, is_fastest, is_cheapest, is_most_reliable, updated_at
  ) VALUES (
    target_agent_id,
    ROUND(v_comp,2), ROUND(v_acc,2), ROUND(v_rel,2),
    ROUND(v_lat,2),  ROUND(v_cost,2),ROUND(v_pop,2),
    v_total,
    (v_rating >= 4.5 AND v_total >= 20),
    (v_latency < 500  AND v_total >= 10),
    (v_price = 0      AND v_total >= 10),
    (v_rel    >= 95   AND v_total >= 10),
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
GRANT EXECUTE ON FUNCTION public.compute_agent_score(UUID)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.compute_all_agent_scores()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER := 0; v_id UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM public.agents
    WHERE status::text = 'active' AND total_executions >= 5
  LOOP
    PERFORM public.compute_agent_score(v_id);
    v_count := v_count + 1;
  END LOOP;
  PERFORM public.refresh_agent_rankings();
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.compute_all_agent_scores() TO service_role;


CREATE OR REPLACE FUNCTION public.refresh_agent_rankings()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT
      s.agent_id,
      ROW_NUMBER() OVER (ORDER BY s.composite_score DESC, s.sample_size DESC) AS g_rank,
      ROW_NUMBER() OVER (PARTITION BY a.category ORDER BY s.composite_score DESC) AS c_rank
    FROM public.agent_scores s
    JOIN public.agents a ON a.id = s.agent_id AND a.status::text = 'active'
    WHERE s.composite_score > 0
  )
  UPDATE public.agent_scores s
  SET global_rank   = r.g_rank,
      category_rank = r.c_rank,
      updated_at    = now()
  FROM ranked r
  WHERE s.agent_id = r.agent_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.agents a
  SET composite_score  = ags.composite_score,
      is_top_rated     = ags.is_top_rated,
      is_fastest       = ags.is_fastest,
      is_cheapest      = ags.is_cheapest,
      is_most_reliable = ags.is_most_reliable
  FROM public.agent_scores ags
  WHERE a.id = ags.agent_id AND a.status::text = 'active';

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_agent_rankings() TO service_role;


CREATE OR REPLACE FUNCTION public.aggregate_daily_analytics()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target_date DATE := CURRENT_DATE - 1; v_count INTEGER;
BEGIN
  INSERT INTO public.agent_analytics (
    agent_id, date,
    executions, successful, failed,
    success_rate, avg_latency_ms,
    tokens_in, tokens_out, cost_usd, updated_at
  )
  SELECT
    e.agent_id, target_date,
    COUNT(*) FILTER (WHERE status IN ('success','failed')),
    COUNT(*) FILTER (WHERE status = 'success'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    ROUND((COUNT(*) FILTER (WHERE status='success')::NUMERIC
           / NULLIF(COUNT(*) FILTER (WHERE status IN ('success','failed')),0))*100, 2),
    ROUND(COALESCE(AVG(latency_ms) FILTER (WHERE status='success'),0),0)::INTEGER,
    COALESCE(SUM(tokens_input),  0),
    COALESCE(SUM(tokens_output), 0),
    COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE cost END), 0),
    now()
  FROM public.executions e
  WHERE DATE(e.created_at) = target_date AND e.agent_id IS NOT NULL
  GROUP BY e.agent_id
  ON CONFLICT (agent_id, date) DO UPDATE SET
    executions     = EXCLUDED.executions,
    successful     = EXCLUDED.successful,
    failed         = EXCLUDED.failed,
    success_rate   = EXCLUDED.success_rate,
    avg_latency_ms = EXCLUDED.avg_latency_ms,
    tokens_in      = EXCLUDED.tokens_in,
    tokens_out     = EXCLUDED.tokens_out,
    cost_usd       = EXCLUDED.cost_usd,
    updated_at     = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.aggregate_daily_analytics() TO service_role;

CREATE OR REPLACE FUNCTION public.aggregate_agent_analytics_yesterday()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.aggregate_daily_analytics(); $$;
GRANT EXECUTE ON FUNCTION public.aggregate_agent_analytics_yesterday() TO service_role;


CREATE OR REPLACE FUNCTION public.reset_monthly_quotas()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.profiles
  SET executions_used_this_month = 0,
      quota_reset_date           = now() + INTERVAL '30 days',
      updated_at                 = now()
  WHERE quota_reset_date IS NULL OR quota_reset_date <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_monthly_quotas() TO service_role;

CREATE OR REPLACE FUNCTION public.reset_monthly_execution_quotas()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.reset_monthly_quotas(); $$;
GRANT EXECUTE ON FUNCTION public.reset_monthly_execution_quotas() TO service_role;


CREATE OR REPLACE FUNCTION public.send_quota_warning_notifications()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, action_url)
  SELECT p.id,
    'Approaching monthly limit',
    FORMAT('Used %s of %s executions (%s%%). Upgrade to avoid interruptions.',
      p.executions_used_this_month, p.monthly_execution_quota,
      ROUND((p.executions_used_this_month::FLOAT / NULLIF(p.monthly_execution_quota,0))*100)),
    'quota_warning', '/billing'
  FROM public.profiles p
  WHERE p.monthly_execution_quota  > 0
    AND p.monthly_execution_quota != -1
    AND (p.executions_used_this_month::FLOAT
         / NULLIF(p.monthly_execution_quota,0)) >= 0.80
    AND (p.executions_used_this_month::FLOAT
         / NULLIF(p.monthly_execution_quota,0)) < 1.0
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p.id
        AND n.type    = 'quota_warning'
        AND n.created_at > now() - INTERVAL '24 hours'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_quota_warning_notifications() TO service_role;


-- ===========================================================================
-- SECTION 5: CLEANUP FUNCTIONS
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_memory()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.agent_memory
    WHERE ttl_at IS NOT NULL AND ttl_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memory() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_memories()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.cleanup_expired_memory(); $$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memories() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_execution_cache()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.execution_cache WHERE expires_at < now() RETURNING cache_key
  )
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_execution_cache() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.cleanup_execution_cache(); $$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_cache() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_counters()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.rate_limit_counters WHERE window_end < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_counters() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_processed_stripe_events()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.processed_stripe_events
    WHERE processed_at < now() - INTERVAL '30 days'
    RETURNING event_id
  )
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_processed_stripe_events() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_stripe_events()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.cleanup_processed_stripe_events(); $$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_stripe_events() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (DELETE FROM public.idempotency_keys WHERE expires_at < now() RETURNING id)
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_idempotency_keys() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_injection_attempts()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.injection_attempts
    WHERE created_at < now() - INTERVAL '90 days'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_injection_attempts() TO service_role;


-- ===========================================================================
-- SECTION 6: MISCELLANEOUS FUNCTIONS
-- ===========================================================================

-- Param names match TS caller in memory/route.ts
CREATE OR REPLACE FUNCTION public.upsert_agent_memory(
  user_id_param  UUID,
  agent_id_param UUID,
  key_param      TEXT,
  value_param    JSONB,
  ttl_param      INTEGER DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agent_memory (user_id, agent_id, key, value, ttl_at, updated_at)
  VALUES (
    user_id_param, agent_id_param, key_param, value_param,
    CASE WHEN ttl_param IS NOT NULL
         THEN now() + (ttl_param || ' seconds')::INTERVAL
    END,
    now()
  )
  ON CONFLICT (user_id, agent_id, key) DO UPDATE
    SET value      = value_param,
        ttl_at     = CASE WHEN ttl_param IS NOT NULL
                          THEN now() + (ttl_param || ' seconds')::INTERVAL
                     END,
        updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_agent_memory(UUID, UUID, TEXT, JSONB, INTEGER)
  TO authenticated, service_role;


-- Param names match TS caller in pipelines/[id]/execute/route.ts
CREATE OR REPLACE FUNCTION public.increment_agent_pipeline_use(
  agent_id_param    UUID,
  pipeline_id_param UUID,
  user_id_param     UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agent_pipeline_usage (agent_id, pipeline_id, user_id, use_count, last_used)
  VALUES (agent_id_param, pipeline_id_param, user_id_param, 1, now())
  ON CONFLICT (agent_id, pipeline_id)
  DO UPDATE SET
    use_count = public.agent_pipeline_usage.use_count + 1,
    last_used = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_agent_pipeline_use(UUID, UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_pipeline_usage(
  agent_id_param UUID, pipeline_id_param UUID, user_id_param UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.increment_agent_pipeline_use(agent_id_param, pipeline_id_param, user_id_param);
$$;
GRANT EXECUTE ON FUNCTION public.upsert_pipeline_usage(UUID, UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_agent_pipeline_usage(
  agent_id_param UUID, pipeline_id_param UUID, user_id_param UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.increment_agent_pipeline_use(agent_id_param, pipeline_id_param, user_id_param);
$$;
GRANT EXECUTE ON FUNCTION public.upsert_agent_pipeline_usage(UUID, UUID, UUID)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.increment_kb_doc_count(kb_id_param UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.knowledge_bases
  SET doc_count = COALESCE(doc_count, 0) + 1, updated_at = now()
  WHERE id = kb_id_param;
$$;
GRANT EXECUTE ON FUNCTION public.increment_kb_doc_count(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decrement_kb_doc_count(kb_id_param UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.knowledge_bases
  SET doc_count = GREATEST(0, COALESCE(doc_count, 0) - 1), updated_at = now()
  WHERE id = kb_id_param;
$$;
GRANT EXECUTE ON FUNCTION public.decrement_kb_doc_count(UUID) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.compute_context_hash(agent_id_param UUID, input_param TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT encode(sha256((agent_id_param::text || '|' || input_param)::bytea), 'hex');
$$;
GRANT EXECUTE ON FUNCTION public.compute_context_hash(UUID, TEXT) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.is_email_verified(user_id_param UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(email_verified, false) FROM public.profiles WHERE id = user_id_param;
$$;
GRANT EXECUTE ON FUNCTION public.is_email_verified(UUID) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.increment_seller_earned(
  seller_id_param UUID,
  amount_param    NUMERIC
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET total_earned = COALESCE(total_earned, 0) + amount_param, updated_at = now()
  WHERE id = seller_id_param;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_seller_earned(UUID, NUMERIC) TO service_role;


CREATE OR REPLACE FUNCTION public.expire_hitl_approvals()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.hitl_approvals
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.expire_hitl_approvals() TO service_role;


CREATE OR REPLACE FUNCTION public.reset_share_key_daily_limits()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.pipeline_share_keys
  SET executions_today = 0, last_reset_at = now()
  WHERE last_reset_at < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_share_key_daily_limits() TO service_role;


-- ===========================================================================
-- SECTION 7: VECTOR SEARCH FUNCTIONS
-- CRITICAL: Parameter names MUST match TypeScript callers exactly.
-- Verified against:
--   src/lib/rag-retriever.ts:       kb_id_param, query_embedding, match_threshold, match_count ← p_*
--   src/app/api/rag/query/route.ts: kb_id_param, query_embedding, match_threshold, match_count ← p_*
-- Note: rag-retriever passes query_embedding as string "[...]" (pgvector text literal)
-- ===========================================================================

CREATE FUNCTION public.search_agents_semantic(
  query_embedding  vector(1536),
  match_threshold  double precision DEFAULT 0.75,
  match_count      integer          DEFAULT 20
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
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.name, a.description, a.category::text,
    COALESCE(a.composite_score,  0)::numeric,
    COALESCE(a.average_rating,   0)::numeric,
    a.pricing_model::text,
    COALESCE(a.price_per_call,   0)::numeric,
    COALESCE(a.total_executions, 0)::bigint,
    (1 - (ae.embedding <=> query_embedding))::double precision AS similarity
  FROM public.agent_embeddings ae
  JOIN public.agents a ON a.id = ae.agent_id
  WHERE a.status::text = 'active'
    AND (1 - (ae.embedding <=> query_embedding)) > match_threshold
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.search_agents_semantic(vector, double precision, integer)
  TO anon, authenticated, service_role;


-- FIX: param names match BOTH TypeScript callers (rag-retriever.ts + rag/query/route.ts)
-- Both call: { kb_id_param, query_embedding, match_threshold, match_count }
-- NOT p_embedding / p_threshold / p_count (those were wrong in 027)
CREATE FUNCTION public.search_rag_chunks(
  kb_id_param     UUID,
  query_embedding vector(1536),   -- matches TS: query_embedding
  match_threshold FLOAT DEFAULT 0.75,  -- matches TS: match_threshold
  match_count     INT   DEFAULT 5      -- matches TS: match_count
)
RETURNS TABLE (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  content        text,
  similarity     float,
  metadata       jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id::uuid,
    c.document_id,
    d.title,
    c.content,
    (1 - (c.embedding <=> query_embedding))::FLOAT,
    d.metadata
  FROM public.rag_chunks c
  JOIN public.rag_documents d ON d.id = c.document_id
  WHERE c.knowledge_base_id = kb_id_param
    AND d.status = 'indexed'
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.search_rag_chunks(UUID, vector, FLOAT, INT)
  TO anon, authenticated, service_role;


-- ===========================================================================
-- SECTION 8: RECREATE VIEWS WITH security_invoker = on
-- Fixes all 8 SECURITY DEFINER view errors from Supabase Advisor.
-- security_invoker = on → RLS of the QUERYING user applies, not creator's.
-- ===========================================================================

CREATE VIEW public.agent_leaderboard
  WITH (security_invoker = on)
AS
SELECT
  a.id, a.name, a.slug, a.description, a.category::text AS category,
  a.pricing_model::text AS pricing_model,
  COALESCE(a.price_per_call,     0)::numeric AS price_per_call,
  COALESCE(a.average_rating,     0)::numeric AS average_rating,
  COALESCE(a.total_reviews,      0)          AS total_reviews,
  COALESCE(a.total_executions,   0)          AS total_executions,
  COALESCE(a.average_latency_ms, 0)          AS average_latency_ms,
  a.is_featured, a.is_verified, a.icon_url, a.tags,
  COALESCE(s.composite_score,    0)::numeric AS composite_score,
  COALESCE(s.accuracy_score,     0)::numeric AS accuracy_score,
  COALESCE(s.reliability_score,  0)::numeric AS reliability_score,
  COALESCE(s.latency_score,      0)::numeric AS latency_score,
  COALESCE(s.cost_score,         0)::numeric AS cost_score,
  COALESCE(s.popularity_score,   0)::numeric AS popularity_score,
  COALESCE(s.global_rank,     9999)          AS global_rank,
  COALESCE(s.category_rank,   9999)          AS category_rank,
  COALESCE(s.is_top_rated,   false)          AS is_top_rated,
  COALESCE(s.is_fastest,     false)          AS is_fastest,
  COALESCE(s.is_cheapest,    false)          AS is_cheapest,
  COALESCE(s.is_most_reliable, false)        AS is_most_reliable,
  p.full_name   AS seller_name,
  p.username    AS seller_username,
  p.is_verified AS seller_verified,
  a.created_at
FROM public.agents a
LEFT JOIN public.agent_scores  s ON s.agent_id = a.id
JOIN  public.profiles          p ON p.id        = a.seller_id
WHERE a.status::text = 'active';
GRANT SELECT ON public.agent_leaderboard TO anon, authenticated;


CREATE VIEW public.user_credit_summary
  WITH (security_invoker = on)
AS
SELECT
  c.user_id, c.balance_usd, c.hard_limit_usd, c.alert_threshold,
  c.total_purchased, c.total_spent,
  (c.balance_usd < c.alert_threshold) AS low_balance,
  c.updated_at
FROM public.credits c
WHERE c.user_id = auth.uid();
GRANT SELECT ON public.user_credit_summary TO authenticated;


CREATE VIEW public.agent_trace_summary
  WITH (security_invoker = on)
AS
SELECT
  t.agent_id,
  date_trunc('day', t.created_at) AS day,
  COUNT(*)                         AS total_calls,
  AVG(t.total_ms)::INTEGER         AS avg_latency_ms,
  AVG(t.ttft_ms)::INTEGER          AS avg_ttft_ms,
  SUM(t.tokens_input)              AS total_tokens_in,
  SUM(t.tokens_output)             AS total_tokens_out,
  SUM(t.cost_usd)                  AS total_cost,
  COUNT(*) FILTER (WHERE t.status = 'success') AS successes,
  COUNT(*) FILTER (WHERE t.status = 'error')   AS errors
FROM public.execution_traces t
JOIN public.agents a ON a.id = t.agent_id
WHERE a.seller_id = auth.uid()
GROUP BY t.agent_id, date_trunc('day', t.created_at)
ORDER BY day DESC;
GRANT SELECT ON public.agent_trace_summary TO authenticated;


CREATE VIEW public.agent_capabilities
  WITH (security_invoker = on)
AS
SELECT
  a.id, a.name, a.slug, a.description, a.category::text AS category,
  COALESCE(a.capability_tags, '{}')         AS capability_tags,
  COALESCE(a.input_types,  ARRAY['text'])   AS input_types,
  COALESCE(a.output_types, ARRAY['text'])   AS output_types,
  COALESCE(a.languages,    ARRAY['en'])     AS languages,
  COALESCE(a.compliance_tags, '{}')         AS compliance_tags,
  a.pricing_model::text                     AS pricing_model,
  COALESCE(a.price_per_call, 0)::numeric    AS price_per_call,
  COALESCE(a.subscription_price_monthly, 0)::numeric AS subscription_price_monthly,
  COALESCE(a.free_calls_per_month, 0)       AS free_calls_per_month,
  a.model_name,
  COALESCE(a.average_latency_ms, 0)         AS average_latency_ms,
  COALESCE(a.composite_score, 0)::numeric   AS composite_score,
  COALESCE(s.is_top_rated,    false)        AS is_top_rated,
  COALESCE(s.is_fastest,      false)        AS is_fastest,
  COALESCE(s.is_cheapest,     false)        AS is_cheapest,
  COALESCE(s.is_most_reliable,false)        AS is_most_reliable
FROM public.agents a
LEFT JOIN public.agent_scores s ON s.agent_id = a.id
WHERE a.status::text = 'active';
GRANT SELECT ON public.agent_capabilities TO anon, authenticated;


CREATE VIEW public.admin_platform_stats
  WITH (security_invoker = on)
AS
SELECT
  (SELECT COUNT(*) FROM public.profiles)                                AS total_users,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'active')         AS active_agents,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'pending_review') AS pending_review,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'suspended')      AS suspended_agents,
  (SELECT COUNT(*) FROM public.executions)                             AS total_executions,
  (SELECT COALESCE(SUM(amount),0)      FROM public.transactions WHERE status='succeeded') AS gross_revenue,
  (SELECT COALESCE(SUM(amount),0)*0.20 FROM public.transactions WHERE status='succeeded') AS platform_revenue,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='blocked') AS blocked_attempts,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='flagged') AS flagged_attempts,
  (SELECT COUNT(*) FROM public.reviews WHERE status='pending')            AS pending_reviews,
  (SELECT COUNT(*) FROM public.profiles WHERE is_banned = true)           AS banned_users,
  (SELECT COUNT(*) FROM public.credits  WHERE balance_usd <= 0)           AS zero_credit_users;
GRANT SELECT ON public.admin_platform_stats TO authenticated;


CREATE VIEW public.user_abuse_summary
  WITH (security_invoker = on)
AS
SELECT
  p.id AS user_id, p.email, p.full_name, p.is_banned, p.role::text AS role,
  COUNT(ia.id)                                          AS injection_attempts,
  COUNT(ia.id) FILTER (WHERE ia.action = 'blocked')    AS blocked_attempts,
  MAX(ia.created_at)                                   AS last_attempt_at
FROM public.profiles p
LEFT JOIN public.injection_attempts ia ON ia.user_id = p.id
GROUP BY p.id, p.email, p.full_name, p.is_banned, p.role;
GRANT SELECT ON public.user_abuse_summary TO authenticated;


CREATE VIEW public.agent_pipeline_stats
  WITH (security_invoker = on)
AS
SELECT
  apu.agent_id,
  a.name AS agent_name,
  a.seller_id,
  COUNT(DISTINCT apu.pipeline_id) AS pipeline_count,
  SUM(apu.use_count)              AS total_uses,
  MAX(apu.last_used)              AS last_used_at
FROM public.agent_pipeline_usage apu
JOIN public.agents a ON a.id = apu.agent_id
WHERE a.seller_id = auth.uid()
   OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
GROUP BY apu.agent_id, a.name, a.seller_id;
GRANT SELECT ON public.agent_pipeline_stats TO authenticated;


CREATE VIEW public.agents_search
  WITH (security_invoker = on)
AS
SELECT
  a.id, a.name, a.slug, a.description, a.long_description,
  a.category::text AS category, a.tags, a.capability_tags,
  a.input_types, a.output_types,
  a.pricing_model::text AS pricing_model,
  COALESCE(a.price_per_call,   0)::numeric AS price_per_call,
  COALESCE(a.average_rating,   0)::numeric AS average_rating,
  COALESCE(a.total_executions, 0)          AS total_executions,
  COALESCE(a.composite_score,  0)::numeric AS composite_score,
  a.is_featured, a.is_verified, a.icon_url, a.model_name,
  COALESCE(a.free_calls_per_month, 0)      AS free_calls_per_month,
  p.full_name   AS seller_name,
  p.username    AS seller_username,
  p.is_verified AS seller_verified,
  a.created_at
FROM public.agents a
JOIN public.profiles p ON p.id = a.seller_id
WHERE a.status::text = 'active';
GRANT SELECT ON public.agents_search TO anon, authenticated;


CREATE VIEW public.profiles_public
  WITH (security_invoker = on)
AS
SELECT id, full_name, username, avatar_url, bio, website, company,
       role::text AS role, is_verified, created_at
FROM public.profiles;
GRANT SELECT ON public.profiles_public TO anon, authenticated;


-- ===========================================================================
-- SECTION 9: FIX RLS "ALWAYS TRUE" POLICIES
-- Scope system-only writes to auth.role() = 'service_role'.
-- ===========================================================================

-- execution_cache: only backend writes; anyone reads
DROP POLICY IF EXISTS "cache_service_write"  ON public.execution_cache;
DROP POLICY IF EXISTS "cache_service_rw"     ON public.execution_cache;
DROP POLICY IF EXISTS "cache_auth_write"     ON public.execution_cache;
DROP POLICY IF EXISTS "cache_auth_update"    ON public.execution_cache;
DROP POLICY IF EXISTS "cache_auth_read"      ON public.execution_cache;

CREATE POLICY "cache_service_rw"
  ON public.execution_cache FOR ALL
  USING     (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "cache_auth_read"
  ON public.execution_cache FOR SELECT
  USING (true);


-- agent_pipeline_usage: RPC-only writes
DROP POLICY IF EXISTS "apu_insert"         ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_write"          ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_service_insert" ON public.agent_pipeline_usage;

CREATE POLICY "apu_service_insert"
  ON public.agent_pipeline_usage FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);


-- failed_webhooks: backend only
DROP POLICY IF EXISTS "fw_system_write" ON public.failed_webhooks;
DROP POLICY IF EXISTS "fw_service_all"  ON public.failed_webhooks;
CREATE POLICY "fw_service_all"
  ON public.failed_webhooks FOR ALL
  USING     (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- governance_events: backend only
DROP POLICY IF EXISTS "governance_system_insert"  ON public.governance_events;
DROP POLICY IF EXISTS "governance_service_insert" ON public.governance_events;
CREATE POLICY "governance_service_insert"
  ON public.governance_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');


-- injection_attempts: backend only (users must not self-report injections)
DROP POLICY IF EXISTS "injection_system_insert"  ON public.injection_attempts;
DROP POLICY IF EXISTS "injection_service_insert" ON public.injection_attempts;
CREATE POLICY "injection_service_insert"
  ON public.injection_attempts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');


-- node_retry_log: backend only
DROP POLICY IF EXISTS "retry_log_sys_ins"         ON public.node_retry_log;
DROP POLICY IF EXISTS "retry_log_service_insert"  ON public.node_retry_log;
CREATE POLICY "retry_log_service_insert"
  ON public.node_retry_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');


-- processed_stripe_events: backend only
DROP POLICY IF EXISTS "pse_system"           ON public.processed_stripe_events;
DROP POLICY IF EXISTS "stripe_service_only"  ON public.processed_stripe_events;
CREATE POLICY "stripe_service_only"
  ON public.processed_stripe_events FOR ALL
  USING     (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- profiles INSERT: only auth trigger (service_role) or self
DROP POLICY IF EXISTS "System inserts new profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_system_insert"      ON public.profiles;
CREATE POLICY "profiles_system_insert"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR id = auth.uid());


-- rate_limit_counters: backend only
DROP POLICY IF EXISTS "Service manages rate limits" ON public.rate_limit_counters;
DROP POLICY IF EXISTS "rate_limit_service_only"     ON public.rate_limit_counters;
CREATE POLICY "rate_limit_service_only"
  ON public.rate_limit_counters FOR ALL
  USING     (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- email_queue: backend only
DROP POLICY IF EXISTS "email_queue_sys_ins"          ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_ins"      ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_insert"   ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_update"   ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_sys_upd"          ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_upd"      ON public.email_queue;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='email_queue'
                   AND policyname='email_queue_svc_ins') THEN
    CREATE POLICY "email_queue_svc_ins"
      ON public.email_queue FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='email_queue'
                   AND policyname='email_queue_svc_upd') THEN
    CREATE POLICY "email_queue_svc_upd"
      ON public.email_queue FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- pipeline_versions: owner or service
DROP POLICY IF EXISTS "pv_system_insert"           ON public.pipeline_versions;
DROP POLICY IF EXISTS "pv_owner_or_service_insert" ON public.pipeline_versions;
CREATE POLICY "pv_owner_or_service_insert"
  ON public.pipeline_versions FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (created_by IS NOT NULL AND created_by = auth.uid())
  );


-- execution_snapshots: backend only
DROP POLICY IF EXISTS "snapshots_system_ins"     ON public.execution_snapshots;
DROP POLICY IF EXISTS "snapshots_service_insert" ON public.execution_snapshots;
CREATE POLICY "snapshots_service_insert"
  ON public.execution_snapshots FOR INSERT
  WITH CHECK (auth.role() = 'service_role');


-- hitl_approvals: owner or service
DROP POLICY IF EXISTS "hitl_system_write"      ON public.hitl_approvals;
DROP POLICY IF EXISTS "hitl_restricted_write"  ON public.hitl_approvals;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='hitl_approvals'
                   AND policyname='hitl_restricted_write') THEN
    CREATE POLICY "hitl_restricted_write"
      ON public.hitl_approvals FOR INSERT
      WITH CHECK (auth.role() = 'service_role' OR user_id = auth.uid());
  END IF;
END $$;


-- ===========================================================================
-- SECTION 10: STORAGE BUCKET — DEDUPLICATE AVATAR POLICIES
-- ===========================================================================

DO $$
BEGIN
  DROP POLICY IF EXISTS "Avatars are public"    ON storage.objects;
  DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
  DROP POLICY IF EXISTS "avatars_public_select" ON storage.objects;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'avatars_public_select'
  ) THEN
    CREATE POLICY "avatars_public_select"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️ Storage policy update skipped (non-fatal): %', SQLERRM;
END $$;


-- ===========================================================================
-- SECTION 11: PERFORMANCE INDICES
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active
  ON public.api_keys(key_hash) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_executions_user_status_created
  ON public.executions(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executions_running
  ON public.executions(user_id, status, created_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_credit_res_status_created
  ON public.credit_reservations(status, created_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_credit_res_user_reserved
  ON public.credit_reservations(user_id, expires_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_agents_active_score
  ON public.agents(status, composite_score DESC, total_executions DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_agents_featured
  ON public.agents(is_featured, composite_score DESC)
  WHERE status = 'active' AND is_featured = true;

CREATE INDEX IF NOT EXISTS idx_analytics_agent_date
  ON public.agent_analytics(agent_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_injection_user_recent
  ON public.injection_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idem_expires
  ON public.idempotency_keys(expires_at)
  WHERE status != 'success';

CREATE INDEX IF NOT EXISTS idx_cache_expires
  ON public.execution_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_kb_embedding
  ON public.rag_chunks USING ivfflat (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;


-- ===========================================================================
-- SECTION 12: CANONICAL pg_cron SCHEDULE (idempotent — same name = update)
-- ===========================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-fail-stuck',          '*/5 * * * *',  'SELECT public.fail_stuck_executions()');
    PERFORM cron.schedule('agentdyne-reset-quotas',        '0 0 1 * *',    'SELECT public.reset_monthly_quotas()');
    PERFORM cron.schedule('agentdyne-daily-analytics',     '0 1 * * *',    'SELECT public.aggregate_daily_analytics()');
    PERFORM cron.schedule('agentdyne-refresh-rankings',    '0 2 * * *',    'SELECT public.refresh_agent_rankings()');
    PERFORM cron.schedule('agentdyne-cleanup-memory',      '0 4 * * *',    'SELECT public.cleanup_expired_memory()');
    PERFORM cron.schedule('agentdyne-cleanup-cache',       '30 * * * *',   'SELECT public.cleanup_execution_cache()');
    PERFORM cron.schedule('agentdyne-cleanup-rl',          '*/30 * * * *', 'SELECT public.cleanup_rate_limit_counters()');
    PERFORM cron.schedule('agentdyne-cleanup-stripe',      '0 3 * * *',    'SELECT public.cleanup_processed_stripe_events()');
    PERFORM cron.schedule('agentdyne-cleanup-idempotency', '0 4 * * *',    'SELECT public.cleanup_expired_idempotency_keys()');
    PERFORM cron.schedule('agentdyne-cleanup-injection',   '0 3 * * 0',    'SELECT public.cleanup_old_injection_attempts()');
    PERFORM cron.schedule('agentdyne-quota-warnings',      '0 */6 * * *',  'SELECT public.send_quota_warning_notifications()');
    PERFORM cron.schedule('agentdyne-hitl-expire',         '0 * * * *',    'SELECT public.expire_hitl_approvals()');
    PERFORM cron.schedule('agentdyne-share-key-reset',     '0 0 * * *',    'SELECT public.reset_share_key_daily_limits()');
    RAISE NOTICE '✅ 13 pg_cron jobs registered';
  ELSE
    RAISE NOTICE '⚠️ pg_cron not enabled — register cron jobs manually in Supabase Dashboard';
  END IF;
END $$;


-- ===========================================================================
-- SECTION 13: BACK-FILL credits + GRANT revocation
-- ===========================================================================

-- Ensure every profile has a credits row
INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd, alert_threshold)
SELECT id, 0, 5, 1 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- Remove excess grants on sensitive tables that anon should never touch
DO $$
BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.executions          FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.execution_traces    FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.agent_analytics     FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.credit_reservations FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.audit_logs          FROM anon;
  REVOKE INSERT, UPDATE, DELETE ON public.governance_events   FROM anon;
  REVOKE ALL                    ON public.profiles            FROM anon;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️ REVOKE partial (non-fatal): %', SQLERRM;
END $$;


-- ===========================================================================
-- SECTION 14: FINAL VERIFICATION
-- ===========================================================================

DO $$
DECLARE
  v_fn_count   INTEGER;
  v_view_count INTEGER;
  v_fn_path    INTEGER;
  v_cron       INTEGER;
  v_uc_analytics BOOLEAN;
  v_uc_memory    BOOLEAN;
  v_uc_apu       BOOLEAN;
  v_uc_pv        BOOLEAN;
  v_rag_fn_ok    BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('reserve_credits','commit_credit_reservation',
                      'release_credit_reservation','fail_stuck_executions');

  SELECT COUNT(*) INTO v_view_count
  FROM pg_views
  WHERE schemaname = 'public'
    AND viewname IN (
      'agent_leaderboard','user_credit_summary','agent_trace_summary',
      'agent_capabilities','admin_platform_stats','user_abuse_summary',
      'agent_pipeline_stats','agents_search','profiles_public'
    );

  SELECT COUNT(*) INTO v_fn_path
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('reserve_credits','fail_stuck_executions',
                      'aggregate_daily_analytics','cleanup_expired_memory',
                      'get_concurrent_executions','search_rag_chunks')
    AND p.proconfig && ARRAY['search_path=public'];

  -- Verify search_rag_chunks has correct param names
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN unnest(p.proargnames) WITH ORDINALITY AS args(name, pos)
      ON args.name = 'query_embedding'
    WHERE n.nspname = 'public' AND p.proname = 'search_rag_chunks'
  ) INTO v_rag_fn_ok;

  -- UNIQUE constraints
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.agent_analytics'::regclass AND contype='u') INTO v_uc_analytics;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.agent_memory'::regclass AND contype='u')    INTO v_uc_memory;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.agent_pipeline_usage'::regclass AND contype='u') INTO v_uc_apu;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pipeline_versions'::regclass AND contype='u' AND conname != 'pipeline_versions_pkey') INTO v_uc_pv;

  BEGIN
    SELECT COUNT(*) INTO v_cron FROM cron.job WHERE active = true;
  EXCEPTION WHEN OTHERS THEN v_cron := -1; END;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE ' AgentDyne Migration 028 v3 — Verification';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Credit functions (4 expected):        %  %', v_fn_count,   CASE WHEN v_fn_count   = 4 THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Views recreated (9 expected):          %  %', v_view_count, CASE WHEN v_view_count = 9 THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Functions with search_path (6 check):  %  %', v_fn_path,   CASE WHEN v_fn_path   >= 6 THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'search_rag_chunks param names correct:    %', CASE WHEN v_rag_fn_ok THEN '✅ query_embedding' ELSE '❌ WRONG PARAMS' END;
  RAISE NOTICE 'UNIQUE agent_analytics(agent_id,date):    %', CASE WHEN v_uc_analytics THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'UNIQUE agent_memory(user,agent,key):       %', CASE WHEN v_uc_memory   THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'UNIQUE agent_pipeline_usage(agent,pipe):   %', CASE WHEN v_uc_apu      THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'UNIQUE pipeline_versions(pipe,version):    %', CASE WHEN v_uc_pv       THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'Active cron jobs:                          %', CASE WHEN v_cron >= 0 THEN v_cron::TEXT ELSE 'pg_cron disabled' END;
  RAISE NOTICE '';
  RAISE NOTICE 'MANUAL STEPS AFTER THIS MIGRATION:';
  RAISE NOTICE '  1. Auth → Password → Enable "Leaked password protection"';
  RAISE NOTICE '  2. Run Supabase Advisor → should show 0 CRITICAL errors';
  RAISE NOTICE '  3. Smoke test: SELECT reserve_credits((SELECT id FROM profiles LIMIT 1), 0.001)';
  RAISE NOTICE '  4. Smoke test: SELECT search_rag_chunks(gen_random_uuid(), NULL, 0.75, 1)';
  RAISE NOTICE '     (expected: empty result, not an error)';
  RAISE NOTICE '  5. Push code to GitHub → Cloudflare auto-deploys';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
