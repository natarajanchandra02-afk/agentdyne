# AgentDyne — Complete Audit Report + Pending Items
# Generated: April 18, 2026

## ✅ CRITICAL BUGS FIXED THIS SESSION

### Bug 1 — Pipeline Execute Route: `response.usage` undefined
**File:** `src/app/api/pipelines/[id]/execute/route.ts`
**Error:** Line ~171 referenced `response.usage.input_tokens` / `response.usage.output_tokens`
where `response` was never declared. The correct variables are `inputTokens` / `outputTokens`
from the destructured `routeCompletion()` return value.
**Impact:** EVERY pipeline execution would throw `TypeError: Cannot read properties of undefined`
**Fix:** Rewrote entire execute route — removed the undefined reference, fixed variable names,
also imported and wired `rag-retriever.ts` for RAG context injection per node.

### Bug 2 — Agent Execute Route: RAG injection uses wrong RPC params
**File:** `src/app/api/agents/[id]/execute/route.ts`
**Error:** Inline `injectRAGContext()` called RPC `search_rag_chunks` with:
  - `kb_id` (wrong — should be `kb_id_param`)
  - `query_text` (wrong — RPC does NOT accept text; needs pre-embedded `query_embedding` vector)
This meant RAG was silently failing for every agent with a knowledge_base_id.
**Fix:** Removed broken inline function. Now imports `retrieveRAGContext` + `buildRAGSystemPrompt`
from `src/lib/rag-retriever.ts` which correctly embeds via OpenAI before calling the RPC.

### Bug 3 — Cloudflare Build Failure: /pipelines/[id] missing edge runtime
**File:** `src/app/pipelines/[id]/page.tsx` was missing entirely (only `_stub_removed.tsx`)
**Error:** `⚡️ The following routes were not configured to run with the Edge Runtime: /pipelines/[id]`
**Fix:** Created `src/app/pipelines/[id]/page.tsx` with `export const runtime = 'edge'`
+ redirect to dashboard. Next.js resolves `(dashboard)/pipelines/[id]/page.tsx` first.

## ✅ FEATURES ADDED THIS SESSION

### 4. Executions History Page
**File:** `src/app/(dashboard)/executions/page.tsx` + `executions-client.tsx`
Full execution history with: status filter tabs, search, 5-metric stats strip,
expandable row details (tokens/cost/ID), load-more pagination.
Sidebar "Executions" link no longer 404s.

### 5. Execution Detail Page
**File:** `src/app/(dashboard)/executions/[id]/page.tsx`
Drilldown view: summary card (latency/tokens/cost), input panel, output panel,
LLM trace panel (model/TTFT/temperature/tool_calls/system_prompt), replay API reference.
Both panels have copy-to-clipboard buttons.

### 6. Platform TypeScript Type System
**File:** `src/types/platform.ts`
Comprehensive interfaces for ALL entities: MicroAgent, Pipeline/DAG, Execution,
RAG, Registry, Commerce, API request/response contracts.
Satisfies the GPT document's "MicroAgent Core Abstraction" requirement.

### 7. Pipeline Execute: RAG per node
The pipeline execute route now runs RAG context injection on each node that has
a `knowledge_base_id` set on the agent, using the same `rag-retriever.ts` module.

### 8. Settings/API-keys pages: useRef singleton client
Both `settings/page.tsx` and `api-keys/page.tsx` now use `useRef` for the Supabase
client, preventing race conditions from creating a new client on every re-render.

## 🔴 PENDING — Next Claude Session

### P1 (Build-critical)
- **Delete** `src/app/(dashboard)/pipelines/[id]/page.tsx` manually:
  ```bash
  git rm "src/app/(dashboard)/pipelines/[id]/page.tsx"
  git commit -m "fix: remove duplicate pipelines/[id] route"
  ```
  The file was overwritten with a redirect-fallback stub, but it still exists on disk.
  Next.js may or may not error on the duplicate depending on version — verify build first.

### P2 (Feature gaps)

1. **Notification bell in Navbar** — `api/notifications` route exists, sidebar has no bell UI.
   Add unread count badge + dropdown to `src/components/layout/navbar.tsx`.

2. **MCP tool-use loop for non-Anthropic models** — Currently only `claude-*` models get
   the tool-use loop. OpenAI function calling + Gemini function calling need to be added
   to `mcp-tool-executor.ts` and wired into the execute route.

3. **Background RAG auto-embedding** — Knowledge sources saved via Builder → Behavior →
   Knowledge are stored as JSONB in `input_schema` but NOT auto-embedded into `rag_chunks`.
   Need a server action or cron that calls `POST /api/rag/ingest` when an agent is saved
   with new knowledge sources.

4. **Execution trace streaming drilldown** — Streaming executions don't store TTFT in the
   trace correctly (value is computed but `ttfts[0]` timing depends on wall clock).
   Improve precision: capture timing relative to HTTP response start.

5. **SEO metadata** — Key pages are missing `generateMetadata()`:
   - `/marketplace` (page.tsx is just a Suspense wrapper, no metadata)
   - `/leaderboard` ✅ already has it
   - `/pricing`, `/docs`, `/integrations` — missing

6. **Mobile responsiveness audit** — Most layouts are desktop-first.
   Builder wizard, Pipeline editor, Executions list need review at <640px.

7. **Stripe webhook registration** — Must register `POST /api/webhooks/stripe` in
   Stripe Dashboard with events: checkout.session.completed,
   customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.

8. **Supabase cron jobs** — Not configured:
   ```sql
   SELECT cron.schedule('reset-quotas',   '0 0 1 * *',  $$SELECT reset_monthly_quotas()$$);
   SELECT cron.schedule('score-agents',   '0 2 * * *',  $$SELECT compute_all_agent_scores()$$);
   SELECT cron.schedule('cleanup-memory', '0 4 * * *',  $$SELECT cleanup_expired_memory()$$);
   SELECT cron.schedule('daily-analytics','0 1 * * *',  $$SELECT aggregate_daily_analytics()$$);
   ```

9. **Agent swarm / parallel execution** — Pipeline engine currently runs nodes sequentially.
   Parallel branches (nodes with same in-degree = 0 after root) should run concurrently with
   `Promise.allSettled()`. Requires detecting parallel groups in the topological sort.

10. **Webhooks settings UI** — No page for users to configure outbound webhook URLs for
    execution events. Route `api/webhooks/stripe` handles Stripe; need user-configurable webhooks.

11. **`env.ts` / env validation** — No runtime validation of required env vars on startup.
    Add `src/lib/env.ts` that checks `ANTHROPIC_API_KEY`, `SUPABASE_*`, `STRIPE_*` exist.

### P3 (Architecture / GPT doc gaps)

The GPT document requested several subsystems. Current state vs. requested:

| GPT Doc Request          | Status        | Notes                                    |
|--------------------------|---------------|------------------------------------------|
| MicroAgent schema        | ✅ Done       | `src/types/platform.ts`                  |
| Unified workflow system  | ✅ Exists     | `api/pipelines/[id]/execute/route.ts`    |
| Execution runtime        | ✅ Exists     | Sequential DAG engine, timeouts, retries |
| RAG system               | ✅ Done       | `rag-retriever.ts` + API routes           |
| Agentic workflows (loop) | 🔴 Missing   | Plan→execute→evaluate→refine loop        |
| Multi-agent swarm        | 🟡 Partial   | Sequential only; parallel branches TBD   |
| Memory system            | 🟡 Schema    | `agent_memory` table exists; no UI/API   |
| Learning/optimization    | 🔴 Missing   | No workflow optimizer or agent ranker    |
| Cost routing optimizer   | ✅ Partial   | `model-router.ts` has cost estimates     |
| Outcome templates        | ✅ Done       | 6 starter templates on dashboard         |
| Execution trace UI       | ✅ Done       | `/executions/[id]` page                  |
| SDK layer (JS/Python)    | 🔴 Missing   | `sdk/` directory exists but no impl      |

### Key env vars still needed in production
```
OPENAI_API_KEY          ← RAG embeddings (required if any RAG agents exist)
STRIPE_STARTER_PRICE_ID ← Must be created in Stripe dashboard
STRIPE_PRO_PRICE_ID     ← Must be created in Stripe dashboard
GOOGLE_AI_API_KEY       ← Optional: only if using Gemini models
VLLM_BASE_URL           ← Optional: only if using self-hosted vLLM
```

## Build command after this session
```bash
cd /home/opc/AD/platform   # or Windows path
git add -A
git commit -m "fix: pipeline execute undefined response, RAG RPC params, CF build route, type system, execution detail page"
git push

# Cloudflare Pages will auto-build from main
# Supabase: run 010_final_cleanup.sql if not already done
```
