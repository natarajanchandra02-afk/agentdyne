-- ============================================================
-- Migration 016 PATCH — Fix search_rag_chunks return type error
-- Run this in Supabase SQL Editor INSTEAD of the original 016.
--
-- Root cause: PostgreSQL error 42P13 — cannot change return type
-- of existing function via CREATE OR REPLACE when OUT parameter
-- types differ. The existing search_rag_chunks() in your DB uses
-- a different type signature for 'similarity' (e.g. float8/double
-- precision). We must DROP first, then CREATE fresh.
--
-- This file is the complete, corrected 016 migration.
-- All statements fully idempotent — safe to re-run.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SECTION 1: MISSING RPCs
-- ════════════════════════════════════════════════════════════

-- ── add_credits() ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.add_credits(UUID, NUMERIC, TEXT, UUID);
CREATE FUNCTION public.add_credits(
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
  v_before NUMERIC;
  v_after  NUMERIC;
BEGIN
  IF amount_param <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount must be positive');
  END IF;

  SELECT balance_usd INTO v_before
  FROM   public.credits WHERE user_id = user_id_param FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.credits (user_id, balance_usd, total_purchased, total_spent)
    VALUES (user_id_param, amount_param, amount_param, 0)
    ON CONFLICT (user_id) DO UPDATE
      SET balance_usd     = credits.balance_usd     + amount_param,
          total_purchased = credits.total_purchased + amount_param,
          updated_at      = now();
    RETURN jsonb_build_object('ok', true, 'balance_after', amount_param);
  END IF;

  v_after := v_before + amount_param;

  UPDATE public.credits
  SET    balance_usd     = v_after,
         total_purchased = total_purchased + amount_param,
         updated_at      = now()
  WHERE  user_id = user_id_param;

  INSERT INTO public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  VALUES
    (user_id_param, 'credit', amount_param, v_after,
     COALESCE(NULLIF(description_param, ''), 'Credit added'),
     reference_id_param);

  RETURN jsonb_build_object('ok', true, 'balance_before', v_before, 'balance_after', v_after);
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, NUMERIC, TEXT, UUID)
  TO authenticated, service_role;

-- ── update_agent_cost_analytics() ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_agent_cost_analytics(
  agent_id_param    UUID,
  actual_cost_param NUMERIC,
  tokens_in_param   INTEGER,
  tokens_out_param  INTEGER
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.agent_analytics
    (agent_id, date, executions, successful, cost_usd, tokens_in, tokens_out)
  VALUES
    (agent_id_param, CURRENT_DATE, 1, 1, actual_cost_param, tokens_in_param, tokens_out_param)
  ON CONFLICT (agent_id, date) DO UPDATE
    SET executions = agent_analytics.executions + 1,
        successful = agent_analytics.successful + 1,
        cost_usd   = agent_analytics.cost_usd   + actual_cost_param,
        tokens_in  = agent_analytics.tokens_in  + tokens_in_param,
        tokens_out = agent_analytics.tokens_out + tokens_out_param;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_agent_cost_analytics(UUID, NUMERIC, INTEGER, INTEGER)
  TO authenticated, service_role;

-- ── search_rag_chunks() — THE FIX ─────────────────────────────────────────
-- Error 42P13 occurs because the existing function's OUT parameter 'similarity'
-- has a different type (likely float8/double precision) from what CREATE OR REPLACE
-- tries to set. PostgreSQL forbids changing OUT parameter types via REPLACE.
--
-- Solution: DROP all known overloads (all PostgreSQL type aliases for float),
-- then CREATE fresh with the canonical FLOAT type.
--
-- We use CASCADE-free drops — this function has no dependents.
DROP FUNCTION IF EXISTS public.search_rag_chunks(UUID, vector, float4,    integer);
DROP FUNCTION IF EXISTS public.search_rag_chunks(UUID, vector, float8,    integer);
DROP FUNCTION IF EXISTS public.search_rag_chunks(UUID, vector, float,     integer);
DROP FUNCTION IF EXISTS public.search_rag_chunks(UUID, vector, double precision, integer);
DROP FUNCTION IF EXISTS public.search_rag_chunks(UUID, vector, real,      integer);
DROP FUNCTION IF EXISTS public.search_rag_chunks(UUID, vector, numeric,   integer);

CREATE FUNCTION public.search_rag_chunks(
  kb_id_param     UUID,
  query_embedding vector(1536),
  match_threshold float8  DEFAULT 0.65,
  match_count     integer DEFAULT 5
)
RETURNS TABLE (
  chunk_id       bigint,
  document_id    uuid,
  document_title text,
  content        text,
  similarity     float8
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rc.id                                        AS chunk_id,
    rc.document_id                               AS document_id,
    COALESCE(rd.title, 'Untitled')::text         AS document_title,
    rc.content                                   AS content,
    (1.0 - (rc.embedding <=> query_embedding))   AS similarity
  FROM   public.rag_chunks   rc
  JOIN   public.rag_documents rd ON rd.id = rc.document_id
  WHERE  rc.knowledge_base_id = kb_id_param
    AND  rc.embedding IS NOT NULL
    AND  (1.0 - (rc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY rc.embedding <=> query_embedding
  LIMIT  match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_rag_chunks(UUID, vector, float8, integer)
  TO authenticated, service_role;

-- ── dag_has_cycle() ────────────────────────────────────────────────────────
-- RETURNS BOOLEAN — safe to use CREATE OR REPLACE (return type never changes)
CREATE OR REPLACE FUNCTION public.dag_has_cycle(dag_param JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nodes   TEXT[];
  in_degree JSONB   := '{}';
  queue     TEXT[];
  processed INTEGER := 0;
  edge      JSONB;
  to_id     TEXT;
  from_id   TEXT;
BEGIN
  SELECT ARRAY_AGG(n->>'id')
  INTO   v_nodes
  FROM   jsonb_array_elements(dag_param->'nodes') n;

  IF v_nodes IS NULL OR array_length(v_nodes, 1) = 0 THEN
    RETURN FALSE;
  END IF;

  FOR i IN 1..array_length(v_nodes, 1) LOOP
    in_degree := jsonb_set(in_degree, ARRAY[v_nodes[i]], '0');
  END LOOP;

  FOR edge IN SELECT * FROM jsonb_array_elements(dag_param->'edges') LOOP
    to_id := edge->>'to';
    IF to_id IS NOT NULL AND in_degree ? to_id THEN
      in_degree := jsonb_set(
        in_degree, ARRAY[to_id],
        to_jsonb((in_degree->>to_id)::INTEGER + 1)
      );
    END IF;
  END LOOP;

  FOR i IN 1..array_length(v_nodes, 1) LOOP
    IF (in_degree->>v_nodes[i])::INTEGER = 0 THEN
      queue := array_append(queue, v_nodes[i]);
    END IF;
  END LOOP;

  WHILE queue IS NOT NULL AND array_length(queue, 1) > 0 LOOP
    from_id := queue[1];
    queue   := queue[2:];
    processed := processed + 1;

    FOR edge IN SELECT * FROM jsonb_array_elements(dag_param->'edges') LOOP
      IF (edge->>'from') = from_id THEN
        to_id := edge->>'to';
        IF to_id IS NOT NULL AND in_degree ? to_id THEN
          in_degree := jsonb_set(
            in_degree, ARRAY[to_id],
            to_jsonb((in_degree->>to_id)::INTEGER - 1)
          );
          IF (in_degree->>to_id)::INTEGER = 0 THEN
            queue := array_append(queue, to_id);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN processed != array_length(v_nodes, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.dag_has_cycle(JSONB)
  TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 2: HITL APPROVALS
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.hitl_approvals (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id      UUID        REFERENCES public.pipelines(id)           ON DELETE CASCADE,
  execution_id     UUID        REFERENCES public.pipeline_executions(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES public.profiles(id),
  node_id          TEXT        NOT NULL,
  step_name        TEXT        NOT NULL,
  context          TEXT,
  status           TEXT        DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','rejected','expired')),
  approval_token   TEXT        NOT NULL UNIQUE,
  approved_by      UUID        REFERENCES public.profiles(id),
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  expires_at       TIMESTAMPTZ DEFAULT (now() + INTERVAL '48 hours'),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hitl_user_status
  ON public.hitl_approvals(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hitl_token
  ON public.hitl_approvals(approval_token) WHERE status = 'pending';

ALTER TABLE public.hitl_approvals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hitl_approvals' AND policyname = 'hitl_own'
  ) THEN
    CREATE POLICY "hitl_own"          ON public.hitl_approvals FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY "hitl_system_write" ON public.hitl_approvals FOR INSERT WITH CHECK (true);
    CREATE POLICY "hitl_system_upd"   ON public.hitl_approvals FOR UPDATE USING (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.hitl_approvals TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.expire_hitl_approvals();
CREATE FUNCTION public.expire_hitl_approvals()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.hitl_approvals
  SET    status = 'expired'
  WHERE  status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.expire_hitl_approvals() TO service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 3: WORKFLOW TEMPLATES
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.workflow_templates (
  id               UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug             TEXT      NOT NULL UNIQUE,
  name             TEXT      NOT NULL,
  description      TEXT      NOT NULL,
  category         TEXT      NOT NULL,
  pattern          TEXT      DEFAULT 'linear'
                             CHECK (pattern IN ('linear','parallel','branch','subagent','mixed')),
  dag              JSONB     NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  tags             TEXT[]    DEFAULT '{}',
  icon             TEXT,
  estimated_cost   NUMERIC   DEFAULT 0,
  estimated_time_s INTEGER   DEFAULT 30,
  use_count        INTEGER   DEFAULT 0,
  is_featured      BOOLEAN   DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_featured
  ON public.workflow_templates(is_featured DESC, use_count DESC);

ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='workflow_templates' AND policyname='templates_public_read'
  ) THEN
    CREATE POLICY "templates_public_read" ON public.workflow_templates
      FOR SELECT USING (true);
    CREATE POLICY "templates_admin_all" ON public.workflow_templates
      FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

GRANT SELECT ON public.workflow_templates TO authenticated, anon;
GRANT ALL    ON public.workflow_templates TO service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 4: WEBHOOK TRIGGERS
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.webhook_triggers (
  id                UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id       UUID      NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  user_id           UUID      NOT NULL REFERENCES public.profiles(id),
  name              TEXT      NOT NULL,
  secret_hash       TEXT      NOT NULL,
  event_filter      JSONB     DEFAULT '{}',
  is_active         BOOLEAN   DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  trigger_count     INTEGER   DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_pipeline_active
  ON public.webhook_triggers(pipeline_id, is_active);

ALTER TABLE public.webhook_triggers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='webhook_triggers' AND policyname='webhook_own_all'
  ) THEN
    CREATE POLICY "webhook_own_all" ON public.webhook_triggers
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    CREATE POLICY "webhook_system_read" ON public.webhook_triggers
      FOR SELECT USING (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_triggers TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 5: EMAIL QUEUE
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_queue (
  id           BIGSERIAL   PRIMARY KEY,
  to_address   TEXT        NOT NULL,
  template     TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  status       TEXT        DEFAULT 'pending'
               CHECK (status IN ('pending','sent','failed','skipped')),
  attempts     INTEGER     DEFAULT 0,
  sent_at      TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_pending
  ON public.email_queue(status, created_at ASC) WHERE status = 'pending';

ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='email_queue' AND policyname='email_queue_admin'
  ) THEN
    CREATE POLICY "email_queue_admin" ON public.email_queue
      FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
    CREATE POLICY "email_queue_sys_ins" ON public.email_queue FOR INSERT WITH CHECK (true);
    CREATE POLICY "email_queue_sys_upd" ON public.email_queue FOR UPDATE USING (true);
  END IF;
END $$;

GRANT INSERT, UPDATE, SELECT ON public.email_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_agent_status_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email TEXT; v_name TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  SELECT email, full_name INTO v_email, v_name
  FROM   public.profiles WHERE id = NEW.seller_id;
  IF v_email IS NULL THEN RETURN NEW; END IF;

  IF NEW.status = 'active' AND OLD.status = 'pending_review' THEN
    INSERT INTO public.email_queue (to_address, template, payload) VALUES (
      v_email, 'agent_approved',
      jsonb_build_object('sellerName', v_name, 'agentName', NEW.name, 'agentId', NEW.id::TEXT)
    );
  ELSIF NEW.status = 'draft' AND OLD.status = 'pending_review' THEN
    INSERT INTO public.email_queue (to_address, template, payload) VALUES (
      v_email, 'agent_rejected',
      jsonb_build_object('sellerName', v_name, 'agentName', NEW.name,
        'reason', 'See your agent dashboard for admin feedback.')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_status_change_email ON public.agents;
CREATE TRIGGER on_agent_status_change_email
  AFTER UPDATE OF status ON public.agents
  FOR EACH ROW EXECUTE PROCEDURE public.enqueue_agent_status_email();

-- ════════════════════════════════════════════════════════════
-- SECTION 6: AGENT MEMORY
-- ════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_uk
  ON public.agent_memory(user_id, agent_id, key);

CREATE OR REPLACE FUNCTION public.upsert_agent_memory(
  user_id_param   UUID,
  agent_id_param  UUID,
  key_param       TEXT,
  value_param     JSONB,
  ttl_hours_param INTEGER DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id  UUID;
  v_ttl TIMESTAMPTZ;
BEGIN
  IF ttl_hours_param IS NOT NULL THEN
    v_ttl := now() + (ttl_hours_param || ' hours')::INTERVAL;
  END IF;

  INSERT INTO public.agent_memory (user_id, agent_id, key, value, ttl_at, updated_at)
  VALUES (user_id_param, agent_id_param, key_param, value_param, v_ttl, now())
  ON CONFLICT (user_id, agent_id, key) DO UPDATE
    SET value      = EXCLUDED.value,
        ttl_at     = COALESCE(EXCLUDED.ttl_at, agent_memory.ttl_at),
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_agent_memory(UUID, UUID, TEXT, JSONB, INTEGER)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.cleanup_expired_memories();
CREATE FUNCTION public.cleanup_expired_memories()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.agent_memory WHERE ttl_at IS NOT NULL AND ttl_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_memories() TO service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 7: NODE RETRY LOG
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.node_retry_log (
  id            BIGSERIAL   PRIMARY KEY,
  execution_id  UUID        REFERENCES public.pipeline_executions(id) ON DELETE CASCADE,
  node_id       TEXT        NOT NULL,
  agent_id      UUID,
  attempt       INTEGER     NOT NULL,
  error_message TEXT,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retry_log_exec
  ON public.node_retry_log(execution_id, node_id);

ALTER TABLE public.node_retry_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='node_retry_log' AND policyname='retry_log_own'
  ) THEN
    CREATE POLICY "retry_log_own" ON public.node_retry_log
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.pipeline_executions pe
          WHERE pe.id = execution_id AND pe.user_id = auth.uid()
        )
      );
    CREATE POLICY "retry_log_sys_ins" ON public.node_retry_log
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON public.node_retry_log TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════
-- SECTION 8: pg_cron SCHEDULES (uncomment to enable)
-- ════════════════════════════════════════════════════════════
-- SELECT cron.schedule('fail-stuck',     '*/5 * * * *', $$SELECT public.fail_stuck_executions()$$);
-- SELECT cron.schedule('reset-quotas',   '0 0 1 * *',   $$SELECT public.reset_monthly_quotas()$$);
-- SELECT cron.schedule('cleanup-rl',     '*/30 * * * *',$$SELECT public.cleanup_rate_limit_counters()$$);
-- SELECT cron.schedule('expire-hitl',    '0 * * * *',   $$SELECT public.expire_hitl_approvals()$$);
-- SELECT cron.schedule('cleanup-memory', '0 2 * * *',   $$SELECT public.cleanup_expired_memories()$$);

-- ════════════════════════════════════════════════════════════
-- SECTION 9: VERIFICATION
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_fn_sig TEXT;
BEGIN
  -- Verify search_rag_chunks has the correct float8 return type
  SELECT pg_get_function_result(p.oid)
  INTO   v_fn_sig
  FROM   pg_proc p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public'
    AND  p.proname = 'search_rag_chunks'
  LIMIT 1;

  RAISE NOTICE 'add_credits                : %', (SELECT proname FROM pg_proc WHERE proname='add_credits'                LIMIT 1);
  RAISE NOTICE 'update_agent_cost_analytics: %', (SELECT proname FROM pg_proc WHERE proname='update_agent_cost_analytics' LIMIT 1);
  RAISE NOTICE 'search_rag_chunks (return) : %', COALESCE(v_fn_sig, '❌ MISSING');
  RAISE NOTICE 'dag_has_cycle              : %', (SELECT proname FROM pg_proc WHERE proname='dag_has_cycle'              LIMIT 1);
  RAISE NOTICE 'upsert_agent_memory        : %', (SELECT proname FROM pg_proc WHERE proname='upsert_agent_memory'        LIMIT 1);
  RAISE NOTICE 'expire_hitl_approvals      : %', (SELECT proname FROM pg_proc WHERE proname='expire_hitl_approvals'      LIMIT 1);
  RAISE NOTICE 'cleanup_expired_memories   : %', (SELECT proname FROM pg_proc WHERE proname='cleanup_expired_memories'   LIMIT 1);
  RAISE NOTICE 'hitl_approvals table       : %', (SELECT tablename FROM pg_tables WHERE tablename='hitl_approvals'      AND schemaname='public');
  RAISE NOTICE 'workflow_templates table   : %', (SELECT tablename FROM pg_tables WHERE tablename='workflow_templates'  AND schemaname='public');
  RAISE NOTICE 'webhook_triggers table     : %', (SELECT tablename FROM pg_tables WHERE tablename='webhook_triggers'    AND schemaname='public');
  RAISE NOTICE 'email_queue table          : %', (SELECT tablename FROM pg_tables WHERE tablename='email_queue'         AND schemaname='public');
  RAISE NOTICE 'node_retry_log table       : %', (SELECT tablename FROM pg_tables WHERE tablename='node_retry_log'      AND schemaname='public');
  RAISE NOTICE '✅ Migration 016 complete';
END $$;
