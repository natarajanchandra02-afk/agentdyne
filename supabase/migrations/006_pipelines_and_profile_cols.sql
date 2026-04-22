-- ============================================================
-- Migration 006: Pipelines table + missing profile columns
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Add notification_prefs column to profiles ──────────────────────────
alter table public.profiles
  add column if not exists notification_prefs jsonb default '{}';

-- ── 2. Pipelines table ────────────────────────────────────────────────────
create table if not exists public.pipelines (
  id               uuid default uuid_generate_v4() primary key,
  owner_id         uuid references public.profiles(id) on delete cascade not null,
  name             text not null,
  description      text,
  dag              jsonb not null default '{"nodes":[],"edges":[]}',
  is_public        boolean default false,
  timeout_seconds  integer default 300,
  tags             text[] default '{}',
  status           text default 'idle'
    check (status in ('idle','running','success','failed')),
  run_count        integer default 0,
  last_run_at      timestamp with time zone,
  created_at       timestamp with time zone default now(),
  updated_at       timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_pipelines_owner_id
  on public.pipelines(owner_id);

create index if not exists idx_pipelines_is_public
  on public.pipelines(is_public)
  where is_public = true;

create index if not exists idx_pipelines_updated_at
  on public.pipelines(updated_at desc);

-- Updated_at trigger
drop trigger if exists set_pipelines_updated_at on public.pipelines;
create trigger set_pipelines_updated_at
  before update on public.pipelines
  for each row execute procedure public.set_updated_at();

-- ── 3. Row Level Security ─────────────────────────────────────────────────
alter table public.pipelines enable row level security;

-- Owners can read all their pipelines; public pipelines visible to everyone
create policy "Pipeline read access"
  on public.pipelines for select
  using (owner_id = auth.uid() or is_public = true);

create policy "Pipeline insert"
  on public.pipelines for insert
  with check (auth.uid() = owner_id);

create policy "Pipeline update"
  on public.pipelines for update
  using (auth.uid() = owner_id);

create policy "Pipeline delete"
  on public.pipelines for delete
  using (auth.uid() = owner_id);

-- ── 4. Pipeline runs (execution audit log) ───────────────────────────────
create table if not exists public.pipeline_runs (
  id           uuid default uuid_generate_v4() primary key,
  pipeline_id  uuid references public.pipelines(id) on delete cascade not null,
  user_id      uuid references public.profiles(id) on delete set null,
  status       text default 'running'
    check (status in ('running','success','failed','timeout')),
  input        jsonb,
  output       jsonb,
  error        text,
  latency_ms   integer,
  created_at   timestamp with time zone default now(),
  completed_at timestamp with time zone
);

create index if not exists idx_pipeline_runs_pipeline_id
  on public.pipeline_runs(pipeline_id, created_at desc);

alter table public.pipeline_runs enable row level security;

create policy "Pipeline runs read"
  on public.pipeline_runs for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.pipelines
      where pipelines.id = pipeline_runs.pipeline_id
        and pipelines.owner_id = auth.uid()
    )
  );

-- ── 5. Increment run_count after each pipeline run completes ─────────────
create or replace function public.increment_pipeline_run_count()
returns trigger language plpgsql security definer as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    update public.pipelines
    set
      run_count   = run_count + 1,
      last_run_at = new.completed_at,
      status      = new.status,
      updated_at  = now()
    where id = new.pipeline_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_pipeline_run_complete on public.pipeline_runs;
create trigger on_pipeline_run_complete
  after update on public.pipeline_runs
  for each row execute procedure public.increment_pipeline_run_count();

-- ── 6. Grant service_role access for pipeline execution ──────────────────
grant select, insert, update, delete on public.pipelines       to service_role;
grant select, insert, update, delete on public.pipeline_runs   to service_role;
grant select, insert, update         on public.pipelines       to authenticated;
grant select, insert                 on public.pipeline_runs   to authenticated;
