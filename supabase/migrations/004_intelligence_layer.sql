-- ============================================================
-- Migration 004: Agent Intelligence Layer
-- Adds: agent scoring, pipeline orchestration, audit logs,
--       machine-readable discovery metadata.
--
-- Run in Supabase SQL Editor AFTER migrations 001–003.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ============================================================
-- AGENT SCORES
-- Composite quality score (0–100) computed after each execution
-- and on a nightly cron schedule.
-- ============================================================

create table if not exists public.agent_scores (
  id                uuid default uuid_generate_v4() primary key,
  agent_id          uuid references public.agents(id) on delete cascade not null unique,

  -- Component scores (each 0–100)
  accuracy_score    numeric(5,2) default 0,   -- success_rate * 100
  latency_score     numeric(5,2) default 0,   -- inverse of avg_latency, normalised
  cost_score        numeric(5,2) default 0,   -- cost efficiency vs category peers
  reliability_score numeric(5,2) default 0,   -- 30-day uptime / error rate
  popularity_score  numeric(5,2) default 0,   -- weighted executions + reviews

  -- Composite (weighted average)
  composite_score   numeric(5,2) default 0,

  -- Derived badges
  is_top_rated      boolean default false,    -- composite >= 85
  is_fastest        boolean default false,    -- latency_score >= 90 in category
  is_cheapest       boolean default false,    -- cost_score >= 90 in category
  is_most_reliable  boolean default false,    -- reliability_score >= 90

  -- Rank within category (1 = best)
  category_rank     integer,
  global_rank       integer,

  -- Metadata
  sample_size       integer default 0,        -- executions used to compute score
  computed_at       timestamp with time zone default now(),
  updated_at        timestamp with time zone default now()
);

create index if not exists idx_agent_scores_composite on public.agent_scores(composite_score desc);
create index if not exists idx_agent_scores_category on public.agent_scores(category_rank);

alter table public.agent_scores enable row level security;
create policy "Agent scores are public" on public.agent_scores for select using (true);

-- ── Trigger: keep updated_at fresh ───────────────────────────────────────
create trigger set_agent_scores_updated_at
  before update on public.agent_scores
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- PIPELINES  (multi-agent DAG workflows)
-- ============================================================

create table if not exists public.pipelines (
  id          uuid default uuid_generate_v4() primary key,
  owner_id    uuid references public.profiles(id) on delete cascade not null,
  name        text not null,
  description text,
  is_public   boolean default false,
  is_active   boolean default true,

  -- DAG definition stored as JSONB
  -- nodes: [{id, agent_id, label, config}]
  -- edges: [{from, to, condition?}]
  dag         jsonb not null default '{"nodes":[],"edges":[]}',

  -- Execution settings
  timeout_seconds   integer default 300,
  retry_on_failure  boolean default false,
  max_retries       integer default 1,

  -- Stats
  total_runs        bigint default 0,
  successful_runs   bigint default 0,
  avg_latency_ms    integer default 0,

  -- Tags for discovery
  tags        text[] default '{}',

  version     text default '1.0.0',
  created_at  timestamp with time zone default now(),
  updated_at  timestamp with time zone default now()
);

create index if not exists idx_pipelines_owner on public.pipelines(owner_id);
create index if not exists idx_pipelines_public on public.pipelines(is_public, total_runs desc);

alter table public.pipelines enable row level security;
create policy "Public pipelines viewable by all"
  on public.pipelines for select
  using (is_public = true or owner_id = auth.uid());
create policy "Owners can manage own pipelines"
  on public.pipelines for all
  using (auth.uid() = owner_id);

create trigger set_pipelines_updated_at
  before update on public.pipelines
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- PIPELINE EXECUTIONS
-- ============================================================

create table if not exists public.pipeline_executions (
  id            uuid default uuid_generate_v4() primary key,
  pipeline_id   uuid references public.pipelines(id) on delete set null,
  user_id       uuid references public.profiles(id) on delete set null,
  status        text default 'running',  -- running|success|failed|timeout
  input         jsonb not null default '{}',
  output        jsonb,
  error_message text,

  -- Per-node results
  -- [{node_id, agent_id, status, output, latency_ms, cost}]
  node_results  jsonb default '[]',

  -- Aggregates
  total_latency_ms  integer,
  total_cost        numeric(10,6) default 0,
  total_tokens_in   integer default 0,
  total_tokens_out  integer default 0,

  created_at    timestamp with time zone default now(),
  completed_at  timestamp with time zone
);

create index if not exists idx_pipeline_exec_pipeline on public.pipeline_executions(pipeline_id, created_at desc);
create index if not exists idx_pipeline_exec_user on public.pipeline_executions(user_id, created_at desc);

alter table public.pipeline_executions enable row level security;
create policy "Users can view own pipeline executions"
  on public.pipeline_executions for select
  using (auth.uid() = user_id);

-- ============================================================
-- AUDIT LOGS  (enterprise trust layer)
-- Immutable append-only log of all significant events.
-- ============================================================

create table if not exists public.audit_logs (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  actor_type  text default 'user',    -- 'user' | 'api_key' | 'system'
  actor_id    text,                   -- user_id or api_key_id
  action      text not null,          -- 'execution.created' | 'agent.published' | etc.
  resource    text,                   -- 'agents' | 'executions' | 'pipelines'
  resource_id uuid,
  payload     jsonb default '{}',
  ip_address  inet,
  user_agent  text,
  created_at  timestamp with time zone default now()
);

-- Immutable: no updates or deletes allowed via RLS
create index if not exists idx_audit_logs_user on public.audit_logs(user_id, created_at desc);
create index if not exists idx_audit_logs_resource on public.audit_logs(resource, resource_id, created_at desc);
create index if not exists idx_audit_logs_action on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;
create policy "Users can view own audit logs"
  on public.audit_logs for select
  using (auth.uid() = user_id);
create policy "System can insert audit logs"
  on public.audit_logs for insert
  with check (true);

-- ============================================================
-- AGENT CAPABILITY METADATA  (machine-readable discovery)
-- ============================================================

alter table public.agents
  add column if not exists capability_tags text[] default '{}',
  add column if not exists input_types     text[] default '{"text"}',
  add column if not exists output_types    text[] default '{"text"}',
  add column if not exists languages       text[] default '{"en"}',
  add column if not exists compliance_tags text[] default '{}',  -- 'gdpr','hipaa','soc2'
  add column if not exists composite_score numeric(5,2) default 0;

comment on column public.agents.capability_tags is
  'Machine-readable capability tags e.g. summarize, classify, extract, generate, analyze';
comment on column public.agents.composite_score is
  'Cached composite score from agent_scores table (0–100)';

-- ============================================================
-- SCORING FUNCTION
-- Called by: nightly cron, after 50+ executions milestone,
-- and on-demand via /api/agents/[id]/score (POST).
-- ============================================================

create or replace function public.compute_agent_score(target_agent_id uuid)
returns numeric language plpgsql security definer as $$
declare
  v_total_exec    bigint;
  v_success_exec  bigint;
  v_avg_latency   numeric;
  v_avg_cost      numeric;
  v_rating        numeric;
  v_review_count  integer;

  v_accuracy_score    numeric;
  v_latency_score     numeric;
  v_cost_score        numeric;
  v_reliability_score numeric;
  v_popularity_score  numeric;
  v_composite         numeric;

  -- Category peer medians for relative scoring
  v_cat_median_latency  numeric;
  v_cat_median_cost     numeric;
  v_cat              text;
begin
  -- Load agent stats
  select
    a.total_executions,
    a.successful_executions,
    a.average_latency_ms,
    a.average_rating,
    a.total_reviews,
    a.category
  into
    v_total_exec, v_success_exec, v_avg_latency,
    v_rating, v_review_count, v_cat
  from public.agents a
  where a.id = target_agent_id;

  -- Need at least 10 executions for a meaningful score
  if v_total_exec < 10 then
    return 0;
  end if;

  -- Average cost per execution (last 30 days)
  select coalesce(avg(cost_usd), 0)
  into v_avg_cost
  from public.executions
  where agent_id = target_agent_id
    and created_at >= now() - interval '30 days'
    and status = 'success';

  -- Category peer medians
  select
    coalesce(median_latency, 500),
    coalesce(median_cost, 0.01)
  into v_cat_median_latency, v_cat_median_cost
  from (
    select
      percentile_cont(0.5) within group (order by average_latency_ms) as median_latency,
      percentile_cont(0.5) within group (order by (
        select avg(cost_usd) from public.executions e2
        where e2.agent_id = a.id and e2.status = 'success'
          and e2.created_at >= now() - interval '30 days'
      )) as median_cost
    from public.agents a
    where a.category = v_cat
      and a.status = 'active'
      and a.total_executions >= 10
  ) peer_stats;

  -- ── Component scores ──────────────────────────────────────────────────

  -- 1. Accuracy (success rate)
  v_accuracy_score := least(100, (v_success_exec::numeric / v_total_exec) * 100);

  -- 2. Latency (lower is better; score = 100 if at/below median, 0 if 3x slower)
  v_latency_score := case
    when v_avg_latency <= 0 then 50
    when v_avg_latency <= v_cat_median_latency then 100
    when v_avg_latency >= v_cat_median_latency * 3 then 0
    else greatest(0, 100 - ((v_avg_latency - v_cat_median_latency) / v_cat_median_latency) * 50)
  end;

  -- 3. Cost efficiency (lower cost = higher score)
  v_cost_score := case
    when v_avg_cost <= 0 then 80  -- free agents get 80
    when v_avg_cost <= v_cat_median_cost then 100
    when v_avg_cost >= v_cat_median_cost * 5 then 10
    else greatest(10, 100 - ((v_avg_cost - v_cat_median_cost) / v_cat_median_cost) * 20)
  end;

  -- 4. Reliability (30-day window success rate)
  select
    case when count(*) = 0 then 50
    else (count(*) filter (where status = 'success'))::numeric / count(*) * 100
    end
  into v_reliability_score
  from public.executions
  where agent_id = target_agent_id
    and created_at >= now() - interval '30 days';

  -- 5. Popularity (log-scaled total executions + rating signal)
  v_popularity_score := least(100,
    (ln(greatest(1, v_total_exec)) / ln(10000)) * 70  -- execution volume (70%)
    + (coalesce(v_rating, 0) / 5) * 30                 -- rating (30%)
  );

  -- ── Weighted composite ────────────────────────────────────────────────
  -- Weights: accuracy=30%, reliability=25%, latency=20%, cost=15%, popularity=10%
  v_composite := (
    v_accuracy_score    * 0.30 +
    v_reliability_score * 0.25 +
    v_latency_score     * 0.20 +
    v_cost_score        * 0.15 +
    v_popularity_score  * 0.10
  );

  -- ── Upsert into agent_scores ──────────────────────────────────────────
  insert into public.agent_scores (
    agent_id, accuracy_score, latency_score, cost_score,
    reliability_score, popularity_score, composite_score,
    sample_size, computed_at
  ) values (
    target_agent_id,
    round(v_accuracy_score,    2),
    round(v_latency_score,     2),
    round(v_cost_score,        2),
    round(v_reliability_score, 2),
    round(v_popularity_score,  2),
    round(v_composite,         2),
    v_total_exec::integer,
    now()
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

  -- Update cached score on agents table
  update public.agents
  set composite_score = round(v_composite, 2)
  where id = target_agent_id;

  return round(v_composite, 2);
end;
$$;

-- ── Batch score all active agents ────────────────────────────────────────
create or replace function public.compute_all_agent_scores()
returns integer language plpgsql security definer as $$
declare
  v_count integer := 0;
  v_agent_id uuid;
begin
  for v_agent_id in
    select id from public.agents
    where status = 'active' and total_executions >= 10
  loop
    perform public.compute_agent_score(v_agent_id);
    v_count := v_count + 1;
  end loop;

  -- Update category ranks
  update public.agent_scores s
  set category_rank = ranks.rn
  from (
    select
      s2.id,
      row_number() over (
        partition by a.category
        order by s2.composite_score desc
      ) as rn
    from public.agent_scores s2
    join public.agents a on a.id = s2.agent_id
    where a.status = 'active'
  ) ranks
  where s.id = ranks.id;

  -- Update global ranks
  update public.agent_scores
  set global_rank = ranks.rn
  from (
    select id, row_number() over (order by composite_score desc) as rn
    from public.agent_scores
    where composite_score > 0
  ) ranks
  where agent_scores.id = ranks.id;

  -- Update badges
  update public.agent_scores
  set
    is_top_rated     = (composite_score >= 85),
    is_fastest       = (latency_score >= 90),
    is_cheapest      = (cost_score >= 90),
    is_most_reliable = (reliability_score >= 90);

  return v_count;
end;
$$;

grant execute on function public.compute_agent_score(uuid) to authenticated, service_role;
grant execute on function public.compute_all_agent_scores() to service_role;

-- ============================================================
-- PIPELINE STATS UPDATE TRIGGER
-- ============================================================

create or replace function public.update_pipeline_stats()
returns trigger language plpgsql security definer as $$
begin
  if new.status in ('success', 'failed') then
    update public.pipelines set
      total_runs       = total_runs + 1,
      successful_runs  = case when new.status = 'success' then successful_runs + 1 else successful_runs end,
      avg_latency_ms   = case when new.total_latency_ms is not null then
        (avg_latency_ms * total_runs + new.total_latency_ms) / (total_runs + 1)
        else avg_latency_ms end
    where id = new.pipeline_id;
  end if;
  return new;
end;
$$;

create trigger on_pipeline_execution_complete
  after update on public.pipeline_executions
  for each row execute procedure public.update_pipeline_stats();

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Leaderboard view: top agents with scores
create or replace view public.agent_leaderboard as
select
  a.id,
  a.name,
  a.slug,
  a.description,
  a.category,
  a.pricing_model,
  a.price_per_call,
  a.average_rating,
  a.total_reviews,
  a.total_executions,
  a.average_latency_ms,
  a.is_verified,
  a.icon_url,
  s.composite_score,
  s.accuracy_score,
  s.latency_score,
  s.cost_score,
  s.reliability_score,
  s.popularity_score,
  s.global_rank,
  s.category_rank,
  s.is_top_rated,
  s.is_fastest,
  s.is_cheapest,
  s.is_most_reliable,
  p.full_name   as seller_name,
  p.is_verified as seller_verified
from public.agents a
join public.agent_scores s on s.agent_id = a.id
join public.profiles p on p.id = a.seller_id
where a.status = 'active'
  and s.composite_score > 0
order by s.composite_score desc;

-- Machine-readable capability discovery view
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
  a.pricing_model,
  a.price_per_call,
  a.subscription_price_monthly,
  a.free_calls_per_month,
  a.model_name,
  a.average_latency_ms,
  a.composite_score,
  s.accuracy_score,
  s.cost_score,
  s.latency_score
from public.agents a
left join public.agent_scores s on s.agent_id = a.id
where a.status = 'active';
