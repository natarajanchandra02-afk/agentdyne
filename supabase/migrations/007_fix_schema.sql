-- ============================================================
-- Migration 007: Fix schema conflicts + missing infrastructure
-- Safe to re-run (all statements are idempotent).
-- Run in Supabase SQL Editor AFTER migrations 001–006.
--
-- What this fixes:
--   1. pipelines.run_count / last_run_at / status — migration 006's
--      CREATE TABLE IF NOT EXISTS was silently skipped because migration 004
--      already created the table. These three columns never got added.
--      The pipelines page UI + TypeScript types reference them → shows null.
--
--   2. pipeline_executions INSERT RLS policy — migration 004 created the
--      table with only a SELECT policy. The execute API (POST /api/pipelines/[id]/execute)
--      inserts into this table using the anon-key client, which means RLS applies.
--      Without an INSERT policy every pipeline execution fails with a RLS violation.
--
--   3. update_pipeline_stats trigger — migration 004's trigger updates total_runs
--      (004 column name) but the UI reads run_count (006 column name). Update the
--      function to also write run_count, last_run_at, status so the UI stays in sync.
--
--   4. avatars storage bucket — settings avatar upload fails silently because
--      the bucket doesn't exist.
--
--   5. notification_prefs on profiles — safety re-apply in case 006 was skipped.
--
--   6. pipeline_runs table — dead code from migration 006. The execute API writes
--      to pipeline_executions (004). pipeline_runs is never written to and its
--      trigger never fires. Drop it to avoid confusion.
--
--   7. Grant authenticated INSERT on pipeline_executions — required for RLS to
--      work with the anon-key client on the execute endpoint.
-- ============================================================

-- ── 1. Add columns migration 006 tried but couldn't add to pipelines ────────
-- These columns were in 006's CREATE TABLE statement, but since 004 already
-- created the table, CREATE TABLE IF NOT EXISTS is a no-op and the columns
-- were never added.

alter table public.pipelines
  add column if not exists run_count   integer not null default 0,
  add column if not exists last_run_at timestamp with time zone,
  add column if not exists status      text not null default 'idle'
    check (status in ('idle', 'running', 'success', 'failed'));

-- Backfill run_count from migration 004's total_runs column (if it has data)
update public.pipelines
  set run_count = total_runs
  where run_count = 0
    and total_runs > 0;

-- ── 2. notification_prefs on profiles (safety re-apply) ─────────────────────
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}';

-- ── 3. Fix update_pipeline_stats to also write new columns ──────────────────
-- Migration 004's function only updated total_runs / successful_runs / avg_latency_ms.
-- Extend it to also write run_count, last_run_at, status so the UI is in sync.

create or replace function public.update_pipeline_stats()
returns trigger language plpgsql security definer as $$
begin
  if new.status in ('success', 'failed', 'timeout') then
    update public.pipelines set
      total_runs       = total_runs + 1,
      run_count        = run_count  + 1,           -- NEW: UI reads this column
      successful_runs  = case
        when new.status = 'success'
        then successful_runs + 1
        else successful_runs
      end,
      avg_latency_ms   = case
        when new.total_latency_ms is not null
        then (avg_latency_ms * total_runs + new.total_latency_ms) / (total_runs + 1)
        else avg_latency_ms
      end,
      last_run_at      = new.completed_at,          -- NEW: UI reads this column
      status           = case                        -- NEW: UI reads this column
        when new.status = 'success' then 'success'
        else 'failed'
      end,
      updated_at       = now()
    where id = new.pipeline_id;
  end if;
  return new;
end;
$$;

-- Re-create the trigger to pick up the updated function
drop trigger if exists on_pipeline_execution_complete on public.pipeline_executions;
create trigger on_pipeline_execution_complete
  after update on public.pipeline_executions
  for each row execute procedure public.update_pipeline_stats();

-- ── 4. INSERT RLS policy on pipeline_executions ──────────────────────────────
-- Without this, any INSERT into pipeline_executions using the anon-key client
-- (which the execute API uses server-side) gets rejected by RLS.

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename  = 'pipeline_executions'
      and schemaname = 'public'
      and cmd        = 'INSERT'
  ) then
    execute $pol$
      create policy "Users can insert own pipeline executions"
        on public.pipeline_executions
        for insert
        with check (auth.uid() = user_id)
    $pol$;
  end if;
end $$;

-- Grant INSERT to authenticated role (required even with RLS policy)
grant select, insert on public.pipeline_executions to authenticated;
grant select, insert on public.pipeline_executions to service_role;

-- ── 5. Avatars storage bucket ────────────────────────────────────────────────
-- The settings page uploads avatars to storage.from("avatars"). Without this
-- bucket, uploads fail with "Bucket not found".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,   -- 2 MB hard limit
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Allow each user to upload their own avatar (folder = user_id)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename  = 'objects'
      and schemaname = 'storage'
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

-- ── 6. Drop pipeline_runs (dead code from migration 006) ─────────────────────
-- The execute API writes to pipeline_executions (migration 004).
-- pipeline_runs is never written to, and its trigger increment_pipeline_run_count
-- never fires. Drop it to avoid confusion and wasted space.

drop trigger if exists on_pipeline_run_complete on public.pipeline_runs;
drop function if exists public.increment_pipeline_run_count();
drop table if exists public.pipeline_runs cascade;

-- ── 7. Ensure pipeline_executions DELETE not allowed for normal users ─────────
-- Users should only be able to read their own execution logs, never delete them.
-- (SELECT policy already exists from migration 004 — this is a hardening step.)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename  = 'pipeline_executions'
      and schemaname = 'public'
      and policyname = 'No delete on pipeline executions'
  ) then
    create policy "No delete on pipeline executions"
      on public.pipeline_executions
      for delete
      using (false);  -- nobody can delete via client; only service_role can
  end if;
end $$;

-- ── 8. Index for pipeline_executions INSERT performance ──────────────────────
create index if not exists idx_pipeline_exec_status
  on public.pipeline_executions(status, created_at desc);

-- ── Done ─────────────────────────────────────────────────────────────────────
-- Summary of changes:
--   pipelines: run_count, last_run_at, status columns added
--   pipelines: run_count backfilled from total_runs
--   pipeline_executions: INSERT RLS policy added
--   pipeline_executions: authenticated INSERT grant added
--   pipeline_executions: DELETE blocked for normal users
--   update_pipeline_stats(): extended to write new columns
--   storage.buckets: avatars bucket created
--   storage policies: avatar upload/update/read policies created
--   pipeline_runs: dropped (was dead code)
--   increment_pipeline_run_count(): dropped (was dead code)
