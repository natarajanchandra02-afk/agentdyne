-- ============================================================
-- AgentDyne Platform — Complete Database Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum ('user', 'seller', 'admin');
create type agent_status as enum ('draft', 'pending_review', 'active', 'suspended', 'archived');
create type agent_category as enum (
  'productivity', 'coding', 'marketing', 'finance', 'legal',
  'customer_support', 'data_analysis', 'content', 'research',
  'hr', 'sales', 'devops', 'security', 'other'
);
create type pricing_model as enum ('free', 'per_call', 'subscription', 'freemium');
create type execution_status as enum ('queued', 'running', 'success', 'failed', 'timeout');
create type subscription_plan as enum ('free', 'starter', 'pro', 'enterprise');
create type subscription_status as enum ('active', 'past_due', 'canceled', 'trialing');
create type payout_status as enum ('pending', 'processing', 'paid', 'failed');
create type review_status as enum ('pending', 'approved', 'rejected');

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================

create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text unique not null,
  full_name text,
  username text unique,
  avatar_url text,
  bio text,
  website text,
  company text,
  role user_role default 'user' not null,
  is_verified boolean default false,
  is_banned boolean default false,
  stripe_customer_id text unique,
  stripe_connect_account_id text unique,
  stripe_connect_onboarded boolean default false,
  subscription_plan subscription_plan default 'free',
  subscription_status subscription_status,
  subscription_id text,
  monthly_execution_quota integer default 100,
  executions_used_this_month integer default 0,
  quota_reset_date timestamp with time zone default (now() + interval '30 days'),
  total_earned numeric(12,2) default 0,
  total_spent numeric(12,2) default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ============================================================
-- AGENTS
-- ============================================================

create table public.agents (
  id uuid default uuid_generate_v4() primary key,
  seller_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  slug text unique not null,
  description text not null,
  long_description text,
  category agent_category not null,
  tags text[] default '{}',
  status agent_status default 'draft',
  is_featured boolean default false,
  is_verified boolean default false,

  -- Pricing
  pricing_model pricing_model default 'free',
  price_per_call numeric(10,4) default 0,
  subscription_price_monthly numeric(10,2) default 0,
  subscription_price_yearly numeric(10,2) default 0,
  free_calls_per_month integer default 0,

  -- Runtime config
  model_provider text default 'anthropic',
  model_name text default 'claude-sonnet-4-20250514',
  system_prompt text,
  tools jsonb default '[]',
  mcp_servers jsonb default '[]',
  max_tokens integer default 4096,
  temperature numeric(3,2) default 0.7,
  timeout_seconds integer default 30,

  -- Input/Output schema
  input_schema jsonb default '{}',
  output_schema jsonb default '{}',
  example_inputs jsonb default '[]',

  -- Media
  icon_url text,
  cover_url text,
  demo_video_url text,

  -- Stats (denormalized for performance)
  total_executions bigint default 0,
  successful_executions bigint default 0,
  average_latency_ms integer default 0,
  average_rating numeric(3,2) default 0,
  total_reviews integer default 0,
  total_revenue numeric(12,2) default 0,
  monthly_executions integer default 0,

  -- SEO
  meta_title text,
  meta_description text,

  version text default '1.0.0',
  changelog jsonb default '[]',
  documentation text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index idx_agents_seller_id on public.agents(seller_id);
create index idx_agents_category on public.agents(category);
create index idx_agents_status on public.agents(status);
create index idx_agents_pricing on public.agents(pricing_model);
create index idx_agents_rating on public.agents(average_rating desc);
create index idx_agents_executions on public.agents(total_executions desc);
create index idx_agents_search on public.agents using gin(to_tsvector('english', name || ' ' || description || ' ' || coalesce(long_description, '')));
create index idx_agents_tags on public.agents using gin(tags);

-- ============================================================
-- API KEYS
-- ============================================================

create table public.api_keys (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  key_hash text unique not null,
  key_prefix text not null,
  last_used_at timestamp with time zone,
  expires_at timestamp with time zone,
  is_active boolean default true,
  permissions text[] default '{execute,read}',
  rate_limit_per_minute integer default 60,
  total_calls bigint default 0,
  created_at timestamp with time zone default now()
);

create index idx_api_keys_user_id on public.api_keys(user_id);
create index idx_api_keys_hash on public.api_keys(key_hash);

-- ============================================================
-- EXECUTIONS
-- ============================================================

create table public.executions (
  id uuid default uuid_generate_v4() primary key,
  agent_id uuid references public.agents(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  api_key_id uuid references public.api_keys(id) on delete set null,
  status execution_status default 'queued',
  input jsonb not null,
  output jsonb,
  error_message text,
  tokens_input integer default 0,
  tokens_output integer default 0,
  latency_ms integer,
  cost_usd numeric(10,6) default 0,
  is_billed boolean default false,
  billed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  completed_at timestamp with time zone
);

create index idx_executions_agent_id on public.executions(agent_id);
create index idx_executions_user_id on public.executions(user_id);
create index idx_executions_status on public.executions(status);
create index idx_executions_created_at on public.executions(created_at desc);

-- ============================================================
-- REVIEWS
-- ============================================================

create table public.reviews (
  id uuid default uuid_generate_v4() primary key,
  agent_id uuid references public.agents(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  title text,
  body text,
  status review_status default 'approved',
  helpful_count integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(agent_id, user_id)
);

create index idx_reviews_agent_id on public.reviews(agent_id);

-- ============================================================
-- SUBSCRIPTIONS (user agent subscriptions)
-- ============================================================

create table public.agent_subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  agent_id uuid references public.agents(id) on delete cascade not null,
  stripe_subscription_id text unique,
  status subscription_status default 'active',
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean default false,
  created_at timestamp with time zone default now(),
  unique(user_id, agent_id)
);

-- ============================================================
-- TRANSACTIONS
-- ============================================================

create table public.transactions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  seller_id uuid references public.profiles(id) on delete set null,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  amount numeric(10,2) not null,
  platform_fee numeric(10,2) default 0,
  seller_amount numeric(10,2) default 0,
  currency text default 'usd',
  type text not null, -- 'subscription', 'per_call', 'topup'
  status text default 'pending',
  metadata jsonb default '{}',
  created_at timestamp with time zone default now()
);

create index idx_transactions_user_id on public.transactions(user_id);
create index idx_transactions_seller_id on public.transactions(seller_id);
create index idx_transactions_created_at on public.transactions(created_at desc);

-- ============================================================
-- PAYOUTS
-- ============================================================

create table public.payouts (
  id uuid default uuid_generate_v4() primary key,
  seller_id uuid references public.profiles(id) on delete cascade not null,
  stripe_payout_id text unique,
  amount numeric(10,2) not null,
  currency text default 'usd',
  status payout_status default 'pending',
  period_start timestamp with time zone,
  period_end timestamp with time zone,
  created_at timestamp with time zone default now(),
  paid_at timestamp with time zone
);

-- ============================================================
-- COLLECTIONS (curated agent lists)
-- ============================================================

create table public.collections (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  description text,
  is_public boolean default false,
  agent_ids uuid[] default '{}',
  created_at timestamp with time zone default now()
);

-- ============================================================
-- AGENT USAGE ANALYTICS (time-series)
-- ============================================================

create table public.agent_analytics (
  id uuid default uuid_generate_v4() primary key,
  agent_id uuid references public.agents(id) on delete cascade not null,
  date date not null,
  executions integer default 0,
  successful integer default 0,
  failed integer default 0,
  unique_users integer default 0,
  revenue numeric(10,2) default 0,
  avg_latency_ms integer default 0,
  unique(agent_id, date)
);

create index idx_analytics_agent_date on public.agent_analytics(agent_id, date desc);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create table public.notifications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  body text not null,
  type text not null,
  is_read boolean default false,
  action_url text,
  metadata jsonb default '{}',
  created_at timestamp with time zone default now()
);

create index idx_notifications_user_id on public.notifications(user_id, is_read, created_at desc);

-- ============================================================
-- WAITLIST
-- ============================================================

create table public.waitlist (
  id uuid default uuid_generate_v4() primary key,
  email text unique not null,
  name text,
  company text,
  use_case text,
  referral_code text,
  position integer,
  is_invited boolean default false,
  created_at timestamp with time zone default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.api_keys enable row level security;
alter table public.executions enable row level security;
alter table public.reviews enable row level security;
alter table public.agent_subscriptions enable row level security;
alter table public.transactions enable row level security;
alter table public.payouts enable row level security;
alter table public.collections enable row level security;
alter table public.agent_analytics enable row level security;
alter table public.notifications enable row level security;

-- Profiles
create policy "Public profiles are viewable by everyone" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Agents
create policy "Active agents are viewable by everyone" on public.agents for select using (status = 'active' or seller_id = auth.uid());
create policy "Sellers can insert agents" on public.agents for insert with check (auth.uid() = seller_id);
create policy "Sellers can update own agents" on public.agents for update using (auth.uid() = seller_id);

-- API Keys
create policy "Users can view own API keys" on public.api_keys for select using (auth.uid() = user_id);
create policy "Users can create API keys" on public.api_keys for insert with check (auth.uid() = user_id);
create policy "Users can update own API keys" on public.api_keys for update using (auth.uid() = user_id);
create policy "Users can delete own API keys" on public.api_keys for delete using (auth.uid() = user_id);

-- Executions
create policy "Users can view own executions" on public.executions for select using (auth.uid() = user_id);
create policy "Sellers can view executions on their agents" on public.executions for select using (
  exists (select 1 from public.agents where agents.id = executions.agent_id and agents.seller_id = auth.uid())
);

-- Reviews
create policy "Reviews are public" on public.reviews for select using (status = 'approved');
create policy "Users can insert reviews" on public.reviews for insert with check (auth.uid() = user_id);
create policy "Users can update own reviews" on public.reviews for update using (auth.uid() = user_id);

-- Transactions
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id or auth.uid() = seller_id);

-- Notifications
create policy "Users can view own notifications" on public.notifications for select using (auth.uid() = user_id);
create policy "Users can update own notifications" on public.notifications for update using (auth.uid() = user_id);

-- Payouts
create policy "Sellers can view own payouts" on public.payouts for select using (auth.uid() = seller_id);

-- Collections
create policy "Public collections viewable by all" on public.collections for select using (is_public = true or user_id = auth.uid());
create policy "Users can manage own collections" on public.collections for all using (auth.uid() = user_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Update agent stats after execution
create or replace function public.update_agent_stats()
returns trigger language plpgsql security definer as $$
begin
  if NEW.status = 'success' or NEW.status = 'failed' then
    update public.agents set
      total_executions = total_executions + 1,
      successful_executions = case when NEW.status = 'success' then successful_executions + 1 else successful_executions end,
      average_latency_ms = case when NEW.latency_ms is not null then
        (average_latency_ms * total_executions + NEW.latency_ms) / (total_executions + 1)
        else average_latency_ms end,
      updated_at = now()
    where id = NEW.agent_id;
  end if;
  return NEW;
end;
$$;

create trigger on_execution_complete
  after update on public.executions
  for each row execute procedure public.update_agent_stats();

-- Update agent rating after review
create or replace function public.update_agent_rating()
returns trigger language plpgsql security definer as $$
begin
  update public.agents set
    average_rating = (select avg(rating) from public.reviews where agent_id = NEW.agent_id and status = 'approved'),
    total_reviews = (select count(*) from public.reviews where agent_id = NEW.agent_id and status = 'approved'),
    updated_at = now()
  where id = NEW.agent_id;
  return NEW;
end;
$$;

create trigger on_review_change
  after insert or update on public.reviews
  for each row execute procedure public.update_agent_rating();

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger set_agents_updated_at before update on public.agents for each row execute procedure public.set_updated_at();

-- ============================================================
-- SEED: Subscription Plans (stored as reference data in agents)
-- ============================================================

-- Platform plans stored in Stripe, referenced here for quota management
-- free:       100 calls/month
-- starter:   1,000 calls/month  ($19/mo)
-- pro:       10,000 calls/month ($79/mo)
-- enterprise: unlimited          (custom)
