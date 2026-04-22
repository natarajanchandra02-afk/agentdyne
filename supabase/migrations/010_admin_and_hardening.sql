-- ============================================================
-- Migration 010: Admin roles, security hardening, cost tracking
-- Run in Supabase SQL Editor AFTER migrations 001–009
-- ============================================================

-- ── 1. Grant admin role to a specific user ────────────────────────────────────
-- Replace 'your@email.com' with the actual admin email address.
-- Uncomment and run once after first deployment:
--
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';

-- ── 3. is_banned column (used by admin ban/unban feature) ──────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;

-- ── 4. execution_cost_usd column on executions (if missing) ──────────────────
-- Ensures cost tracking works correctly for the analytics and admin pages.
ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS cost       NUMERIC(10,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd   NUMERIC(10,6) DEFAULT 0;

-- Sync: if cost_usd is populated but cost is not, copy it over
UPDATE public.executions
  SET cost = cost_usd
  WHERE cost = 0 AND cost_usd > 0;

-- ── 3. Agent knowledge_base_id column ─────────────────────────────────────────
-- Already added in migration 009 but guarded here for safety.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS knowledge_base_id UUID REFERENCES public.knowledge_bases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mcp_server_ids    TEXT[] DEFAULT '{}';

-- ── 4. Execution traces INSERT policy ─────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'execution_traces'
      AND policyname = 'Users insert own traces'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "Users insert own traces"
        ON public.execution_traces FOR INSERT
        WITH CHECK (user_id = auth.uid())
    $p$;
  END IF;
END $$;

-- ── 5. Rate-limit counters table (cross-Cloudflare-worker persistent limits) ──
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  id         TEXT        PRIMARY KEY,
  count      INTEGER     DEFAULT 0,
  window_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON public.rate_limit_counters(window_end);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manages rate limits"
  ON public.rate_limit_counters FOR ALL
  USING (true) WITH CHECK (true);

-- ── 6. Admin helper views ──────────────────────────────────────────────────────

-- Platform revenue summary view (used by admin page)
CREATE OR REPLACE VIEW public.admin_platform_stats AS
SELECT
  (SELECT COUNT(*) FROM public.profiles)                                    AS total_users,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'active')              AS active_agents,
  (SELECT COUNT(*) FROM public.agents WHERE status = 'pending_review')      AS pending_review,
  (SELECT COUNT(*) FROM public.executions)                                   AS total_executions,
  (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE status = 'succeeded') AS gross_revenue,
  (SELECT COALESCE(SUM(amount), 0) * 0.20 FROM public.transactions WHERE status = 'succeeded') AS platform_revenue,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action = 'blocked') AS blocked_attempts,
  (SELECT COUNT(*) FROM public.injection_attempts WHERE action = 'flagged') AS flagged_attempts;

GRANT SELECT ON public.admin_platform_stats TO authenticated;

-- ── 7. Profiles INSERT policy (for new users on signup via trigger) ───────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'System inserts new profiles'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "System inserts new profiles"
        ON public.profiles FOR INSERT
        WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- ── 8. Credits table INSERT for new users ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'credits' AND policyname = 'System creates credits'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "System creates credits"
        ON public.credits FOR INSERT
        WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- ── 9. Context compression savings tracking column ────────────────────────────
-- Track how much was saved per execution for analytics.
ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS tokens_saved INTEGER DEFAULT 0;

-- ── SUMMARY ───────────────────────────────────────────────────────────────────
-- To grant yourself admin access after running this migration:
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';
--
-- Then visit /admin in the browser. If you see "Access Denied", the role
-- update hasn't propagated yet — sign out and sign back in.
