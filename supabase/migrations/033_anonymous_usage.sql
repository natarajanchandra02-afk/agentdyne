-- =============================================================================
-- AgentDyne — Migration 033: Anonymous Usage Tracking
--
-- Supports the "Try without login" feature on the marketplace.
-- Stores IP hash (never raw IP) + daily call count.
-- Automatically cleaned up after 7 days by pg_cron.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.anonymous_usage (
  ip_hash          TEXT        NOT NULL,
  executions_count INTEGER     NOT NULL DEFAULT 1,
  last_used_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT anonymous_usage_pkey PRIMARY KEY (ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_anon_usage_last_used
  ON public.anonymous_usage(last_used_at);

ALTER TABLE public.anonymous_usage ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (anonymous users never query this directly)
CREATE POLICY "anon_usage_service_only"
  ON public.anonymous_usage FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- pg_cron: purge old anonymous records daily (keep table small)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('agentdyne-cleanup-anon-usage', '0 3 * * *',
      'DELETE FROM public.anonymous_usage WHERE last_used_at < now() - INTERVAL ''7 days''');
    RAISE NOTICE '✅ anonymous_usage cleanup cron registered';
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 033 COMPLETE — anonymous_usage table created ===';
END $$;
