# AgentDyne Platform — Production Audit Report
_April 2026_

## ✅ Fixed This Session

### 1. SQL FK Constraint Error
**Error:** `constraint "agents_knowledge_base_id_fkey" already exists`  
**Root cause:** `009_production_registry.sql` added the FK via a DO block, then `009_rag_memory_registry.sql` tried to add it again via inline `ALTER TABLE … ADD COLUMN … REFERENCES`.  
**Fix:** `010_final_cleanup.sql` — checks constraint existence before adding, fully idempotent.  
**Run this in Supabase SQL Editor now.**

### 2. Dashboard Pages Blank After Navigation
**Root cause:** All dashboard page.tsx files called `supabase.auth.getUser()` directly in `useEffect`, which returns `null` for ~200ms after soft navigation.  
**Fix:** All 7 pages (dashboard, my-agents, analytics, api-keys, billing, settings, seller) now use `useUser()` hook.

### 3. Builder Page "Removes Everything"
**Root cause:** `/builder` uses `DashboardSidebar` layout (correct for authenticated app), but had no way to navigate back to the marketing site.  
**Fix:** Sidebar now shows `← Site` link to `/marketplace` in the header, and mobile hamburger menu.

### 4. Create Agent Does Nothing on Step 3
**Root cause:** `handleSubmit(onSubmit)` missing second `onError` argument — silent validation failures.  
**Fix:** Builder page now has `handleSubmit(onSubmit, onError)` with step-jump on error + red field highlights.

### 5. MCP and Knowledge Tabs Empty
**Root cause:** Previous builder-editor-client.tsx had `<TabsTrigger>` entries for MCP/Knowledge but NO `<TabsContent>`.  
**Fix:** Full redesign — 3-tab architecture (Overview / Behavior / Monetization) + pinned test panel. Behavior tab contains Instructions → Model → Knowledge (RAG) → MCP Tools all built out.

### 6. Navbar Auth Flicker (Sign In flash)
**Root cause:** `loading` state from `useUser()` not checked before rendering auth buttons.  
**Fix:** Navbar renders skeleton placeholder while `authLoading = true`.

### 7. Pricing Page CTAs Go to Wrong Place
**Root cause:** All plan CTAs went to `/signup` regardless of auth state.  
**Fix:** Auth-aware CTAs — logged in users see "Go to marketplace" (free) or "Upgrade to Starter/Pro" → `/billing?upgrade=...`. Current plan shows "Your plan" badge.

### 8. Agent Type Selector UX
**Root cause:** Multi-agent and RAG were buried in top-right toggle on builder page.  
**Fix:** Full-page Step 0 type selector with Single Agent / RAG Agent / Pipeline cards. Pipeline redirects to Pipeline Studio (not a wizard tab).

### 9. Marketplace Redesign
**Fix:** Apple-standard layout — clean hero search, category pill rail, grid/list toggle, filter bar, skeleton loading, agent cards with verified badges and pricing pills.

---

## 🟡 Pending / Requires Action

### ENV Variables — Must Set in Vercel/Linux
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_STARTER_PRICE_ID=
STRIPE_PRO_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=https://agentdyne.com
```

### Supabase Cron Jobs (pg_cron) — Must Set Up
```sql
SELECT cron.schedule('reset-quotas',   '0 0 1 * *',  $$SELECT reset_monthly_quotas()$$);
SELECT cron.schedule('score-agents',   '0 2 * * *',  $$SELECT compute_all_agent_scores()$$);
SELECT cron.schedule('cleanup-memory', '0 4 * * *',  $$SELECT cleanup_expired_memory()$$);
SELECT cron.schedule('daily-analytics','0 1 * * *',  $$SELECT aggregate_daily_analytics()$$);
```

### Stripe Setup
- Create products + prices in Stripe dashboard for Starter ($19/mo) and Pro ($79/mo)
- Set `STRIPE_STARTER_PRICE_ID` and `STRIPE_PRO_PRICE_ID` in env
- Configure webhook endpoint: `POST /api/webhooks/stripe`
- Webhook events to subscribe: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

### RAG Embeddings
- The `rag_chunks.embedding` column uses `vector(1536)` (OpenAI dimensions)
- Embedding generation is NOT wired to the execute API yet — knowledge sources added in the builder are stored as JSONB but not auto-embedded
- To activate RAG: add a background job that calls OpenAI embeddings API on saved knowledge items and inserts into `rag_chunks`

### Agent Registry
- `agent_registry_versions` table exists ✅
- `agent_graph_nodes` view exists ✅
- Auto-snapshot trigger on approval exists ✅
- Registry API routes: `/api/agents/[id]/score` ✅, `/api/leaderboard` ✅

---

## 🔴 Known Non-Issues (working as designed)

| Symptom | Why it's correct |
|---|---|
| Empty dashboard pages with no agents | Correct empty-state UX — shows CTAs to create agents |
| Builder uses sidebar layout, not public navbar | Standard SaaS UX — authenticated app has different chrome than marketing site |
| Docs link in sidebar goes to public docs | Correct — `/docs` renders the public docs page with Navbar |
| Free plan agents cost nothing to run | Platform absorbs inference cost from subscription revenue |

---

## 📊 Architecture Summary

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 18, Tailwind CSS v3, shadcn/ui |
| Auth | Supabase Auth (SSR cookies via @supabase/ssr) |
| Database | Supabase Postgres (21 tables, 6 views, pgvector) |
| AI execution | Anthropic Claude (primary), GPT-4o, Gemini (via model_name field) |
| Payments | Stripe (subscriptions + Connect for seller payouts) |
| Storage | Supabase Storage (avatars bucket) |
| Deployment | Vercel / Cloudflare Workers (edge runtime) |
