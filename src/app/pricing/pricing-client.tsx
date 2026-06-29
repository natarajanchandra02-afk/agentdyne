"use client"
export const dynamic = "force-dynamic"

import { useState } from "react"
import Link from "next/link"
import { Check, Zap, ArrowRight, HelpCircle, X, Shield, Users, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SlidingTabs } from "@/components/ui/sliding-tabs"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"

const PLANS = [
  {
    key: "free", name: "Free", price: { monthly: 0, yearly: 0 }, badge: null,
    description: "Explore the platform. No card needed.", highlight: false,
    features: [
      { text: "50 lifetime executions",    ok: true  },
      { text: "Platform agents only",       ok: true  },
      { text: "Playground testing",         ok: true  },
      { text: "Community support",          ok: true  },
      { text: "API access",                 ok: false },
      { text: "Pipelines",                  ok: false },
      { text: "Marketplace publishing",      ok: false },
      { text: "Priority execution",         ok: false },
    ],
    limit: "50 lifetime calls", computeCap: null,
  },
  {
    key: "starter", name: "Starter", price: { monthly: 19, yearly: 15 }, badge: null,
    description: "For developers building real products.", highlight: false,
    features: [
      { text: "500 executions / month",     ok: true  },
      { text: "$10 compute cap / month",    ok: true  },
      { text: "All free + premium agents",  ok: true  },
      { text: "Pipelines (up to 5 steps)",  ok: true  },
      { text: "API access + analytics",     ok: true  },
      { text: "Email support",              ok: true  },
      { text: "Marketplace publishing",      ok: true  },
      { text: "Priority execution",         ok: false },
    ],
    limit: "500 calls / month", computeCap: "$10 / month",
  },
  {
    key: "pro", name: "Pro", price: { monthly: 79, yearly: 63 }, badge: "Most Popular",
    description: "For teams shipping at scale.", highlight: true,
    features: [
      { text: "5,000 executions / month",   ok: true },
      { text: "$50 compute cap / month",    ok: true },
      { text: "All agents",                 ok: true },
      { text: "Full pipelines (unlimited)", ok: true },
      { text: "Full API + analytics",       ok: true },
      { text: "Priority support",           ok: true },
      { text: "Priority execution",         ok: true },
      { text: "Webhooks + unlimited keys",  ok: true },
    ],
    limit: "5,000 calls / month", computeCap: "$50 / month",
  },
  {
    key: "enterprise", name: "Enterprise", price: { monthly: null, yearly: null }, badge: null,
    description: "Custom contracts for large organisations.", highlight: false,
    features: [
      { text: "Unlimited executions",       ok: true },
      { text: "Custom compute cap",         ok: true },
      { text: "All agents",                 ok: true },
      { text: "Dedicated infrastructure",   ok: true },
      { text: "Dedicated account manager",  ok: true },
      { text: "Custom SLA & uptime",        ok: true },
      { text: "SSO / SAML",                 ok: true },
      { text: "On-premise option",          ok: true },
    ],
    limit: "Unlimited", computeCap: "Custom",
  },
]

const FAQS = [
  { q: "What counts as an execution?", a: "Every agent call (single or pipeline step) = 1 execution. Free users get 50 lifetime; paid users reset monthly." },
  { q: "What happens when I hit my compute cap?", a: "Executions stop with a clear error. The cap protects you from runaway costs. Upgrade instantly from your billing dashboard." },
  { q: "Can free users publish agents?", a: "No. Publishing requires Starter or Pro. This keeps marketplace quality high for everyone." },
  { q: "How does the evaluation harness work?", a: "Submitting for review runs your agent on test cases + hidden adversarial tests. Below 70/100 is rejected instantly with feedback. 70–85 goes to review; 85+ is fast-tracked." },
  // ✅ Bug 5 fix: removed false "14-day free trial" claim.
  // The Stripe checkout route never sets trial_period_days so users who signed
  // up expecting a free trial found none. Replaced with accurate copy.
  { q: "Is there a free trial?", a: "The Free plan gives you 50 executions to explore every feature — no credit card needed, no time limit. When you\'re ready to scale, upgrade to Starter or Pro from your billing dashboard at any time." },
  { q: "How do seller payouts work?", a: "Sellers receive 80% of every transaction. Monthly payouts via Stripe Connect directly to your bank." },
]

const TRUST_SIGNALS = [
  { icon: Shield,    label: "Security",     sub: "RLS, TLS 1.3, SOC2-ready"  },
  { icon: Users,     label: "Multi-tenant", sub: "Fully isolated accounts"   },
  { icon: Zap,       label: "Edge runtime", sub: "Global CDN, <100ms p50"    },
  { icon: BarChart3, label: "99.9% uptime", sub: "SLA + public status page"  },
]

function getCtaInfo(planKey: string, isLoggedIn: boolean, currentPlan?: string) {
  if (planKey === "enterprise") return { label: "Contact sales", href: "/contact" }
  if (isLoggedIn) {
    if (currentPlan === planKey) return { label: "Current plan", href: "/billing" }
    if (planKey === "free")      return { label: "Go to dashboard", href: "/dashboard" }
    return { label: planKey === "pro" ? "Upgrade to Pro" : "Upgrade to Starter", href: `/billing?upgrade=${planKey}` }
  }
  if (planKey === "free")    return { label: "Get started free", href: "/signup" }
  if (planKey === "starter") return { label: "Start free trial", href: "/signup?plan=starter" }
  return                            { label: "Start Pro trial",  href: "/signup?plan=pro" }
}

export default function PricingClientPage() {
  const [yearly,  setYearly]  = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const { user, profile } = useUser()
  const isLoggedIn = !!user
  const currentPlan = profile?.subscription_plan

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
              Pay for what you actually use
            </h1>
            <p className="text-xl text-zinc-500 max-w-xl mx-auto mb-10">
              Start free. Scale as you grow. No hidden fees, no surprise charges.
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

        {/* Plans */}
        <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-start">
            {PLANS.map(plan => {
              const { label, href } = getCtaInfo(plan.key, isLoggedIn, currentPlan)
              const isCurrent = isLoggedIn && currentPlan === plan.key
              return (
                <div key={plan.key} className={cn(
                  "relative flex flex-col rounded-2xl border p-6 transition-all",
                  plan.highlight
                    ? "border-zinc-900 bg-zinc-900 shadow-2xl xl:scale-[1.03]"
                    : "border-zinc-100 bg-white hover:border-zinc-200 hover:shadow-md"
                )}>
                  {(plan.badge || isCurrent) && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                      <span className={cn("text-[10px] font-black px-3 py-1 rounded-full shadow-sm whitespace-nowrap",
                        isCurrent ? "bg-green-500 text-white" : "bg-primary text-white")}>
                        {isCurrent ? "Your plan" : plan.badge}
                      </span>
                    </div>
                  )}
                  <div className="mb-5">
                    <h3 className={cn("font-black text-lg", plan.highlight ? "text-white" : "text-zinc-900")}>{plan.name}</h3>
                    <p className={cn("text-xs mt-1", plan.highlight ? "text-zinc-400" : "text-zinc-500")}>{plan.description}</p>
                    <div className="mt-5">
                      {plan.price.monthly === null ? (
                        <div className={cn("text-3xl font-black", plan.highlight ? "text-white" : "text-zinc-900")}>Custom</div>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className={cn("text-4xl font-black", plan.highlight ? "text-white" : "text-zinc-900")}>
                            ${yearly ? plan.price.yearly : plan.price.monthly}
                          </span>
                          {plan.price.monthly > 0 && (
                            <span className={cn("text-sm", plan.highlight ? "text-zinc-400" : "text-zinc-400")}>/mo</span>
                          )}
                        </div>
                      )}
                      {yearly && plan.price.monthly && plan.price.monthly > 0 && (
                        <p className="text-xs text-green-400 mt-0.5 font-semibold">
                          Save ${((plan.price.monthly - (plan.price.yearly || 0)) * 12).toFixed(0)}/year
                        </p>
                      )}
                    </div>
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
                  <Link href={href}>
                    <Button disabled={isCurrent} className={cn("w-full rounded-xl font-bold h-11",
                      isCurrent ? "opacity-50 cursor-default bg-zinc-700 text-zinc-300"
                        : plan.highlight ? "bg-white text-zinc-900 hover:bg-zinc-100"
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
            All plans: GDPR compliant · TLS 1.3 · CCPA · Supabase RLS isolation
          </p>
        </section>

        {/* FAQ */}
        <section className="py-20 bg-zinc-50 border-t border-zinc-100">
          <div className="max-w-3xl mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-black tracking-tight text-zinc-900">Frequently asked questions</h2>
              <p className="text-zinc-500 mt-3">Everything about pricing, limits, and publishing.</p>
            </div>
            <div className="space-y-2">
              {FAQS.map((faq, i) => (
                <div key={i} className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-zinc-50/50 transition-colors"
                    aria-expanded={openFaq === i}>
                    <HelpCircle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                    <p className="font-semibold text-sm text-zinc-900 flex-1">{faq.q}</p>
                    <span className={cn("text-zinc-400 text-xs flex-shrink-0 mt-0.5 transition-transform", openFaq === i && "rotate-180")}>▼</span>
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-4 ml-7">
                      <p className="text-sm text-zinc-500 leading-relaxed">{faq.a}</p>
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
