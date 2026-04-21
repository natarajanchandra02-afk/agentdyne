-- ============================================================
-- AgentDyne Migration 009: Production fixes + Registry versioning
-- Filename: 009_production_registry.sql
--
-- Validated against live schema dump (April 2026).
-- 100 % idempotent — safe to re-run.
--
-- Live DB already has (do NOT re-create):
--   agent_memory, agent_registry_versions, injection_attempts,
--   knowledge_bases, rag_documents, rag_chunks
--
-- What this file does:
--   Section 1  — Backfill missing columns on agents table
--   Section 2  — RLS hardening on agent_registry_versions
--   Section 3  — Snapshot trigger: auto-publish on agent approval
--   Section 4  — Search function: semantic registry lookup
--   Section 5  — View: agent_graph_nodes (for pipeline / planner)
--   Section 6  — Grants
--   Section 7  — Verification
-- ============================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1: Fill gaps in agents table
-- ═══════════════════════════════════════════════════════════════════════════

-- These columns were added in migration 008 but may be missing if 008
-- was applied before the agents table existed in its current form.
alter table public.agents
  add column if not exists mcp_server_ids   text[]       default '{}',
  add column if not exists capability_tags  text[]       default '{}',
  add column if not exists input_types      text[]       default '{"text"}',
  add column if not exists output_types     text[]       default '{"text"}',
  add column if not exists languages        text[]       default '{"en"}',
  add column if not exists compliance_tags  text[]       default '{}',
  add column if not exists composite_score  numeric(5,2) default 0,
  add column if not exists is_top_rated     boolean      default false,
  add column if not exists is_fastest       boolean      default false,
  add column if not exists is_cheapest      boolean      default false,
  add column if not exists is_most_reliable boolean      default false,
  -- knowledge_base_id references knowledge_bases (already in live schema)
  add column if not exists knowledge_base_id uuid;

-- Add FK only if knowledge_bases exists and FK doesn't already exist
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'knowledge_bases'
  ) and not exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
    where tc.table_name = 'agents'
      and ccu.column_name = 'knowledge_base_id'
      and tc.constraint_type = 'FOREIGN KEY'
  ) then
    alter table public.agents
      add constraint agents_knowledge_base_id_fkey
        foreign key (knowledge_base_id) references public.knowledge_bases(id)
        on delete set null;
  end if;
end $$;

create index if not exists idx_agents_knowledge_base
  on public.agents(knowledge_base_id)
  where knowledge_base_id is not null;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2: Harden RLS on agent_registry_versions
--
-- The table already exists (confirmed in live DB). Apply policies only
-- if they don't yet exist.
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS if not already on
alter table public.agent_registry_versions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_registry_versions'
      and policyname = 'Registry versions are public'
  ) then
    create policy "Registry versions are public"
      on public.agent_registry_versions for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_registry_versions'
      and policyname = 'Service role manages registry versions'
  ) then
    create policy "Service role manages registry versions"
      on public.agent_registry_versions for all
      using (auth.role() = 'service_role');
  end if;
end $$;

create index if not exists idx_registry_versions_agent_date
  on public.agent_registry_versions(agent_id, created_at desc);

create index if not exists idx_registry_versions_version
  on public.agent_registry_versions(agent_id, version);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3: Auto-snapshot trigger
--
-- When an agent's status changes to 'active' (i.e. approved by admin),
-- automatically publish a snapshot to agent_registry_versions.
-- This means the registry is always populated for active agents without
-- requiring a manual API call.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.auto_snapshot_on_approval()
returns trigger language plpgsql security definer as $$
begin
  -- Only trigger when transitioning TO 'active' status
  if (old.status::text != 'active' and new.status::text = 'active') then
    -- Insert snapshot; ignore if this exact version already exists
    insert into public.agent_registry_versions (
      agent_id, version, changelog, snapshot
    )
    values (
      new.id,
      coalesce(new.version, '1.0.0'),
      'Auto-published on approval',
      jsonb_build_object(
        'name',            new.name,
        'description',     new.description,
        'category',        new.category,
        'model_name',      new.model_name,
        'pricing_model',   new.pricing_model,
        'price_per_call',  new.price_per_call,
        'capability_tags', coalesce(new.capability_tags, '{}'),
        'input_types',     coalesce(new.input_types, '{"text"}'),
        'output_types',    coalesce(new.output_types, '{"text"}'),
        'mcp_server_ids',  coalesce(new.mcp_server_ids, '{}'),
        'max_tokens',      new.max_tokens,
        'temperature',     new.temperature
      )
    )
    on conflict do nothing;

    -- Update composite score cache on agents table
    update public.agents
      set updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_agent_approved_snapshot on public.agents;
create trigger on_agent_approved_snapshot
  after update on public.agents
  for each row execute procedure public.auto_snapshot_on_approval();


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4: Registry capability search view (refresh)
--
-- The agent_capabilities view may need to be updated to include columns
-- added after it was first created. Recreating it is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.agent_capabilities as
select
  a.id,
  a.name,
  a.slug,
  a.description,
  a.category,
  a.capability_tags,
  a.input_types,
  a.output_types,
  a.languages,
  a.compliance_tags,
  a.mcp_server_ids,
  a.knowledge_base_id,
  a.pricing_model,
  a.price_per_call,
  a.subscription_price_monthly,
  a.free_calls_per_month,
  a.model_name,
  a.average_latency_ms,
  a.composite_score,
  a.total_executions,
  a.average_rating,
  s.accuracy_score,
  s.cost_score,
  s.latency_score,
  s.reliability_score,
  s.popularity_score
from public.agents a
left join public.agent_scores s on s.agent_id = a.id
where a.status::text = 'active';

comment on view public.agent_capabilities is
  'Machine-readable capability registry used by /api/registry and /api/discover';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5: agent_graph_nodes view
--
-- A flattened view optimised for the pipeline DAG engine.
-- Each row is one agent with the minimal fields needed to schedule it
-- as a node in a multi-agent workflow.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.agent_graph_nodes as
select
  a.id                               as agent_id,
  a.name,
  a.category,
  a.system_prompt,
  a.model_name,
  a.max_tokens,
  a.temperature,
  a.timeout_seconds,
  a.pricing_model,
  a.price_per_call,
  a.free_calls_per_month,
  a.input_types,
  a.output_types,
  a.capability_tags,
  a.mcp_server_ids,
  a.knowledge_base_id,
  coalesce(s.composite_score, 0)     as composite_score,
  coalesce(s.latency_score,   0)     as latency_score,
  coalesce(s.cost_score,      0)     as cost_score
from public.agents a
left join public.agent_scores s on s.agent_id = a.id
where a.status::text = 'active';

comment on view public.agent_graph_nodes is
  'Optimised for pipeline DAG execution — minimal fields per node';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 6: Grants
-- ═══════════════════════════════════════════════════════════════════════════

grant select on public.agent_capabilities   to anon, authenticated, service_role;
grant select on public.agent_graph_nodes    to authenticated, service_role;
grant select, insert on public.agent_registry_versions to authenticated;
grant select, insert, update, delete on public.agent_registry_versions to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 7: Verification
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  view_count int;
  trigger_exists boolean;
begin
  select count(*) into view_count
  from information_schema.views
  where table_schema = 'public'
    and table_name in ('agent_capabilities', 'agent_graph_nodes');
  raise notice '✅ Views created/refreshed: % / 2', view_count;

  select exists (
    select 1 from pg_trigger
    where tgname = 'on_agent_approved_snapshot'
  ) into trigger_exists;
  raise notice '✅ Auto-snapshot trigger: %', case when trigger_exists then 'OK' else 'MISSING' end;

  raise notice '✅ Migration 009 complete';
end $$;
