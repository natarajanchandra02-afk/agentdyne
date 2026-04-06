"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Zap, Globe, Shield, BarChart3, Code2, Star, CheckCircle, Bot, Cpu, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { formatNumber } from "@/lib/utils"

const STATS = [
  { label: "Active Agents",  value: 12400 },
  { label: "Developers",     value: 89000 },
  { label: "API Calls/Day",  value: 4200000 },
  { label: "Countries",      value: 127 },
]

const FEATURES = [
  { icon: Zap,       title: "Instant Deployment",    desc: "Publish agents in minutes. Auto-scaled execution with sub-100ms cold starts globally." },
  { icon: Globe,     title: "Global Marketplace",    desc: "Reach developers in 127 countries. Local payment methods, regional pricing built in." },
  { icon: Shield,    title: "Sandboxed & Secure",    desc: "Every agent runs in an isolated sandbox. Full audit logs, compliance tools, SOC2 ready." },
  { icon: BarChart3, title: "Revenue Analytics",     desc: "Real-time earnings dashboard. Track calls, revenue, ratings. Automated monthly payouts." },
  { icon: Code2,     title: "MCP Native",            desc: "40+ verified MCP server integrations. Connect databases, APIs, browsers, and more." },
  { icon: Cpu,       title: "Multi-Model Runtime",   desc: "Claude, GPT-4o, Gemini — run any model. Switch without changing your integration." },
]

const CATEGORIES = [
  { name: "Coding",          emoji: "💻", count: 1840 },
  { name: "Marketing",       emoji: "📣", count: 1230 },
  { name: "Finance",         emoji: "💰", count: 980  },
  { name: "Data Analysis",   emoji: "📊", count: 1100 },
  { name: "Customer Support",emoji: "🎧", count: 760  },
  { name: "Research",        emoji: "🔬", count: 890  },
  { name: "Legal",           emoji: "⚖️",  count: 540  },
  { name: "DevOps",          emoji: "🛠️",  count: 670  },
]

const TESTIMONIALS = [
  { name: "Sarah Chen",    role: "CTO, Finova",   avatar: "SC", text: "AgentDyne cut our AI development time by 80%. We integrated 6 production agents in a single sprint.", stars: 5 },
  { name: "Marcus Okafor", role: "AI Lead",        avatar: "MO", text: "The marketplace quality is unmatched. Every agent we've deployed has been production-ready from day one.", stars: 5 },
  { name: "Priya Sharma",  role: "Founder",        avatar: "PS", text: "Made $12K in my first month as a seller. The platform handles payments, hosting, support — everything.", stars: 5 },
]

function FadeUp({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.div>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-24 md:pt-36 md:pb-32 overflow-hidden">
        {/* Subtle gradient bg */}
        <div className="absolute inset-0 bg-hero pointer-events-none" />
        <div className="absolute inset-0 bg-grid opacity-[0.35] pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <FadeUp>
            <Badge className="mb-6 bg-primary/8 text-primary border-primary/20 text-xs px-3 py-1 font-semibold">
              🚀 40+ MCP integrations · 12,400+ agents live
            </Badge>
            <h1 className="text-[3.25rem] md:text-[5rem] font-black tracking-tighter text-zinc-900 dark:text-white leading-[1.05] mb-6">
              The World's Premier<br />
              <span className="gradient-text">Microagent Marketplace</span>
            </h1>
            <p className="text-xl md:text-2xl text-zinc-500 dark:text-zinc-400 max-w-2xl mx-auto mb-10 font-normal leading-relaxed">
              Discover production-ready AI agents. Deploy in one line of code.
              Earn by publishing your own.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/marketplace">
                <Button size="lg" className="h-12 px-8 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-100 font-semibold text-[15px] shadow-lg">
                  Explore Marketplace <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/builder">
                <Button size="lg" variant="outline" className="h-12 px-8 rounded-2xl border-zinc-200 dark:border-zinc-700 font-semibold text-[15px] hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  Build an Agent
                </Button>
              </Link>
            </div>
          </FadeUp>

          {/* Stats */}
          <FadeUp delay={0.2}>
            <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-100 dark:bg-zinc-800 rounded-3xl overflow-hidden border border-zinc-100 dark:border-zinc-800">
              {STATS.map(stat => (
                <div key={stat.label} className="bg-white dark:bg-zinc-900 px-6 py-8 text-center">
                  <div className="text-3xl md:text-4xl font-black text-zinc-900 dark:text-white nums">
                    {formatNumber(stat.value)}+
                  </div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 font-medium">{stat.label}</div>
                </div>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      <section className="py-24 bg-zinc-50 dark:bg-zinc-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeUp>
            <div className="text-center mb-14">
              <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Platform Features</p>
              <h2 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-white">Everything you need to ship</h2>
              <p className="text-zinc-500 mt-3 max-w-xl mx-auto">Built for enterprise scale, accessible to solo developers.</p>
            </div>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <FadeUp key={f.title} delay={i * 0.07}>
                <div className="bg-white dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700/60 rounded-2xl p-6 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center mb-4">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{f.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── Categories ────────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-2">Browse by Category</p>
              <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Agents for every workflow</h2>
            </div>
            <Link href="/marketplace">
              <Button variant="ghost" className="gap-1 text-primary font-semibold">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CATEGORIES.map((cat, i) => (
              <FadeUp key={cat.name} delay={i * 0.05}>
                <Link href={`/marketplace?category=${cat.name.toLowerCase().replace(" ", "_")}`}>
                  <div className="bg-white dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700/60 rounded-2xl p-5 text-center hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group">
                    <div className="text-3xl mb-3">{cat.emoji}</div>
                    <div className="font-semibold text-zinc-900 dark:text-white text-sm group-hover:text-primary transition-colors">{cat.name}</div>
                    <div className="text-xs text-zinc-400 mt-1">{formatNumber(cat.count)} agents</div>
                  </div>
                </Link>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing Preview ───────────────────────────────────────────── */}
      <section className="py-24 bg-zinc-50 dark:bg-zinc-900/50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <FadeUp>
            <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Simple Pricing</p>
            <h2 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4">Start free, scale infinitely</h2>
            <p className="text-zinc-500 mb-12 max-w-md mx-auto">No hidden fees. Pay for what you use.</p>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { name: "Free",       price: "$0",  period: "/mo", calls: "100 calls/mo",   features: ["All free agents","Playground","Community support"], highlight: false, cta: "Get started free" },
              { name: "Pro",        price: "$79", period: "/mo", calls: "10,000 calls/mo", features: ["All agents","Priority execution","Advanced analytics","API access"], highlight: true,  cta: "Start Pro trial" },
              { name: "Enterprise", price: "Custom", period: "", calls: "Unlimited",       features: ["Custom SLA","Dedicated infra","SSO/SAML","Custom contracts"], highlight: false, cta: "Contact sales" },
            ].map((plan, i) => (
              <FadeUp key={plan.name} delay={i * 0.08}>
                <div className={`rounded-2xl p-7 text-left border relative ${
                  plan.highlight
                    ? "bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white shadow-xl"
                    : "bg-white dark:bg-zinc-800/60 border-zinc-100 dark:border-zinc-700/60"
                }`}>
                  {plan.highlight && (
                    <div className="absolute -top-3 left-6">
                      <Badge className="bg-primary text-white border-0 text-xs shadow-sm">Most Popular</Badge>
                    </div>
                  )}
                  <p className={`font-semibold mb-2 ${plan.highlight ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-500"}`}>{plan.name}</p>
                  <div className={`text-4xl font-black mb-1 ${plan.highlight ? "text-white dark:text-zinc-900" : "text-zinc-900 dark:text-white"}`}>
                    {plan.price}<span className="text-sm font-normal opacity-50">{plan.period}</span>
                  </div>
                  <p className={`text-xs mb-6 ${plan.highlight ? "text-zinc-500 dark:text-zinc-600" : "text-zinc-400"}`}>{plan.calls}</p>
                  <ul className="space-y-2.5 mb-7">
                    {plan.features.map(f => (
                      <li key={f} className={`flex items-center gap-2 text-sm ${plan.highlight ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-600 dark:text-zinc-400"}`}>
                        <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-400" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href={plan.name === "Enterprise" ? "/contact" : "/signup"}>
                    <Button className={`w-full rounded-xl ${
                      plan.highlight
                        ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-100"
                    }`}>
                      {plan.cta}
                    </Button>
                  </Link>
                </div>
              </FadeUp>
            ))}
          </div>
          <p className="mt-8 text-sm text-zinc-400">
            <Link href="/pricing" className="text-primary hover:underline font-medium">View full pricing →</Link>
          </p>
        </div>
      </section>

      {/* ── Testimonials ──────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeUp>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-white">Loved by builders worldwide</h2>
            </div>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <FadeUp key={t.name} delay={i * 0.1}>
                <div className="bg-white dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700/60 rounded-2xl p-6">
                  <div className="flex gap-0.5 mb-4">
                    {Array.from({ length: t.stars }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-5">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-zinc-900 dark:text-white">{t.name}</p>
                      <p className="text-xs text-zinc-400">{t.role}</p>
                    </div>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="py-24 bg-zinc-900 dark:bg-zinc-950">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <FadeUp>
            <h2 className="text-4xl font-black tracking-tight text-white mb-4">Ready to build?</h2>
            <p className="text-zinc-400 text-lg mb-8">Join 89,000+ developers building the AI-native economy.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/signup">
                <Button size="lg" className="h-12 px-8 rounded-2xl bg-white text-zinc-900 hover:bg-zinc-100 font-semibold text-[15px]">
                  Get started free <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/marketplace">
                <Button size="lg" variant="outline" className="h-12 px-8 rounded-2xl border-zinc-700 text-zinc-300 hover:bg-zinc-800 font-semibold text-[15px]">
                  Browse Marketplace
                </Button>
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>

      <Footer />
    </div>
  )
}
