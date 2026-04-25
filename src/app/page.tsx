"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import {
  ArrowRight, Zap, Globe, Shield, BarChart3, Code2, Cpu,
  Star, CheckCircle,
  Megaphone, TrendingUp, Headphones,
  FlaskConical, Scale, Settings2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { useUser } from "@/hooks/use-user"
import { formatNumber } from "@/lib/utils"

const STATS = [
  { label: "Active Agents", value: 12400 },
  { label: "Developers",    value: 89000 },
  { label: "API Calls/Day", value: 4200000 },
  { label: "Countries",     value: 127 },
]

const FEATURES = [
  { icon: Zap,      title: "Instant Deployment",  desc: "Publish agents in minutes. Auto-scaled execution with sub-100ms cold starts globally." },
  { icon: Globe,    title: "Global Marketplace",  desc: "Reach developers in 127 countries. Local payment methods, regional pricing built in." },
  { icon: Shield,   title: "Sandboxed & Secure",  desc: "Every agent runs in an isolated sandbox. Full audit logs, compliance tools, SOC2 ready." },
  { icon: BarChart3,title: "Revenue Analytics",   desc: "Real-time earnings dashboard. Track calls, revenue, ratings. Automated monthly payouts." },
  { icon: Code2,    title: "MCP Native",          desc: "40+ verified MCP server integrations. Connect databases, APIs, browsers, and more." },
  { icon: Cpu,      title: "Multi-Model Runtime", desc: "Claude, GPT-4o, Gemini — run any model. Switch without changing your integration." },
]

const CATEGORIES = [
  { name: "Coding",           icon: Code2,    count: 1840, color: "bg-blue-50   text-blue-600",   ring: "group-hover:ring-blue-200"   },
  { name: "Marketing",        icon: Megaphone,     count: 1230, color: "bg-pink-50   text-pink-600",   ring: "group-hover:ring-pink-200"   },
  { name: "Finance",          icon: TrendingUp,    count: 980,  color: "bg-green-50  text-green-600",  ring: "group-hover:ring-green-200"  },
  { name: "Data Analysis",    icon: BarChart3,     count: 1100, color: "bg-indigo-50 text-indigo-600", ring: "group-hover:ring-indigo-200" },
  { name: "Customer Support", icon: Headphones,    count: 760,  color: "bg-cyan-50   text-cyan-600",   ring: "group-hover:ring-cyan-200"   },
  { name: "Research",         icon: FlaskConical,  count: 890,  color: "bg-teal-50   text-teal-600",   ring: "group-hover:ring-teal-200"   },
  { name: "Legal",            icon: Scale,         count: 540,  color: "bg-violet-50 text-violet-600", ring: "group-hover:ring-violet-200" },
  { name: "DevOps",           icon: Settings2,     count: 670,  color: "bg-slate-50  text-slate-600",  ring: "group-hover:ring-slate-200"  },
]

const TESTIMONIALS = [
  { name: "Sarah Chen",    role: "CTO, Finova",  avatar: "SC", text: "AgentDyne cut our AI development time by 80%. We integrated 6 production agents in a single sprint.", stars: 5 },
  { name: "Marcus Okafor", role: "AI Lead",       avatar: "MO", text: "The marketplace quality is unmatched. Every agent we've deployed has been production-ready from day one.", stars: 5 },
  { name: "Priya Sharma",  role: "Founder",       avatar: "PS", text: "Made $12K in my first month as a seller. The platform handles payments, hosting, support — everything.", stars: 5 },
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
  const { user, profile } = useUser()
  const isLoggedIn = !!user
  const currentPlan = profile?.subscription_plan

  // Returns the correct CTA label + href based on plan + auth state
  function planCta(planKey: string): { label: string; href: string } {
    if (planKey === "Enterprise") return { label: "Contact sales", href: "/contact" }
    if (isLoggedIn) {
      if (currentPlan === planKey.toLowerCase())
        return { label: "Your current plan", href: "/billing" }
      if (planKey === "Free")
        return { label: "Go to marketplace", href: "/marketplace" }
      return { label: `Upgrade to ${planKey}`, href: `/billing?upgrade=${planKey.toLowerCase()}` }
    }
    if (planKey === "Free")    return { label: "Get started free", href: "/signup" }
    if (planKey === "Starter") return { label: "Start free trial", href: "/signup?plan=starter" }
    return { label: "Start Pro trial", href: "/signup?plan=pro" }
  }
  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-28 pb-24 md:pt-36 md:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-hero pointer-events-none" />
        <div className="absolute inset-0 bg-grid opacity-[0.35] pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <FadeUp>
            <div className="inline-flex items-center gap-2 mb-6 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold">
              <Zap className="h-3.5 w-3.5" />
              40+ MCP integrations · 12,400+ agents live
            </div>
            <h1 className="text-[3.25rem] md:text-[5rem] font-black tracking-tighter text-zinc-900 leading-[1.05] mb-6">
              The World's Premier<br />
              <span className="gradient-text">Microagent Marketplace</span>
            </h1>
            <p className="text-xl md:text-2xl text-zinc-500 max-w-2xl mx-auto mb-10 font-normal leading-relaxed">
              Discover production-ready AI agents. Deploy in one line of code.
              Earn by publishing your own.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/marketplace">
                <Button size="lg" className="h-12 px-8 rounded-2xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold text-[15px] shadow-md">
                  Explore Marketplace <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/builder">
                <Button size="lg" variant="outline" className="h-12 px-8 rounded-2xl border-zinc-200 font-semibold text-[15px] hover:bg-zinc-50">
                  Build an Agent
                </Button>
              </Link>
            </div>
          </FadeUp>

          {/* Stats */}
          <FadeUp delay={0.2}>
            <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-100 rounded-3xl overflow-hidden border border-zinc-100">
              {STATS.map(stat => (
                <div key={stat.label} className="bg-white px-6 py-8 text-center">
                  <div className="text-3xl md:text-4xl font-black text-zinc-900 nums">
                    {formatNumber(stat.value)}+
                  </div>
                  <div className="text-sm text-zinc-500 mt-1 font-medium">{stat.label}</div>
                </div>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-zinc-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeUp>
            <div className="text-center mb-14">
              <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Platform Features</p>
              <h2 className="text-4xl font-bold tracking-tight text-zinc-900">Everything you need to ship</h2>
              <p className="text-zinc-500 mt-3 max-w-xl mx-auto">Built for enterprise scale, accessible to solo developers.</p>
            </div>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <FadeUp key={f.title} delay={i * 0.07}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-6 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center mb-4">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-zinc-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-2">Browse by Category</p>
              <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Agents for every workflow</h2>
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
                <Link href={`/marketplace?category=${cat.name.toLowerCase().replace(/ /g, "_")}`}>
                  <div className="bg-white border border-zinc-100 rounded-2xl p-5 text-center hover:border-primary/20 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group">
                    <div className={`w-12 h-12 rounded-2xl ${cat.color} flex items-center justify-center mx-auto mb-3 transition-all ring-2 ring-transparent ${cat.ring}`}>
                      <cat.icon className="h-5 w-5" />
                    </div>
                    <div className="font-semibold text-zinc-900 text-sm group-hover:text-primary transition-colors">{cat.name}</div>
                    <div className="text-xs text-zinc-400 mt-1">{formatNumber(cat.count)} agents</div>
                  </div>
                </Link>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 bg-zinc-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <FadeUp>
            <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Simple Pricing</p>
            <h2 className="text-4xl font-bold tracking-tight text-zinc-900 mb-4">Start free, scale infinitely</h2>
            <p className="text-zinc-500 mb-12 max-w-md mx-auto">No hidden fees. Pay for what you use.</p>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {[
              { name: "Free",       price: "$0",     period: "/mo", calls: "100 calls/mo",    features: ["All free agents", "Playground access", "Community support"], highlight: false, cta: "Get started free" },
              { name: "Starter",    price: "$19",    period: "/mo", calls: "1,000 calls/mo", features: ["All free agents", "API access", "Basic analytics", "Email support"], highlight: false, cta: "Start free trial" },
              { name: "Pro",        price: "$79",    period: "/mo", calls: "10,000 calls/mo", features: ["All agents", "Priority execution", "Advanced analytics", "API access"], highlight: true, cta: "Start Pro trial" },
              { name: "Enterprise", price: "Custom", period: "",    calls: "Unlimited",        features: ["Custom SLA", "Dedicated infra", "SSO / SAML", "Custom contracts"], highlight: false, cta: "Contact sales" },
            ].map((plan, i) => (
            <FadeUp key={plan.name} delay={i * 0.08}>
            <div className={`rounded-2xl p-7 text-left border relative ${
            plan.highlight
            ? "bg-zinc-900 border-zinc-900 shadow-xl"
            : "bg-white border-zinc-100"
            }`}>
            {plan.highlight && (
            <div className="absolute -top-3 left-6">
            <span className="bg-primary text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm">Most Popular</span>
            </div>
            )}
            <p className={`font-semibold mb-2 text-sm ${plan.highlight ? "text-zinc-400" : "text-zinc-500"}`}>{plan.name}</p>
            <div className={`text-4xl font-black mb-1 ${plan.highlight ? "text-white" : "text-zinc-900"}`}>
            {plan.price}<span className="text-sm font-normal opacity-40">{plan.period}</span>
            </div>
            <p className={`text-xs mb-6 ${plan.highlight ? "text-zinc-500" : "text-zinc-400"}`}>{plan.calls}</p>
            <ul className="space-y-2.5 mb-7">
            {plan.features.map(f => (
            <li key={f} className={`flex items-center gap-2 text-sm ${plan.highlight ? "text-zinc-300" : "text-zinc-600"}`}>
            <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-400" />
            {f}
            </li>
            ))}
            </ul>
            {(() => {
            const { label, href } = planCta(plan.name)
            return (
            <Link href={href}>
            <Button className={`w-full rounded-xl font-semibold ${
                  plan.highlight
                  ? "bg-white text-zinc-900 hover:bg-zinc-100"
                    : "bg-zinc-900 text-white hover:bg-zinc-700"
                  }`}>
                      {label}
                      </Button>
                      </Link>
                    )
                  })()}
                </div>
              </FadeUp>
            ))}
          </div>
          <p className="mt-8 text-sm text-zinc-400">
            <Link href="/pricing" className="text-primary hover:underline font-medium">View full pricing details →</Link>
          </p>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeUp>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold tracking-tight text-zinc-900">Loved by builders worldwide</h2>
            </div>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <FadeUp key={t.name} delay={i * 0.1}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-6">
                  <div className="flex gap-0.5 mb-4">
                    {Array.from({ length: t.stars }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-sm text-zinc-600 leading-relaxed mb-5">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-zinc-900">{t.name}</p>
                      <p className="text-xs text-zinc-400">{t.role}</p>
                    </div>
                  </div>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-zinc-900">
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
