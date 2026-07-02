import Link from "next/link"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { ArrowRight, Clock, TrendingUp, Zap, Brain, Layers, Shield, Globe, DollarSign, GitMerge, Cpu, Lock, CreditCard, Gauge, MessageSquareCode } from "lucide-react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Blog — AgentDyne",
  description: "Insights on AI agents, multi-agent systems, and the future of intelligent automation.",
}

// ─────────────────────────────────────────────────────────────────────────────
// Posts data — static for now; wire to CMS / Supabase when content team scales
// ─────────────────────────────────────────────────────────────────────────────

interface Post {
  slug:       string
  title:      string
  excerpt:    string
  date:       string
  readMin:    number
  category:   string
  icon:       typeof Zap
  featured?:  boolean
}

const POSTS: Post[] = [
  {
    slug:     "agentic-commerce-ap2-agent-payments-2026",
    title:    "Agentic Commerce Has Arrived: What AP2 and Agent Payments Mean for Builders",
    excerpt:  "Google's Agent Payments Protocol (AP2), Visa's Trusted Agent Protocol, and Mastercard's Agent Pay all shipped within months of each other in 2026. For the first time, an AI agent can hold a cryptographically-scoped mandate to spend real money on a user's behalf. Here's what that infrastructure actually looks like, and why AgentDyne is treating it as a first-class capability, not a bolt-on.",
    date:     "June 24, 2026",
    readMin:  9,
    category: "Architecture",
    icon:     CreditCard,
    featured: true,
  },
  {
    slug:     "inference-cost-collapse-small-models-eating-agent-market",
    title:    "The Great Inference Cost Collapse: Why Cheap Models Are Eating the Agent Market",
    excerpt:  "Frontier-model token prices have fallen roughly 10x in eighteen months while small-model quality kept closing the gap. That combination is quietly rewriting agent unit economics — the agents winning the AgentDyne leaderboard today are model-routed, not model-loyal. We break down the real cost curves and what they mean for how you should be building.",
    date:     "June 18, 2026",
    readMin:  8,
    category: "Business",
    icon:     Gauge,
  },
  {
    slug:     "context-engineering-is-the-new-prompt-engineering",
    title:    "Context Engineering Is the New Prompt Engineering",
    excerpt:  "\"Prompt engineering\" described a skill that mostly evaporated as models got instruction-following right by default. The discipline that replaced it — deciding what information an agent sees, in what order, from which tools, at what point in a task — is a systems problem, not a wordsmithing one. Here's how that shift shows up concretely in how we'd build an agent on AgentDyne today.",
    date:     "June 12, 2026",
    readMin:  9,
    category: "Engineering",
    icon:     MessageSquareCode,
  },
  {
    slug:     "a2a-protocol-agent-to-agent-communication",
    title:    "A2A vs MCP: The Two Protocols Defining How AI Agents Talk to Each Other",
    excerpt:  "Google’s Agent-to-Agent (A2A) protocol and Anthropic’s Model Context Protocol (MCP) are not competitors — they solve different layers of the same problem. MCP connects an agent to tools; A2A connects agents to agents. Together they form a complete inter-agent communication stack, and AgentDyne now supports both.",
    date:     "May 9, 2026",
    readMin:  8,
    category: "Architecture",
    icon:     GitMerge,
  },
  {
    slug:     "parallel-agent-swarms-promise-allsettled",
    title:    "Parallel Agent Swarms: Why Promise.allSettled Is the New Async/Await for AI",
    excerpt:  "Sequential pipelines waste wall-clock time. When three independent agents can run in parallel, running them sequentially is the AI equivalent of a single-threaded server. We explain the DAG-based parallelism engine behind AgentDyne Pipelines, how we detect branch nodes, and why continue_on_failure changes the error calculus entirely.",
    date:     "May 7, 2026",
    readMin:  10,
    category: "Engineering",
    icon:     Cpu,
  },
  {
    slug:     "vibe-coding-to-production-agents-the-gap-nobody-talks-about",
    title:    "From Vibe Coding to Production Agents: The Gap Nobody Talks About",
    excerpt:  "Everyone can generate a working agent in five minutes with a frontier model. Fewer than 5% of those agents are still working six months later. The gap isn’t the model — it’s observability, schema validation, cost controls, and version pinning. This is the production checklist we wish existed when we launched AgentDyne.",
    date:     "May 5, 2026",
    readMin:  12,
    category: "Product",
    icon:     Lock,
  },
  {
    slug:     "why-microagents-beat-monolithic-ai",
    title:    "Why Microagents Beat Monolithic AI: The Case for Composable Intelligence",
    excerpt:  "Monolithic LLM prompts are the equivalent of writing all your business logic in a single function. Microagents — small, single-purpose AI components — compose into systems that are testable, replaceable, and dramatically cheaper to iterate on.",
    date:     "April 14, 2026",
    readMin:  7,
    category: "Architecture",
    icon:     Layers,
  },
  {
    slug:     "mcp-the-usb-c-of-ai-tools",
    title:    "MCP: The USB-C of AI Tools",
    excerpt:  "The Model Context Protocol is quietly standardising how AI agents connect to external services. If every agent had to re-implement its own GitHub or Notion integration, the ecosystem would fragment. MCP prevents that — and AgentDyne has 40+ verified MCP servers ready to plug in.",
    date:     "April 10, 2026",
    readMin:  5,
    category: "Integrations",
    icon:     Globe,
  },
  {
    slug:     "rag-without-the-hallucinations",
    title:    "RAG Without the Hallucinations: Building Grounded Agents",
    excerpt:  "Retrieval-Augmented Generation (RAG) lets your agents answer from facts, not imagination. We walk through the exact chunking strategy, embedding model choice, and pgvector cosine-similarity queries that power AgentDyne's native knowledge bases.",
    date:     "April 7, 2026",
    readMin:  9,
    category: "Engineering",
    icon:     Brain,
  },
  {
    slug:     "agent-registry-the-dns-of-intelligence",
    title:    "The Agent Registry: DNS for the Intelligence Layer",
    excerpt:  "Just as DNS maps domain names to IP addresses, an Agent Registry maps task descriptions to capable agents. We explain how AgentDyne's registry uses composite quality scores, capability tags, and routing heuristics to automatically select the best agent for any job.",
    date:     "April 4, 2026",
    readMin:  6,
    category: "Product",
    icon:     TrendingUp,
  },
  {
    slug:     "multi-agent-pipelines-production",
    title:    "Multi-Agent Pipelines in Production: Lessons from 10,000 Runs",
    excerpt:  "After running 10,000 pipeline executions across our beta users, here is what we learned: where timeouts blow up, how to design idempotent nodes, when to use continue_on_failure, and why output schemas matter more than system prompts.",
    date:     "March 31, 2026",
    readMin:  11,
    category: "Engineering",
    icon:     Zap,
  },
  {
    slug:     "prompt-injection-is-the-xss-of-ai",
    title:    "Prompt Injection Is the XSS of AI — and Most Platforms Ignore It",
    excerpt:  "Prompt injection attacks let malicious users override your system prompt, extract secrets, or impersonate the AI. We open-source our 18-pattern injection filter that blocked 4,200 attacks in the first month of production — and explain why regex beats ML for Layer 1 defence.",
    date:     "March 27, 2026",
    readMin:  8,
    category: "Security",
    icon:     Shield,
  },
  {
    slug:     "80-percent-to-builders",
    title:    "Why We Give Builders 80% — And Why It Changes Everything",
    excerpt:  "Most SaaS platforms take 30–50% as a platform fee. We take 20%. The reason is not altruism — it is growth strategy. When builders earn meaningful money from their agents, they invest more in making them excellent. We are betting on that flywheel.",
    date:     "March 22, 2026",
    readMin:  4,
    category: "Business",
    icon:     DollarSign,
  },
  {
    slug:     "cloudflare-edge-vs-vercel",
    title:    "Cloudflare Edge vs Vercel: What We Learned Running AI at the Edge",
    excerpt:  "Cold starts kill agent UX. We migrated from Vercel to Cloudflare Pages (via @cloudflare/next-on-pages) and cut cold start time from 800ms to under 50ms globally. Here is the trade-offs, the worker isolation gotchas, and the in-memory rate-limiter problem we hit.",
    date:     "March 18, 2026",
    readMin:  10,
    category: "Engineering",
    icon:     Globe,
  },
]

const CATEGORY_COLORS: Record<string, string> = {
  Architecture: "bg-violet-50  text-violet-700",
  Integrations: "bg-blue-50    text-blue-700",
  Engineering:  "bg-primary/8  text-primary",
  Product:      "bg-amber-50   text-amber-700",
  Security:     "bg-red-50     text-red-700",
  Business:     "bg-green-50   text-green-700",
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function PostCard({ post, large }: { post: Post; large?: boolean }) {
  const color = CATEGORY_COLORS[post.category] ?? "bg-zinc-100 text-zinc-600"
  const Icon  = post.icon

  return (
    <Link href={`/blog/${post.slug}`}>
      <article className={`group bg-white border border-zinc-100 rounded-2xl overflow-hidden hover:border-zinc-200 hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col h-full ${large ? "lg:flex-row" : ""}`}
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

        {/* Icon banner */}
        <div className={`bg-zinc-50 flex items-center justify-center flex-shrink-0 ${large ? "lg:w-64 h-40 lg:h-auto" : "h-36"}`}>
          <div className="w-14 h-14 rounded-2xl bg-white border border-zinc-100 flex items-center justify-center shadow-sm">
            <Icon className="h-7 w-7 text-zinc-500 group-hover:text-primary transition-colors" />
          </div>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
              {post.category}
            </span>
            <span className="text-[11px] text-zinc-400 flex items-center gap-1">
              <Clock className="h-3 w-3" /> {post.readMin} min read
            </span>
          </div>
          <h2 className={`font-bold text-zinc-900 mb-2 leading-snug group-hover:text-primary transition-colors ${large ? "text-lg" : "text-sm"}`}>
            {post.title}
          </h2>
          <p className="text-xs text-zinc-500 leading-relaxed flex-1 mb-4 line-clamp-3">
            {post.excerpt}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">{post.date}</span>
            <span className="text-xs font-semibold text-primary flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              Read <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual post page (stub — serves the article content inline for now)
// In production, wire to a CMS (Sanity, Contentlayer, or Supabase storage)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Blog index page
// ─────────────────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const featured = POSTS.find(p => p.featured)
  const rest     = POSTS.filter(p => !p.featured)

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* Hero */}
        <div className="relative overflow-hidden bg-zinc-50 border-b border-zinc-100">
          <div className="absolute inset-0 bg-hero pointer-events-none" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
            <div className="inline-flex items-center gap-1.5 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1 rounded-full font-semibold mb-4">
              <TrendingUp className="h-3 w-3" /> AgentDyne Blog
            </div>
            <h1 className="text-4xl font-black tracking-tight text-zinc-900 mb-3">
              Ideas, Engineering &amp; Insights
            </h1>
            <p className="text-zinc-500 text-base max-w-xl">
              Deep dives on AI agents, multi-agent architecture, MCP integrations, and
              building production-grade intelligent systems.
            </p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

          {/* Featured post */}
          {featured && (
            <section className="mb-12">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">
                Featured Article
              </p>
              <PostCard post={featured} large />
            </section>
          )}

          {/* All other posts */}
          <section>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-6">
              Recent Articles
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {rest.map(post => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>
          </section>

          {/* Newsletter CTA */}
          <div className="mt-16 bg-zinc-50 border border-zinc-100 rounded-2xl p-8 text-center">
            <h3 className="text-lg font-bold text-zinc-900 mb-2">Stay in the loop</h3>
            <p className="text-sm text-zinc-500 mb-5 max-w-sm mx-auto">
              New articles on AI agents, architecture, and platform updates — straight to your feed.
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <a href="https://twitter.com/agentdyne" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                Follow @agentdyne
              </a>
              <span className="text-zinc-300">·</span>
              <a href="https://discord.gg/agentdyne" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-600 hover:text-zinc-900">
                Join Discord
              </a>
              <span className="text-zinc-300">·</span>
              <Link href="/changelog" className="text-sm font-semibold text-zinc-600 hover:text-zinc-900">
                Changelog
              </Link>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
