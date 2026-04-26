"use client"
export const dynamic = 'force-dynamic'

import { useState } from "react"
import Link from "next/link"
import { Check, Zap, ArrowRight, HelpCircle, X, Shield, Users, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SlidingTabs } from "@/components/ui/sliding-tabs"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"
import { PLAN_QUOTAS, PLAN_COMPUTE_CAPS } from "@/lib/constants"

// ── Plan definitions — ALIGNED with constants.ts + spec ──────────────────────
// Free: 50 lifetime executions, no pipelines, no publishing, no API
// Starter: $19/mo — 500 exec, $10 cap, pipelines (3-5 steps), API, marketplace
// Pro: $79/mo — 5,000 exec, $50 cap, full pipelines, priority, webhooks + analytics
// Enterprise: custom

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: { monthly: 0, yearly: 0 },
    badge: null,
    description: "Explore the platform. No card needed.",
    highlight: false,
    features: [
      { text: "50 lifetime executions",      ok: true  },
      { text: "Platform agents only",         ok: true  },
      { text: "Playground testing",           ok: true  },
      { text: "Community support",            ok: true  },
      { text: "API access",                   ok: false },
      { text: "Pipelines",                    ok: false },
      { text: "Marketplace publishing",        ok: false },
      { text: "Priority execution",           ok: false },
    ],
    limit: "50 lifetime calls",
    computeCap: null,
  },
  {
    key: "starter",
    name: "Starter",
    price: { monthly: 19, yearly: 15 },
    badge: null,
    description: "For developers building real products.",
    highlight: false,
    features: [
      { text: "500 executions / month",       ok: true  },
      { text: "$10 compute cap / month",      ok: true  },
      { text: "All free + premium agents",    ok: true  },
      { text: "Pipelines (up to 5 steps)",    ok: true  },
      { text: "API access + basic analytics", ok: true  },
      { text: "Email support",                ok: true  },
      { text: "Marketplace publishing",        ok: true  },
      { text: "Priority execution",           ok: false },
    ],
    limit: "500 calls / month",
    computeCap: "$10 / month",
  },
  {
    key: "pro",
    name: "Pro",
    price: { monthly: 79, yearly: 63 },
    badge: "Most Popular",
    description: "For teams shipping at scale.",
    highlight: true,
    features: [
      { text: "5,000 executions / month",     ok: true },
      { text: "$50 compute cap / month",      ok: true },
      { text: "All agents",                   ok: true },
      { text: "Full pipelines (unlimited)",   ok: true },
      { text: "Full API + advanced analytics",ok: true },
      { text: "Priority support",             ok: true },
      { text: "Priority execution",           ok: true },
      { text: "Webhooks + unlimited API keys",ok: true },
    ],
    limit: "5,000 calls / month",
    computeCap: "$50 / month",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: { monthly: null, yearly: null },
    badge: null,
    description: "Custom contracts for large organisations.",
    highlight: false,
    features: [
      { text: "Unlimited executions",         ok: true },
      { text: "Custom compute cap",           ok: true },
      { text: "All agents",                   ok: true },
      { text: "Dedicated infrastructure",     ok: true },
      { text: "Dedicated account manager",    ok: true },
      { text: "Custom SLA & uptime",          ok: true },
      { text: "SSO / SAML",                   ok: true },
      { text: "On-premise option",            ok: true },
    ],
    limit: "Unlimited",
    computeCap: "Custom",
  },
]

const FAQS = [
  {
    q: "What counts as a 'free' execution on the free plan?",
    a: "Every agent call (single agent or pipeline step) counts as one execution. Free users get 50 total, lifetime — not per month. Once used, you need to upgrade.",
  },
  {
    q: "What happens when I hit my compute cap?",
    a: "Executions stop with a clear error message. The cap protects you from runaway costs. You can upgrade instantly from your billing dashboard or wait for the next billing cycle.",
  },
  {
    q: "Can free users publish agents to the marketplace?",
    a: "No. Free users can create, test, and iterate privately — but marketplace publishing requires a Starter or Pro plan. This keeps quality high for everyone.",
  },
  {
    q: "How does the evaluation harness work before publishing?",
    a: "When you submit for review, we auto-run your agent on your test cases plus our hidden adversarial tests. Agents scoring below 70/100 are rejected instantly with detailed feedback. 70–85 goes to human review; above 85 is fast-tracked.",
  },
  {
    q: "Is there a free trial for paid plans?",
    a: "Starter and Pro both come with a 14-day free trial. No credit card required to start.",
  },
  {
    q: "How does billing work for per-call agents?",
    a: "Per-call agents are charged from your account balance at the listed price. Subscription agents bill monthly via Stripe. You receive an invoice for every charge.",
  },
  {
    q: "How do payouts work for sellers?",
    a: "Sellers receive 80% of every transaction. Payouts are processed monthly via Stripe Connect directly to your bank account. You must have a Starter or Pro plan to monetise agents.",
  },
  {
    q: "What's the margin model — do you mark up AI costs?",
    a: "Yes, transparently. We charge 3× the raw AI inference cost, plus overhead factors for RAG (+10%), pipelines (+50%), and tool calls (+15%). This covers infrastructure, failed runs, and the platform. Sellers set their own prices on top.",
  },
]

const TRUST_SIGNALS = [
  { icon: Shield,    label: "Security",      sub: "RLS, TLS, SOC2-ready"  },
  { icon: Users,     label: "Multi-tenant",  sub: "Fully isolated accounts" },
  { icon: Zap,       label: "Edge runtime",  sub: "Global CDN, <100ms p50"  },
  { icon: BarChart3, label: "99.9% uptime",  sub: "SLA + status page"       },
]

function getCtaInfo(planKey: string, isLoggedIn: boolean, currentPlan?: string): { label: string; href: string } {
  if (planKey === "enterprise") return { label: "Contact sales", href: "/contact" }
  if (isLoggedIn) {
    if (currentPlan === planKey) return { label: "Current plan",    href: "/billing" }
    if (planKey === "free")      return { label: "Go to dashboard", href: "/dashboard" }
    return { label: planKey === "pro" ? "Upgrade to Pro" : "Upgrade to Starter", href: `/billing?upgrade=${planKey}` }
  }
  if (planKey === "free")    return { label: "Get started free", href: "/signup" }
  if (planKey === "starter") return { label: "Start free trial",  href: "/signup?plan=starter" }
  return                            { label: "Start Pro trial",   href: "/signup?plan=pro" }
}

export default function PricingPage() {
  const [yearly,  setYearly]  = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const { user, profile } = useUser()
  const isLoggedIn        = !!user
  const currentPlan       = profile?.subscription_plan

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* Hero */}
        <section className="py-20 text-center bg-zinc-50 border-b border-zinc-100">
          <div className="max-w-4xl mx-auto px-4">
            <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-6">
              <Zap className="h-3.5 w-3.5" /> Simple, transparent pricing
            </div>
            <h1 className="text-5xl font-black tracking-tighter text-zinc-900 mb-4">
              Pay for what you <span className="gradient-text">actually use</span>
            </h1>
            <p className="text-xl text-zinc-500 max-w-xl mx-auto mb-10">
              Start free. Scale as you grow. No hidden fees, no surprise charges.
              Free users get 50 lifetime calls to explore the platform.
            </p>
            <SlidingTabs
              variant="pill"
              bg="bg-white border border-zinc-200 shadow-sm"
              tabs={[
                { id: "monthly", label: "Monthly" },
                { id: "yearly",  label: "Yearly · Save 20%" },
              ]}
              active={yearly ? "yearly" : "monthly"}
              onChange={id => setYearly(id === "yearly")}
            />
          </div>
        </section>

        {/* Plan cards */}
        <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-start">
            {PLANS.map(plan => {
              const { label, href } = getCtaInfo(plan.key, isLoggedIn, currentPlan)
              const isCurrent       = isLoggedIn && currentPlan === plan.key

              return (
                <div key={plan.key}
                  className={cn(
                    "relative flex flex-col rounded-2xl border p-6 transition-all",
                    plan.highlight
                      ? "border-zinc-900 bg-zinc-900 shadow-2xl xl:scale-[1.03]"
                      : "border-zinc-100 bg-white hover:border-zinc-200 hover:shadow-md"
                  )}
                  style={{ boxShadow: plan.highlight ? "0 20px 60px rgba(0,0,0,0.15)" : "0 1px 3px rgba(0,0,0,0.04)" }}>

                  {(plan.badge || isCurrent) && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                      <span className={cn("text-[10px] font-black px-3 py-1 rounded-full shadow-sm whitespace-nowrap",
                        isCurrent ? "bg-green-500 text-white" : "bg-primary text-white")}>
                        {isCurrent ? "Your plan" : plan.badge}
                      </span>
                    </div>
                  )}

                  {/* Plan name + description */}
                  <div className="mb-5">
                    <h3 className={cn("font-black text-lg tracking-tight", plan.highlight ? "text-white" : "text-zinc-900")}>{plan.name}</h3>
                    <p className={cn("text-xs mt-1 leading-relaxed", plan.highlight ? "text-zinc-400" : "text-zinc-500")}>{plan.description}</p>

                    {/* Price */}
                    <div className="mt-5">
                      {plan.price.monthly === null ? (
                        <div className={cn("text-3xl font-black", plan.highlight ? "text-white" : "text-zinc-900")}>Custom</div>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className={cn("text-4xl font-black nums", plan.highlight ? "text-white" : "text-zinc-900")}>
                            ${yearly ? plan.price.yearly : plan.price.monthly}
                          </span>
                          {plan.price.monthly > 0 && (
                            <span className={cn("text-sm", plan.highlight ? "text-zinc-400" : "text-zinc-400")}>/mo</span>
                          )}
                        </div>
                      )}
                      {yearly && plan.price.monthly && plan.price.monthly > 0 && (
                        <p className="text-xs text-green-400 mt-0.5 nums font-semibold">
                          Save ${((plan.price.monthly - (plan.price.yearly || 0)) * 12).toFixed(0)}/year
                        </p>
                      )}
                    </div>

                    {/* Usage + compute cap pills */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1",
                        plan.highlight ? "bg-zinc-800 text-zinc-300" : "bg-zinc-50 text-zinc-600 border border-zinc-100")}>
                        <Zap className="h-3 w-3" /> {plan.limit}
                      </span>
                      {plan.computeCap && (
                        <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1",
                          plan.highlight ? "bg-zinc-800 text-zinc-300" : "bg-zinc-50 text-zinc-600 border border-zinc-100")}>
                          <Shield className="h-3 w-3" /> Cap: {plan.computeCap}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2.5 flex-1 mb-6">
                    {plan.features.map(f => (
                      <li key={f.text} className={cn("flex items-start gap-2 text-sm",
                        f.ok
                          ? plan.highlight ? "text-zinc-300" : "text-zinc-700"
                          : "text-zinc-300 line-through decoration-zinc-200")}>
                        {f.ok
                          ? <Check className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
                          : <X    className="h-4 w-4 flex-shrink-0 mt-0.5 opacity-25" />}
                        {f.text}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Link href={href}>
                    <Button disabled={isCurrent}
                      className={cn("w-full rounded-xl font-bold h-11",
                        isCurrent
                          ? "opacity-50 cursor-default bg-zinc-700 text-zinc-300"
                          : plan.highlight
                          ? "bg-white text-zinc-900 hover:bg-zinc-100"
                          : "bg-zinc-900 text-white hover:bg-zinc-700")}>
                      {label}
                      {!isCurrent && plan.key !== "enterprise" && <ArrowRight className="h-3.5 w-3.5 ml-1.5" />}
                    </Button>
                  </Link>
                </div>
              )
            })}
          </div>

          {/* Trust signals */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
            {TRUST_SIGNALS.map(t => (
              <div key={t.label} className="flex items-center gap-3 bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-zinc-100 flex items-center justify-center flex-shrink-0">
                  <t.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-900">{t.label}</p>
                  <p className="text-[11px] text-zinc-400">{t.sub}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-zinc-400 mt-6">
            All plans: GDPR compliant · TLS 1.3 encryption · CCPA · Supabase RLS data isolation
          </p>
        </section>

        {/* FAQ */}
        <section className="py-20 bg-zinc-50 border-t border-zinc-100">
          <div className="max-w-3xl mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-black tracking-tight text-zinc-900">Frequently asked questions</h2>
              <p className="text-zinc-500 mt-3">Everything you need to know about pricing, limits, and publishing.</p>
            </div>
            <div className="space-y-2">
              {FAQS.map((faq, i) => (
                <div key={i} className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-zinc-50/50 transition-colors">
                    <div className="w-5 h-5 rounded-md bg-primary/8 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <HelpCircle className="h-3 w-3 text-primary" />
                    </div>
                    <p className="font-semibold text-sm text-zinc-900 flex-1">{faq.q}</p>
                    <span className={cn("text-zinc-400 text-xs flex-shrink-0 mt-0.5 transition-transform", openFaq === i && "rotate-180")}>▼</span>
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-4 pt-0">
                      <div className="ml-8">
                        <p className="text-sm text-zinc-500 leading-relaxed">{faq.a}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-center mt-10">
              <p className="text-zinc-400 text-sm mb-4">Still have questions?</p>
              <Link href="/contact">
                <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">Talk to us</Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
