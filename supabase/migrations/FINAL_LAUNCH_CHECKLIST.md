# AgentDyne — Pre-Launch Final Checklist

## Step 1 — Run the fix migration in Supabase SQL Editor

Paste the entire contents of `025_final_production_fixes.sql` into
Supabase Dashboard → SQL Editor → New Query → Run.

Expected output at the end:
```
=== AgentDyne Migration 025 Verification ===
credit_reservations.resolved_at: ✅ OK
credit_reservations.reserved_usd: ✅ OK
agent_pipeline_usage UNIQUE constraint: ✅ OK
refresh_agent_rankings() function: ✅ OK
waitlist RLS enabled: ✅ OK
Active cron jobs: 11
=== Migration 025 COMPLETE ===
```

## Step 2 — Push code to GitHub (triggers Cloudflare deploy)

```powershell
cd "C:\Users\raman\Downloads\agentdyne9\platform"
git add .
git commit -m "fix: reserve_credits column name, refresh_agent_rankings, waitlist RLS, email_queue policy, duplicate cron jobs, apu unique constraint"
git push origin main
```

## Step 3 — Verify pg_cron jobs are clean

In SQL Editor:
```sql
SELECT jobid, schedule, command, active
FROM cron.job
ORDER BY jobid;
```

Expected: no duplicate jobs for quota reset, memory cleanup, or analytics.
Expected: job 14 (refresh_agent_rankings) now shows the correct function name.

## Step 4 — Verify credit reservation works end-to-end

```sql
-- Test reserve_credits (should return success: true)
SELECT reserve_credits(
  (SELECT id FROM profiles LIMIT 1),
  0.001,
  NULL
);
```

If it previously returned an error about "amount_usd column not found",
it will now succeed.

## What was fixed

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| 1 | 🔴 CRITICAL | `reserve_credits`, `commit_credit_reservation`, `release_credit_reservation`, `fail_stuck_executions` all referenced column `amount_usd` — actual column is `reserved_usd` — every credit reservation call silently failed with a column error | All 4 RPCs recreated with correct `reserved_usd` column name |
| 2 | 🔴 CRITICAL | `credit_reservations` missing `resolved_at` column that commit/release RPCs try to UPDATE | `ALTER TABLE ADD COLUMN IF NOT EXISTS resolved_at` |
| 3 | 🔴 CRITICAL | pg_cron jobid 14 calls `refresh_agent_rankings()` which did not exist — silently errored every day at 2 AM | Created function that calls `compute_agent_score` on all active agents + updates ranks |
| 4 | 🔴 CRITICAL | `014_production_infrastructure.sql` pg_cron block failed with "syntax error at or near SELECT" because `$$SELECT...$$` inside `DO $$...$$` terminates the outer DO block | All cron.schedule calls are now standalone SQL statements (no DO block) |
| 5 | 🟠 HIGH | `waitlist` table had RLS disabled (`rowsecurity: false`) — all waitlist emails readable by anyone | RLS enabled + admin-only SELECT + public INSERT |
| 6 | 🟠 HIGH | `email_queue` UPDATE policy `qual: "true"` — any authenticated user could modify any queued email | Replaced with service_role-only UPDATE |
| 7 | 🟠 HIGH | `agent_pipeline_usage` had no UNIQUE(agent_id, pipeline_id) constraint — the upsert RPC's ON CONFLICT clause was silently inserting duplicates | UNIQUE constraint added (with deduplication first) |
| 8 | 🟡 MEDIUM | 3 pairs of duplicate cron jobs (quota reset, memory cleanup, analytics) | Older duplicate jobs removed |
| 9 | 🟡 MEDIUM | 4 duplicate SELECT + 2 duplicate INSERT policies on `agent_pipeline_usage` | Replaced with 3 clean consolidated policies |
| 10 | 🟡 MEDIUM | `anon` role had INSERT/UPDATE/DELETE grants on sensitive tables (executions, traces, analytics) — defense-in-depth risk even though RLS protects them | Excess grants revoked from anon role |
