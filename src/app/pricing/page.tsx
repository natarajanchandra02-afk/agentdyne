"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { Check, Zap, ArrowRight, HelpCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"
import type { Metadata } from "next"

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: { monthly: 0, yearly: 0 },
    calls: "100",
    description: "Perfect for exploring and prototyping.",
    cta: "Get started free",
    href: "/signup",
    highlight: false,
    features: [
      { text: "100 agent calls / month", included: true },
      { text: "Access to all free agents", included: true },
      { text: "Playground testing",       included: true },
      { text: "Community support",        included: true },
      { text: "API access",               included: false },
      { text: "Analytics dashboard",      included: false },
      { text: "Priority execution",       included: false },
      { text: "Custom API keys",          included: false },
    ],
  },
  {
    key: "starter",
    name: "Starter",
    price: { monthly: 19, yearly: 15 },
    calls: "1,000",
    description: "For developers building real products.",
    cta: "Start free trial",
    href: "/signup?plan=starter",
    highlight: false,
    features: [
      { text: "1,000 agent calls / month",   included: true },
      { text: "All free + premium agents",   included: true },
      { text: "Playground testing",          included: true },
      { text: "Email support",               included: true },
      { text: "API access",                  included: true },
      { text: "Basic analytics",             included: true },
      { text: "Priority execution",          included: false },
      { text: "Custom API keys",             included: false },
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: { monthly: 79, yearly: 63 },
    calls: "10,000",
    description: "For teams shipping at scale.",
    cta: "Start Pro trial",
    href: "/signup?plan=pro",
    highlight: true,
    features: [
      { text: "10,000 agent calls / month",  included: true },
      { text: "All agents (free + premium)", included: true },
      { text: "Playground testing",          included: true },
      { text: "Priority support",            included: true },
      { text: "Full API access",             included: true },
      { text: "Advanced analytics",          included: true },
      { text: "Priority execution",          included: true },
      { text: "Unlimited API keys",          included: true },
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: { monthly: null, yearly: null },
    calls: "Unlimited",
    description: "Custom contracts for large organisations.",
    cta: "Contact sales",
    href: "/contact",
    highlight: false,
    features: [
      { text: "Unlimited agent calls",      included: true },
      { text: "All agents",                 included: true },
      { text: "Dedicated infrastructure",   included: true },
      { text: "Dedicated account manager",  included: true },
      { text: "Custom SLA & uptime",        included: true },
      { text: "SSO / SAML",                 included: true },
      { text: "On-premise option",          included: true },
      { text: "Custom contracts",           included: true },
    ],
  },
]

const FAQS = [
  { q: "Can I change my plan at any time?",
    a: "Yes — upgrade or downgrade instantly from your billing dashboard. Upgrades take effect immediately; downgrades apply at the end of your current billing period." },
  { q: "What happens if I exceed my monthly quota?",
    a: "Executions will return a 429 error once you hit your limit. You can upgrade your plan at any time to increase your quota. We'll also send an email warning at 80% usage." },
  { q: "Is there a free trial for paid plans?",
    a: "Starter and Pro both come with a 14-day free trial. No credit card required to start." },
  { q: "How does billing work for agent purchases?",
    a: "Per-call agents are billed from your account balance. Subscription agents are billed monthly via Stripe. You receive an invoice for every charge." },
  { q: "What payment methods are accepted?",
    a: "We accept all major credit/debit cards via Stripe, and wire transfers for Enterprise contracts." },
  { q: "How do payouts work for sellers?",
    a: "Sellers receive 80% of every transaction. Payouts are processed monthly via Stripe Connect directly to your bank account." },
]

export default function PricingPage() {
  const [yearly, setYearly] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14">
        {/* Hero */}
        <section className="py-20 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-radial-brand opacity-30" />
          <div className="relative max-w-4xl mx-auto px-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <Badge className="mb-4">Simple, transparent pricing</Badge>
              <h1 className="text-5xl font-black tracking-tighter mb-4">
                Pay for what you <span className="gradient-text">actually use</span>
              </h1>
              <p className="text-xl text-muted-foreground max-w-xl mx-auto mb-8">
                Start free. Scale as you grow. No hidden fees, no surprise charges.
              </p>
              {/* Billing toggle */}
              <div className="inline-flex items-center gap-3 bg-muted rounded-xl p-1">
                <button onClick={() => setYearly(false)}
                  className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", !yearly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                  Monthly
                </button>
                <button onClick={() => setYearly(true)}
                  className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5", yearly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
                  Yearly
                  <Badge variant="success" className="text-[10px] h-4 px-1.5">-20%</Badge>
                </button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Plans */}
        <section className="pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            {PLANS.map((plan, i) => (
              <motion.div key={plan.key}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                className={cn("relative flex flex-col rounded-2xl border p-6", plan.highlight ? "border-primary bg-primary/5 shadow-primary-lg scale-[1.02]" : "border-border bg-card")}>
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground border-0 shadow-sm">Most Popular</Badge>
                  </div>
                )}
                <div className="mb-5">
                  <h3 className="font-bold text-lg">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                  <div className="mt-4">
                    {plan.price.monthly === null ? (
                      <div className="text-3xl font-black">Custom</div>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-black">
                          ${yearly ? plan.price.yearly : plan.price.monthly}
                        </span>
                        <span className="text-muted-foreground text-sm">/mo</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      <Zap className="h-3 w-3 inline mr-1" />{plan.calls} calls / month
                    </p>
                    {yearly && plan.price.monthly && plan.price.monthly > 0 && (
                      <p className="text-xs text-green-500 mt-0.5">Save ${(plan.price.monthly - (plan.price.yearly || 0)) * 12}/year</p>
                    )}
                  </div>
                </div>

                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f.text} className={cn("flex items-center gap-2 text-sm", f.included ? "text-foreground" : "text-muted-foreground line-through")}>
                      {f.included
                        ? <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        : <X className="h-4 w-4 flex-shrink-0 opacity-40" />}
                      {f.text}
                    </li>
                  ))}
                </ul>

                <Link href={plan.href}>
                  <Button className={cn("w-full", plan.highlight ? "bg-gradient-brand text-white border-0" : "")} variant={plan.highlight ? "default" : "outline"}>
                    {plan.cta} {plan.key !== "enterprise" && <ArrowRight className="h-3.5 w-3.5 ml-1.5" />}
                  </Button>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Feature comparison note */}
          <p className="text-center text-sm text-muted-foreground mt-8">
            All plans include: 99.9% uptime SLA, TLS encryption, GDPR compliance, and access to the AgentDyne community.
          </p>
        </section>

        {/* FAQ */}
        <section className="py-20 bg-muted/20 border-t border-border">
          <div className="max-w-3xl mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-black tracking-tight">Frequently asked questions</h2>
            </div>
            <div className="space-y-3">
              {FAQS.map((faq, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }} viewport={{ once: true }}
                  className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm text-foreground">{faq.q}</p>
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{faq.a}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="text-center mt-10">
              <p className="text-muted-foreground text-sm mb-4">Still have questions?</p>
              <Link href="/contact">
                <Button variant="brand">Talk to us</Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
