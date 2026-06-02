# AgentDyne Platform — Launch Checklist
# Generated: May 2026 | v2.0.0

## ✅ COMPLETED — P0 (Critical)

### Streaming Execution (P0)
- [x] `POST /api/execute/stream` — full SSE token-by-token streaming
- [x] Self-correction agentic loop (confidence < 0.6 → auto re-prompt up to 3×)
- [x] Semantic memory injection before each call
- [x] Webhook dispatch on success/failure
- [x] Monthly + lifetime quota enforcement
- [x] Plan-aware model routing

### Supabase Auth Fix
- [x] `createClient()` — correct browser client with `NEXT_PUBLIC_` vars
- [x] `createAdminClient()` — service-role bypass for server operations
- [x] Config error banner on login page with exact fix instructions
- [x] `/api/debug/config` diagnostic endpoint

### Middleware Security
- [x] CSP relaxed for embed widget routes (`frame-ancestors *`)
- [x] `X-Frame-Options: DENY` on all non-embed routes
- [x] Embed routes CORS `Access-Control-Allow-Origin: *`
- [x] `embed/*.js` → `/api/embed/[id]` rewrite in `next.config.js`
- [x] HMAC-signed internal pipeline share calls

---

## ✅ COMPLETED — P1

### Embed Agent Network ("Stripe Checkout for AI")
- [x] `GET/POST /api/agents/[id]/embed` — config + token generation
- [x] `GET /api/embed/[id]` — serves the hosted widget JS (vanilla, 0 deps)
- [x] `/embed/widget/[id]` — full streaming chat widget page
- [x] Customisable: theme, position, primary colour, placeholder
- [x] 1-year embed token with CORS domain restriction
- [x] `DeployPanel` in builder — live preview + copy-to-clipboard
- [x] `next.config.js` rewrite: `/embed/{id}.js` → `/api/embed/{id}`

### Self-Correction Agentic Loop (P1)
- [x] Wired into `/api/execute/stream`
- [x] Trust layer `extractConfidence` + `evaluateConfidenceGating`
- [x] SSE event `type: "correction"` with attempt + confidence
- [x] Max 3 retries with conversation history

### Parallel Pipeline Execution (P1)
- [x] Topological levels via Kahn's algorithm
- [x] `Promise.all()` at each level — true parallelism
- [x] Cycle detection with early `422` return
- [x] Schema strict mode (flag unknown output fields)
- [x] WAL-lite checkpoints for resume on crash

### Execution Memory Graph (P1)
- [x] `pgvector` extension enabled
- [x] `agent_memory.embedding` column (vector 1536) + ivfflat index
- [x] `search_agent_memories()` RPC — cosine similarity search
- [x] `getRelevantMemories()` — semantic + keyword fallback
- [x] `extractAndStoreExecutionMemories()` — Haiku extracts facts post-execution
- [x] `buildMemorySystemPrompt()` — injects context before LLM call

---

## ✅ COMPLETED — P2

### Self-Improving Agent UI
- [x] `GET/POST /api/agents/[id]/versions` — generate suggestions + apply
- [x] Haiku generates: revised prompt, score delta, cost delta, improvements list
- [x] `agent_versions` table with version snapshots
- [x] `ImprovePanel` in builder — diff view, one-click apply
- [x] Version history with apply/rollback

### Workflow Evolution (Pipeline Optimizer)
- [x] `GET/POST /api/pipelines/[id]/optimize`
- [x] Analyses p95 latency, median cost per node
- [x] Returns "Recommended: N Steps / -32% Cost / -41% Latency"
- [x] POST: forks pipeline with problem nodes removed
- [x] `pipeline_optimizations` table

### Notification Bell + Webhooks UI
- [x] `useNotifications` hook with Supabase Realtime + polling fallback
- [x] `GET/PATCH/POST /api/notifications` — list, mark-all-read, create
- [x] `PATCH/DELETE /api/notifications/[id]` — per-notification
- [x] `/settings/webhooks` — full CRUD UI with event picker
- [x] `GET/POST /api/webhooks` — create webhook with HMAC secret
- [x] `PATCH/DELETE /api/webhooks/[id]` — update/delete
- [x] `POST /api/webhooks/[id]/test` — test delivery with HMAC signing
- [x] `webhook-dispatcher.ts` — fire-and-forget with 3 retries, auto-disable at 10 failures
- [x] Webhook delivery logged to `webhook_deliveries` table

### Gemini + Multimodal Model Routing (P2/P3)
- [x] `model-router.ts` — Gemini 2.5 Flash + Pro branches
- [x] Graceful fallback to Haiku if `GOOGLE_AI_API_KEY` not set
- [x] Function calling via Gemini `functionDeclarations`
- [x] `constants.ts` — Gemini models in `SUPPORTED_MODELS`, `MODEL_LABELS`, `PLAN_ALLOWED_MODELS`

---

## ✅ COMPLETED — P3

### Browser Agent Type (Computer Use)
- [x] `POST /api/execute/browser` — Anthropic computer-use wrapper
- [x] `browser_agent_sessions` table
- [x] `claude-opus-4-6` with `computer_use_20250124` tools
- [x] Plan guard: Pro+ only
- [x] Agentic loop up to 20 steps

### Multi-Agent Swarm (Gap 4)
- [x] `POST /api/swarm` — orchestrate | debate | parallel modes
- [x] `multi_agent_sessions` + `swarm_messages` tables
- [x] `/dashboard/swarm` — full UI with agent picker
- [x] Webhook dispatch on completion
- [x] Plan guard: Starter+

### SEO Metadata
- [x] `/marketplace` — full OG + Twitter cards
- [x] `/marketplace/[id]` — dynamic agent page with generateMetadata()
- [x] `/pricing` — full OG + Twitter + canonical

---

## ✅ COMPLETED — SDK

### Python SDK v2.0.0
- [x] Zero-dependency sync client (pure stdlib urllib)
- [x] Async client (httpx optional)
- [x] Full implementation: execute, stream, swarm, pipeline, browser_agent
- [x] Webhook HMAC verification with replay protection
- [x] Error hierarchy: Auth, NotFound, RateLimit, Quota, Validation, Server
- [x] `pyproject.toml` ready for PyPI publish
- [x] Type-safe dataclasses (frozen)

### TypeScript SDK v2.0.0
- [x] New types: SwarmRequest/Session, PipelineExecuteRequest/Response, BrowserExecuteRequest/Response
- [x] `client.ts` — swarm(), runPipeline(), runBrowserAgent(), getEmbedCode()
- [x] `index.ts` — updated exports for all new types
- [x] Production HTTP client with retry + jitter + streaming

---

## ✅ DATABASE (65 tables)

### New Tables (Migrations 040–044)
- [x] `agent_versions` — version snapshots
- [x] `embed_tokens` — embed widget tokens
- [x] `pipeline_optimizations` — workflow evolution
- [x] `multi_agent_sessions` — swarm state
- [x] `swarm_messages` — A2A message log
- [x] `browser_agent_sessions` — computer-use state
- [x] `webhooks` — outbound webhooks
- [x] `webhook_deliveries` — audit log
- [x] `credit_reservations` — TOCTOU-safe credit holds
- [x] `rate_limit_counters` — distributed rate limiting

### New RPCs
- [x] `search_agent_memories()` — cosine similarity via pgvector
- [x] `increment_rate_limit()` — advisory-locked rate counter
- [x] `increment_executions_used()` — atomic quota increment
- [x] `reserve_credits()` / `commit_credit_reservation()` / `release_credit_reservation()` — TOCTOU-safe billing
- [x] `get_resumable_execution()` — WAL-lite pipeline resume
- [x] `get_dashboard_stats()` — single RPC for overview
- [x] `get_agent_analytics()` — per-agent analytics

### Cron Jobs (via pg_cron)
- [x] Cleanup rate_limit_counters every hour
- [x] Cleanup expired memories daily at 3am
- [x] Cleanup stale credit reservations every 6 hours
- [x] Cleanup webhook_deliveries after 30 days
- [x] Cleanup old notifications after 90 days (read only)
- [x] Cleanup browser_agent_sessions after 7 days
- [x] Cleanup execution_traces after 30 days
- [x] Auto-compute agent scores every 4 hours

---

## 🚀 PRE-LAUNCH ACTIONS REQUIRED

### Environment Variables (Cloudflare Pages)
```
REQUIRED:
  NEXT_PUBLIC_SUPABASE_URL          ← Supabase project URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY     ← Supabase anon/public key
  SUPABASE_SERVICE_ROLE_KEY         ← Supabase service role key (server only)
  ANTHROPIC_API_KEY                 ← Claude API key
  NEXT_PUBLIC_APP_URL               ← https://agentdyne.com

STRONGLY RECOMMENDED:
  OPENAI_API_KEY                    ← Semantic memory embeddings
  STRIPE_SECRET_KEY + WEBHOOK_SECRET ← Billing
  RESEND_API_KEY                    ← Transactional email

OPTIONAL:
  GOOGLE_AI_API_KEY                 ← Gemini 2.5 Flash/Pro agents
```

### Deploy to Cloudflare Pages
```bash
# From platform/
npm install
npm run build
# Deploy via Cloudflare Dashboard → Pages → new deployment
# Or: npx wrangler pages deploy .open-next/
```

### Publish SDKs
```bash
# TypeScript SDK
cd sdk/typescript && npm publish --access public

# Python SDK  
cd sdk/python && pip install hatch && hatch build && hatch publish
```

### Verify at launch
- [ ] Visit `/api/debug/config` → all required vars show ✅ SET
- [ ] Login with email/password works
- [ ] Run a free agent → tokens stream word-by-word
- [ ] Create embed → copy script tag → test on external page
- [ ] Run a swarm with 2 agents
- [ ] Create webhook → click Test → see 200 in delivery log
- [ ] Open pipeline → Run → see parallel nodes execute
- [ ] Builder → Improve tab → Generate → see score delta

---

**Status: LAUNCH READY** 🚀
