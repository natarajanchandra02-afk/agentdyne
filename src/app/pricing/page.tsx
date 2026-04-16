"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Zap, ArrowRight, HelpCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"

// ── Plan definitions ─────────────────────────────────────────────────────────

const PLANS = [
  {
    key: "free", name: "Free",
    price: { monthly: 0, yearly: 0 }, calls: "100",
    description: "Perfect for exploring and prototyping.",
    // CTA changes based on auth state — see getHref() below
    highlight: false,
    features: [
      { text: "100 agent calls / month", ok: true },
      { text: "All free agents",         ok: true },
      { text: "Playground testing",      ok: true },
      { text: "Community support",       ok: true },
      { text: "API access",              ok: false },
      { text: "Analytics dashboard",     ok: false },
      { text: "Priority execution",      ok: false },
      { text: "Custom API keys",         ok: false },
    ],
  },
  {
    key: "starter", name: "Starter",
    price: { monthly: 19, yearly: 15 }, calls: "1,000",
    description: "For developers building real products.",
    highlight: false,
    features: [
      { text: "1,000 agent calls / month",  ok: true },
      { text: "All free + premium agents",  ok: true },
      { text: "Playground testing",         ok: true },
      { text: "Email support",              ok: true },
      { text: "API access",                 ok: true },
      { text: "Basic analytics",            ok: true },
      { text: "Priority execution",         ok: false },
      { text: "Custom API keys",            ok: false },
    ],
  },
  {
    key: "pro", name: "Pro",
    price: { monthly: 79, yearly: 63 }, calls: "10,000",
    description: "For teams shipping at scale.",
    highlight: true,
    features: [
      { text: "10,000 agent calls / month", ok: true },
      { text: "All agents",                 ok: true },
      { text: "Playground testing",         ok: true },
      { text: "Priority support",           ok: true },
      { text: "Full API access",            ok: true },
      { text: "Advanced analytics",         ok: true },
      { text: "Priority execution",         ok: true },
      { text: "Unlimited API keys",         ok: true },
    ],
  },
  {
    key: "enterprise", name: "Enterprise",
    price: { monthly: null, yearly: null }, calls: "Unlimited",
    description: "Custom contracts for large organisations.",
    highlight: false,
    features: [
      { text: "Unlimited agent calls",     ok: true },
      { text: "All agents",                ok: true },
      { text: "Dedicated infrastructure",  ok: true },
      { text: "Dedicated account manager", ok: true },
      { text: "Custom SLA & uptime",       ok: true },
      { text: "SSO / SAML",                ok: true },
      { text: "On-premise option",         ok: true },
      { text: "Custom contracts",          ok: true },
    ],
  },
]

const FAQS = [
  { q: "Can I change my plan at any time?",
    a: "Yes — upgrade or downgrade instantly from your billing dashboard. Upgrades take effect immediately; downgrades apply at the end of your current billing period." },
  { q: "What happens if I exceed my monthly quota?",
    a: "Executions will return a 429 error once you hit your limit. You can upgrade at any time. We send an email warning at 80% usage." },
  { q: "Is there a free trial for paid plans?",
    a: "Starter and Pro both come with a 14-day free trial. No credit card required to start." },
  { q: "How does billing work for agent purchases?",
    a: "Per-call agents are billed from your account balance. Subscription agents are billed monthly via Stripe. You receive an invoice for every charge." },
  { q: "What payment methods are accepted?",
    a: "We accept all major credit/debit cards via Stripe, and wire transfers for Enterprise contracts." },
  { q: "How do payouts work for sellers?",
    a: "Sellers receive 80% of every transaction. Payouts are processed monthly via Stripe Connect directly to your bank account." },
]

// Determine where each CTA goes based on plan + auth state
function getCtaInfo(
  planKey: string,
  isLoggedIn: boolean,
  currentPlan?: string,
): { label: string; href: string } {
  if (planKey === "enterprise") return { label: "Contact sales", href: "/contact" }

  if (isLoggedIn) {
    // Already on this plan
    if (currentPlan === planKey) return { label: "Current plan", href: "/billing" }
    // Free plan for logged-in user → go to marketplace to start using it
    if (planKey === "free") return { label: "Go to marketplace", href: "/marketplace" }
    // Paid plans → go straight to billing upgrade
    return { label: planKey === "pro" ? "Upgrade to Pro" : "Upgrade to Starter", href: `/billing?upgrade=${planKey}` }
  }

  // Logged out
  if (planKey === "free")    return { label: "Get started free",  href: "/signup" }
  if (planKey === "starter") return { label: "Start free trial",  href: "/signup?plan=starter" }
  return { label: "Start Pro trial", href: "/signup?plan=pro" }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [yearly, setYearly] = useState(false)
  const { user, profile }   = useUser()
  const isLoggedIn          = !!user
  const currentPlan         = profile?.subscription_plan

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* Hero */}
        <section className="py-20 text-center bg-zinc-50 border-b border-zinc-100">
          <div className="max-w-4xl mx-auto px-4">
            <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
              <Zap className="h-3.5 w-3.5" /> Simple, transparent pricing
            </div>
            <h1 className="text-5xl font-black tracking-tighter text-zinc-900 mb-4">
              Pay for what you <span className="gradient-text">actually use</span>
            </h1>
            <p className="text-xl text-zinc-500 max-w-xl mx-auto mb-8">
              Start free. Scale as you grow. No hidden fees, no surprise charges.
            </p>
            {/* Monthly / yearly toggle */}
            <div className="inline-flex items-center gap-1 bg-white border border-zinc-200 rounded-xl p-1 shadow-sm">
              <button onClick={() => setYearly(false)}
                className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                  !yearly ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
                Monthly
              </button>
              <button onClick={() => setYearly(true)}
                className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2",
                  yearly ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
                Yearly
                <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                  -20%
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Plan cards */}
        <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            {PLANS.map((plan) => {
              const { label, href } = getCtaInfo(plan.key, isLoggedIn, currentPlan)
              const isCurrent = isLoggedIn && currentPlan === plan.key

              return (
                <div key={plan.key}
                  className={cn(
                    "relative flex flex-col rounded-2xl border p-6 transition-all",
                    plan.highlight
                      ? "border-zinc-900 bg-zinc-900 shadow-xl scale-[1.02]"
                      : "border-zinc-100 bg-white hover:border-zinc-200 hover:shadow-md"
                  )}
                  style={{ boxShadow: plan.highlight ? undefined : "0 1px 3px rgba(0,0,0,0.04)" }}>

                  {plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-primary text-white text-[10px] font-bold px-3 py-0.5 rounded-full shadow-sm">
                        Most Popular
                      </span>
                    </div>
                  )}

                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-green-500 text-white text-[10px] font-bold px-3 py-0.5 rounded-full shadow-sm">
                        Your plan
                      </span>
                    </div>
                  )}

                  {/* Price */}
                  <div className="mb-5">
                    <h3 className={cn("font-bold text-lg", plan.highlight ? "text-white" : "text-zinc-900")}>
                      {plan.name}
                    </h3>
                    <p className={cn("text-xs mt-1", plan.highlight ? "text-zinc-400" : "text-zinc-500")}>
                      {plan.description}
                    </p>
                    <div className="mt-4">
                      {plan.price.monthly === null ? (
                        <div className={cn("text-3xl font-black", plan.highlight ? "text-white" : "text-zinc-900")}>
                          Custom
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className={cn("text-4xl font-black nums", plan.highlight ? "text-white" : "text-zinc-900")}>
                            ${yearly ? plan.price.yearly : plan.price.monthly}
                          </span>
                          <span className={cn("text-sm", plan.highlight ? "text-zinc-400" : "text-zinc-400")}>/mo</span>
                        </div>
                      )}
                      <p className={cn("text-xs mt-1 flex items-center gap-1", plan.highlight ? "text-zinc-400" : "text-zinc-400")}>
                        <Zap className="h-3 w-3" />
                        {plan.calls} calls / month
                      </p>
                      {yearly && plan.price.monthly && plan.price.monthly > 0 && (
                        <p className="text-xs text-green-400 mt-0.5 nums">
                          Save ${((plan.price.monthly - (plan.price.yearly || 0)) * 12).toFixed(0)}/year
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2.5 flex-1 mb-6">
                    {plan.features.map(f => (
                      <li key={f.text}
                        className={cn("flex items-center gap-2 text-sm",
                          f.ok
                            ? plan.highlight ? "text-zinc-300" : "text-zinc-700"
                            : "text-zinc-300 line-through")}>
                        {f.ok
                          ? <Check className="h-4 w-4 text-green-400 flex-shrink-0" />
                          : <X className="h-4 w-4 flex-shrink-0 opacity-30" />}
                        {f.text}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Link href={href}>
                    <Button
                      disabled={isCurrent}
                      className={cn("w-full rounded-xl font-semibold",
                        isCurrent
                          ? "opacity-50 cursor-default bg-zinc-700 text-zinc-300"
                          : plan.highlight
                          ? "bg-white text-zinc-900 hover:bg-zinc-100"
                          : "bg-zinc-900 text-white hover:bg-zinc-700"
                      )}>
                      {label}
                      {!isCurrent && plan.key !== "enterprise" && <ArrowRight className="h-3.5 w-3.5 ml-1.5" />}
                    </Button>
                  </Link>
                </div>
              )
            })}
          </div>

          <p className="text-center text-sm text-zinc-400 mt-8">
            All plans include: 99.9% uptime SLA · TLS encryption · GDPR compliance · Community access
          </p>
        </section>

        {/* FAQ */}
        <section className="py-20 bg-zinc-50 border-t border-zinc-100">
          <div className="max-w-3xl mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-black tracking-tight text-zinc-900">Frequently asked questions</h2>
            </div>
            <div className="space-y-3">
              {FAQS.map((faq, i) => (
                <div key={i} className="bg-white border border-zinc-100 rounded-2xl p-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <HelpCircle className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-zinc-900">{faq.q}</p>
                      <p className="text-sm text-zinc-500 mt-2 leading-relaxed">{faq.a}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-center mt-10">
              <p className="text-zinc-400 text-sm mb-4">Still have questions?</p>
              <Link href="/contact">
                <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
                  Talk to us
                </Button>
              </Link>
            </div>
          </div>
        </section>

      </div>
      <Footer />
    </div>
  )
}
