-- ============================================================
-- AgentDyne Seed Data — FIXED v2
-- Run AFTER 001_initial_schema.sql
--
-- FIX: Creates a platform system user first (no real auth user needed),
-- then inserts demo agents owned by that system user.
-- This works on a fresh Supabase project with zero users.
-- ============================================================

-- ── Step 1: Create a system/platform profile directly ─────────────────────
-- We insert into auth.users first (service_role can do this),
-- then the trigger auto-creates the profile.
-- This represents the "AgentDyne Official" seller account.

do $$
declare
  system_user_id uuid := 'a0000000-0000-0000-0000-000000000001'::uuid;
begin

  -- Only insert if not already there (idempotent)
  if not exists (select 1 from auth.users where id = system_user_id) then
    insert into auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      role
    ) values (
      system_user_id,
      '00000000-0000-0000-0000-000000000000',
      'platform@agentdyne.com',
      crypt('AgentDyne_System_2026!', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"AgentDyne Official","avatar_url":""}',
      false,
      'authenticated'
    );
  end if;

  -- Ensure the profile exists (trigger may have already created it)
  insert into public.profiles (
    id,
    email,
    full_name,
    username,
    bio,
    role,
    is_verified,
    subscription_plan,
    monthly_execution_quota
  ) values (
    system_user_id,
    'platform@agentdyne.com',
    'AgentDyne Official',
    'agentdyne',
    'Official AgentDyne platform agents — verified, production-ready, and free to use.',
    'seller',
    true,
    'enterprise',
    -1
  )
  on conflict (id) do update set
    full_name              = excluded.full_name,
    username               = excluded.username,
    bio                    = excluded.bio,
    role                   = excluded.role,
    is_verified            = excluded.is_verified,
    subscription_plan      = excluded.subscription_plan,
    monthly_execution_quota = excluded.monthly_execution_quota;

end $$;

-- ── Step 2: Insert demo agents owned by the platform user ─────────────────

insert into public.agents (
  id,
  seller_id,
  name,
  slug,
  description,
  long_description,
  category,
  pricing_model,
  status,
  is_featured,
  is_verified,
  system_prompt,
  model_name,
  tags,
  average_rating,
  total_reviews,
  total_executions,
  successful_executions,
  price_per_call,
  subscription_price_monthly,
  free_calls_per_month,
  temperature,
  max_tokens,
  timeout_seconds,
  version
) values

-- 1. Email Summarizer Pro
(
  uuid_generate_v4(),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Email Summarizer Pro',
  'email-summarizer-pro',
  'Instantly summarize long email threads into key points and action items. Save hours every week.',
  'Paste any email thread and get a structured summary in seconds. Identifies action items, urgency levels, key decisions, and follow-ups. Used by 8,000+ professionals daily.',
  'productivity',
  'freemium',
  'active',
  true,
  true,
  'You are an expert email analyst. When given an email thread, extract and return as JSON:
{
  "summary": "2-3 sentence plain-English summary",
  "keyPoints": ["bullet 1", "bullet 2"],
  "actionItems": [{"owner": "name or role", "task": "what to do", "deadline": "when or null"}],
  "urgency": "low|medium|high",
  "sentiment": "positive|neutral|negative|mixed",
  "followUpRequired": true|false
}
Be concise, professional, and always return valid JSON.',
  'claude-sonnet-4-20250514',
  ARRAY['email','productivity','summarize','inbox','gmail'],
  4.8, 124, 8420, 8100,
  0.005, 0.00, 50,
  0.3, 2048, 30,
  '1.2.0'
),

-- 2. Code Review Agent
(
  uuid_generate_v4(),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Code Review Agent',
  'code-review-agent',
  'Expert-level code reviews in seconds. Finds bugs, security issues, performance problems, and style violations.',
  'Powered by Claude Opus — the most capable model for code analysis. Reviews any language, returns structured findings with severity levels and fix suggestions. Integrates with GitHub PRs via the API.',
  'coding',
  'per_call',
  'active',
  true,
  true,
  'You are a senior software engineer with 15 years of experience in code review. Analyze the provided code and return as JSON:
{
  "score": 0-100,
  "summary": "overall assessment in 2 sentences",
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "type": "bug|security|performance|style|maintainability",
      "line": null,
      "description": "what is wrong",
      "fix": "how to fix it"
    }
  ],
  "positives": ["what was done well"],
  "language": "detected language",
  "verdict": "approve|request_changes|comment"
}
Be specific, actionable, and always return valid JSON.',
  'claude-opus-4-6',
  ARRAY['code','review','debugging','security','github','pr'],
  4.9, 87, 3210, 3180,
  0.015, 0.00, 10,
  0.1, 4096, 60,
  '1.0.0'
),

-- 3. SEO Content Writer
(
  uuid_generate_v4(),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'SEO Content Writer',
  'seo-content-writer',
  'Generate SEO-optimized blog posts, meta descriptions, and landing copy that ranks and converts.',
  'Give it a topic and target keywords, get back a fully structured, SEO-ready article with title tags, meta descriptions, H1/H2 structure, body content, and internal link suggestions. Used by 200+ marketing teams.',
  'marketing',
  'subscription',
  'active',
  true,
  true,
  'You are an expert SEO content writer and digital marketing specialist with deep knowledge of Google ranking factors. Given a topic and keywords, return as JSON:
{
  "titleTag": "60 chars max, keyword-rich",
  "metaDescription": "155 chars max, includes CTA",
  "h1": "Main heading",
  "outline": [
    {"h2": "Section heading", "keyPoints": ["point 1", "point 2"]}
  ],
  "introduction": "2-3 paragraph intro with primary keyword in first 100 words",
  "keywordDensity": {"primary": "2-3%", "secondary": "1-2%"},
  "internalLinkSuggestions": ["topic ideas to link to"],
  "estimatedWordCount": 1200,
  "readabilityScore": "Grade 8-10 (Flesch-Kincaid)"
}
Always prioritize user intent and readability over keyword stuffing.',
  'claude-sonnet-4-20250514',
  ARRAY['seo','content','marketing','blogging','copywriting','google'],
  4.7, 203, 5630, 5420,
  0.00, 29.00, 20,
  0.8, 4096, 45,
  '1.1.0'
),

-- 4. Financial Report Analyzer
(
  uuid_generate_v4(),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Financial Report Analyzer',
  'financial-report-analyzer',
  'Analyze any financial statement — P&L, balance sheet, cash flow. Get instant insights, ratios, and risk flags.',
  'Paste a financial statement or earnings report and get a structured analyst-grade assessment. Calculates key ratios, identifies trends, flags risks, and provides an investment summary. Used by 500+ finance professionals.',
  'finance',
  'per_call',
  'active',
  false,
  true,
  'You are a CFA-certified financial analyst with expertise in equity research. Analyze the provided financial data and return as JSON:
{
  "summary": "executive summary in 2-3 sentences",
  "keyMetrics": {
    "revenue": "value with YoY growth %",
    "grossMargin": "%",
    "operatingMargin": "%",
    "netMargin": "%",
    "revenueGrowth": "YoY %"
  },
  "ratios": {
    "peRatio": null,
    "debtToEquity": null,
    "currentRatio": null,
    "quickRatio": null
  },
  "strengths": ["strength 1", "strength 2"],
  "risks": ["risk 1", "risk 2"],
  "trends": "3-5 sentence trend analysis",
  "verdict": "bullish|neutral|bearish",
  "confidenceLevel": "low|medium|high"
}
Be objective, data-driven, and clearly flag any assumptions made.',
  'claude-opus-4-6',
  ARRAY['finance','analysis','investment','reports','accounting','earnings'],
  4.6, 56, 1840, 1760,
  0.025, 0.00, 5,
  0.2, 4096, 60,
  '1.0.0'
),

-- 5. Customer Support Agent
(
  uuid_generate_v4(),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Customer Support Agent',
  'customer-support-agent',
  'Handle customer inquiries, complaints, and requests automatically. Tone-aware, empathetic, and escalation-smart.',
  'Configure with your product context and FAQs, and this agent handles Tier-1 support automatically. Detects sentiment, classifies intent, drafts responses, and flags escalations. CSAT-optimized.',
  'customer_support',
  'subscription',
  'active',
  false,
  true,
  'You are an expert customer support specialist. Analyze the customer message and return as JSON:
{
  "intent": "complaint|inquiry|refund_request|technical_support|compliment|other",
  "sentiment": "positive|neutral|negative|angry",
  "urgency": "low|medium|high|critical",
  "shouldEscalate": true|false,
  "escalationReason": "reason or null",
  "suggestedResponse": "full empathetic response draft",
  "responseType": "resolve|apologize|investigate|redirect|escalate",
  "tags": ["billing", "product", etc]
}
Always be empathetic. Never make promises you cannot keep. Acknowledge the customer''s frustration before offering solutions.',
  'claude-sonnet-4-20250514',
  ARRAY['support','customer-service','helpdesk','crm','zendesk'],
  4.5, 41, 2890, 2760,
  0.00, 49.00, 100,
  0.5, 2048, 30,
  '1.0.0'
),

-- 6. Data Extraction Agent
(
  uuid_generate_v4(),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Data Extraction Agent',
  'data-extraction-agent',
  'Extract structured data from any unstructured text — contracts, invoices, reports, web pages.',
  'Give it any unstructured text and a schema, get back perfectly structured JSON. Works with contracts, invoices, research papers, news articles, and more. Zero hallucination mode — returns null for missing fields.',
  'data_analysis',
  'per_call',
  'active',
  false,
  true,
  'You are a precise data extraction specialist. Your job is to extract specific information from unstructured text.

Rules:
1. Only extract what is explicitly stated — NEVER infer or guess
2. Return null for any field not found in the text
3. Preserve exact values (dates, numbers, names) as they appear
4. Always return valid JSON
5. If the text is ambiguous, note it in an "extractionNotes" field

Return the extracted data in the schema provided by the user, plus an "extractionNotes" field for any ambiguities or missing data.',
  'claude-sonnet-4-20250514',
  ARRAY['data','extraction','parsing','nlp','ocr','documents','invoices'],
  4.7, 33, 1240, 1220,
  0.010, 0.00, 20,
  0.0, 4096, 45,
  '1.0.0'
),

-- 7. SQL Query Generator
(
  uuid_generate_v4(),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'SQL Query Generator',
  'sql-query-generator',
  'Turn natural language questions into production-ready SQL queries. Supports PostgreSQL, MySQL, SQLite, and BigQuery.',
  'Describe your database schema and ask questions in plain English. Get back optimized, commented SQL that handles edge cases, uses proper indexes, and follows best practices.',
  'coding',
  'free',
  'active',
  false,
  true,
  'You are an expert SQL engineer. Given a database schema and a natural language question, return as JSON:
{
  "sql": "the complete, formatted SQL query",
  "explanation": "plain English explanation of what the query does",
  "dialect": "postgresql|mysql|sqlite|bigquery",
  "indexSuggestions": ["CREATE INDEX... if relevant"],
  "warnings": ["any edge cases or performance concerns"],
  "estimatedComplexity": "simple|moderate|complex"
}

Rules:
- Use CTEs for complex queries
- Always alias subqueries
- Add comments for non-obvious logic
- Prefer explicit JOINs over implicit
- Always return valid JSON',
  'claude-sonnet-4-20250514',
  ARRAY['sql','database','queries','postgresql','mysql','bigquery','analytics'],
  4.8, 91, 4100, 4050,
  0.00, 0.00, 999999,
  0.1, 4096, 30,
  '1.0.0'
);

-- ── Step 3: Add some demo reviews ─────────────────────────────────────────
-- Reviews need real user_id values, so we skip them for now.
-- They'll be created organically as real users sign up and review agents.

-- ── Step 4: Increment executions used helper (idempotent) ─────────────────
create or replace function public.increment_executions_used(user_id_param uuid)
returns void language plpgsql security definer as $$
begin
  update public.profiles
  set executions_used_this_month = executions_used_this_month + 1
  where id = user_id_param;
end;
$$;

-- ── Verify seed worked ────────────────────────────────────────────────────
do $$
declare
  agent_count int;
begin
  select count(*) into agent_count from public.agents where status = 'active';
  raise notice 'Seed complete. Active agents: %', agent_count;
end $$;
