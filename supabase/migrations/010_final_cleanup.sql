-- ============================================================
-- Migration 010: Final production cleanup
-- Safe to run ONCE — all statements are idempotent.
--
-- Fixes:
--   1. agents_knowledge_base_id_fkey duplicate constraint error
--      (009_rag_memory_registry.sql Section 12 tried to add the column
--       with an inline REFERENCES clause after it already existed with
--       the FK from 009_production_registry.sql Section 1)
--   2. Ensure agent_graph_nodes and agent_registry_versions exist
--   3. Ensure execution_traces INSERT RLS policy exists
--   4. Final index cleanup
-- ============================================================

-- ── 1. Fix knowledge_base_id FK ────────────────────────────────────────────
-- The column already exists from 009_production_registry.sql.
-- Only add the FK constraint if it doesn't already exist.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_schema  = 'public'
      AND tc.table_name    = 'agents'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name  = 'knowledge_base_id'
  ) THEN
    -- Only add FK if knowledge_bases table exists
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'knowledge_bases'
    ) THEN
      ALTER TABLE public.agents
        ADD CONSTRAINT agents_knowledge_base_id_fkey
          FOREIGN KEY (knowledge_base_id)
          REFERENCES public.knowledge_bases(id)
          ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- ── 2. Ensure agent_graph_nodes view exists ────────────────────────────────
CREATE OR REPLACE VIEW public.agent_graph_nodes AS
SELECT
  a.id                                         AS agent_id,
  a.name,
  a.category::text,
  a.system_prompt,
  a.model_name,
  a.max_tokens,
  a.temperature,
  a.timeout_seconds,
  a.pricing_model::text,
  a.price_per_call,
  a.free_calls_per_month,
  COALESCE(a.input_types,      ARRAY['text'])  AS input_types,
  COALESCE(a.output_types,     ARRAY['text'])  AS output_types,
  COALESCE(a.capability_tags,  '{}')           AS capability_tags,
  COALESCE(a.mcp_server_ids,   '{}')           AS mcp_server_ids,
  a.knowledge_base_id,
  COALESCE(s.composite_score,  0)::numeric     AS composite_score,
  COALESCE(s.latency_score,    0)::numeric     AS latency_score,
  COALESCE(s.cost_score,       0)::numeric     AS cost_score
FROM public.agents a
LEFT JOIN public.agent_scores s ON s.agent_id = a.id
WHERE a.status::text = 'active';

COMMENT ON VIEW public.agent_graph_nodes IS
  'Optimised for pipeline DAG execution — minimal fields per node';

GRANT SELECT ON public.agent_graph_nodes TO authenticated, service_role;

-- ── 3. Ensure agent_registry_versions table and trigger exist ──────────────
CREATE TABLE IF NOT EXISTS public.agent_registry_versions (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id   UUID        NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version    TEXT        NOT NULL,
  changelog  TEXT,
  snapshot   JSONB       DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arv_agent
  ON public.agent_registry_versions(agent_id, created_at DESC);

ALTER TABLE public.agent_registry_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_registry_versions'
      AND policyname = 'arv_public_read'
  ) THEN
    CREATE POLICY "arv_public_read"
      ON public.agent_registry_versions FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.agents
          WHERE agents.id = agent_registry_versions.agent_id
            AND agents.status::text = 'active'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_registry_versions'
      AND policyname = 'arv_owner_insert'
  ) THEN
    CREATE POLICY "arv_owner_insert"
      ON public.agent_registry_versions FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.agents
          WHERE agents.id = agent_registry_versions.agent_id
            AND agents.seller_id = auth.uid()
        )
      );
  END IF;
END $$;

GRANT SELECT, INSERT ON public.agent_registry_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_registry_versions TO service_role;

-- ── 4. Auto-snapshot trigger on agent approval ─────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_snapshot_on_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (OLD.status::text != 'active' AND NEW.status::text = 'active') THEN
    INSERT INTO public.agent_registry_versions (
      agent_id, version, changelog, snapshot
    ) VALUES (
      NEW.id,
      COALESCE(NEW.version, '1.0.0'),
      'Auto-published on approval',
      jsonb_build_object(
        'name',           NEW.name,
        'description',    NEW.description,
        'category',       NEW.category,
        'model_name',     NEW.model_name,
        'pricing_model',  NEW.pricing_model,
        'price_per_call', NEW.price_per_call,
        'mcp_server_ids', COALESCE(NEW.mcp_server_ids, '{}'),
        'max_tokens',     NEW.max_tokens,
        'temperature',    NEW.temperature
      )
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_agent_approved_snapshot ON public.agents;
CREATE TRIGGER on_agent_approved_snapshot
  AFTER UPDATE ON public.agents
  FOR EACH ROW EXECUTE PROCEDURE public.auto_snapshot_on_approval();

-- ── 5. Execution traces INSERT policy ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'execution_traces'
  ) THEN RETURN; END IF;

  ALTER TABLE public.execution_traces ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'execution_traces'
      AND policyname = 'traces_authenticated_insert'
  ) THEN
    CREATE POLICY "traces_authenticated_insert"
      ON public.execution_traces FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'execution_traces'
      AND policyname = 'traces_own_select'
  ) THEN
    CREATE POLICY "traces_own_select"
      ON public.execution_traces FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ── 6. Final performance indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agents_mcp_server_ids
  ON public.agents USING gin(mcp_server_ids)
  WHERE mcp_server_ids != '{}';

CREATE INDEX IF NOT EXISTS idx_agents_capability_tags
  ON public.agents USING gin(capability_tags)
  WHERE capability_tags != '{}';

CREATE INDEX IF NOT EXISTS idx_pipelines_status
  ON public.pipelines(status, updated_at DESC);

-- ── 7. Ensure executions can be inserted + updated by users ─────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'executions'
      AND policyname = 'Users can insert own executions'
  ) THEN
    CREATE POLICY "Users can insert own executions"
      ON public.executions FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'executions'
      AND policyname = 'Users can update own executions'
  ) THEN
    CREATE POLICY "Users can update own executions"
      ON public.executions FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT INSERT, UPDATE ON public.executions TO authenticated;

-- ── 8. Verification ─────────────────────────────────────────────────────────
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.views
  WHERE table_schema = 'public'
    AND table_name IN ('agent_graph_nodes', 'agent_capabilities', 'agent_leaderboard');
  RAISE NOTICE '✅ Core views present: % / 3', v_count;

  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'agent_registry_versions';
  RAISE NOTICE '✅ agent_registry_versions: %', CASE WHEN v_count=1 THEN 'present' ELSE 'MISSING' END;

  SELECT COUNT(*) INTO v_count
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  WHERE tc.table_schema = 'public'
    AND tc.table_name   = 'agents'
    AND ccu.column_name = 'knowledge_base_id'
    AND tc.constraint_type = 'FOREIGN KEY';
  RAISE NOTICE '✅ knowledge_base_id FK: %', CASE WHEN v_count=1 THEN 'present' ELSE 'none (ok if knowledge_bases missing)' END;

  RAISE NOTICE '✅ Migration 010 complete';
END $$;
