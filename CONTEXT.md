# AgentDyne — Session Context (keep this updated, paste at start of each session)

## Stack
Next.js 15 App Router · Supabase (Postgres 17) · Stripe · Cloudflare Pages · Anthropic SDK

## Supabase Project
ID: hxrrtxnewvwgxhugtlai  |  Region: us-east-2  |  DB: 21MB

## Migrations applied (latest state)
- 030: SECURITY DEFINER views fixed, 52 function search_paths locked, 14 RLS policies tightened
- 031: eval harness schema (agent_evaluations, hidden_test_cases, device_fingerprints), builder reputation, compute caps, auto-disable cron
- 032: 15 FK indexes + compound indexes for hot paths
- 033: duplicate RLS policies dropped
- 034: (had syntax error — cron $$ wrapper bug — partially applied)
- 035: cron function indexes (running_stuck, active_quality, quota_check)
- 036: anti-gaming compute_agent_score, leaderboard view rebuild, RLS for PSE
- 037: RLS dedup, schema fixes (agent_type, security_config cols), platform_config seed, leaderboard view
- 038a: ALTER TYPE agent_status ADD VALUE 'rejected'
- 038b: agents RLS INSERT/UPDATE/DELETE, api_keys prefix+last_ip cols, cron re-register, leaderboard final

## Known enum values: agent_status
draft | pending_review | active | suspended | archived | rejected

## Critical bugs fixed
- agents INSERT RLS: create/route.ts now uses createAdminClient() — fixed builder navigation
- model-router.ts: uses correct model names (claude-sonnet-4-6, claude-haiku-4-5-20251001, claude-opus-4-6)
- billing-client.tsx: free plan shows "50 lifetime" not "100 monthly"
- builder-editor-client.tsx: breadcrumb + autosave + eval score panel + pricing guidance
- support-widget.tsx: POSTs to /api/support (Haiku, rate-limited, context-aware)
- pricing/page.tsx: Free=50 lifetime, Starter=$19/500/mo, Pro=$79/5000/mo

## Known outstanding issues
- composer route: hard-fails when no active agents exist on fresh deployment
- model name mismatch in cost lookup still possible in older pipeline execute paths
- admin-client.tsx Tabs still using old shadcn pattern (partially fixed)
- 034 migration: reset_monthly_quotas cron needs manual re-registration

## Plan limits (source of truth: src/lib/constants.ts)
free: 50 lifetime exec, $5 cap, 1 concurrent, Haiku only, no pipelines, no publish
starter: 500/mo, $10 cap, 3 concurrent, pipelines 5 steps
pro: 5000/mo, $50 cap, 10 concurrent, full pipelines
enterprise: unlimited, custom cap

## Eval harness gates
<70 = reject | 70-85 = pending_review | >85 = fast_track
Adversarial tests: 2x weight. All adversarial must pass or score capped at 65.

## Pricing (billing + builder must match)
per_call max: $0.25 | min: $0.001 | subscription max: $999/mo

## Key file locations
src/lib/constants.ts           — plan limits, model names, eval gates (SINGLE SOURCE OF TRUTH)
src/lib/model-router.ts        — cognitive depth routing
src/lib/evaluation-harness.ts  — eval scoring engine
src/lib/anti-abuse.ts          — bot detection, cost estimation
src/lib/guardrails.ts          — input/output safety
src/lib/fingerprint.ts         — device fingerprinting
src/app/api/execute/route.ts   — hardened execution (idempotency, quota, compute cap)
src/app/api/agents/create/route.ts — createAdminClient() INSERT pattern
src/app/api/support/route.ts   — AI support (Haiku, /api/support)
src/app/api/run/route.ts       — async queue entry point
src/app/builder/[id]/builder-editor-client.tsx — full editor rewrite

## Supabase crons (active)
agentdyne-auto-disable-agents     0 * * * *   auto_disable_low_quality_agents()
agentdyne-fail-stuck-executions   */5 * * * * fail_stuck_executions()
agentdyne-reset-monthly-quotas    0 0 1 * *   reset_monthly_quotas()
agentdyne_cleanup_expired_memory  0 * * * *   cleanup_expired_memory()
agentdyne-daily-analytics         0 2 * * *   aggregate_agent_analytics_yesterday()

## Next session: paste this file + state the specific task
