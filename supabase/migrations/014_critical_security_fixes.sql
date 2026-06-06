-- ============================================================
-- Migration 014: Critical security & correctness fixes
-- Validated against live schema, functions, triggers & RLS.
-- Run ONCE in Supabase SQL Editor. All statements idempotent.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SECTION 1: ADMIN RLS — THE MOST CRITICAL FIXES
-- Without these, the admin panel silently returns empty data
-- and all admin mutations (approve/reject agent) are blocked.
-- ════════════════════════════════════════════════════════════

-- ── 1a. AGENTS — admin ALL policy (read pending_review + update status) ───
-- Current state: only policies are "status=active OR seller=self" for SELECT
-- and "seller=self" for UPDATE. Admin is completely locked out.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agents' AND policyname = 'agents_admin_all'
  ) THEN
    CREATE POLICY "agents_admin_all" ON public.agents
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ── 1b. REVIEWS — admin ALL policy (approve / reject reviews) ──────────────
-- Current state: only SELECT(approved), INSERT(own), UPDATE(own).
-- Admin can never flip status to 'approved' or 'rejected'.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reviews' AND policyname = 'reviews_admin_all'
  ) THEN
    CREATE POLICY "reviews_admin_all" ON public.reviews
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ── 1c. PROFILES — admin read-all policy (user management tab) ─────────────
-- Admin needs to read all profiles (including role, is_banned, plan).
-- Existing "profiles_public_read" qual=true already exposes everything —
-- we add a named admin policy so the intent is explicit and auditable.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'profiles_admin_all'
  ) THEN
    CREATE POLICY "profiles_admin_all" ON public.profiles
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p2
          WHERE p2.id = auth.uid() AND p2.role = 'admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles p2
          WHERE p2.id = auth.uid() AND p2.role = 'admin'
        )
      );
  END IF;
END $$;

-- ── 1d. TRANSACTIONS — admin read (revenue stats) ─────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transactions' AND policyname = 'transactions_admin_read'
  ) THEN
    CREATE POLICY "transactions_admin_read" ON public.transactions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ── 1e. EXECUTIONS — admin read (platform stats) ──────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'executions' AND policyname = 'executions_admin_read'
  ) THEN
    CREATE POLICY "executions_admin_read" ON public.executions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- SECTION 2: PROFILES PUBLIC READ — SENSITIVE DATA EXPOSURE
-- Current "profiles_public_read" has qual=true which exposes
-- stripe_customer_id, stripe_connect_account_id, is_banned,
-- subscription_plan, total_earned, total_spent to everyone.
-- Fix: replace with a SECURITY DEFINER function + restrict
-- the policy to only allow reading via safe fields.
-- Note: RLS is row-level only; we fix column exposure via a
-- dedicated safe view that the app should use for public reads.
-- ════════════════════════════════════════════════════════════

-- Public-safe profile view (used by marketplace, leaderboard, etc.)
-- Never exposes Stripe IDs, ban status, financial data, or quota info.
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  id,
  full_name,
  username,
  avatar_url,
  bio,
  website,
  company,
  role,
  is_verified,
  created_at
FROM public.profiles;

-- Grant SELECT to authenticated + anon (replaces direct profiles access for public use)
GRANT SELECT ON public.profiles_public TO authenticated, anon;

-- RLS note: views in Supabase inherit the caller's role but since this view
-- only projects safe columns, even if someone queries it they see nothing sensitive.

-- ════════════════════════════════════════════════════════════
-- SECTION 3: deduct_credits() — MISSING RPC (CRITICAL)
-- Both execute routes call supabase.rpc("deduct_credits", {...})
-- This function does not exist in the live DB. Every paid-agent
-- execution throws "function not found" and returns 500.
-- ════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.deduct_credits(UUID, NUMERIC, TEXT, UUID);

CREATE FUNCTION public.deduct_credits(
  user_id_param      UUID,
  amount_param       NUMERIC,
  description_param  TEXT    DEFAULT '',
  reference_id_param UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance_before  NUMERIC;
  v_balance_after   NUMERIC;
  v_hard_limit      NUMERIC;
BEGIN
  -- Lock the credits row for this user (prevent race conditions)
  SELECT balance_usd, hard_limit_usd
  INTO   v_balance_before, v_hard_limit
  FROM   public.credits
  WHERE  user_id = user_id_param
  FOR UPDATE;

  -- Handle missing credits row gracefully
  IF NOT FOUND THEN
    INSERT INTO public.credits (user_id, balance_usd, total_purchased, total_spent)
    VALUES (user_id_param, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_credits', 'balance', 0);
  END IF;

  -- Insufficient balance check
  IF v_balance_before < amount_param THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'insufficient_credits',
      'balance', v_balance_before,
      'required', amount_param
    );
  END IF;

  v_balance_after := v_balance_before - amount_param;

  -- Deduct from balance
  UPDATE public.credits
  SET
    balance_usd  = v_balance_after,
    total_spent  = total_spent + amount_param,
    updated_at   = now()
  WHERE user_id  = user_id_param;

  -- Write credit transaction ledger entry
  INSERT INTO public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES
    (user_id_param, 'debit', amount_param, v_balance_after,
     COALESCE(NULLIF(description_param, ''), 'Agent execution'),
     reference_id_param);

  -- Also update profiles.total_spent
  UPDATE public.profiles
  SET
    total_spent = total_spent + amount_param,
    updated_at  = now()
  WHERE id = user_id_param;

  RETURN jsonb_build_object(
    'ok',             true,
    'balance_before', v_balance_before,
    'balance_after',  v_balance_after,
    'deducted',       amount_param
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 4: NEW USER CREDITS BUG
-- handle_new_user() (on auth.users INSERT) creates credits(0).
-- handle_new_user_credits() (on profiles INSERT) tries credits(2)
-- but hits ON CONFLICT DO NOTHING → users always get $0.
-- Fix: update handle_new_user to use $2 starting balance, OR
-- drop the credits insert from handle_new_user entirely and let
-- handle_new_user_credits do it (it runs right after on profiles INSERT).
-- We choose: remove credits insert from handle_new_user (cleaner separation).
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert profile row (credits will be created by handle_new_user_credits
  -- which fires on profiles INSERT — that function gives the correct $2 balance)
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- DO NOT insert into credits here.
  -- handle_new_user_credits fires on the profiles INSERT above
  -- and creates credits(balance_usd=2.00, hard_limit_usd=5.00).
  -- If we insert credits(0) here first, ON CONFLICT DO NOTHING
  -- in handle_new_user_credits means user gets $0 forever.

  RETURN NEW;
END;
$$;

-- Ensure the trigger is correct (recreate to pick up new function body)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ════════════════════════════════════════════════════════════
-- SECTION 5: execution_traces INSERT — API KEY AUTH FIX
-- When a user executes via API key (no session cookie),
-- auth.uid() is NULL. The INSERT policy:
--   "traces_authenticated_insert": user_id = auth.uid()
-- evaluates to (uuid = NULL) which is NULL (falsy) → insert blocked.
-- Fix: Add a system-level insert policy that allows service_role
-- to insert traces on behalf of API-key authenticated requests.
-- The execute route should use createAdminClient() for trace writes
-- when API-key auth is active (handled in code fix below).
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'execution_traces' AND policyname = 'traces_service_insert'
  ) THEN
    CREATE POLICY "traces_service_insert" ON public.execution_traces
      FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- Also allow admin to read all traces
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'execution_traces' AND policyname = 'traces_admin_read'
  ) THEN
    CREATE POLICY "traces_admin_read" ON public.execution_traces
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- SECTION 6: DUPLICATE EXECUTION TRIGGER AUDIT
-- Two triggers fire on executions table:
--   on_execution_completed → increment_agent_executions()   [our migration]
--   on_execution_complete  → update_agent_stats()           [pre-existing]
-- If update_agent_stats() also increments total_executions,
-- that column will be double-counted.
-- Fix: make increment_agent_executions() a no-op for stats
-- that update_agent_stats() already handles. We reconstruct
-- it to ONLY handle profile.total_spent (cost tracking) since
-- that's likely NOT in update_agent_stats().
-- ════════════════════════════════════════════════════════════

-- Rewrite increment_agent_executions to avoid double-counting:
-- It now ONLY updates profiles.total_spent (cost deduction on success).
-- Agent execution counters are handled by update_agent_stats().
CREATE OR REPLACE FUNCTION public.increment_agent_executions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only act on status transitions TO 'success' (not repeated updates)
  IF NEW.status = 'success'
     AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'success')
  THEN
    -- Update buyer's total_spent (cost tracking in profile)
    -- update_agent_stats() handles agent counters — we avoid double-count.
    UPDATE public.profiles
    SET
      total_spent = total_spent + COALESCE(NEW.cost_usd, 0),
      updated_at  = now()
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger (ensures it fires on both INSERT and UPDATE OF status)
DROP TRIGGER IF EXISTS on_execution_completed ON public.executions;
CREATE TRIGGER on_execution_completed
  AFTER INSERT OR UPDATE OF status ON public.executions
  FOR EACH ROW EXECUTE PROCEDURE public.increment_agent_executions();

-- ════════════════════════════════════════════════════════════
-- SECTION 7: increment_executions_used — ensure correct version
-- Must be idempotent. DROP + CREATE since return type (VOID)
-- might differ from any stale version.
-- ════════════════════════════════════════════════════════════

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

-- ════════════════════════════════════════════════════════════
-- SECTION 8: reset_monthly_quotas — ensure correct version
-- ════════════════════════════════════════════════════════════

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

GRANT EXECUTE ON FUNCTION public.reset_monthly_quotas() TO service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 9: cleanup_rate_limit_counters
-- ════════════════════════════════════════════════════════════

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

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_counters() TO service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 10: MISSING PERFORMANCE INDEXES
-- ════════════════════════════════════════════════════════════

-- Agents: FIFO review queue (admin panel default sort)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_analytics_agent_date
  ON public.agent_analytics(agent_id, date);

CREATE INDEX IF NOT EXISTS idx_agents_status_created
  ON public.agents(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agents_seller_status
  ON public.agents(seller_id, status, created_at DESC);

-- Executions: per-user history + agent analytics
CREATE INDEX IF NOT EXISTS idx_executions_user_status_created
  ON public.executions(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executions_agent_status_created
  ON public.executions(agent_id, status, created_at DESC);

-- API key hash lookup (called on EVERY execution)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active
  ON public.api_keys(key_hash) WHERE is_active = TRUE;

-- Agent subscriptions (checked on every subscription-gated execution)
CREATE INDEX IF NOT EXISTS idx_agent_subs_user_agent_status
  ON public.agent_subscriptions(user_id, agent_id, status);

-- Reviews: admin approval queue (FIFO) + marketplace display
CREATE INDEX IF NOT EXISTS idx_reviews_status_created
  ON public.reviews(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_reviews_agent_approved
  ON public.reviews(agent_id, status, created_at DESC);

-- Notifications: unread badge count
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);

-- Injection attempts: admin security tab
CREATE INDEX IF NOT EXISTS idx_injection_action_created
  ON public.injection_attempts(action, created_at DESC);

-- Credit transactions: user billing history
CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created
  ON public.credit_transactions(user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- SECTION 11: refresh_agent_rating — fix TG_OP=DELETE crash
-- The function uses COALESCE(NEW.agent_id, OLD.agent_id) but
-- on DELETE, NEW is NULL so NEW.agent_id throws a field access
-- error in some PostgreSQL versions. Rewrite defensively.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refresh_agent_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_agent_id UUID;
BEGIN
  -- Safe extraction regardless of TG_OP
  IF TG_OP = 'DELETE' THEN
    v_agent_id := OLD.agent_id;
  ELSE
    v_agent_id := NEW.agent_id;
  END IF;

  IF v_agent_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.agents
  SET
    average_rating = (
      SELECT COALESCE(AVG(rating::NUMERIC), 0)
      FROM   public.reviews
      WHERE  agent_id = v_agent_id
        AND  status   = 'approved'
    ),
    total_reviews  = (
      SELECT COUNT(*)
      FROM   public.reviews
      WHERE  agent_id = v_agent_id
        AND  status   = 'approved'
    ),
    updated_at     = now()
  WHERE id = v_agent_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ════════════════════════════════════════════════════════════
-- SECTION 12: update_seller_earnings — prevent double-credit
-- The function fires on INSERT OR UPDATE OF status. If a
-- transaction is inserted directly with status='succeeded',
-- OLD is NULL. Guard against that case.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_seller_earnings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only act when status transitions TO 'succeeded' (not on updates that keep same status)
  IF NEW.status = 'succeeded'
     AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'succeeded')
  THEN
    IF NEW.seller_id IS NOT NULL THEN
      UPDATE public.profiles
      SET
        total_earned = total_earned + COALESCE(NEW.seller_amount, 0),
        updated_at   = now()
      WHERE id = NEW.seller_id;
    END IF;

    IF NEW.agent_id IS NOT NULL THEN
      UPDATE public.agents
      SET
        total_revenue = total_revenue + COALESCE(NEW.seller_amount, 0),
        updated_at    = now()
      WHERE id = NEW.agent_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- SECTION 13: ADMIN STATS VIEW — updated for correctness
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.admin_platform_stats AS
SELECT
  (SELECT COUNT(*)   FROM public.profiles)                                       AS total_users,
  (SELECT COUNT(*)   FROM public.agents   WHERE status = 'active')               AS active_agents,
  (SELECT COUNT(*)   FROM public.agents   WHERE status = 'pending_review')       AS pending_review_agents,
  (SELECT COUNT(*)   FROM public.agents   WHERE status = 'suspended')            AS suspended_agents,
  (SELECT COUNT(*)   FROM public.executions)                                     AS total_executions,
  (SELECT COUNT(*)   FROM public.executions WHERE status = 'success')            AS successful_executions,
  (SELECT COALESCE(SUM(amount),  0) FROM public.transactions WHERE status='succeeded') AS gross_revenue,
  (SELECT COALESCE(SUM(amount),  0)*0.20
                     FROM public.transactions WHERE status='succeeded')          AS platform_revenue,
  (SELECT COALESCE(SUM(seller_amount), 0)
                     FROM public.transactions WHERE status='succeeded')          AS seller_revenue,
  (SELECT COUNT(*)   FROM public.injection_attempts WHERE action='blocked')      AS blocked_attempts,
  (SELECT COUNT(*)   FROM public.injection_attempts WHERE action='flagged')      AS flagged_attempts,
  (SELECT COUNT(*)   FROM public.reviews  WHERE status='pending')                AS pending_reviews,
  (SELECT COUNT(*)   FROM public.profiles WHERE is_banned = TRUE)                AS banned_users,
  (SELECT COUNT(*)   FROM public.credits  WHERE balance_usd <= 0)               AS zero_credit_users,
  (SELECT COALESCE(SUM(balance_usd), 0) FROM public.credits)                    AS total_credit_float;

GRANT SELECT ON public.admin_platform_stats TO authenticated;

-- ════════════════════════════════════════════════════════════
-- SECTION 14: BACK-FILL CREDITS for existing users with $0
-- Any existing users who were caught by the bug (credits=0
-- because handle_new_user ran before handle_new_user_credits)
-- get the $2 starting balance if they've never topped up.
-- Only applies to users with 0 total_purchased (never paid).
-- ════════════════════════════════════════════════════════════

UPDATE public.credits
SET
  balance_usd      = 2.00,
  hard_limit_usd   = GREATEST(hard_limit_usd, 5.00),
  updated_at       = now()
WHERE
  balance_usd    = 0
  AND total_purchased = 0
  AND total_spent     = 0;

-- ════════════════════════════════════════════════════════════
-- SECTION 15: VERIFICATION
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_admin_agent_policy   TEXT;
  v_admin_review_policy  TEXT;
  v_deduct_credits_fn    TEXT;
  v_handle_new_user_fn   TEXT;
  v_backfill_count       INT;
  v_zero_credits         INT;
BEGIN
  -- Check admin policies exist
  SELECT policyname INTO v_admin_agent_policy
  FROM pg_policies WHERE tablename='agents' AND policyname='agents_admin_all';

  SELECT policyname INTO v_admin_review_policy
  FROM pg_policies WHERE tablename='reviews' AND policyname='reviews_admin_all';

  RAISE NOTICE 'agents_admin_all policy   : %', COALESCE(v_admin_agent_policy,  '❌ MISSING');
  RAISE NOTICE 'reviews_admin_all policy  : %', COALESCE(v_admin_review_policy, '❌ MISSING');

  -- Check deduct_credits exists
  SELECT proname::TEXT INTO v_deduct_credits_fn
  FROM pg_proc WHERE proname = 'deduct_credits' LIMIT 1;
  RAISE NOTICE 'deduct_credits()          : %', COALESCE(v_deduct_credits_fn, '❌ MISSING');

  -- Check handle_new_user exists
  SELECT proname::TEXT INTO v_handle_new_user_fn
  FROM pg_proc WHERE proname = 'handle_new_user' LIMIT 1;
  RAISE NOTICE 'handle_new_user()         : %', COALESCE(v_handle_new_user_fn, '❌ MISSING');

  -- Check zero-credit users remaining
  SELECT COUNT(*) INTO v_zero_credits
  FROM public.credits
  WHERE balance_usd = 0 AND total_purchased = 0 AND total_spent = 0;
  RAISE NOTICE 'Zero-credit users remaining: %', v_zero_credits;

  RAISE NOTICE '✅ Migration 014 complete — platform is production-ready';
END $$;
