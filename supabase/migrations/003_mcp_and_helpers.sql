-- ============================================================
-- Migration 003: MCP Server Support + Helper Functions
-- Run after 001_initial_schema.sql and 002_seed_data.sql
-- ============================================================

-- ── Increment executions used (called after each API execution) ───────────
create or replace function public.increment_executions_used(user_id_param uuid)
returns void language plpgsql security definer as $$
begin
  update public.profiles
  set executions_used_this_month = executions_used_this_month + 1
  where id = user_id_param;
end;
$$;

-- ── Increment seller total_earned after a transaction ────────────────────
create or replace function public.increment_seller_earned(seller_id_param uuid, amount_param numeric)
returns void language plpgsql security definer as $$
begin
  update public.profiles
  set total_earned = total_earned + amount_param
  where id = seller_id_param;
end;
$$;

-- ── Daily analytics aggregation (run via cron) ───────────────────────────
create or replace function public.aggregate_daily_analytics(target_date date default current_date - 1)
returns void language plpgsql security definer as $$
begin
  insert into public.agent_analytics (
    agent_id, date, executions, successful, failed, revenue, avg_latency_ms
  )
  select
    e.agent_id,
    target_date,
    count(*),
    count(*) filter (where e.status = 'success'),
    count(*) filter (where e.status = 'failed'),
    coalesce(sum(t.seller_amount), 0),
    coalesce(avg(e.latency_ms)::integer, 0)
  from public.executions e
  left join public.transactions t
    on t.agent_id = e.agent_id
    and t.created_at::date = target_date
  where
    e.created_at::date = target_date
    and e.agent_id is not null
  group by e.agent_id
  on conflict (agent_id, date) do update set
    executions     = excluded.executions,
    successful     = excluded.successful,
    failed         = excluded.failed,
    revenue        = excluded.revenue,
    avg_latency_ms = excluded.avg_latency_ms;
end;
$$;

-- ── Reset monthly quotas (run on 1st of each month via cron) ─────────────
create or replace function public.reset_monthly_quotas()
returns void language plpgsql security definer as $$
begin
  update public.profiles
  set
    executions_used_this_month = 0,
    quota_reset_date = now() + interval '30 days'
  where quota_reset_date <= now();
end;
$$;

-- ── Full-text search helper view ──────────────────────────────────────────
create or replace view public.agents_search as
select
  a.id,
  a.name,
  a.slug,
  a.description,
  a.category,
  a.tags,
  a.pricing_model,
  a.price_per_call,
  a.subscription_price_monthly,
  a.free_calls_per_month,
  a.average_rating,
  a.total_reviews,
  a.total_executions,
  a.average_latency_ms,
  a.icon_url,
  a.is_featured,
  a.is_verified,
  a.status,
  a.version,
  a.created_at,
  p.full_name    as seller_name,
  p.username     as seller_username,
  p.avatar_url   as seller_avatar_url,
  p.is_verified  as seller_verified,
  to_tsvector('english',
    coalesce(a.name, '') || ' ' ||
    coalesce(a.description, '') || ' ' ||
    coalesce(a.long_description, '') || ' ' ||
    coalesce(array_to_string(a.tags, ' '), '')
  ) as search_vector
from public.agents a
join public.profiles p on p.id = a.seller_id
where a.status = 'active';

-- ── Useful indexes ────────────────────────────────────────────────────────
create index if not exists idx_executions_agent_date
  on public.executions (agent_id, created_at desc);

create index if not exists idx_executions_user_date
  on public.executions (user_id, created_at desc);

create index if not exists idx_transactions_seller_date
  on public.transactions (seller_id, created_at desc);

create index if not exists idx_notifications_unread
  on public.notifications (user_id, is_read, created_at desc);

-- ── Add MCP server config column to agents table ─────────────────────────
-- (already in schema but re-applying safely)
alter table public.agents
  add column if not exists mcp_server_ids text[] default '{}';

comment on column public.agents.mcp_server_ids is
  'Array of MCP server IDs (from mcp-servers.ts) connected to this agent';

-- ── Waitlist position trigger ─────────────────────────────────────────────
create or replace function public.set_waitlist_position()
returns trigger language plpgsql as $$
begin
  new.position := (select coalesce(max(position), 0) + 1 from public.waitlist);
  return new;
end;
$$;

drop trigger if exists set_waitlist_position_trigger on public.waitlist;
create trigger set_waitlist_position_trigger
  before insert on public.waitlist
  for each row execute procedure public.set_waitlist_position();

-- ── Grant execute on helper functions ────────────────────────────────────
grant execute on function public.increment_executions_used(uuid) to authenticated;
grant execute on function public.increment_seller_earned(uuid, numeric) to service_role;
grant execute on function public.aggregate_daily_analytics(date) to service_role;
grant execute on function public.reset_monthly_quotas() to service_role;
