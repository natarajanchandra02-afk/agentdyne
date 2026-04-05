# AgentDyne Platform

The world's premier microagent marketplace — discover, deploy, and monetise AI agents.
Built with Next.js 14, Supabase, Stripe, and MCP-native integrations.

---

## Stack

| Layer       | Technology                                      |
|-------------|------------------------------------------------|
| Frontend    | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend     | Next.js API Routes (serverless)                |
| Database    | Supabase (PostgreSQL + Auth + Storage)         |
| Payments    | Stripe (subscriptions + Connect payouts)       |
| AI Runtime  | Anthropic Claude, OpenAI, Google Gemini        |
| MCP         | 40+ verified MCP server integrations           |
| Deployment  | Vercel (5 regions globally)                    |
| Email       | Resend                                         |

---

## Quick Start

### 1. Install dependencies

```bash
cd platform
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AI
ANTHROPIC_API_KEY=sk-ant-...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. In the SQL Editor, run migrations in order:
   ```
   supabase/migrations/001_initial_schema.sql
   supabase/migrations/002_seed_data.sql
   supabase/migrations/003_mcp_and_helpers.sql
   ```
3. Enable OAuth providers in **Auth → Providers**:
   - GitHub: add Client ID + Secret
   - Google: add Client ID + Secret
4. Set redirect URL: `http://localhost:3000/auth/callback`

### 4. Set up Stripe

```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

Create products in Stripe Dashboard:
- Starter: $19/month → copy Price ID to `STRIPE_STARTER_PRICE_ID`
- Pro: $79/month → copy Price ID to `STRIPE_PRO_PRICE_ID`

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
platform/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (auth)/             # Login, signup, forgot-password
│   │   ├── (dashboard)/        # Protected dashboard pages
│   │   ├── marketplace/        # Agent marketplace + detail
│   │   ├── builder/            # Agent builder + editor
│   │   ├── seller/             # Seller portal
│   │   ├── admin/              # Admin panel
│   │   ├── integrations/       # MCP server marketplace
│   │   ├── docs/               # API documentation
│   │   ├── pricing/            # Pricing page
│   │   ├── about/              # About page
│   │   ├── contact/            # Contact page
│   │   ├── careers/            # Careers page
│   │   ├── changelog/          # Changelog
│   │   ├── terms/              # Terms of Service
│   │   ├── privacy/            # Privacy Policy
│   │   └── api/                # API routes
│   │       ├── agents/         # GET /api/agents, /api/agents/[id]
│   │       ├── execute/        # POST /api/execute
│   │       ├── billing/        # Stripe checkout, portal, connect
│   │       ├── webhooks/       # Stripe webhooks
│   │       ├── user/           # User profile API
│   │       └── notifications/  # Notification API
│   ├── components/
│   │   ├── ui/                 # 18 Apple-grade UI primitives
│   │   ├── layout/             # Navbar, Footer
│   │   ├── dashboard/          # Sidebar, metric cards
│   │   ├── marketplace/        # Agent cards, featured banner
│   │   ├── builder/            # MCP server picker
│   │   └── providers/          # Theme, Query providers
│   ├── lib/
│   │   ├── supabase/           # Client + Server Supabase clients
│   │   ├── stripe.ts           # Stripe client + plan config
│   │   ├── mcp-servers.ts      # 40+ MCP server registry
│   │   ├── utils.ts            # Formatters, helpers
│   │   └── rate-limit.ts       # In-memory rate limiter
│   ├── hooks/
│   │   ├── use-toast.ts
│   │   ├── use-debounce.ts
│   │   └── use-user.ts
│   └── types/
│       └── supabase.ts         # Full TypeScript DB types
├── supabase/
│   ├── config.toml
│   └── migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_seed_data.sql
│       └── 003_mcp_and_helpers.sql
├── .env.example
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── vercel.json
```

---

## Key Features

### 🛒 Marketplace
- Browse 12,400+ agents with full-text search
- Filter by category, pricing model, rating
- Featured agents, verified badges
- Agent detail with live playground

### 🏗️ Builder Studio
- System prompt editor with model selection
- 40+ MCP server integrations (one-click)
- Live test playground with JSON I/O
- Version history and documentation editor
- Submit for review workflow

### 💰 Monetisation
- 4 pricing models: Free, Per-call, Subscription, Freemium
- Stripe Connect seller payouts (80% revenue share)
- Real-time revenue analytics
- Automated monthly payouts

### 🔌 MCP Integrations (40+ servers)
- Databases: Supabase, PostgreSQL, MySQL, MongoDB, Redis
- Communication: Gmail, Slack, Twilio, Discord, SendGrid
- Productivity: Notion, Google Calendar, Google Drive, Linear, Asana
- Development: GitHub, Filesystem, Browserbase, GitLab
- Cloud: AWS, GCP, Cloudflare, Vercel
- AI: Anthropic, OpenAI, Pinecone, Qdrant
- Finance: Stripe, Plaid
- Marketing: HubSpot, Salesforce
- Analytics: PostHog, Google Analytics, Mixpanel
- E-Commerce: Shopify, WooCommerce

### 🔐 Security
- Supabase Auth with Row-Level Security on all tables
- API key hashing with SHA-256
- Rate limiting on all endpoints
- Stripe for PCI-compliant payments

---

## API Reference

```bash
# Execute an agent
POST https://api.agentdyne.com/v1/agents/{agentId}/execute
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{"input": "your input here"}

# List agents
GET /api/agents?category=coding&sort=popular&limit=24

# Get agent
GET /api/agents/{id}
```

Full API docs: [agentdyne.com/docs](https://agentdyne.com/docs)

---

## Deployment

```bash
# Deploy to Vercel
npx vercel --prod

# Set environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
# ... add all vars from .env.example
```

The platform auto-deploys to 5 global regions via `vercel.json`.

---

## Revenue Model

| Stream              | Details                              |
|---------------------|--------------------------------------|
| Subscriptions       | Free / Starter $19 / Pro $79 / Enterprise custom |
| Platform fee        | 20% of all agent transactions        |
| Enterprise contracts| Custom pricing for large teams       |

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'Add my feature'`
4. Push and open a PR

---

## License

MIT © 2026 AgentDyne, Inc.
# agentdyne
