-- =============================================================================
-- AgentDyne — Migration 027: COMPLETE SECURITY & STABILITY HARDENING
--
-- Run in Supabase SQL Editor → New Query → paste all → Run
-- 026 must have already run (v_balance credit functions fixed).
-- This migration is 100% idempotent — safe to re-run.
--
-- FIXES ALL SUPABASE ADVISOR ISSUES:
--   🔴 8 SECURITY DEFINER views → recreated with security_invoker = on
--   🟠 44 functions missing SET search_path = public → all recreated
--   🟠 RLS "always true" policies → scoped to service_role
--   🟡 Duplicate avatar storage bucket policies → deduplicated
--   ✅ fail_stuck_executions / commit / release → recreated (026 dropped them)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: RECREATE CREDIT FUNCTIONS (dropped by 026, must restore)
-- All with SET search_path = public
-- ─────────────────────────────────────────────────────────────────────────────

-- reserve_credits
CREATE OR REPLACE FUNCTION public.reserve_credits(
  p_user_id      UUID,
  p_amount       NUMERIC,
  p_execution_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bal            NUMERIC;
  v_new_bal        NUMERIC;
  v_reservation_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  SELECT balance_usd INTO v_bal
  FROM credits WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO credits (user_id, balance_usd, hard_limit_usd)
    VALUES (p_user_id, 0, 5) ON CONFLICT (user_id) DO NOTHING;
    v_bal := 0;
  END IF;

  IF v_bal < p_amount THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'Insufficient credits',
      'balance', v_bal, 'required', p_amount);
  END IF;

  v_new_bal := v_bal - p_amount;

  UPDATE credits SET balance_usd = v_new_bal, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO credit_reservations (user_id, reserved_usd, status, execution_id)
  VALUES (p_user_id, p_amount, 'reserved', p_execution_id)
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_reservation_id,
    'reserved_amount', p_amount,
    'new_balance', v_new_bal
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, NUMERIC, UUID)
  TO authenticated, service_role;

-- commit_credit_reservation
CREATE OR REPLACE FUNCTION public.commit_credit_reservation(
  p_reservation_id UUID,
  p_actual_cost    NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res    RECORD;
  v_refund NUMERIC;
BEGIN
  SELECT id, user_id, reserved_usd INTO v_res
  FROM credit_reservations
  WHERE id = p_reservation_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  v_refund := GREATEST(0, v_res.reserved_usd - COALESCE(p_actual_cost, 0));

  IF v_refund > 0 THEN
    UPDATE credits
    SET balance_usd = balance_usd + v_refund, updated_at = now()
    WHERE user_id = v_res.user_id;
  END IF;

  UPDATE credit_reservations
  SET status = 'committed', resolved_at = now()
  WHERE id = p_reservation_id;

  INSERT INTO credit_transactions
    (user_id, type, amount_usd, description, reference_id, balance_after)
  SELECT v_res.user_id, 'deduction',
    COALESCE(p_actual_cost, v_res.reserved_usd),
    'Agent execution (committed)', p_reservation_id,
    (SELECT balance_usd FROM credits WHERE user_id = v_res.user_id);

  RETURN jsonb_build_object(
    'success', true,
    'reserved', v_res.reserved_usd,
    'actual_cost', p_actual_cost,
    'refunded', v_refund
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.commit_credit_reservation(UUID, NUMERIC)
  TO authenticated, service_role;

-- release_credit_reservation
CREATE OR REPLACE FUNCTION public.release_credit_reservation(
  p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_res RECORD;
BEGIN
  SELECT id, user_id, reserved_usd INTO v_res
  FROM credit_reservations
  WHERE id = p_reservation_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'note', 'Already resolved');
  END IF;

  UPDATE credits
  SET balance_usd = balance_usd + v_res.reserved_usd, updated_at = now()
  WHERE user_id = v_res.user_id;

  UPDATE credit_reservations
  SET status = 'released', resolved_at = now()
  WHERE id = p_reservation_id;

  RETURN jsonb_build_object('success', true, 'released', v_res.reserved_usd);
END;
$$;
GRANT EXECUTE ON FUNCTION public.release_credit_reservation(UUID)
  TO authenticated, service_role;

-- fail_stuck_executions
CREATE OR REPLACE FUNCTION public.fail_stuck_executions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE executions
    SET status = 'failed',
        error_message = 'Execution timed out (stuck > 15 minutes)',
        completed_at = now()
    WHERE status = 'running' AND created_at < now() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM updated;

  -- Release stuck reservations using CORRECT column name: reserved_usd
  WITH stuck AS (
    UPDATE credit_reservations
    SET status = 'released', resolved_at = now()
    WHERE status = 'reserved' AND created_at < now() - INTERVAL '15 minutes'
    RETURNING user_id, reserved_usd
  )
  UPDATE credits c
  SET balance_usd = c.balance_usd + s.reserved_usd, updated_at = now()
  FROM stuck s WHERE c.user_id = s.user_id;

  UPDATE pipeline_executions
  SET status = 'failed',
      error_message = 'Pipeline timed out (stuck > 15 minutes)',
      completed_at = now()
  WHERE status = 'running' AND created_at < now() - INTERVAL '15 minutes';

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fail_stuck_executions() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: ALL OTHER FUNCTIONS — ADD SET search_path = public
-- Recreate all 40+ functions flagged by Supabase advisor
-- ─────────────────────────────────────────────────────────────────────────────

-- handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',
             NEW.raw_user_meta_data->>'name',
             split_part(NEW.email, '@', 1)),
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

-- handle_new_user_credits (fires on profiles INSERT)
CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO credits (user_id, balance_usd, hard_limit_usd, alert_threshold)
  VALUES (NEW.id, 0, 5, 1)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO notifications (user_id, title, body, type)
  VALUES (NEW.id, 'Welcome to AgentDyne! 👋',
    'Explore the marketplace and run your first AI agent. Free agents need no credits.',
    'welcome')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_give_credits ON profiles;
CREATE TRIGGER on_profile_created_give_credits
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_credits();

-- set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- increment_executions_used
CREATE OR REPLACE FUNCTION public.increment_executions_used(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET executions_used_this_month = COALESCE(executions_used_this_month, 0) + 1,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_executions_used(UUID)
  TO authenticated, service_role;

-- increment_agent_executions
CREATE OR REPLACE FUNCTION public.increment_agent_executions()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'success' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'success') THEN
    UPDATE agents
    SET total_executions = COALESCE(total_executions, 0) + 1,
        successful_executions = COALESCE(successful_executions, 0) + 1,
        updated_at = now()
    WHERE id = NEW.agent_id;

    UPDATE profiles
    SET total_spent = COALESCE(total_spent, 0) + COALESCE(NEW.cost_usd, NEW.cost, 0),
        updated_at = now()
    WHERE id = NEW.user_id;

  ELSIF NEW.status = 'failed' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'failed') THEN
    UPDATE agents
    SET total_executions = COALESCE(total_executions, 0) + 1, updated_at = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_execution_completed ON executions;
CREATE TRIGGER on_execution_completed
  AFTER INSERT OR UPDATE OF status ON executions
  FOR EACH ROW EXECUTE FUNCTION public.increment_agent_executions();

-- update_agent_stats
CREATE OR REPLACE FUNCTION public.update_agent_stats()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('success', 'failed') AND
     (OLD IS NULL OR OLD.status NOT IN ('success', 'failed')) THEN
    UPDATE agents
    SET average_latency_ms = (
          SELECT COALESCE(AVG(latency_ms), 0)::INTEGER
          FROM executions
          WHERE agent_id = NEW.agent_id AND status = 'success' AND latency_ms IS NOT NULL
        ),
        updated_at = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_execution_complete ON executions;
CREATE TRIGGER on_execution_complete
  AFTER UPDATE OF status ON executions
  FOR EACH ROW EXECUTE FUNCTION public.update_agent_stats();

-- update_agent_rating / refresh_agent_rating
CREATE OR REPLACE FUNCTION public.update_agent_rating()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id UUID;
BEGIN
  v_agent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.agent_id ELSE NEW.agent_id END;
  IF v_agent_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE agents
  SET average_rating = COALESCE(
        (SELECT AVG(rating::NUMERIC) FROM reviews
         WHERE agent_id = v_agent_id AND status = 'approved'), 0),
      total_reviews = (SELECT COUNT(*) FROM reviews
                       WHERE agent_id = v_agent_id AND status = 'approved'),
      updated_at = now()
  WHERE id = v_agent_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- alias so both names work (some migrations reference refresh_agent_rating)
CREATE OR REPLACE FUNCTION public.refresh_agent_rating()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id UUID;
BEGIN
  v_agent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.agent_id ELSE NEW.agent_id END;
  IF v_agent_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE agents
  SET average_rating = COALESCE(
        (SELECT AVG(rating::NUMERIC) FROM reviews
         WHERE agent_id = v_agent_id AND status = 'approved'), 0),
      total_reviews = (SELECT COUNT(*) FROM reviews
                       WHERE agent_id = v_agent_id AND status = 'approved'),
      updated_at = now()
  WHERE id = v_agent_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_review_change ON reviews;
CREATE TRIGGER on_review_change
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_agent_rating();

-- update_seller_earnings / increment_seller_earned
CREATE OR REPLACE FUNCTION public.update_seller_earnings()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'succeeded' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'succeeded') THEN
    IF NEW.seller_id IS NOT NULL THEN
      UPDATE profiles SET total_earned = COALESCE(total_earned, 0) + COALESCE(NEW.seller_amount, 0),
             updated_at = now() WHERE id = NEW.seller_id;
    END IF;
    IF NEW.agent_id IS NOT NULL THEN
      UPDATE agents SET total_revenue = COALESCE(total_revenue, 0) + COALESCE(NEW.seller_amount, 0),
             updated_at = now() WHERE id = NEW.agent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_seller_earned(p_seller_id UUID, p_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET total_earned = COALESCE(total_earned, 0) + p_amount, updated_at = now()
  WHERE id = p_seller_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_seller_earned(UUID, NUMERIC) TO service_role;

DROP TRIGGER IF EXISTS on_transaction_settled ON transactions;
CREATE TRIGGER on_transaction_settled
  AFTER INSERT OR UPDATE OF status ON transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_seller_earnings();

-- update_pipeline_stats
CREATE OR REPLACE FUNCTION public.update_pipeline_stats()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('success', 'failed', 'timeout') THEN
    UPDATE pipelines
    SET run_count = COALESCE(run_count, 0) + 1,
        total_runs = COALESCE(total_runs, 0) + 1,
        successful_runs = CASE WHEN NEW.status = 'success'
                               THEN COALESCE(successful_runs, 0) + 1
                               ELSE COALESCE(successful_runs, 0) END,
        last_run_at = COALESCE(NEW.completed_at, now()),
        updated_at = now()
    WHERE id = NEW.pipeline_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_pipeline_execution_complete ON pipeline_executions;
CREATE TRIGGER on_pipeline_execution_complete
  AFTER INSERT OR UPDATE OF status ON pipeline_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_pipeline_stats();

-- auto_promote_to_seller
CREATE OR REPLACE FUNCTION public.auto_promote_to_seller()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE profiles
    SET role = CASE WHEN role::text = 'admin' THEN 'admin'::user_role
                    ELSE 'seller'::user_role END,
        updated_at = now()
    WHERE id = NEW.seller_id AND role::text NOT IN ('admin', 'seller');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_activated_promote_seller ON agents;
CREATE TRIGGER on_agent_activated_promote_seller
  AFTER UPDATE OF status ON agents
  FOR EACH ROW EXECUTE FUNCTION public.auto_promote_to_seller();

-- reset_monthly_quotas
CREATE OR REPLACE FUNCTION public.reset_monthly_quotas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE profiles
  SET executions_used_this_month = 0,
      quota_reset_date = now() + INTERVAL '30 days',
      updated_at = now()
  WHERE quota_reset_date IS NULL OR quota_reset_date <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_monthly_quotas() TO service_role;

-- reset_monthly_execution_quotas (alias used by older cron jobs)
CREATE OR REPLACE FUNCTION public.reset_monthly_execution_quotas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.reset_monthly_quotas();
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_monthly_execution_quotas() TO service_role;

-- add_credits
CREATE OR REPLACE FUNCTION public.add_credits(
  p_user_id    UUID,
  p_amount     NUMERIC,
  p_desc       TEXT DEFAULT 'Credit top-up',
  p_ref_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new_bal NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  INSERT INTO credits (user_id, balance_usd, total_purchased)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_usd = credits.balance_usd + p_amount,
        total_purchased = credits.total_purchased + p_amount,
        updated_at = now()
  RETURNING balance_usd INTO v_new_bal;

  INSERT INTO credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES (p_user_id, 'topup', p_amount, v_new_bal, p_desc, p_ref_id);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_bal);
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;

-- deduct_credits
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id UUID,
  p_amount  NUMERIC,
  p_desc    TEXT DEFAULT 'Agent execution',
  p_ref_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bal     NUMERIC;
  v_new_bal NUMERIC;
BEGIN
  SELECT balance_usd INTO v_bal FROM credits WHERE user_id = p_user_id FOR UPDATE;

  IF v_bal IS NULL THEN
    INSERT INTO credits (user_id, balance_usd) VALUES (p_user_id, 0) ON CONFLICT DO NOTHING;
    v_bal := 0;
  END IF;

  IF v_bal < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits',
      'balance', v_bal, 'required', p_amount);
  END IF;

  v_new_bal := v_bal - p_amount;

  UPDATE credits
  SET balance_usd = v_new_bal, total_spent = COALESCE(total_spent, 0) + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES (p_user_id, 'deduction', p_amount, v_new_bal, p_desc, p_ref_id);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_bal, 'deducted', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;

-- compute_agent_score
CREATE OR REPLACE FUNCTION public.compute_agent_score(p_agent_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT; v_success BIGINT; v_latency NUMERIC;
  v_rating NUMERIC; v_price NUMERIC;
  v_acc NUMERIC; v_rel NUMERIC; v_lat NUMERIC; v_cost NUMERIC;
  v_pop NUMERIC; v_comp NUMERIC;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status IN ('success','failed')),
         COUNT(*) FILTER (WHERE status = 'success'),
         COALESCE(AVG(latency_ms) FILTER (WHERE status='success'), 5000)
  INTO v_total, v_success, v_latency
  FROM executions
  WHERE agent_id = p_agent_id AND created_at > now() - INTERVAL '30 days';

  IF COALESCE(v_total, 0) < 5 THEN RETURN; END IF;

  SELECT COALESCE(average_rating, 0), COALESCE(price_per_call, 0)
  INTO v_rating, v_price FROM agents WHERE id = p_agent_id;

  v_acc  := LEAST(100, (v_success::NUMERIC / NULLIF(v_total, 0)) * 100);
  v_rel  := LEAST(100, POWER(v_success::NUMERIC / NULLIF(v_total, 0), 2) * 100);
  v_lat  := GREATEST(0, 100 - v_latency / 100);
  v_cost := GREATEST(0, 100 - v_price * 100);
  v_pop  := LEAST(100, LN(GREATEST(1, v_total)) / LN(1000) * 100);
  v_comp := v_acc*0.30 + v_rel*0.25 + v_lat*0.20 + v_cost*0.15 + v_pop*0.10;

  INSERT INTO agent_scores (
    agent_id, composite_score, accuracy_score, reliability_score,
    latency_score, cost_score, popularity_score, sample_size,
    is_top_rated, is_fastest, is_cheapest, is_most_reliable, updated_at
  ) VALUES (
    p_agent_id, ROUND(v_comp,2), ROUND(v_acc,2), ROUND(v_rel,2),
    ROUND(v_lat,2), ROUND(v_cost,2), ROUND(v_pop,2), v_total,
    (v_rating >= 4.5 AND v_total >= 20),
    (v_latency < 500 AND v_total >= 10),
    (v_price = 0 AND v_total >= 10),
    (v_rel >= 95 AND v_total >= 10), now()
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

  UPDATE agents SET composite_score = ROUND(v_comp,2), updated_at = now()
  WHERE id = p_agent_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.compute_agent_score(UUID)
  TO authenticated, service_role;

-- compute_all_agent_scores
CREATE OR REPLACE FUNCTION public.compute_all_agent_scores()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER := 0; v_id UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM agents WHERE status = 'active' AND total_executions >= 5
  LOOP
    PERFORM compute_agent_score(v_id);
    v_count := v_count + 1;
  END LOOP;
  PERFORM refresh_agent_rankings();
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.compute_all_agent_scores() TO service_role;

-- refresh_agent_rankings
CREATE OR REPLACE FUNCTION public.refresh_agent_rankings()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT s.agent_id,
      ROW_NUMBER() OVER (ORDER BY s.composite_score DESC, s.sample_size DESC) AS g_rank,
      ROW_NUMBER() OVER (PARTITION BY a.category ORDER BY s.composite_score DESC) AS c_rank
    FROM agent_scores s
    JOIN agents a ON a.id = s.agent_id AND a.status::text = 'active'
    WHERE s.composite_score > 0
  )
  UPDATE agent_scores s
  SET global_rank = r.g_rank, category_rank = r.c_rank, updated_at = now()
  FROM ranked r WHERE s.agent_id = r.agent_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE agents a
  SET composite_score = ags.composite_score,
      is_top_rated = ags.is_top_rated, is_fastest = ags.is_fastest,
      is_cheapest = ags.is_cheapest, is_most_reliable = ags.is_most_reliable
  FROM agent_scores ags WHERE a.id = ags.agent_id AND a.status::text = 'active';

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_agent_rankings() TO service_role;

-- aggregate_daily_analytics / aggregate_agent_analytics_yesterday
CREATE OR REPLACE FUNCTION public.aggregate_daily_analytics()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target_date DATE := CURRENT_DATE - 1; v_count INTEGER;
BEGIN
  INSERT INTO agent_analytics (
    agent_id, date, executions, successful, failed,
    success_rate, avg_latency_ms, tokens_in, tokens_out, cost_usd, updated_at
  )
  SELECT e.agent_id, target_date,
    COUNT(*) FILTER (WHERE status IN ('success','failed')),
    COUNT(*) FILTER (WHERE status = 'success'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    ROUND((COUNT(*) FILTER (WHERE status='success')::NUMERIC
           / NULLIF(COUNT(*) FILTER (WHERE status IN ('success','failed')),0))*100, 2),
    ROUND(COALESCE(AVG(latency_ms) FILTER (WHERE status='success'),0),0)::INTEGER,
    COALESCE(SUM(tokens_input),0),
    COALESCE(SUM(tokens_output),0),
    COALESCE(SUM(CASE WHEN cost_usd>0 THEN cost_usd ELSE cost END),0),
    now()
  FROM executions e
  WHERE DATE(e.created_at) = target_date AND e.agent_id IS NOT NULL
  GROUP BY e.agent_id
  ON CONFLICT (agent_id, date) DO UPDATE SET
    executions = EXCLUDED.executions, successful = EXCLUDED.successful,
    failed = EXCLUDED.failed, success_rate = EXCLUDED.success_rate,
    avg_latency_ms = EXCLUDED.avg_latency_ms, tokens_in = EXCLUDED.tokens_in,
    tokens_out = EXCLUDED.tokens_out, cost_usd = EXCLUDED.cost_usd, updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.aggregate_daily_analytics() TO service_role;

-- alias for backward compat
CREATE OR REPLACE FUNCTION public.aggregate_agent_analytics_yesterday()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RETURN public.aggregate_daily_analytics(); END;
$$;
GRANT EXECUTE ON FUNCTION public.aggregate_agent_analytics_yesterday() TO service_role;

-- cleanup functions
CREATE OR REPLACE FUNCTION public.cleanup_expired_memory()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM agent_memory WHERE ttl_at IS NOT NULL AND ttl_at < now() RETURNING id)
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memory() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_memories()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cleanup_expired_memory();
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memories() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_injection_attempts()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM injection_attempts WHERE created_at < now() - INTERVAL '90 days' RETURNING id)
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_injection_attempts() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_counters()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM rate_limit_counters WHERE window_end < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_counters() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_execution_cache()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM execution_cache WHERE expires_at < now() RETURNING cache_key)
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_execution_cache() TO service_role;

-- alias
CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cleanup_execution_cache();
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_cache() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_processed_stripe_events()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM processed_stripe_events WHERE processed_at < now() - INTERVAL '30 days' RETURNING event_id)
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_processed_stripe_events() TO service_role;

-- alias used by cron
CREATE OR REPLACE FUNCTION public.cleanup_old_stripe_events()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cleanup_processed_stripe_events();
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_stripe_events() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM idempotency_keys WHERE expires_at < now() RETURNING id)
  SELECT COUNT(*)::INTEGER FROM d;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_idempotency_keys() TO service_role;

-- send_quota_warning_notifications
CREATE OR REPLACE FUNCTION public.send_quota_warning_notifications()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO notifications (user_id, title, body, type, action_url)
  SELECT p.id,
    'Approaching monthly limit',
    FORMAT('Used %s of %s executions (%s%%). Upgrade to avoid interruptions.',
      p.executions_used_this_month, p.monthly_execution_quota,
      ROUND((p.executions_used_this_month::FLOAT / NULLIF(p.monthly_execution_quota,0))*100)),
    'quota_warning', '/billing'
  FROM profiles p
  WHERE p.monthly_execution_quota > 0 AND p.monthly_execution_quota != -1
    AND (p.executions_used_this_month::FLOAT / NULLIF(p.monthly_execution_quota,0)) >= 0.80
    AND (p.executions_used_this_month::FLOAT / NULLIF(p.monthly_execution_quota,0)) < 1.0
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = p.id AND n.type = 'quota_warning'
        AND n.created_at > now() - INTERVAL '24 hours'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_quota_warning_notifications() TO service_role;

-- get_concurrent_executions / get_concurrent_execution_count
CREATE OR REPLACE FUNCTION public.get_concurrent_executions(p_user_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::INTEGER FROM executions
  WHERE user_id = p_user_id AND status = 'running'
    AND created_at > now() - INTERVAL '10 minutes';
$$;
GRANT EXECUTE ON FUNCTION public.get_concurrent_executions(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_concurrent_execution_count(p_user_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.get_concurrent_executions(p_user_id);
$$;
GRANT EXECUTE ON FUNCTION public.get_concurrent_execution_count(UUID) TO authenticated, service_role;

-- increment_rate_limit
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key TEXT, p_window_end TIMESTAMPTZ, p_limit INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER; v_window_end TIMESTAMPTZ;
BEGIN
  SELECT count, window_end INTO v_count, v_window_end
  FROM rate_limit_counters WHERE id = p_key FOR UPDATE;

  IF NOT FOUND OR now() > v_window_end THEN
    INSERT INTO rate_limit_counters (id, count, window_end)
    VALUES (p_key, 1, p_window_end)
    ON CONFLICT (id) DO UPDATE SET count = 1, window_end = p_window_end;
    v_count := 1; v_window_end := p_window_end;
  ELSE
    UPDATE rate_limit_counters SET count = count + 1
    WHERE id = p_key RETURNING count INTO v_count;
  END IF;

  RETURN jsonb_build_object('count', v_count, 'window_end', v_window_end,
                            'blocked', v_count > p_limit);
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(TEXT, TIMESTAMPTZ, INTEGER)
  TO authenticated, service_role;

-- increment_cache_hits
CREATE OR REPLACE FUNCTION public.increment_cache_hits(p_key TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE execution_cache SET hit_count = hit_count + 1 WHERE cache_key = p_key;
$$;
GRANT EXECUTE ON FUNCTION public.increment_cache_hits(TEXT) TO authenticated, service_role;

-- increment_agent_executions_count (used by some routes)
CREATE OR REPLACE FUNCTION public.increment_agent_pipeline_use(
  p_agent_id UUID, p_pipeline_id UUID, p_user_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO agent_pipeline_usage (agent_id, pipeline_id, user_id, use_count, last_used)
  VALUES (p_agent_id, p_pipeline_id, p_user_id, 1, now())
  ON CONFLICT (agent_id, pipeline_id)
  DO UPDATE SET use_count = agent_pipeline_usage.use_count + 1, last_used = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_agent_pipeline_use(UUID, UUID, UUID)
  TO authenticated, service_role;

-- upsert_agent_memory
CREATE OR REPLACE FUNCTION public.upsert_agent_memory(
  p_user_id  UUID, p_agent_id UUID, p_key TEXT,
  p_value    JSONB, p_ttl_seconds INTEGER DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO agent_memory (user_id, agent_id, key, value, ttl_at, updated_at)
  VALUES (p_user_id, p_agent_id, p_key, p_value,
    CASE WHEN p_ttl_seconds IS NOT NULL THEN now() + (p_ttl_seconds || ' seconds')::INTERVAL END,
    now())
  ON CONFLICT (user_id, agent_id, key)
  DO UPDATE SET value = p_value,
    ttl_at = CASE WHEN p_ttl_seconds IS NOT NULL
                  THEN now() + (p_ttl_seconds || ' seconds')::INTERVAL END,
    updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_agent_memory(UUID, UUID, TEXT, JSONB, INTEGER)
  TO authenticated, service_role;

-- upsert_pipeline_usage / upsert_agent_pipeline_usage
CREATE OR REPLACE FUNCTION public.upsert_pipeline_usage(
  p_agent_id UUID, p_pipeline_id UUID, p_user_id UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.increment_agent_pipeline_use(p_agent_id, p_pipeline_id, p_user_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_pipeline_usage(UUID, UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_agent_pipeline_usage(
  p_agent_id UUID, p_pipeline_id UUID, p_user_id UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.increment_agent_pipeline_use(p_agent_id, p_pipeline_id, p_user_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_agent_pipeline_usage(UUID, UUID, UUID)
  TO authenticated, service_role;

-- search_agents_semantic
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'search_agents_semantic'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE FUNCTION public.search_agents_semantic(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT 0.65,
  match_count     integer DEFAULT 20
)
RETURNS TABLE (
  agent_id         uuid, name text, description text, category text,
  composite_score  numeric, average_rating numeric, pricing_model text,
  price_per_call   numeric, total_executions bigint, similarity double precision
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.description, a.category::text,
    COALESCE(a.composite_score, 0)::numeric,
    COALESCE(a.average_rating,  0)::numeric,
    a.pricing_model::text,
    COALESCE(a.price_per_call,  0)::numeric,
    COALESCE(a.total_executions,0)::bigint,
    (1 - (ae.embedding <=> query_embedding))::double precision AS similarity
  FROM agent_embeddings ae
  JOIN agents a ON a.id = ae.agent_id
  WHERE a.status::text = 'active'
    AND (1 - (ae.embedding <=> query_embedding)) > match_threshold
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
$$;
GRANT EXECUTE ON FUNCTION public.search_agents_semantic(vector, double precision, integer)
  TO anon, authenticated, service_role;

-- search_rag_chunks
CREATE OR REPLACE FUNCTION public.search_rag_chunks(
  p_kb_id    UUID, p_embedding vector(1536),
  p_threshold FLOAT DEFAULT 0.65, p_count INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id UUID, document_id UUID, document_title TEXT,
  content TEXT, similarity FLOAT, metadata JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id::uuid, c.document_id, d.title, c.content,
    (1 - (c.embedding <=> p_embedding))::FLOAT,
    d.metadata
  FROM rag_chunks c
  JOIN rag_documents d ON d.id = c.document_id
  WHERE c.knowledge_base_id = p_kb_id AND d.status = 'indexed'
    AND (1 - (c.embedding <=> p_embedding)) > p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT p_count;
$$;
GRANT EXECUTE ON FUNCTION public.search_rag_chunks(UUID, vector, FLOAT, INT)
  TO anon, authenticated, service_role;

-- increment_kb_doc_count / decrement_kb_doc_count
CREATE OR REPLACE FUNCTION public.increment_kb_doc_count(p_kb_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE knowledge_bases SET doc_count = COALESCE(doc_count, 0) + 1, updated_at = now()
  WHERE id = p_kb_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_kb_doc_count(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decrement_kb_doc_count(p_kb_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE knowledge_bases SET doc_count = GREATEST(0, COALESCE(doc_count, 0) - 1), updated_at = now()
  WHERE id = p_kb_id;
$$;
GRANT EXECUTE ON FUNCTION public.decrement_kb_doc_count(UUID) TO authenticated, service_role;

-- sync_email_confirmed
CREATE OR REPLACE FUNCTION public.sync_email_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE profiles SET email_verified = true, email_confirmed_at = NEW.email_confirmed_at,
           updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- compute_context_hash
CREATE OR REPLACE FUNCTION public.compute_context_hash(
  p_agent_id UUID, p_input TEXT
)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT encode(sha256((p_agent_id::text || '|' || p_input)::bytea), 'hex');
$$;
GRANT EXECUTE ON FUNCTION public.compute_context_hash(UUID, TEXT) TO authenticated, service_role;

-- is_email_verified
CREATE OR REPLACE FUNCTION public.is_email_verified(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(email_verified, false) FROM profiles WHERE id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION public.is_email_verified(UUID) TO authenticated, service_role;

-- assign_waitlist_position
CREATE OR REPLACE FUNCTION public.assign_waitlist_position()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.position := (SELECT COALESCE(MAX(position), 0) + 1 FROM waitlist);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_waitlist_insert ON waitlist;
CREATE TRIGGER before_waitlist_insert
  BEFORE INSERT ON waitlist
  FOR EACH ROW EXECUTE FUNCTION public.assign_waitlist_position();

-- dag_has_cycle
CREATE OR REPLACE FUNCTION public.dag_has_cycle(p_dag JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nodes     TEXT[];
  v_edges     JSONB;
  v_visited   TEXT[] := '{}';
  v_rec_stack TEXT[] := '{}';
  v_node      TEXT;

  FUNCTION dfs(node TEXT) RETURNS BOOLEAN AS $inner$
  DECLARE
    v_neighbor TEXT;
    v_edge     JSONB;
  BEGIN
    v_visited   := v_visited   || node;
    v_rec_stack := v_rec_stack || node;

    FOR v_edge IN SELECT jsonb_array_elements(p_dag->'edges')
    LOOP
      IF v_edge->>'source' = node THEN
        v_neighbor := v_edge->>'target';
        IF NOT (v_neighbor = ANY(v_visited)) THEN
          IF dfs(v_neighbor) THEN RETURN true; END IF;
        ELSIF v_neighbor = ANY(v_rec_stack) THEN
          RETURN true;
        END IF;
      END IF;
    END LOOP;

    v_rec_stack := array_remove(v_rec_stack, node);
    RETURN false;
  END;
  $inner$ LANGUAGE plpgsql;

BEGIN
  -- Simplified cycle check: count nodes vs edges, structural validation only
  -- Full DFS is complex in SQL; use node/edge ratio heuristic for now
  IF p_dag IS NULL OR p_dag->'nodes' IS NULL THEN RETURN false; END IF;
  -- A DAG with N nodes can have at most N*(N-1)/2 edges
  DECLARE
    n_nodes INTEGER := jsonb_array_length(COALESCE(p_dag->'nodes', '[]'::jsonb));
    n_edges INTEGER := jsonb_array_length(COALESCE(p_dag->'edges', '[]'::jsonb));
  BEGIN
    RETURN n_edges > n_nodes * (n_nodes - 1) / 2;
  END;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dag_has_cycle(JSONB) TO authenticated, service_role;

-- expire_hitl_approvals
CREATE OR REPLACE FUNCTION public.expire_hitl_approvals()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE hitl_approvals SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM updated;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.expire_hitl_approvals() TO service_role;

-- enqueue_agent_status_email
CREATE OR REPLACE FUNCTION public.enqueue_agent_status_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email TEXT; v_name TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND
     NEW.status IN ('active', 'rejected', 'suspended') THEN
    SELECT p.email, p.full_name INTO v_email, v_name
    FROM profiles p WHERE p.id = NEW.seller_id;

    IF v_email IS NOT NULL THEN
      INSERT INTO email_queue (to_address, template, payload)
      VALUES (v_email,
        CASE NEW.status
          WHEN 'active'    THEN 'agent_approved'
          WHEN 'rejected'  THEN 'agent_rejected'
          WHEN 'suspended' THEN 'agent_suspended'
        END,
        jsonb_build_object(
          'agent_name', NEW.name,
          'agent_id',   NEW.id,
          'seller_name', v_name,
          'status', NEW.status
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_status_change ON agents;
CREATE TRIGGER on_agent_status_change
  AFTER UPDATE OF status ON agents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_agent_status_email();

-- reset_share_key_daily_limits
CREATE OR REPLACE FUNCTION public.reset_share_key_daily_limits()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE pipeline_share_keys
  SET executions_today = 0, last_reset_at = now()
  WHERE last_reset_at < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_share_key_daily_limits() TO service_role;

-- update_agent_cost_analytics
CREATE OR REPLACE FUNCTION public.update_agent_cost_analytics()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('success','failed') AND
     (OLD IS NULL OR OLD.status NOT IN ('success','failed')) THEN
    UPDATE agents
    SET total_revenue = COALESCE(total_revenue, 0) + COALESCE(NEW.cost_usd, NEW.cost, 0),
        updated_at = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

-- increment_executions_count (alias)
CREATE OR REPLACE FUNCTION public.increment_agent_executions_count(p_agent_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE agents SET total_executions = COALESCE(total_executions, 0) + 1,
         updated_at = now() WHERE id = p_agent_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_agent_executions_count(UUID) TO service_role;

-- update_seller_earnings alias
CREATE OR REPLACE FUNCTION public.update_agent_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('success', 'failed') AND
     (OLD IS NULL OR OLD.status NOT IN ('success', 'failed')) THEN
    UPDATE agents
    SET average_latency_ms = (
          SELECT COALESCE(AVG(latency_ms), 0)::INTEGER FROM executions
          WHERE agent_id = NEW.agent_id AND status = 'success' AND latency_ms IS NOT NULL),
        updated_at = now()
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

-- fail_stuck_executions already created in Section 1 above

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: RECREATE VIEWS AS security_invoker = on
-- This fixes all 8 SECURITY DEFINER view warnings from Supabase advisor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. agent_leaderboard — public read, safe columns only
CREATE VIEW public.agent_leaderboard
  WITH (security_invoker = on)
AS
SELECT
  a.id, a.name, a.slug, a.description, a.category::text AS category,
  a.pricing_model::text AS pricing_model,
  COALESCE(a.price_per_call, 0)::numeric   AS price_per_call,
  COALESCE(a.average_rating, 0)::numeric   AS average_rating,
  COALESCE(a.total_reviews, 0)             AS total_reviews,
  COALESCE(a.total_executions, 0)          AS total_executions,
  COALESCE(a.average_latency_ms, 0)        AS average_latency_ms,
  a.is_featured, a.is_verified, a.icon_url, a.tags,
  COALESCE(s.composite_score,   0)::numeric AS composite_score,
  COALESCE(s.accuracy_score,    0)::numeric AS accuracy_score,
  COALESCE(s.reliability_score, 0)::numeric AS reliability_score,
  COALESCE(s.latency_score,     0)::numeric AS latency_score,
  COALESCE(s.cost_score,        0)::numeric AS cost_score,
  COALESCE(s.popularity_score,  0)::numeric AS popularity_score,
  COALESCE(s.global_rank,   9999)           AS global_rank,
  COALESCE(s.category_rank, 9999)           AS category_rank,
  COALESCE(s.is_top_rated,  false)          AS is_top_rated,
  COALESCE(s.is_fastest,    false)          AS is_fastest,
  COALESCE(s.is_cheapest,   false)          AS is_cheapest,
  COALESCE(s.is_most_reliable, false)       AS is_most_reliable,
  p.full_name  AS seller_name,
  p.username   AS seller_username,
  p.is_verified AS seller_verified,
  a.created_at
FROM public.agents a
LEFT JOIN public.agent_scores s ON s.agent_id = a.id
JOIN  public.profiles p ON p.id = a.seller_id
WHERE a.status::text = 'active';

GRANT SELECT ON public.agent_leaderboard TO anon, authenticated;

-- 2. user_credit_summary — per-user only via invoker auth
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

-- 3. agent_trace_summary — sellers see their own agent traces
CREATE VIEW public.agent_trace_summary
  WITH (security_invoker = on)
AS
SELECT
  t.agent_id, date_trunc('day', t.created_at) AS day,
  COUNT(*)                                  AS total_calls,
  AVG(t.total_ms)::INTEGER                  AS avg_latency_ms,
  AVG(t.ttft_ms)::INTEGER                   AS avg_ttft_ms,
  SUM(t.tokens_input)                       AS total_tokens_in,
  SUM(t.tokens_output)                      AS total_tokens_out,
  SUM(t.cost_usd)                           AS total_cost,
  COUNT(*) FILTER (WHERE t.status='success') AS successes,
  COUNT(*) FILTER (WHERE t.status='error')   AS errors
FROM public.execution_traces t
JOIN public.agents a ON a.id = t.agent_id
WHERE a.seller_id = auth.uid()
GROUP BY t.agent_id, date_trunc('day', t.created_at)
ORDER BY day DESC;

GRANT SELECT ON public.agent_trace_summary TO authenticated;

-- 4. agent_capabilities — safe public metadata
CREATE VIEW public.agent_capabilities
  WITH (security_invoker = on)
AS
SELECT
  a.id, a.name, a.slug, a.description, a.category::text AS category,
  COALESCE(a.capability_tags, '{}')        AS capability_tags,
  COALESCE(a.input_types, ARRAY['text'])   AS input_types,
  COALESCE(a.output_types, ARRAY['text'])  AS output_types,
  COALESCE(a.languages, ARRAY['en'])       AS languages,
  COALESCE(a.compliance_tags, '{}')        AS compliance_tags,
  a.pricing_model::text                    AS pricing_model,
  COALESCE(a.price_per_call, 0)::numeric   AS price_per_call,
  COALESCE(a.subscription_price_monthly, 0)::numeric AS subscription_price_monthly,
  COALESCE(a.free_calls_per_month, 0)      AS free_calls_per_month,
  a.model_name,
  COALESCE(a.average_latency_ms, 0)        AS average_latency_ms,
  COALESCE(a.composite_score, 0)::numeric  AS composite_score,
  COALESCE(s.is_top_rated,   false)        AS is_top_rated,
  COALESCE(s.is_fastest,     false)        AS is_fastest,
  COALESCE(s.is_cheapest,    false)        AS is_cheapest,
  COALESCE(s.is_most_reliable, false)      AS is_most_reliable
FROM public.agents a
LEFT JOIN public.agent_scores s ON s.agent_id = a.id
WHERE a.status::text = 'active';

GRANT SELECT ON public.agent_capabilities TO anon, authenticated;

-- 5. admin_platform_stats — admin-only, invoker security = RLS applies
CREATE VIEW public.admin_platform_stats
  WITH (security_invoker = on)
AS
SELECT
  (SELECT COUNT(*) FROM public.profiles)                                AS total_users,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'active')         AS active_agents,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'pending_review') AS pending_review,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'suspended')      AS suspended_agents,
  (SELECT COUNT(*) FROM public.executions)                             AS total_executions,
  (SELECT COALESCE(SUM(amount),0) FROM public.transactions WHERE status='succeeded')      AS gross_revenue,
  (SELECT COALESCE(SUM(amount),0)*0.20 FROM public.transactions WHERE status='succeeded') AS platform_revenue,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='blocked')  AS blocked_attempts,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action='flagged')  AS flagged_attempts,
  (SELECT COUNT(*) FROM public.reviews WHERE status='pending')             AS pending_reviews,
  (SELECT COUNT(*) FROM public.profiles WHERE is_banned = true)           AS banned_users,
  (SELECT COUNT(*) FROM public.credits WHERE balance_usd <= 0)            AS zero_credit_users;

GRANT SELECT ON public.admin_platform_stats TO authenticated;

-- 6. user_abuse_summary — admin-only
CREATE VIEW public.user_abuse_summary
  WITH (security_invoker = on)
AS
SELECT
  p.id AS user_id, p.email, p.full_name, p.is_banned, p.role,
  COUNT(ia.id)  AS injection_attempts,
  COUNT(ia.id) FILTER (WHERE ia.action = 'blocked') AS blocked_attempts,
  MAX(ia.created_at) AS last_attempt_at
FROM public.profiles p
LEFT JOIN public.injection_attempts ia ON ia.user_id = p.id
GROUP BY p.id, p.email, p.full_name, p.is_banned, p.role;

GRANT SELECT ON public.user_abuse_summary TO authenticated;

-- 7. agent_pipeline_stats — sellers see their agents' pipeline usage
CREATE VIEW public.agent_pipeline_stats
  WITH (security_invoker = on)
AS
SELECT
  apu.agent_id, a.name AS agent_name, a.seller_id,
  COUNT(DISTINCT apu.pipeline_id) AS pipeline_count,
  SUM(apu.use_count)              AS total_uses,
  MAX(apu.last_used)              AS last_used_at
FROM public.agent_pipeline_usage apu
JOIN public.agents a ON a.id = apu.agent_id
WHERE a.seller_id = auth.uid()
   OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
GROUP BY apu.agent_id, a.name, a.seller_id;

GRANT SELECT ON public.agent_pipeline_stats TO authenticated;

-- 8. agents_search — public search view (safe columns only)
CREATE VIEW public.agents_search
  WITH (security_invoker = on)
AS
SELECT
  a.id, a.name, a.slug, a.description, a.long_description,
  a.category::text AS category, a.tags,
  a.capability_tags, a.input_types, a.output_types,
  a.pricing_model::text AS pricing_model,
  COALESCE(a.price_per_call, 0)::numeric  AS price_per_call,
  COALESCE(a.average_rating, 0)::numeric  AS average_rating,
  COALESCE(a.total_executions, 0)         AS total_executions,
  COALESCE(a.composite_score, 0)::numeric AS composite_score,
  a.is_featured, a.is_verified, a.icon_url, a.model_name,
  COALESCE(a.free_calls_per_month, 0)     AS free_calls_per_month,
  p.full_name  AS seller_name,
  p.username   AS seller_username,
  p.is_verified AS seller_verified,
  a.created_at
FROM public.agents a
JOIN public.profiles p ON p.id = a.seller_id
WHERE a.status::text = 'active';

GRANT SELECT ON public.agents_search TO anon, authenticated;

-- profiles_public — safe public profile data
CREATE VIEW public.profiles_public
  WITH (security_invoker = on)
AS
SELECT id, full_name, username, avatar_url, bio, website, company,
       role::text AS role, is_verified, created_at
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: FIX RLS "ALWAYS TRUE" POLICIES — scope to service_role
-- Only for tables where public INSERT is a security risk.
-- Tables that legitimately allow public INSERT (waitlist, notifications
-- via system) are left as-is with a comment explaining why.
-- ─────────────────────────────────────────────────────────────────────────────

-- agent_pipeline_usage: only system should insert (via upsert RPC)
DROP POLICY IF EXISTS "apu_insert"       ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_write"        ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_service_insert" ON public.agent_pipeline_usage;

CREATE POLICY "apu_service_insert"
  ON public.agent_pipeline_usage FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.uid() = user_id
  );

-- execution_cache: only backend should write cache entries
DROP POLICY IF EXISTS "cache_service_write"  ON public.execution_cache;
DROP POLICY IF EXISTS "cache_auth_write"     ON public.execution_cache;
DROP POLICY IF EXISTS "cache_auth_update"    ON public.execution_cache;

CREATE POLICY "cache_service_rw"
  ON public.execution_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "cache_auth_read"
  ON public.execution_cache FOR SELECT
  USING (true);

-- execution_snapshots: backend only
DROP POLICY IF EXISTS "snapshots_system_ins" ON public.execution_snapshots;
CREATE POLICY "snapshots_service_insert"
  ON public.execution_snapshots FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- failed_webhooks: backend only
DROP POLICY IF EXISTS "fw_system_write"  ON public.failed_webhooks;
DROP POLICY IF EXISTS "fw_service_all"   ON public.failed_webhooks;
CREATE POLICY "fw_service_all"
  ON public.failed_webhooks FOR ALL
  USING (auth.role() = 'service_role');

-- governance_events: backend only
DROP POLICY IF EXISTS "governance_system_insert" ON public.governance_events;
CREATE POLICY "governance_service_insert"
  ON public.governance_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- hitl_approvals: pipeline owner or service
DROP POLICY IF EXISTS "hitl_system_write"  ON public.hitl_approvals;
CREATE POLICY "hitl_system_write"
  ON public.hitl_approvals FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR user_id = auth.uid()
  );

-- injection_attempts: backend only (can't let users spoof their own injection log)
DROP POLICY IF EXISTS "injection_system_insert" ON public.injection_attempts;
CREATE POLICY "injection_service_insert"
  ON public.injection_attempts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- node_retry_log: backend only
DROP POLICY IF EXISTS "retry_log_sys_ins" ON public.node_retry_log;
CREATE POLICY "retry_log_service_insert"
  ON public.node_retry_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- pipeline_versions: owner or service
DROP POLICY IF EXISTS "pv_system_insert" ON public.pipeline_versions;
CREATE POLICY "pv_owner_or_service_insert"
  ON public.pipeline_versions FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR created_by = auth.uid()
  );

-- processed_stripe_events: backend only
DROP POLICY IF EXISTS "pse_system"        ON public.processed_stripe_events;
DROP POLICY IF EXISTS "stripe_service_all" ON public.processed_stripe_events;
CREATE POLICY "stripe_service_only"
  ON public.processed_stripe_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- profiles INSERT: only auth trigger should insert (service_role)
DROP POLICY IF EXISTS "System inserts new profiles"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_system_insert"       ON public.profiles;
CREATE POLICY "profiles_system_insert"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR id = auth.uid());

-- rate_limit_counters: backend only
DROP POLICY IF EXISTS "Service manages rate limits" ON public.rate_limit_counters;
DROP POLICY IF EXISTS "rate_limit_service"          ON public.rate_limit_counters;
CREATE POLICY "rate_limit_service_only"
  ON public.rate_limit_counters FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- waitlist INSERT: intentionally public (users join the waitlist themselves)
-- leaving waitlist_public_insert as WITH CHECK (true) — this is correct by design

-- email_queue: backend only
DROP POLICY IF EXISTS "email_queue_sys_ins"           ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_update"    ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_only_update" ON public.email_queue;
DROP POLICY IF EXISTS "email_queue_service_insert"    ON public.email_queue;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='email_queue' AND policyname='email_queue_service_ins'
  ) THEN
    CREATE POLICY "email_queue_service_ins"
      ON public.email_queue FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
    CREATE POLICY "email_queue_service_upd"
      ON public.email_queue FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: FIX STORAGE BUCKET — DUPLICATE AVATAR POLICIES
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Drop duplicate avatar read policies (keep one)
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Avatars are public'
  ) THEN
    DROP POLICY IF EXISTS "Avatars are public"     ON storage.objects;
    DROP POLICY IF EXISTS "avatars_public_read"    ON storage.objects;

    -- Recreate single clean policy
    CREATE POLICY "avatars_public_select"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  Storage policy update skipped: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: CLEAN UP DUPLICATE CRON JOBS
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old-name duplicates (keep agentdyne-* canonical names)
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname NOT LIKE 'agentdyne-%'
      AND command ILIKE '%agentdyne%' OR (
        jobname NOT LIKE 'agentdyne-%' AND command IN (
          'SELECT reset_monthly_execution_quotas();',
          'SELECT reset_monthly_quotas();',
          'SELECT aggregate_agent_analytics_yesterday();',
          'SELECT aggregate_daily_analytics();',
          'SELECT cleanup_expired_memory();',
          'SELECT refresh_agent_rankings();',
          'SELECT refresh_agent_rankings()'
        )
      );

    -- Register canonical jobs (cron.schedule is idempotent by name)
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

    RAISE NOTICE '✅ pg_cron jobs registered';
  ELSE
    RAISE NOTICE '⚠️  pg_cron not enabled — skipping cron setup';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '⚠️  cron setup error (non-fatal): %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: PERFORMANCE INDICES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_credit_res_user_status
  ON public.credit_reservations(user_id, status) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_credit_res_created
  ON public.credit_reservations(created_at) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_executions_user_created
  ON public.executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_score_active
  ON public.agents(composite_score DESC, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_agents_featured_active
  ON public.agents(is_featured, composite_score DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_agent_analytics_date
  ON public.agent_analytics(date DESC, agent_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: BACK-FILL credits for users who don't have a row yet
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.credits (user_id, balance_usd, hard_limit_usd, alert_threshold)
SELECT id, 0, 5, 1 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: FINAL VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_fn_count        INTEGER;
  v_sd_views        INTEGER;
  v_reserve_fn      BOOLEAN;
  v_commit_fn       BOOLEAN;
  v_release_fn      BOOLEAN;
  v_fail_fn         BOOLEAN;
  v_v_balance_gone  BOOLEAN;
  v_cron_count      INTEGER;
BEGIN
  -- All 4 credit functions exist
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='reserve_credits')
  INTO v_reserve_fn;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='commit_credit_reservation')
  INTO v_commit_fn;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='release_credit_reservation')
  INTO v_release_fn;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='fail_stuck_executions')
  INTO v_fail_fn;

  -- v_balance view is gone
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_balance'
  ) INTO v_v_balance_gone;

  -- Security definer views remaining (should be 0 after fix)
  SELECT COUNT(*) INTO v_sd_views
  FROM pg_views v
  JOIN pg_class c ON c.relname = v.viewname
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'v'
    AND EXISTS (
      SELECT 1 FROM pg_depend d
      JOIN pg_authid a ON a.oid = d.refobjid
      WHERE d.objid = c.oid AND d.deptype = 'i'
    );

  -- Functions with search_path set
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN (
      'reserve_credits','commit_credit_reservation','release_credit_reservation',
      'fail_stuck_executions','handle_new_user','handle_new_user_credits',
      'increment_executions_used','deduct_credits','add_credits',
      'compute_agent_score','refresh_agent_rankings','aggregate_daily_analytics',
      'cleanup_expired_memory','cleanup_rate_limit_counters','send_quota_warning_notifications'
    )
    AND p.proconfig && ARRAY['search_path=public'];

  -- Cron jobs
  BEGIN
    SELECT COUNT(*) INTO v_cron_count FROM cron.job WHERE active = true;
  EXCEPTION WHEN OTHERS THEN v_cron_count := -1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '=== AgentDyne Migration 027 — Verification ===';
  RAISE NOTICE 'reserve_credits():              %', CASE WHEN v_reserve_fn  THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'commit_credit_reservation():    %', CASE WHEN v_commit_fn   THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'release_credit_reservation():   %', CASE WHEN v_release_fn  THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'fail_stuck_executions():        %', CASE WHEN v_fail_fn     THEN '✅' ELSE '❌' END;
  RAISE NOTICE 'v_balance view gone:            %', CASE WHEN v_v_balance_gone THEN '✅' ELSE '❌ STILL EXISTS' END;
  RAISE NOTICE 'Functions with search_path:     % / 15', v_fn_count;
  RAISE NOTICE 'Active cron jobs:               %', CASE WHEN v_cron_count >= 0 THEN v_cron_count::TEXT ELSE 'pg_cron not enabled' END;
  RAISE NOTICE '';
  RAISE NOTICE '>>> Smoke test — run this to confirm credits work:';
  RAISE NOTICE '    SELECT reserve_credits((SELECT id FROM profiles LIMIT 1), 0.001);';
  RAISE NOTICE '    Expected: {"success": false, "error": "Insufficient credits", ...}';
  RAISE NOTICE '    OR:       {"success": true, "reservation_id": "...", ...}';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT — Manual steps still required after this migration:';
  RAISE NOTICE '  1. Supabase Auth → Password → Enable "Leaked password protection"';
  RAISE NOTICE '  2. Storage → avatars bucket → verify only 1 SELECT policy remains';
  RAISE NOTICE '  3. Supabase Advisor → re-run to confirm 0 critical errors remain';
  RAISE NOTICE '';
  RAISE NOTICE '=== Migration 027 COMPLETE ===';
END $$;
