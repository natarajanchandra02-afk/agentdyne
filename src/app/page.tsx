"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Zap, Globe, Shield, BarChart3, Code2, Star, TrendingUp, Play, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { formatNumber } from "@/lib/utils";

const STATS = [
  { label: "Active Agents", value: 12400 },
  { label: "Developers", value: 89000 },
  { label: "API Calls/Day", value: 4200000 },
  { label: "Countries", value: 127 },
];

const FEATURES = [
  { icon: Zap, title: "Instant Deployment", desc: "Publish agents in minutes. Auto-scaled, globally distributed execution with sub-100ms cold starts." },
  { icon: Globe, title: "Global Marketplace", desc: "Reach developers in 127 countries. Multilingual support, local payment methods, regional pricing." },
  { icon: Shield, title: "Sandboxed & Secure", desc: "Every agent runs in an isolated sandbox. Full audit logs, compliance tools, SOC2 ready." },
  { icon: BarChart3, title: "Revenue Analytics", desc: "Real-time earnings dashboard. Track calls, revenue, ratings. Automated monthly payouts." },
  { icon: Code2, title: "MCP Native", desc: "First-class MCP server support. Connect any tool: databases, APIs, file systems, browsers." },
  { icon: Star, title: "Quality Verified", desc: "Human-reviewed agents, automated testing, performance benchmarks. Only the best make it live." },
];

const CATEGORIES = [
  { name: "Coding", emoji: "💻", count: 1840 },
  { name: "Marketing", emoji: "📣", count: 1230 },
  { name: "Finance", emoji: "💰", count: 980 },
  { name: "Data Analysis", emoji: "📊", count: 1100 },
  { name: "Customer Support", emoji: "🎧", count: 760 },
  { name: "Research", emoji: "🔬", count: 890 },
  { name: "Legal", emoji: "⚖️", count: 540 },
  { name: "DevOps", emoji: "🛠️", count: 670 },
];

const TESTIMONIALS = [
  { name: "Sarah Chen", role: "CTO, Finova", avatar: "SC", text: "AgentDyne cut our AI development time by 80%. We integrated 6 agents in a single sprint that would've taken months to build.", rating: 5 },
  { name: "Marcus Okafor", role: "AI Lead, TechCorp", avatar: "MO", text: "The marketplace quality is unmatched. Every agent we've deployed has been production-ready from day one.", rating: 5 },
  { name: "Priya Sharma", role: "Founder, DataFlow", avatar: "PS", text: "As a seller, I made $12K in my first month. The platform handles everything — payments, hosting, support.", rating: 5 },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden pt-24 pb-20 md:pt-32 md:pb-28">
        <div className="absolute inset-0 bg-gradient-dark opacity-60" />
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Badge className="mb-6 bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-sm px-4 py-1.5">
              🚀 Now with MCP v2 support — 12,400+ agents live
            </Badge>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight text-white mb-6">
              The World's Premier{" "}
              <span className="gradient-text">Microagent</span>{" "}
              Marketplace
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Discover production-ready AI agents. Deploy in one line of code.
              Earn revenue by publishing your own. Built for the AI-native economy.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/marketplace">
                <Button size="lg" className="bg-gradient-brand text-white border-0 hover:opacity-90 text-base px-8 h-12 shadow-lg shadow-indigo-500/25">
                  Explore Marketplace <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/builder">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 text-base px-8 h-12">
                  <Play className="mr-2 h-4 w-4" /> Build an Agent
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8"
          >
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl font-black text-white">{formatNumber(stat.value)}+</div>
                <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="mb-4">Platform Features</Badge>
            <h2 className="text-4xl font-black text-white">Everything you need to win</h2>
            <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Built for enterprise scale, accessible to solo developers. No infra headaches.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.1 }} viewport={{ once: true }}
                className="bg-card border border-border rounded-xl p-6 card-hover shine"
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-indigo-400" />
                </div>
                <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-12">
            <div>
              <h2 className="text-3xl font-black text-white">Browse by category</h2>
              <p className="text-muted-foreground mt-2">Agents for every business need</p>
            </div>
            <Link href="/marketplace">
              <Button variant="ghost" className="text-indigo-400">View all <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CATEGORIES.map((cat, i) => (
              <motion.div
                key={cat.name}
                initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: i * 0.05 }} viewport={{ once: true }}
              >
                <Link href={`/marketplace?category=${cat.name.toLowerCase()}`}>
                  <div className="bg-card border border-border rounded-xl p-5 text-center card-hover cursor-pointer group">
                    <div className="text-3xl mb-3">{cat.emoji}</div>
                    <div className="font-medium text-white group-hover:text-indigo-400 transition-colors">{cat.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{formatNumber(cat.count)} agents</div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="mb-4">Simple Pricing</Badge>
            <h2 className="text-4xl font-black text-white">Start free, scale infinitely</h2>
            <p className="text-muted-foreground mt-4">No hidden fees. Pay as you grow.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              { name: "Free", price: "$0", period: "/month", calls: "100 calls/month", features: ["Access to free agents", "Community support", "Basic analytics"], cta: "Get Started", highlighted: false },
              { name: "Pro", price: "$79", period: "/month", calls: "10,000 calls/month", features: ["All premium agents", "Priority execution", "Advanced analytics", "API access", "Priority support"], cta: "Start Pro Trial", highlighted: true },
              { name: "Enterprise", price: "Custom", period: "", calls: "Unlimited calls", features: ["Custom SLA", "Dedicated infra", "SSO / SAML", "Compliance tools", "Custom contracts"], cta: "Contact Sales", highlighted: false },
            ].map((plan) => (
              <div key={plan.name} className={`relative rounded-2xl p-8 ${plan.highlighted ? "bg-gradient-brand text-white shadow-xl shadow-indigo-500/25 scale-105" : "bg-card border border-border"}`}>
                {plan.highlighted && <div className="absolute -top-3 left-1/2 -translate-x-1/2"><Badge className="bg-white text-indigo-600 font-semibold">Most Popular</Badge></div>}
                <div className="font-semibold text-lg mb-2 opacity-80">{plan.name}</div>
                <div className="text-4xl font-black mb-1">{plan.price}<span className="text-sm font-normal opacity-60">{plan.period}</span></div>
                <div className="text-sm opacity-70 mb-6">{plan.calls}</div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 opacity-80 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href={plan.name === "Enterprise" ? "/contact" : "/signup"}>
                  <Button className={`w-full ${plan.highlighted ? "bg-white text-indigo-600 hover:bg-white/90" : ""}`} variant={plan.highlighted ? "default" : "outline"}>
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black text-white">Loved by builders worldwide</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <motion.div key={t.name} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} viewport={{ once: true }}
                className="bg-card border border-border rounded-xl p-6">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: t.rating }).map((_, j) => <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />)}
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-brand flex items-center justify-center text-white text-xs font-bold">{t.avatar}</div>
                  <div>
                    <div className="font-medium text-white text-sm">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-gradient-brand">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <TrendingUp className="h-12 w-12 text-white/80 mx-auto mb-6" />
          <h2 className="text-4xl font-black text-white mb-4">Ready to deploy your first agent?</h2>
          <p className="text-white/70 text-lg mb-8">Join 89,000+ developers building the AI-native economy.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="bg-white text-indigo-600 hover:bg-white/90 font-semibold px-8 h-12">
                Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/marketplace">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 px-8 h-12">
                Browse Marketplace
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
