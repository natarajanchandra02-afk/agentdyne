-- ============================================================
-- AgentDyne Platform — Single Comprehensive Fix Migration
-- File: 008_complete_fix.sql
--
-- Run ONCE in: Supabase Dashboard → SQL Editor → New query
-- All statements are idempotent (100% safe to re-run).
--
-- ROOT CAUSE AUDIT
-- ─────────────────────────────────────────────────────────
-- Applied in your DB:  001, 002, 003, 006
-- NOT applied:         004, 005, 007
-- Evidence:
--   • pipelines has 13 cols  (006 schema — not 004's 17 cols)
--   • pipeline_runs EXISTS   (006 created it; 007 never dropped it)
--   • pipeline_executions MISSING → execute API returns 500
--   • credits MISSING            → pipeline cost-check 500s
--   • executions INSERT policy missing → agent/execute 500s
--   • avatars storage bucket missing   → settings upload fails
--   • agent_scores/audit_logs/etc MISSING (all from 004 & 005)
--
-- WHAT THIS FILE DOES
-- ─────────────────────────────────────────────────────────
-- Section  1  Extensions
-- Section  2  Missing columns on existing tables
-- Section  3  agent_scores table
-- Section  4  pipeline_executions table  ← CRITICAL
-- Section  5  audit_logs table
-- Section  6  agent_embeddings table (pgvector)
-- Section  7  credits + credit_transactions  ← CRITICAL
-- Section  8  execution_traces table
-- Section  9  Fix executions INSERT/UPDATE RLS  ← CRITICAL
-- Section 10  All functions (credits, scoring, pipeline stats)
-- Section 11  Grants
-- Section 12  Storage: avatars bucket + policies
-- Section 13  Drop pipeline_runs (dead code)
-- Section 14  Useful views (refresh / recreate)
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- SECTION 1: Extensions
-- ═══════════════════════════════════════════════════════════
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "vector";


-- ═══════════════════════════════════════════════════════════
-- SECTION 2: Missing columns on existing tables
-- ═══════════════════════════════════════════════════════════

-- 2a. agents — columns from migrations 003 & 004 (never landed)
alter table public.agents
  add column if not exists mcp_server_ids   text[]       default '{}',
  add column if not exists capability_tags  text[]       default '{}',
  add column if not exists input_types      text[]       default '{"text"}',
  add column if not exists output_types     text[]       default '{"text"}',
  add column if not exists languages        text[]       default '{"en"}',
  add column if not exists compliance_tags  text[]       default '{}',
  add column if not exists composite_score  numeric(5,2) default 0;

comment on column public.agents.mcp_server_ids   is 'MCP server IDs connected to this agent';
comment on column public.agents.capability_tags  is 'Machine-readable capability tags (e.g. summarize, classify)';
comment on column public.agents.composite_score  is 'Cached composite score from agent_scores (0–100)';

-- 2b. pipelines — columns from migration 004
-- (migration 006 created the table first; 004 cols were never added)
alter table public.pipelines
  add column if not exists is_active        boolean default true,
  add column if not exists retry_on_failure boolean default false,
  add column if not exists max_retries      integer default 1,
  add column if not exists total_runs       bigint  default 0,
  add column if not exists successful_runs  bigint  default 0,
  add column if not exists avg_latency_ms   integer default 0;

-- Sync total_runs ← run_count (run_count was already being incremented by 006)
update public.pipelines
  set total_runs = run_count
  where total_runs = 0 and run_count > 0;


-- ═══════════════════════════════════════════════════════════
-- SECTION 3: agent_scores (migration 004)
-- ═══════════════════════════════════════════════════════════
create table if not exists public.agent_scores (
  id                uuid         default uuid_generate_v4() primary key,
  agent_id          uuid         references public.agents(id) on delete cascade not null unique,
  accuracy_score    numeric(5,2) default 0,
  latency_score     numeric(5,2) default 0,
  cost_score        numeric(5,2) default 0,
  reliability_score numeric(5,2) default 0,
  popularity_score  numeric(5,2) default 0,
  composite_score   numeric(5,2) default 0,
  is_top_rated      boolean      default false,
  is_fastest        boolean      default false,
  is_cheapest       boolean      default false,
  is_most_reliable  boolean      default false,
  category_rank     integer,
  global_rank       integer,
  sample_size       integer      default 0,
  computed_at       timestamp with time zone default now(),
  updated_at        timestamp with time zone default now()
);

create index if not exists idx_agent_scores_composite
  on public.agent_scores(composite_score desc);
create index if not exists idx_agent_scores_category
  on public.agent_scores(category_rank);

alter table public.agent_scores enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_scores'
      and policyname = 'Agent scores are public'
  ) then
    create policy "Agent scores are public"
      on public.agent_scores for select using (true);
  end if;
end $$;

drop trigger if exists set_agent_scores_updated_at on public.agent_scores;
create trigger set_agent_scores_updated_at
  before update on public.agent_scores
  for each row execute procedure public.set_updated_at();


-- ═══════════════════════════════════════════════════════════
-- SECTION 4: pipeline_executions (migration 004) — CRITICAL
-- /api/pipelines/[id]/execute inserts here; without this
-- table every pipeline execution returns HTTP 500.
-- ═══════════════════════════════════════════════════════════
create table if not exists public.pipeline_executions (
  id               uuid    default uuid_generate_v4() primary key,
  pipeline_id      uuid    references public.pipelines(id) on delete set null,
  user_id          uuid    references public.profiles(id)  on delete set null,
  status           text    default 'running'
    check (status in ('running','success','failed','timeout')),
  input            jsonb   not null default '{}',
  output           jsonb,
  error_message    text,
  node_results     jsonb   default '[]',
  total_latency_ms integer,
  total_cost       numeric(10,6) default 0,
  total_tokens_in  integer default 0,
  total_tokens_out integer default 0,
  created_at       timestamp with time zone default now(),
  completed_at     timestamp with time zone
);

create index if not exists idx_pipeline_exec_pipeline
  on public.pipeline_executions(pipeline_id, created_at desc);
create index if not exists idx_pipeline_exec_user
  on public.pipeline_executions(user_id, created_at desc);
create index if not exists idx_pipeline_exec_status
  on public.pipeline_executions(status, created_at desc);

alter table public.pipeline_executions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_executions'
      and policyname = 'Users can view own pipeline executions'
  ) then
    create policy "Users can view own pipeline executions"
      on public.pipeline_executions for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_executions'
      and policyname = 'Users can insert own pipeline executions'
  ) then
    create policy "Users can insert own pipeline executions"
      on public.pipeline_executions for insert
      with check (auth.uid() = user_id);
  end if;

  -- Execute API updates the row from 'running' → 'success'/'failed'
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_executions'
      and policyname = 'Users can update own pipeline executions'
  ) then
    create policy "Users can update own pipeline executions"
      on public.pipeline_executions for update
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pipeline_executions'
      and policyname = 'No delete on pipeline executions'
  ) then
    create policy "No delete on pipeline executions"
      on public.pipeline_executions for delete
      using (false);
  end if;
end $$;

grant select, insert, update      on public.pipeline_executions to authenticated;
grant select, insert, update, delete on public.pipeline_executions to service_role;


-- ═══════════════════════════════════════════════════════════
-- SECTION 5: audit_logs (migration 004)
-- ═══════════════════════════════════════════════════════════
create table if not exists public.audit_logs (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  actor_type  text default 'user',   -- 'user' | 'api_key' | 'system'
  actor_id    text,
  action      text not null,
  resource    text,
  resource_id uuid,
  payload     jsonb default '{}',
  ip_address  inet,
  user_agent  text,
  created_at  timestamp with time zone default now()
);

create index if not exists idx_audit_logs_user
  on public.audit_logs(user_id, created_at desc);
create index if not exists idx_audit_logs_resource
  on public.audit_logs(resource, resource_id, created_at desc);
create index if not exists idx_audit_logs_action
  on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_logs'
      and policyname = 'Users can view own audit logs'
  ) then
    create policy "Users can view own audit logs"
      on public.audit_logs for select
      using (auth.uid() = user_id);
    create policy "System can insert audit logs"
      on public.audit_logs for insert
      with check (true);
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 6: agent_embeddings (migration 005 — pgvector)
-- Required for semantic search via /api/search
-- ═══════════════════════════════════════════════════════════
create table if not exists public.agent_embeddings (
  agent_id   uuid references public.agents(id) on delete cascade primary key,
  embedding  vector(1536),
  content    text not null,
  updated_at timestamp with time zone default now()
);

create index if not exists idx_agent_embeddings_vector
  on public.agent_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.agent_embeddings enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_embeddings'
      and policyname = 'Agent embeddings are public'
  ) then
    create policy "Agent embeddings are public"
      on public.agent_embeddings for select using (true);
    create policy "Service role can manage embeddings"
      on public.agent_embeddings for all
      using (auth.role() = 'service_role');
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 7: credits + credit_transactions (migration 005) — CRITICAL
-- /api/pipelines/[id]/execute reads credits for cost gating;
-- without this table the SELECT returns null and deduct_credits
-- RPC call throws 'relation does not exist'.
-- ═══════════════════════════════════════════════════════════
create table if not exists public.credits (
  user_id         uuid          references public.profiles(id) on delete cascade primary key,
  balance_usd     numeric(12,6) default 0,
  total_purchased numeric(12,2) default 0,
  total_spent     numeric(12,6) default 0,
  hard_limit_usd  numeric(12,2) default 5,
  alert_threshold numeric(12,2) default 1,
  updated_at      timestamp with time zone default now()
);

alter table public.credits enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credits'
      and policyname = 'Users can view own credits'
  ) then
    create policy "Users can view own credits"
      on public.credits for select using (auth.uid() = user_id);
    create policy "System can insert credits"
      on public.credits for insert with check (true);
    create policy "System can update credits"
      on public.credits for update using (true);
  end if;
end $$;

drop trigger if exists set_credits_updated_at on public.credits;
create trigger set_credits_updated_at
  before update on public.credits
  for each row execute procedure public.set_updated_at();

-- Back-fill $2 starter credits for every existing user
insert into public.credits (user_id, balance_usd, hard_limit_usd)
  select id, 2.00, 5.00
  from public.profiles
on conflict (user_id) do nothing;

-- Credit ledger
create table if not exists public.credit_transactions (
  id            bigserial primary key,
  user_id       uuid references public.profiles(id) on delete set null,
  type          text            not null,  -- 'topup' | 'deduction' | 'refund' | 'bonus'
  amount_usd    numeric(12,6)   not null,  -- positive = credit; negative = debit
  balance_after numeric(12,6)   not null,
  description   text,
  reference_id  uuid,
  created_at    timestamp with time zone default now()
);

create index if not exists idx_credit_tx_user
  on public.credit_transactions(user_id, created_at desc);

alter table public.credit_transactions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_transactions'
      and policyname = 'Users can view own credit transactions'
  ) then
    create policy "Users can view own credit transactions"
      on public.credit_transactions for select
      using (auth.uid() = user_id);
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 8: execution_traces (migration 005)
-- LLM observability — full prompt/response storage
-- ═══════════════════════════════════════════════════════════
create table if not exists public.execution_traces (
  id              bigserial primary key,
  execution_id    uuid references public.executions(id) on delete cascade not null,
  agent_id        uuid references public.agents(id)     on delete set null,
  user_id         uuid references public.profiles(id)   on delete set null,
  model           text,
  system_prompt   text,
  user_message    text,
  assistant_reply text,
  ttft_ms         integer,         -- time to first token
  total_ms        integer,         -- total wall time
  tokens_input    integer,
  tokens_output   integer,
  cost_usd        numeric(10,6),
  status          text,            -- 'success' | 'error' | 'timeout'
  error_message   text,
  tool_calls      jsonb        default '[]',
  temperature     numeric(3,2),
  seed            integer,
  created_at      timestamp with time zone default now()
);

create index if not exists idx_traces_execution
  on public.execution_traces(execution_id);
create index if not exists idx_traces_agent
  on public.execution_traces(agent_id, created_at desc);
create index if not exists idx_traces_user
  on public.execution_traces(user_id,  created_at desc);

alter table public.execution_traces enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'execution_traces'
      and policyname = 'Users can view own traces'
  ) then
    create policy "Users can view own traces"
      on public.execution_traces for select
      using (auth.uid() = user_id);
    create policy "Sellers can view agent traces"
      on public.execution_traces for select
      using (exists (
        select 1 from public.agents
        where agents.id    = execution_traces.agent_id
          and agents.seller_id = auth.uid()
      ));
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 9: Fix executions INSERT + UPDATE policies — CRITICAL
--
-- Both /api/agents/[id]/execute and /api/execute:
--   INSERT a row with status='running'
--   then UPDATE it with status='success'/'failed'
--
-- Migration 001 only added SELECT policies, so every INSERT
-- and every UPDATE via the user's JWT fails silently with
-- an RLS violation, leaving executions un-persisted.
-- ═══════════════════════════════════════════════════════════
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'executions'
      and policyname = 'Users can insert own executions'
  ) then
    create policy "Users can insert own executions"
      on public.executions for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'executions'
      and policyname = 'Users can update own executions'
  ) then
    create policy "Users can update own executions"
      on public.executions for update
      using (auth.uid() = user_id);
  end if;
end $$;

grant insert, update on public.executions to authenticated;


-- ═══════════════════════════════════════════════════════════
-- SECTION 10: Functions (all CREATE OR REPLACE — idempotent)
-- ═══════════════════════════════════════════════════════════

-- ── 10a. increment_executions_used (re-apply for safety) ─────────────────────
create or replace function public.increment_executions_used(user_id_param uuid)
returns void language plpgsql security definer as $$
begin
  update public.profiles
    set executions_used_this_month = executions_used_this_month + 1
  where id = user_id_param;
end;
$$;

-- ── 10b. Auto-provision $2 credits when a new profile is created ──────────────
create or replace function public.handle_new_user_credits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.credits (user_id, balance_usd, hard_limit_usd)
  values (new.id, 2.00, 5.00)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_give_credits on public.profiles;
create trigger on_profile_created_give_credits
  after insert on public.profiles
  for each row execute procedure public.handle_new_user_credits();

-- ── 10c. Deduct credits atomically (with row-level lock) ──────────────────────
create or replace function public.deduct_credits(
  user_id_param      uuid,
  amount_param       numeric,
  description_param  text,
  reference_id_param uuid    default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_balance     numeric;
  v_hard_limit  numeric;
  v_new_balance numeric;
begin
  -- Lock row to prevent double-spend
  select balance_usd, hard_limit_usd
    into v_balance, v_hard_limit
  from public.credits
  where user_id = user_id_param
  for update;

  -- Auto-create if missing (should not happen after trigger, but safe)
  if not found then
    insert into public.credits (user_id, balance_usd, hard_limit_usd)
    values (user_id_param, 2.00, 5.00)
    returning balance_usd, hard_limit_usd into v_balance, v_hard_limit;
  end if;

  if v_balance < amount_param then
    return jsonb_build_object(
      'success',  false,
      'error',    'Insufficient credits',
      'code',     'INSUFFICIENT_CREDITS',
      'balance',  v_balance,
      'required', amount_param
    );
  end if;

  v_new_balance := v_balance - amount_param;

  update public.credits
    set balance_usd = v_new_balance,
        total_spent = total_spent + amount_param
  where user_id = user_id_param;

  insert into public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  values
    (user_id_param, 'deduction', -amount_param, v_new_balance,
     description_param, reference_id_param);

  return jsonb_build_object(
    'success',       true,
    'balance_after', v_new_balance,
    'deducted',      amount_param
  );
end;
$$;

-- ── 10d. Add / top-up credits ─────────────────────────────────────────────────
create or replace function public.add_credits(
  user_id_param      uuid,
  amount_param       numeric,
  description_param  text    default 'Top-up',
  reference_id_param uuid    default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_new_balance numeric;
begin
  insert into public.credits (user_id, balance_usd, total_purchased)
  values (user_id_param, amount_param, amount_param)
  on conflict (user_id) do update
    set balance_usd     = credits.balance_usd     + amount_param,
        total_purchased = credits.total_purchased  + amount_param;

  select balance_usd into v_new_balance
  from public.credits where user_id = user_id_param;

  insert into public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  values
    (user_id_param, 'topup', amount_param, v_new_balance,
     description_param, reference_id_param);

  return jsonb_build_object('success', true, 'balance_after', v_new_balance);
end;
$$;

-- ── 10e. update_pipeline_stats — FIXED version ────────────────────────────────
-- Migration 004 only updated total_runs / successful_runs / avg_latency_ms.
-- The UI reads run_count, last_run_at, status (from migration 006 columns).
-- This version syncs both column sets so the pipeline card always shows
-- live data after an execution.
create or replace function public.update_pipeline_stats()
returns trigger language plpgsql security definer as $$
begin
  if new.status in ('success', 'failed', 'timeout') then
    update public.pipelines set
      total_runs      = total_runs      + 1,
      run_count       = run_count       + 1,   -- UI reads this column
      successful_runs = case when new.status = 'success'
                             then successful_runs + 1
                             else successful_runs end,
      avg_latency_ms  = case when new.total_latency_ms is not null
                             then (avg_latency_ms * total_runs + new.total_latency_ms)
                                  / (total_runs + 1)
                             else avg_latency_ms end,
      last_run_at     = new.completed_at,      -- UI reads this column
      status          = case when new.status = 'success'
                             then 'success'
                             else 'failed' end, -- UI reads this column
      updated_at      = now()
    where id = new.pipeline_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_pipeline_execution_complete on public.pipeline_executions;
create trigger on_pipeline_execution_complete
  after update on public.pipeline_executions
  for each row execute procedure public.update_pipeline_stats();

-- ── 10f. compute_agent_score ──────────────────────────────────────────────────
create or replace function public.compute_agent_score(target_agent_id uuid)
returns numeric language plpgsql security definer as $$
declare
  v_total_exec        bigint;
  v_success_exec      bigint;
  v_avg_latency       numeric;
  v_avg_cost          numeric;
  v_rating            numeric;
  v_accuracy_score    numeric;
  v_latency_score     numeric;
  v_cost_score        numeric;
  v_reliability_score numeric;
  v_popularity_score  numeric;
  v_composite         numeric;
  v_cat_med_latency   numeric := 500;
  v_cat               text;
begin
  select total_executions, successful_executions, average_latency_ms,
         average_rating, category::text
    into v_total_exec, v_success_exec, v_avg_latency, v_rating, v_cat
  from public.agents
  where id = target_agent_id;

  if v_total_exec is null or v_total_exec < 10 then return 0; end if;

  select coalesce(avg(cost_usd), 0) into v_avg_cost
  from public.executions
  where agent_id = target_agent_id
    and created_at >= now() - interval '30 days'
    and status = 'success';

  select coalesce(percentile_cont(0.5) within group (order by average_latency_ms), 500)
    into v_cat_med_latency
  from public.agents
  where category::text = v_cat
    and status::text   = 'active'
    and total_executions >= 10;

  v_accuracy_score := least(100, (v_success_exec::numeric / v_total_exec) * 100);

  v_latency_score := case
    when v_avg_latency <= 0                     then 50
    when v_avg_latency <= v_cat_med_latency     then 100
    when v_avg_latency >= v_cat_med_latency * 3 then 0
    else greatest(0, 100 - ((v_avg_latency - v_cat_med_latency)
                            / v_cat_med_latency) * 50)
  end;

  v_cost_score := case
    when v_avg_cost <= 0      then 80   -- free agents get 80
    when v_avg_cost <= 0.005  then 100
    when v_avg_cost >= 0.05   then 10
    else greatest(10, 100 - ((v_avg_cost - 0.005) / 0.005) * 20)
  end;

  select case when count(*) = 0 then 50
    else (count(*) filter (where status = 'success'))::numeric / count(*) * 100 end
    into v_reliability_score
  from public.executions
  where agent_id  = target_agent_id
    and created_at >= now() - interval '30 days';

  v_popularity_score := least(100,
    (ln(greatest(1, v_total_exec)) / ln(10000)) * 70
    + (coalesce(v_rating, 0) / 5) * 30);

  v_composite := (
    v_accuracy_score    * 0.30 +
    v_reliability_score * 0.25 +
    v_latency_score     * 0.20 +
    v_cost_score        * 0.15 +
    v_popularity_score  * 0.10
  );

  insert into public.agent_scores (
    agent_id, accuracy_score, latency_score, cost_score,
    reliability_score, popularity_score, composite_score,
    sample_size, computed_at
  ) values (
    target_agent_id,
    round(v_accuracy_score,    2), round(v_latency_score,     2),
    round(v_cost_score,        2), round(v_reliability_score, 2),
    round(v_popularity_score,  2), round(v_composite,         2),
    v_total_exec::integer, now()
  )
  on conflict (agent_id) do update set
    accuracy_score    = excluded.accuracy_score,
    latency_score     = excluded.latency_score,
    cost_score        = excluded.cost_score,
    reliability_score = excluded.reliability_score,
    popularity_score  = excluded.popularity_score,
    composite_score   = excluded.composite_score,
    sample_size       = excluded.sample_size,
    computed_at       = excluded.computed_at;

  update public.agents
    set composite_score = round(v_composite, 2)
  where id = target_agent_id;

  return round(v_composite, 2);
end;
$$;

-- ── 10g. compute_all_agent_scores (batch nightly job) ─────────────────────────
create or replace function public.compute_all_agent_scores()
returns integer language plpgsql security definer as $$
declare
  v_count    integer := 0;
  v_agent_id uuid;
begin
  for v_agent_id in
    select id from public.agents
    where status::text = 'active' and total_executions >= 10
  loop
    perform public.compute_agent_score(v_agent_id);
    v_count := v_count + 1;
  end loop;

  -- Update category ranks
  update public.agent_scores s set category_rank = ranks.rn
  from (
    select s2.id,
      row_number() over (
        partition by a.category
        order by s2.composite_score desc
      ) as rn
    from public.agent_scores s2
    join public.agents a on a.id = s2.agent_id
    where a.status::text = 'active'
  ) ranks
  where s.id = ranks.id;

  -- Update global ranks
  update public.agent_scores set global_rank = ranks.rn
  from (
    select id, row_number() over (order by composite_score desc) as rn
    from public.agent_scores where composite_score > 0
  ) ranks where agent_scores.id = ranks.id;

  -- Update badges
  update public.agent_scores set
    is_top_rated     = (composite_score   >= 85),
    is_fastest       = (latency_score     >= 90),
    is_cheapest      = (cost_score        >= 90),
    is_most_reliable = (reliability_score >= 90);

  return v_count;
end;
$$;

-- ── 10h. Semantic search (requires vector extension, Section 1) ───────────────
create or replace function public.search_agents_semantic(
  query_embedding vector(1536),
  match_threshold float   default 0.7,
  match_count     integer default 10
)
returns table (
  agent_id         uuid,
  name             text,
  description      text,
  category         text,
  composite_score  numeric,
  average_rating   numeric,
  pricing_model    text,
  price_per_call   numeric,
  total_executions bigint,
  similarity       float
)
language sql stable as $$
  select
    a.id, a.name, a.description, a.category::text,
    a.composite_score, a.average_rating, a.pricing_model::text,
    a.price_per_call, a.total_executions,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.agent_embeddings e
  join public.agents a on a.id = e.agent_id
  where a.status::text = 'active'
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- ── 10i. Helper functions (re-apply for completeness) ─────────────────────────
create or replace function public.increment_seller_earned(
  seller_id_param uuid,
  amount_param    numeric
)
returns void language plpgsql security definer as $$
begin
  update public.profiles
    set total_earned = total_earned + amount_param
  where id = seller_id_param;
end;
$$;

create or replace function public.reset_monthly_quotas()
returns void language plpgsql security definer as $$
begin
  update public.profiles
    set executions_used_this_month = 0,
        quota_reset_date           = now() + interval '30 days'
  where quota_reset_date <= now();
end;
$$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 11: Grants
-- ═══════════════════════════════════════════════════════════
grant execute on function public.increment_executions_used(uuid)                  to authenticated;
grant execute on function public.increment_seller_earned(uuid, numeric)            to service_role;
grant execute on function public.reset_monthly_quotas()                            to service_role;
grant execute on function public.deduct_credits(uuid, numeric, text, uuid)         to authenticated, service_role;
grant execute on function public.add_credits(uuid, numeric, text, uuid)            to authenticated, service_role;
grant execute on function public.compute_agent_score(uuid)                         to authenticated, service_role;
grant execute on function public.compute_all_agent_scores()                        to service_role;
grant execute on function public.search_agents_semantic(vector, float, integer)    to anon, authenticated;

-- Ensure service_role can manage all pipeline data
grant select, insert, update, delete on public.pipelines             to service_role;
grant select, insert, update         on public.pipelines             to authenticated;
grant select, insert, update, delete on public.pipeline_executions   to service_role;
grant select, insert, update         on public.pipeline_executions   to authenticated;


-- ═══════════════════════════════════════════════════════════
-- SECTION 12: Storage — avatars bucket
-- Settings page uploads to storage.from("avatars").upload()
-- Without this bucket every upload returns "Bucket not found".
-- ═══════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Avatar upload by owner'
  ) then
    create policy "Avatar upload by owner"
      on storage.objects for insert
      with check (
        bucket_id = 'avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );

    create policy "Avatar update by owner"
      on storage.objects for update
      using (
        bucket_id = 'avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      );

    create policy "Avatars are public"
      on storage.objects for select
      using (bucket_id = 'avatars');
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 13: Drop pipeline_runs — dead code from migration 006
--
-- The execute API writes to pipeline_executions (Section 4).
-- pipeline_runs was created by migration 006 but nothing ever
-- inserts into it. Its trigger increment_pipeline_run_count
-- never fires. Drop the table and function to avoid confusion.
-- ═══════════════════════════════════════════════════════════
drop trigger  if exists on_pipeline_run_complete          on public.pipeline_runs;
drop function if exists public.increment_pipeline_run_count();
drop table    if exists public.pipeline_runs cascade;


-- ═══════════════════════════════════════════════════════════
-- SECTION 14: Views (recreate / update)
-- ═══════════════════════════════════════════════════════════

-- Full-text + metadata search view (agents_search)
create or replace view public.agents_search as
select
  a.id, a.name, a.slug, a.description, a.category, a.tags,
  a.pricing_model, a.price_per_call, a.subscription_price_monthly,
  a.free_calls_per_month, a.average_rating, a.total_reviews,
  a.total_executions, a.average_latency_ms, a.icon_url,
  a.is_featured, a.is_verified, a.status, a.version, a.created_at,
  a.composite_score, a.capability_tags, a.input_types, a.output_types,
  p.full_name   as seller_name,
  p.username    as seller_username,
  p.avatar_url  as seller_avatar_url,
  p.is_verified as seller_verified,
  to_tsvector('english',
    coalesce(a.name, '')             || ' ' ||
    coalesce(a.description, '')      || ' ' ||
    coalesce(a.long_description, '') || ' ' ||
    coalesce(array_to_string(a.tags, ' '), '')
  ) as search_vector
from public.agents a
join public.profiles p on p.id = a.seller_id
where a.status::text = 'active';

-- Leaderboard view (requires agent_scores to be populated)
create or replace view public.agent_leaderboard as
select
  a.id, a.name, a.slug, a.description, a.category,
  a.pricing_model, a.price_per_call, a.average_rating, a.total_reviews,
  a.total_executions, a.average_latency_ms, a.is_verified, a.icon_url,
  s.composite_score, s.accuracy_score, s.latency_score, s.cost_score,
  s.reliability_score, s.popularity_score,
  s.global_rank, s.category_rank,
  s.is_top_rated, s.is_fastest, s.is_cheapest, s.is_most_reliable,
  p.full_name   as seller_name,
  p.is_verified as seller_verified
from public.agents a
join public.agent_scores s on s.agent_id = a.id
join public.profiles     p on p.id = a.seller_id
where a.status::text = 'active' and s.composite_score > 0
order by s.composite_score desc;

-- Machine-readable capability discovery view
create or replace view public.agent_capabilities as
select
  a.id, a.name, a.slug, a.description, a.category,
  a.capability_tags, a.input_types, a.output_types,
  a.languages, a.compliance_tags,
  a.pricing_model, a.price_per_call, a.subscription_price_monthly,
  a.free_calls_per_month, a.model_name, a.average_latency_ms,
  a.composite_score,
  s.accuracy_score, s.cost_score, s.latency_score
from public.agents a
left join public.agent_scores s on s.agent_id = a.id
where a.status::text = 'active';

-- User credit summary (safe — only visible to the owner)
create or replace view public.user_credit_summary as
select
  c.user_id, c.balance_usd, c.hard_limit_usd, c.alert_threshold,
  c.total_purchased, c.total_spent,
  (c.balance_usd < c.alert_threshold) as low_balance
from public.credits c
where c.user_id = auth.uid();

-- Seller-facing trace summary (for analytics dashboard)
create or replace view public.agent_trace_summary as
select
  t.agent_id,
  date_trunc('day', t.created_at)                           as day,
  count(*)                                                  as total_calls,
  avg(t.total_ms)::integer                                  as avg_latency_ms,
  avg(t.ttft_ms)::integer                                   as avg_ttft_ms,
  sum(t.tokens_input)                                       as total_tokens_in,
  sum(t.tokens_output)                                      as total_tokens_out,
  sum(t.cost_usd)                                           as total_cost,
  count(*) filter (where t.status = 'success')              as successes,
  count(*) filter (where t.status = 'error')                as errors
from public.execution_traces t
join public.agents a on a.id = t.agent_id
where a.seller_id = auth.uid()
group by t.agent_id, date_trunc('day', t.created_at)
order by day desc;


-- ═══════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════
do $$
declare
  tbl_count int;
  col_count int;
begin
  select count(*) into tbl_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'agent_scores','pipeline_executions','audit_logs',
      'agent_embeddings','credits','credit_transactions','execution_traces'
    );
  raise notice '✅ New tables present: % / 7', tbl_count;

  select count(*) into col_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name  = 'pipelines'
    and column_name in ('is_active','total_runs','successful_runs','avg_latency_ms','retry_on_failure','max_retries');
  raise notice '✅ New pipelines cols: % / 6', col_count;

  select count(*) into col_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name  = 'agents'
    and column_name in ('capability_tags','composite_score','mcp_server_ids');
  raise notice '✅ New agents cols: % / 3', col_count;

  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='pipeline_runs') then
    raise notice '⚠️  pipeline_runs still exists — check for FK conflicts';
  else
    raise notice '✅ pipeline_runs dropped';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- DONE ✅
-- Expected final table count: 20
--   (14 original − 1 pipeline_runs + 7 new)
-- ═══════════════════════════════════════════════════════════
