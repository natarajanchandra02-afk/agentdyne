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

// ✅ Bug fix: replaced fabricated traction numbers with true, verifiable
// facts about the platform itself. "10 Production Agents" and "1 Verified
// Builder" undercut the "global marketplace" pitch sitting right above them
// — a specific, precise-looking number that turns out to be tiny is worse
// for trust than no number at all. These are real architectural facts that
// don't need to wait for traction to be true.
const STATS = [
  { label: "Model Providers",     value: "6",  suffix: "" },
  { label: "MCP Integrations",    value: "40", suffix: "+" },
  { label: "Platform Fee",        value: "20", suffix: "%" },
  { label: "Sandboxed Execution", value: "100",suffix: "%" },
]

const FEATURES = [
  { icon: Zap,      title: "Instant Deployment",  desc: "Publish agents in minutes. Auto-scaled execution with sub-100ms cold starts globally." },
  { icon: Globe,    title: "Global Marketplace",  desc: "Local payment methods and regional pricing built in from day one." },
  { icon: Shield,   title: "Sandboxed & Secure",  desc: "Every agent runs in an isolated sandbox with full audit logs and rate-limited execution." },
  { icon: BarChart3,title: "Revenue Analytics",   desc: "Real-time earnings dashboard. Track calls, revenue, ratings. Automated monthly payouts." },
  { icon: Code2,    title: "MCP Native",          desc: "40+ verified MCP server integrations. Connect databases, APIs, browsers, and more." },
  { icon: Cpu,      title: "Multi-Model Runtime", desc: "Claude, GPT-4o, Gemini — run any model. Switch without changing your integration." },
]

// ✅ Bug fix: removed fabricated per-category counts (1840, 1230, etc.)
// from the rendered UI below. Kept as category metadata in case real counts
// get wired in from the marketplace API later — just not displayed as if
// they were real today.
const CATEGORIES = [
  { name: "Coding",           icon: Code2,        color: "bg-blue-50   text-blue-600",   ring: "group-hover:ring-blue-200"   },
  { name: "Marketing",        icon: Megaphone,    color: "bg-pink-50   text-pink-600",   ring: "group-hover:ring-pink-200"   },
  { name: "Finance",          icon: TrendingUp,   color: "bg-green-50  text-green-600",  ring: "group-hover:ring-green-200"  },
  { name: "Data Analysis",    icon: BarChart3,    color: "bg-indigo-50 text-indigo-600", ring: "group-hover:ring-indigo-200" },
  { name: "Customer Support", icon: Headphones,   color: "bg-cyan-50   text-cyan-600",   ring: "group-hover:ring-cyan-200"   },
  { name: "Research",         icon: FlaskConical, color: "bg-teal-50   text-teal-600",   ring: "group-hover:ring-teal-200"   },
  { name: "Legal",            icon: Scale,        color: "bg-violet-50 text-violet-600", ring: "group-hover:ring-violet-200" },
  { name: "DevOps",           icon: Settings2,    color: "bg-slate-50  text-slate-600",  ring: "group-hover:ring-slate-200"  },
]

const TESTIMONIALS = [
  // ✅ Founder decision: replaced fabricated named testimonials (a specific
  // "$12K in my first month" claim attributed to a named person) with an
  // honest early-stage framing. At this stage, real traction numbers are
  // near zero — a precise-sounding fake quote is a bigger liability than no
  // quote at all if it's ever noticed, and it's the same class of trust
  // issue as the fabricated stats already removed elsewhere. This reframes
  // around what's actually true today (real features, real 20% fee
  // structure, real automation) rather than inventing a softer lie or a new
  // unverified incentive.
  { icon: Zap,      title: "Built by builders, for builders",   text: "We built AgentDyne because publishing an AI agent shouldn't require standing up your own billing, hosting, and support infrastructure. It handles all of that so you can focus on the agent itself." },
  { icon: Shield,   title: "You keep 80% of every sale",         text: "No hidden fees, no surprise deductions. A flat 20% platform fee — the same rate for every seller, from your first sale to your thousandth." },
  { icon: TrendingUp, title: "Early feedback shapes the roadmap", text: "We're in active development and building alongside our first cohort of sellers. If you're an early adopter, your feedback directly shapes what we build next." },
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
    // ✅ Bug fix: removed "trial" language from CTA labels — same false-claim
    // pattern already fixed on /pricing and /signup. Stripe checkout never sets
    // trial_period_days, so "Start free trial" was never true. This is the
    // homepage's own copy of the same CTA logic — third occurrence found.
    if (planKey === "Free")    return { label: "Get started free", href: "/signup" }
    if (planKey === "Starter") return { label: "Get started with Starter", href: "/signup?plan=starter" }
    return { label: "Get started with Pro", href: "/signup?plan=pro" }
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
              40+ MCP integrations · Built for production
            </div>
            <h1 className="text-[3.25rem] md:text-[5rem] font-black tracking-tighter text-zinc-900 leading-[1.05] mb-6">
              Ship AI Agents That<br />
              <span className="gradient-text">Actually Work in Production</span>
            </h1>
            <p className="text-xl md:text-2xl text-zinc-500 max-w-2xl mx-auto mb-10 font-normal leading-relaxed">
              Build once. Run anywhere. Get paid automatically.
              Production-ready AI agents with full observability and cost control.
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
                    {stat.value}{stat.suffix}
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
              // ✅ Bug fix: cta field here was dead code (planCta() below is what
              // actually renders), but still said "Start free trial" / "Start
              // Pro trial" — confusing for anyone editing this later to think
              // trials exist. Corrected to match reality even though unused.
              { name: "Free",       price: "$0",    period: "/mo", calls: "50 lifetime calls",  features: ["Platform agents only", "Playground access", "Community support", "No credit card needed"],  highlight: false, cta: "Get started free" },
              { name: "Starter",    price: "$19",   period: "/mo", calls: "500 calls/month",    features: ["All free + premium agents", "API access", "Pipelines (5 steps)", "Email support"],           highlight: false, cta: "Get started with Starter" },
              { name: "Pro",        price: "$79",   period: "/mo", calls: "5,000 calls/month",  features: ["All agents", "Priority execution", "Full pipelines", "Advanced analytics"],               highlight: true,  cta: "Get started with Pro" },
              { name: "Enterprise", price: "Custom",period: "",    calls: "Unlimited",           features: ["Custom SLA", "Dedicated infra", "SSO / SAML", "Custom contracts"],                       highlight: false, cta: "Contact sales" },
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
              {/* ✅ Bug fix: heading still said "Loved by builders worldwide" —
               * itself a vague, unverifiable trust claim at odds with the
               * honest early-stage reframing applied to the content below it.
               * Updated to match. */}
              <h2 className="text-4xl font-bold tracking-tight text-zinc-900">Built in the open, from day one</h2>
            </div>
          </FadeUp>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* ✅ Bug fix: this render block still referenced the OLD testimonial
             * shape (t.stars, t.avatar, t.name, t.role) after the TESTIMONIALS
             * array itself was updated to the new { icon, title, text } shape.
             * Silently broken — rendered as empty star rows, blank avatar
             * circles, and blank name/role lines, with no error since React
             * just renders undefined as nothing. */}
            {TESTIMONIALS.map((t, i) => (
              <FadeUp key={t.title} delay={i * 0.1}>
                <div className="bg-white border border-zinc-100 rounded-2xl p-6">
                  <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center mb-4">
                    <t.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-semibold text-zinc-900 mb-2">{t.title}</p>
                  <p className="text-sm text-zinc-500 leading-relaxed">{t.text}</p>
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
            <p className="text-zinc-400 text-lg mb-8">Start building for free. No credit card required.</p>
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
