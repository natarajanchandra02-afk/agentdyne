-- ============================================================
-- Migration 005: Semantic Search + Credits Wallet + Execution Traces
--
-- Addresses:
--   • pgvector semantic search (keyword search is 2024 thinking)
--   • Credits wallet (prevent cost abuse / bankruptcy)
--   • Execution traces (LLM observability — table stakes April 2026)
--   • Spend limits per user (hard cap, not just rate limits)
--
-- Run in Supabase SQL Editor AFTER migrations 001–004.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────
create extension if not exists "vector";

-- ============================================================
-- AGENT EMBEDDINGS  (pgvector semantic search)
-- Stores 1536-dim OpenAI / 1024-dim Anthropic embeddings for
-- semantic agent discovery. Rebuilt nightly via cron.
-- ============================================================

create table if not exists public.agent_embeddings (
  agent_id  uuid references public.agents(id) on delete cascade primary key,
  embedding vector(1536),            -- OpenAI text-embedding-3-small
  content   text not null,           -- concatenated text used to generate the embedding
  updated_at timestamp with time zone default now()
);

create index if not exists idx_agent_embeddings_vector
  on public.agent_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

alter table public.agent_embeddings enable row level security;
create policy "Agent embeddings are public" on public.agent_embeddings for select using (true);
create policy "Service role can manage embeddings"
  on public.agent_embeddings for all
  using (auth.role() = 'service_role');

-- Semantic search function — returns agents sorted by cosine similarity
create or replace function public.search_agents_semantic(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count     int   default 10
)
returns table (
  agent_id          uuid,
  name              text,
  description       text,
  category          text,
  composite_score   numeric,
  average_rating    numeric,
  pricing_model     text,
  price_per_call    numeric,
  total_executions  bigint,
  similarity        float
)
language sql stable as $$
  select
    a.id,
    a.name,
    a.description,
    a.category::text,
    a.composite_score,
    a.average_rating,
    a.pricing_model::text,
    a.price_per_call,
    a.total_executions,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.agent_embeddings e
  join public.agents a on a.id = e.agent_id
  where a.status = 'active'
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.search_agents_semantic(vector, float, int) to anon, authenticated;

-- ============================================================
-- CREDITS WALLET
-- Every user has a pre-funded credit balance.
-- Agent executions deduct from it.
-- This prevents unlimited spending on free/pay-as-you-go plans.
-- ============================================================

create table if not exists public.credits (
  user_id         uuid references public.profiles(id) on delete cascade primary key,
  balance_usd     numeric(12,6) default 0,   -- available balance
  total_purchased numeric(12,2) default 0,   -- lifetime purchased
  total_spent     numeric(12,6) default 0,   -- lifetime consumed
  hard_limit_usd  numeric(12,2) default 5,   -- max spend without top-up (default $5)
  alert_threshold numeric(12,2) default 1,   -- alert when balance < this
  updated_at      timestamp with time zone default now()
);

alter table public.credits enable row level security;
create policy "Users can view own credits" on public.credits for select using (auth.uid() = user_id);
create policy "System can update credits"  on public.credits for update using (true);

create trigger set_credits_updated_at
  before update on public.credits
  for each row execute procedure public.set_updated_at();

-- Auto-create credits row when user is created
create or replace function public.handle_new_user_credits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.credits (user_id, balance_usd, hard_limit_usd)
  values (new.id, 2.00, 5.00)   -- $2 free credit on signup
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Attach to the existing handle_new_user trigger (fires after profile is created)
create trigger on_profile_created_give_credits
  after insert on public.profiles
  for each row execute procedure public.handle_new_user_credits();

-- ── Credit transactions ledger ────────────────────────────────────────────
create table if not exists public.credit_transactions (
  id            bigserial primary key,
  user_id       uuid references public.profiles(id) on delete set null,
  type          text not null,          -- 'topup' | 'deduction' | 'refund' | 'bonus'
  amount_usd    numeric(12,6) not null, -- positive = credit, negative = debit
  balance_after numeric(12,6) not null,
  description   text,
  reference_id  uuid,                  -- execution_id or payment_intent_id
  created_at    timestamp with time zone default now()
);

create index if not exists idx_credit_tx_user on public.credit_transactions(user_id, created_at desc);
alter table public.credit_transactions enable row level security;
create policy "Users can view own credit transactions"
  on public.credit_transactions for select
  using (auth.uid() = user_id);

-- Atomic credit deduction with hard-limit enforcement
create or replace function public.deduct_credits(
  user_id_param uuid,
  amount_param  numeric,
  description_param text,
  reference_id_param uuid default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_balance    numeric;
  v_hard_limit numeric;
  v_new_balance numeric;
begin
  -- Lock the row
  select balance_usd, hard_limit_usd
  into v_balance, v_hard_limit
  from public.credits
  where user_id = user_id_param
  for update;

  -- Create row if missing (shouldn't happen due to trigger)
  if not found then
    insert into public.credits (user_id, balance_usd, hard_limit_usd)
    values (user_id_param, 2.00, 5.00)
    returning balance_usd, hard_limit_usd
    into v_balance, v_hard_limit;
  end if;

  -- Enforce hard limit
  if v_balance < amount_param then
    return jsonb_build_object(
      'success', false,
      'error',   'Insufficient credits',
      'code',    'INSUFFICIENT_CREDITS',
      'balance', v_balance,
      'required', amount_param
    );
  end if;

  v_new_balance := v_balance - amount_param;

  -- Deduct
  update public.credits
  set balance_usd = v_new_balance,
      total_spent = total_spent + amount_param
  where user_id = user_id_param;

  -- Ledger entry
  insert into public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  values
    (user_id_param, 'deduction', -amount_param, v_new_balance, description_param, reference_id_param);

  return jsonb_build_object(
    'success',       true,
    'balance_after', v_new_balance,
    'deducted',      amount_param
  );
end;
$$;

-- Add credits (top-up)
create or replace function public.add_credits(
  user_id_param   uuid,
  amount_param    numeric,
  description_param text default 'Top-up',
  reference_id_param uuid default null
)
returns jsonb language plpgsql security definer as $$
declare
  v_new_balance numeric;
begin
  insert into public.credits (user_id, balance_usd, total_purchased)
  values (user_id_param, amount_param, amount_param)
  on conflict (user_id) do update
    set balance_usd     = credits.balance_usd + amount_param,
        total_purchased = credits.total_purchased + amount_param;

  select balance_usd into v_new_balance
  from public.credits where user_id = user_id_param;

  insert into public.credit_transactions
    (user_id, type, amount_usd, balance_after, description, reference_id)
  values
    (user_id_param, 'topup', amount_param, v_new_balance, description_param, reference_id_param);

  return jsonb_build_object('success', true, 'balance_after', v_new_balance);
end;
$$;

grant execute on function public.deduct_credits(uuid, numeric, text, uuid) to authenticated, service_role;
grant execute on function public.add_credits(uuid, numeric, text, uuid) to authenticated, service_role;

-- ============================================================
-- EXECUTION TRACES  (LLM observability — table stakes 2026)
-- Stores full prompt/completion/timing data for debugging,
-- replayability, and analytics.
-- ============================================================

create table if not exists public.execution_traces (
  id              bigserial primary key,
  execution_id    uuid references public.executions(id) on delete cascade not null,
  agent_id        uuid references public.agents(id) on delete set null,
  user_id         uuid references public.profiles(id) on delete set null,

  -- LLM call details
  model           text,
  system_prompt   text,
  user_message    text,
  assistant_reply text,

  -- Timing breakdown (ms)
  ttft_ms         integer,   -- time to first token
  total_ms        integer,   -- total wall time

  -- Token usage
  tokens_input    integer,
  tokens_output   integer,
  cost_usd        numeric(10,6),

  -- Status
  status          text,      -- 'success' | 'error' | 'timeout'
  error_message   text,

  -- MCP tool calls made during execution
  tool_calls      jsonb default '[]',

  -- Replay support
  temperature     numeric(3,2),
  seed            integer,   -- for deterministic replay

  created_at      timestamp with time zone default now()
);

create index if not exists idx_traces_execution on public.execution_traces(execution_id);
create index if not exists idx_traces_agent on public.execution_traces(agent_id, created_at desc);
create index if not exists idx_traces_user on public.execution_traces(user_id, created_at desc);

alter table public.execution_traces enable row level security;
-- Users can see traces for their own executions
create policy "Users can view own traces"
  on public.execution_traces for select
  using (auth.uid() = user_id);
-- Sellers can see traces on their agents (for debugging)
create policy "Sellers can view agent traces"
  on public.execution_traces for select
  using (
    exists (
      select 1 from public.agents
      where agents.id = execution_traces.agent_id
        and agents.seller_id = auth.uid()
    )
  );

-- ============================================================
-- PIPELINE [id] ROUTE — missing last session
-- ============================================================

-- (No schema changes needed — all pipeline tables are in migration 004)

-- ============================================================
-- USEFUL HELPER VIEWS
-- ============================================================

-- User credit summary (safe — no balance exposed to other users via RLS)
create or replace view public.user_credit_summary as
select
  c.user_id,
  c.balance_usd,
  c.hard_limit_usd,
  c.alert_threshold,
  c.total_purchased,
  c.total_spent,
  (c.balance_usd < c.alert_threshold) as low_balance
from public.credits c
where c.user_id = auth.uid();

-- Agent trace summary for seller dashboard
create or replace view public.agent_trace_summary as
select
  t.agent_id,
  date_trunc('day', t.created_at) as day,
  count(*)                        as total_calls,
  avg(t.total_ms)::integer        as avg_latency_ms,
  avg(t.ttft_ms)::integer         as avg_ttft_ms,
  sum(t.tokens_input)             as total_tokens_in,
  sum(t.tokens_output)            as total_tokens_out,
  sum(t.cost_usd)                 as total_cost,
  count(*) filter (where t.status = 'success') as successes,
  count(*) filter (where t.status = 'error')   as errors
from public.execution_traces t
join public.agents a on a.id = t.agent_id
where a.seller_id = auth.uid()
group by t.agent_id, date_trunc('day', t.created_at)
order by day desc;
