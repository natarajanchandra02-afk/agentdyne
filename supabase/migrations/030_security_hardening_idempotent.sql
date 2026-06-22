-- =============================================================================
-- Migration 030: Global Security Hardening — FULLY IDEMPOTENT
-- AgentDyne Marketplace | April 25 2026
-- Safe to run even if 030 was partially applied previously.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1: Fix SECURITY DEFINER views (ERROR severity)
-- ALTER VIEW ... SET (security_invoker = true) is idempotent — safe to re-run.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER VIEW IF EXISTS public.agent_leaderboard    SET (security_invoker = true);
  ALTER VIEW IF EXISTS public.user_credit_summary  SET (security_invoker = true);
  ALTER VIEW IF EXISTS public.agent_trace_summary  SET (security_invoker = true);
  ALTER VIEW IF EXISTS public.agent_capabilities   SET (security_invoker = true);
  ALTER VIEW IF EXISTS public.admin_platform_stats SET (security_invoker = true);
  ALTER VIEW IF EXISTS public.user_abuse_summary   SET (security_invoker = true);
  ALTER VIEW IF EXISTS public.agent_pipeline_stats SET (security_invoker = true);
  ALTER VIEW IF EXISTS public.agents_search        SET (security_invoker = true);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Part 1 partial: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- PART 2: Fix mutable search_path on all public functions (WARN severity)
-- ALTER FUNCTION ... SET search_path = 'public' is idempotent.
-- Using individual DO blocks so one bad signature does not abort all.
-- ---------------------------------------------------------------------------
DO $$ BEGIN ALTER FUNCTION public.add_credits(uuid, numeric, text, uuid)                       SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.deduct_credits(uuid, numeric, text, uuid)                    SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.reserve_credits(uuid, numeric, uuid)                         SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.commit_credit_reservation(uuid, numeric)                     SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.release_credit_reservation(uuid)                             SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.compute_agent_score(uuid)                                    SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.compute_all_agent_scores()                                   SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.compute_context_hash(text, text, text, numeric)              SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.aggregate_agent_analytics_yesterday()                        SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.aggregate_daily_analytics()                                  SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.refresh_agent_rankings()                                     SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.refresh_agent_rating()                                       SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.update_agent_rating()                                        SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.update_agent_stats()                                         SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.update_agent_cost_analytics(uuid, numeric, integer, integer) SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_concurrent_executions(uuid)                              SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_concurrent_execution_count(uuid)                         SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.fail_stuck_executions()                                      SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_executions_used(uuid)                              SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_agent_executions()                                 SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_agent_pipeline_use(uuid)                           SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.update_pipeline_stats()                                      SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.upsert_pipeline_usage(uuid, uuid, uuid)                     SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.upsert_agent_pipeline_usage(uuid, uuid, uuid)               SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.dag_has_cycle(jsonb)                                         SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_seller_earned(uuid, numeric)                       SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.update_seller_earnings()                                     SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.auto_promote_to_seller()                                     SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.cleanup_execution_cache()                                    SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.cleanup_expired_idempotency_keys()                           SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.cleanup_expired_memories()                                   SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.cleanup_expired_memory()                                     SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.cleanup_old_injection_attempts()                             SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.cleanup_processed_stripe_events()                            SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.cleanup_rate_limit_counters()                                SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.sync_email_confirmed()                                       SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.handle_new_user()                                            SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.is_email_verified(uuid)                                      SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.assign_waitlist_position()                                   SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_rate_limit(text, timestamptz, integer)             SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.reset_monthly_quotas()                                       SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.reset_monthly_execution_quotas()                             SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.reset_share_key_daily_limits()                               SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.send_quota_warning_notifications()                           SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.expire_hitl_approvals()                                      SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.search_rag_chunks(uuid, vector, double precision, integer)   SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.search_agents_semantic(vector, double precision, integer)    SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.upsert_agent_memory(uuid, uuid, text, jsonb, integer)       SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.enqueue_agent_status_email()                                 SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_kb_doc_count(uuid)                                 SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.decrement_kb_doc_count(uuid)                                 SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.set_updated_at()                                             SET search_path = 'public'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- PART 3: Tighten overly permissive RLS policies
-- Pattern: DROP IF EXISTS → CREATE (idempotent sequence)
-- ---------------------------------------------------------------------------

-- agent_pipeline_usage — users may only insert their own rows
DROP POLICY IF EXISTS "apu_insert"       ON public.agent_pipeline_usage;
DROP POLICY IF EXISTS "apu_write"        ON public.agent_pipeline_usage;
DO $$ BEGIN
  CREATE POLICY "apu_insert" ON public.agent_pipeline_usage
    FOR INSERT WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- system-only tables — service_role bypasses RLS; drop open authenticated policies
DROP POLICY IF EXISTS "email_queue_sys_ins"       ON public.email_queue;
DROP POLICY IF EXISTS "cache_service_write"        ON public.execution_cache;
DROP POLICY IF EXISTS "snapshots_system_ins"       ON public.execution_snapshots;
DROP POLICY IF EXISTS "fw_system_write"            ON public.failed_webhooks;
DROP POLICY IF EXISTS "governance_system_insert"   ON public.governance_events;
DROP POLICY IF EXISTS "hitl_system_write"          ON public.hitl_approvals;
DROP POLICY IF EXISTS "injection_system_insert"    ON public.injection_attempts;
DROP POLICY IF EXISTS "retry_log_sys_ins"          ON public.node_retry_log;
DROP POLICY IF EXISTS "pse_system"                 ON public.processed_stripe_events;
DROP POLICY IF EXISTS "Service manages rate limits" ON public.rate_limit_counters;

-- pipeline_versions — owner-only insert
DROP POLICY IF EXISTS "pv_system_insert"  ON public.pipeline_versions;
DROP POLICY IF EXISTS "pv_owner_insert"   ON public.pipeline_versions;
DO $$ BEGIN
  CREATE POLICY "pv_owner_insert" ON public.pipeline_versions
    FOR INSERT WITH CHECK (
      created_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.pipelines
        WHERE id = pipeline_id AND owner_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- profiles — only own-id insert (handle_new_user trigger is SECURITY DEFINER, unaffected)
DROP POLICY IF EXISTS "System inserts new profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_insert"         ON public.profiles;
DO $$ BEGIN
  CREATE POLICY "profiles_own_insert" ON public.profiles
    FOR INSERT WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- PART 4: Avatar bucket — remove duplicate SELECT policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Avatars are public" ON storage.objects;

-- ---------------------------------------------------------------------------
-- PART 5: Remove duplicate cron job for cleanup_expired_memory
-- (029 created agentdyne-cleanup-memory daily; hourly job already exists)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('agentdyne-cleanup-memory');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- PART 6: Fix 029 IMMUTABLE index error
-- Safe: DROP IF EXISTS then recreate without volatile predicates
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_exec_cache_expires;
DROP INDEX IF EXISTS public.idx_credit_res_expires;
DROP INDEX IF EXISTS public.idx_idempotency_expires;
DROP INDEX IF EXISTS public.idx_processed_stripe_expires;
DROP INDEX IF EXISTS public.idx_exec_snapshots_hash;

CREATE INDEX IF NOT EXISTS idx_exec_cache_expires
  ON public.execution_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_credit_res_expires
  ON public.credit_reservations (expires_at)
  WHERE status = 'reserved';          -- literal = immutable ✓

CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON public.idempotency_keys (expires_at)
  WHERE status = 'pending';           -- literal = immutable ✓

CREATE INDEX IF NOT EXISTS idx_processed_stripe_expires
  ON public.processed_stripe_events (expires_at);

CREATE INDEX IF NOT EXISTS idx_exec_snapshots_hash
  ON public.execution_snapshots (context_hash)
  WHERE context_hash IS NOT NULL;     -- IS NOT NULL = immutable ✓

-- ---------------------------------------------------------------------------
-- PART 7: Performance / security indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_executions_running_created
  ON public.executions (created_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_rl_window_end
  ON public.rate_limit_counters (window_end);

CREATE INDEX IF NOT EXISTS idx_gov_events_user_created
  ON public.governance_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_res_expiry_user
  ON public.credit_reservations (user_id, expires_at)
  WHERE status = 'reserved';

-- ---------------------------------------------------------------------------
-- DONE — run Supabase Security Advisor after this, should show 0 ERRORs.
-- Manual: Dashboard → Auth → Settings → Enable leaked password protection.
-- ---------------------------------------------------------------------------
