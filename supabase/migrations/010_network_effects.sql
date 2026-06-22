-- ============================================================
-- AgentDyne Migration 010: Network Effects + Observability
-- Filename: 010_network_effects.sql
--
-- This migration adds the tables and indices needed for:
--   1. agent_pipeline_usage  — tracks which agents are used in which pipelines
--                              powers the "Used in X pipelines" widget + flywheel
--   2. execution_traces      — stores per-execution LLM visibility data
--                              (system prompt, user message, assistant reply)
--                              powers the "What did the LLM see?" deep debug view
--   3. pipeline_versions     — immutable pipeline snapshots for rollback
--   4. Performance indices   — on heavily-queried columns
--
-- 100% idempotent — safe to re-run.
-- ============================================================

-- ─── 1. agent_pipeline_usage ──────────────────────────────────────────────────
-- Every time a pipeline containing an agent_id is saved or executed,
-- this table is upserted. Drives network effects UI and feed-forward ML.

create table if not exists public.agent_pipeline_usage (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents(id)     on delete cascade,
  pipeline_id  uuid not null references public.pipelines(id)  on delete cascade,
  user_id      uuid not null references public.profiles(id)   on delete cascade,
  first_used   timestamptz not null default now(),
  last_used    timestamptz not null default now(),
  use_count    integer not null default 1,
  created_at   timestamptz not null default now(),
  unique(agent_id, pipeline_id)
);

alter table public.agent_pipeline_usage enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_pipeline_usage'
      and policyname = 'Usage is public-readable'
  ) then
    create policy "Usage is public-readable"
      on public.agent_pipeline_usage for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_pipeline_usage'
      and policyname = 'Users manage own usage records'
  ) then
    create policy "Users manage own usage records"
      on public.agent_pipeline_usage for all
      using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists idx_agent_pipeline_usage_agent
  on public.agent_pipeline_usage(agent_id, use_count desc);

create index if not exists idx_agent_pipeline_usage_pipeline
  on public.agent_pipeline_usage(pipeline_id);

-- ─── 2. execution_traces ──────────────────────────────────────────────────────
-- Stores the FULL LLM context per execution for deep observability.
-- The "What did the LLM see?" feature reads from this table.
-- Retention: 30 days (long-lived storage would inflate costs).

create table if not exists public.execution_traces (
  id               uuid primary key default gen_random_uuid(),
  execution_id     uuid          references public.executions(id) on delete cascade,
  agent_id         uuid          references public.agents(id)     on delete set null,
  user_id          uuid not null references public.profiles(id)   on delete cascade,

  -- The full prompt sent to the LLM (including RAG context)
  system_prompt    text,
  -- The user message after transformations
  user_message     text,
  -- The raw LLM reply before output processing
  assistant_reply  text,

  model            text,
  temperature      float,
  tokens_input     integer,
  tokens_output    integer,
  cost_usd         numeric(12, 8),
  total_ms         integer,

  -- "flagged" if output scrubbing found a leak; "success" otherwise
  status           text not null default 'success',
  error_message    text,

  created_at       timestamptz not null default now()
);

-- Trace data is sensitive — only the owning user can read it
alter table public.execution_traces enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'execution_traces'
      and policyname = 'Users read own traces'
  ) then
    create policy "Users read own traces"
      on public.execution_traces for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'execution_traces'
      and policyname = 'Service role manages traces'
  ) then
    create policy "Service role manages traces"
      on public.execution_traces for all
      using (auth.role() = 'service_role');
  end if;
end $$;

create index if not exists idx_execution_traces_execution
  on public.execution_traces(execution_id);

create index if not exists idx_execution_traces_user_agent
  on public.execution_traces(user_id, agent_id, created_at desc);

-- Auto-prune traces older than 30 days (via pg_cron if enabled,
-- or a scheduled Supabase Edge Function)
-- pg_cron job (uncomment if pg_cron is available):
-- select cron.schedule('prune-execution-traces', '0 3 * * *',
--   $$ delete from public.execution_traces where created_at < now() - interval '30 days' $$
-- );

-- ─── 3. pipeline_versions ─────────────────────────────────────────────────────
-- Immutable pipeline snapshots. Saved automatically when a pipeline is
-- published (status transitions) or manually via the "Save version" button.
-- Enables rollback to any prior version.

create table if not exists public.pipeline_versions (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references public.pipelines(id) on delete cascade,
  version      text not null,           -- semver string: "1.0.0", "1.1.0", etc.
  dag          jsonb not null,           -- immutable snapshot of dag at save time
  changelog    text,                     -- what changed in this version
  is_published boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),

  unique(pipeline_id, version)
);

alter table public.pipeline_versions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_versions'
      and policyname = 'Pipeline versions public-readable for public pipelines'
  ) then
    create policy "Pipeline versions public-readable for public pipelines"
      on public.pipeline_versions for select
      using (
        exists (
          select 1 from public.pipelines p
          where p.id = pipeline_id
            and (p.is_public = true or p.owner_id = auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_versions'
      and policyname = 'Pipeline owners manage versions'
  ) then
    create policy "Pipeline owners manage versions"
      on public.pipeline_versions for insert
      with check (
        exists (
          select 1 from public.pipelines p
          where p.id = pipeline_id and p.owner_id = auth.uid()
        )
      );
  end if;
end $$;

create index if not exists idx_pipeline_versions_pipeline
  on public.pipeline_versions(pipeline_id, created_at desc);

-- ─── 4. Performance indices ───────────────────────────────────────────────────

-- GIN index on pipeline DAG for fast agent_id containment queries
-- Used by /api/agents/[id]/pipeline-usage
create index if not exists idx_pipelines_dag_gin
  on public.pipelines using gin(dag);

-- Speed up pipeline execution history queries
create index if not exists idx_pipeline_executions_pipeline_created
  on public.pipeline_executions(pipeline_id, created_at desc);

-- Speed up agent execution history for sellers
create index if not exists idx_executions_agent_user
  on public.executions(agent_id, user_id, created_at desc)
  where status = 'success';

-- ─── 5. Grants ────────────────────────────────────────────────────────────────

grant select on public.agent_pipeline_usage to anon, authenticated, service_role;
grant insert, update on public.agent_pipeline_usage to authenticated, service_role;

grant select on public.execution_traces to authenticated;
grant insert on public.execution_traces to service_role;

grant select on public.pipeline_versions to anon, authenticated;
grant insert on public.pipeline_versions to authenticated, service_role;

-- ─── 6. Verification ──────────────────────────────────────────────────────────

do $$
declare
  table_count int;
begin
  select count(*) into table_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('agent_pipeline_usage', 'execution_traces', 'pipeline_versions');

  raise notice '✅ Tables created: % / 3', table_count;
  raise notice '✅ Migration 010 complete';
end $$;
