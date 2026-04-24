# AgentDyne — Pre-Launch Checklist
**April 2026 | Based on GPT + DeepSeek audit validation**

---

## 🔴 48 Hours Before Launch — BLOCKERS

These must be done or the platform will lose money / break immediately.

### Database (Supabase SQL Editor)
- [ ] Run `010_production_hardening.sql` — verify output shows ✅ for all items
- [ ] Run `011_concurrency_idempotency_cache.sql` — confirms new tables exist
- [ ] Run `012_launch_hardening.sql` — confirms pg_cron jobs registered (9/9)
- [ ] Verify pg_cron: Supabase Dashboard → Database → Extensions → pg_cron → check 9 jobs listed
- [ ] **CRITICAL**: Manually run `SELECT fail_stuck_executions()` once to confirm function works
- [ ] Manually run `SELECT cleanup_rate_limit_counters()` — confirm it returns 0 (table should be empty)

### Stripe
- [ ] Switch from `sk_test_` to `sk_live_` in Cloudflare Pages env vars
- [ ] Register webhook endpoint in Stripe Dashboard (live mode):
  - URL: `https://agentdyne.com/api/webhooks/stripe`
  - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`, `account.updated`
  - Copy new `whsec_` secret → update `STRIPE_WEBHOOK_SECRET` in Cloudflare
- [ ] Create Starter ($19/month) and Pro ($79/month) products in Stripe → copy price IDs
- [ ] Test Stripe checkout with a real card (even $5 package) — verify credits appear

### Environment Variables (Cloudflare Pages → Settings → Environment Variables)
- [ ] `ANTHROPIC_API_KEY` — verify it starts with `sk-ant-`
- [ ] `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `STRIPE_SECRET_KEY` (live) + `STRIPE_WEBHOOK_SECRET` + both price IDs
- [ ] `NEXT_PUBLIC_APP_URL` = `https://agentdyne.com` (no trailing slash)
- [ ] `SLACK_WEBHOOK_URL` — test it by running a test agent execution (should see alert if it breaks)
- [ ] `BETTER_STACK_HEARTBEAT_URL` — register monitor at betterstack.com first

### Email & DNS
- [ ] Add SPF record: `v=spf1 include:_spf.google.com ~all` (or your email provider)
- [ ] Add DKIM record (from Supabase Auth → SMTP Settings or Resend)
- [ ] Add DMARC record: `v=DMARC1; p=quarantine; rua=mailto:admin@agentdyne.com`
- [ ] Test email delivery: Supabase → Auth → Email Templates → Send test

### Security Verification
- [ ] Visit `https://agentdyne.com/api/health` — verify `{ status: "ok", checks: { database: true } }`
- [ ] Check security headers: `curl -I https://agentdyne.com` → look for `X-Frame-Options: DENY`
- [ ] Try creating an account and NOT verifying email → execute an agent → should get `EMAIL_NOT_VERIFIED` (403)
- [ ] Try executing with an invalid API key → should get 401, not 500

---

## 🟠 24 Hours Before Launch

### Load Testing
- [ ] Install k6: `brew install k6`
- [ ] Create a simple test: `k6 run --vus 50 --duration 30s script.js` against `/api/health`
- [ ] Verify Cloudflare Pages doesn't rate-limit itself (check Pages dashboard during test)

### Admin Setup
- [ ] Create your admin account in Supabase → Auth → Users → manually set `role = 'admin'` in profiles table
- [ ] Test `/api/admin?action=list_agents` returns agent list
- [ ] Test `/api/governance` returns health dashboard
- [ ] Test admin refund: create a test execution, refund it via admin

### First Agent Approval Flow
- [ ] Create a test agent as a seller → submit for review
- [ ] Approve it as admin → verify `status = 'active'` and seller gets `role = 'seller'`
- [ ] Execute the approved agent as a regular user → verify credits deducted correctly

---

## 🟡 Launch Hour

### Monitoring Dashboard Open
- [ ] Supabase Dashboard → Logs → API Logs (keep open in tab)
- [ ] Cloudflare Pages → Functions → Real-time logs (keep open)
- [ ] Stripe Dashboard → Recent events (keep open)
- [ ] Slack #alerts channel (you should see heartbeat pings if configured)

### Launch Sequence
1. [ ] Deploy latest code: `git push origin main` → Cloudflare Pages auto-deploys
2. [ ] Verify deployment is live: `curl https://agentdyne.com/api/health`
3. [ ] Set `NEXT_PUBLIC_LAUNCH_MODE=live` in Cloudflare env → redeploy (removes beta banners)
4. [ ] Post announcement (Product Hunt, Twitter, LinkedIn)
5. [ ] Watch Supabase logs for first real executions

---

## 📊 First 24 Hours — Watch These Numbers

| Metric | Normal | Investigate |
|--------|--------|-------------|
| `/api/health` status | 200 `ok` | 503 `degraded` |
| Execution success rate | >90% | <80% |
| `injection_attempts` new rows | <10/hour | >50/hour |
| `failed_webhooks` rows | 0 | any |
| `credit_reservations` stuck `reserved` | 0 (cleaned by cron) | >10 |
| Supabase DB connections | <50 | >80 |
| Average execution latency | <3000ms | >10000ms |

### SQL Queries to Run Every 2 Hours
```sql
-- Stuck executions (should be 0 — cron handles this)
SELECT COUNT(*) FROM executions WHERE status = 'running' AND created_at < now() - INTERVAL '10 minutes';

-- Failed webhooks (should be 0)
SELECT event_type, error, created_at FROM failed_webhooks WHERE resolved = FALSE ORDER BY created_at DESC LIMIT 10;

-- Abuse attempts
SELECT user_id, COUNT(*) as attempts FROM injection_attempts WHERE created_at > now() - INTERVAL '1 hour' GROUP BY user_id ORDER BY attempts DESC LIMIT 5;

-- Credit anomalies (users with negative balance — should never happen)
SELECT user_id, balance_usd FROM credits WHERE balance_usd < 0;

-- Top spenders (validate against expected)
SELECT user_id, SUM(amount_usd) as spent FROM credit_transactions WHERE type = 'deduction' AND created_at > now() - INTERVAL '1 hour' GROUP BY user_id ORDER BY spent DESC LIMIT 5;
```

---

## 💰 Economic Health Checks (Weekly)

Run these queries every Monday to validate unit economics:

```sql
-- Platform margin (should be ~3×)
SELECT
  AVG(CASE WHEN cost_usd > 0 THEN cost_usd ELSE cost END) as avg_llm_cost,
  AVG(CASE WHEN cost_usd > 0 THEN cost_usd ELSE cost END) * 3.39 as expected_user_charge,
  'Verify actual charge matches expected_user_charge × margin' as note
FROM executions
WHERE status = 'success' AND created_at > now() - INTERVAL '7 days';

-- Failure rate (should be < 8% — our overhead assumption)
SELECT
  COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / NULLIF(COUNT(*), 0) as failure_rate_pct
FROM executions
WHERE created_at > now() - INTERVAL '7 days';

-- RAG embedding cost (track against plan)
SELECT
  COUNT(*) FILTER (WHERE rag_injected = TRUE) as rag_executions,
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE rag_injected = TRUE) * 100.0 / NULLIF(COUNT(*), 0) as rag_pct
FROM execution_traces
WHERE created_at > now() - INTERVAL '7 days';
```

---

## 🚨 Emergency Runbook

### Platform is down (health check 503)
1. Check Supabase status: status.supabase.com
2. Check Cloudflare status: cloudflarestatus.com
3. If Supabase: `NEXT_PUBLIC_MAINTENANCE_MODE=true` → redeploy (shows maintenance page)
4. Check Supabase logs for "connection refused" or "too many connections"

### Credits being double-charged
1. Immediately set `NEXT_PUBLIC_MAINTENANCE_MODE=true`
2. Check `credit_reservations` for entries stuck in `reserved` → run `SELECT fail_stuck_executions()`
3. Check `credit_transactions` for duplicates: `SELECT user_id, COUNT(*) FROM credit_transactions WHERE created_at > now() - INTERVAL '1 hour' GROUP BY user_id HAVING COUNT(*) > 5`
4. Manual refund: `SELECT add_credits('USER_ID', AMOUNT, 'Emergency refund - system error', NULL)`

### Abuse wave (free tier)
1. Check `injection_attempts` and `governance_events` for the attacking IPs/users
2. Ban user: `UPDATE profiles SET is_banned = TRUE, ban_reason = 'Automated abuse' WHERE id = 'USER_ID'`
3. If signup-based attack: `UPDATE platform_config SET value = 'true' WHERE key = 'signup_disabled'`
4. Consider enabling Cloudflare "Under Attack Mode" temporarily

### Stripe webhook events lost
1. Check `failed_webhooks` table for unresolved events
2. In Stripe Dashboard → Webhooks → your endpoint → Recent deliveries → manually resend failed events
3. Or process manually: take the payload from `failed_webhooks` and call the handler function directly

---

## ✅ Post-Launch Week (Days 2-7)

- [ ] Review unit economics (see weekly SQL above)
- [ ] Read every piece of user feedback in `reviews` table + support emails
- [ ] Check `agent_analytics` — which agents are performing best?
- [ ] Review `injection_attempts` — any patterns to add to the filter?
- [ ] Set up weekly automated economics report (email to yourself via cron)
- [ ] Plan first feature update based on actual user behavior data
