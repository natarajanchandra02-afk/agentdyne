import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import {
  Globe, DollarSign, Zap, Heart, BookOpen, Monitor,
  Users, Brain, MapPin, Clock,
} from "lucide-react"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Careers — AgentDyne" }

const ROLES = [
  { title: "Senior Full-Stack Engineer",  team: "Engineering", location: "Remote (Global)", type: "Full-time", description: "Build and scale the core AgentDyne platform. Work across Next.js, Supabase, and our agent execution runtime.", tags: ["TypeScript", "Next.js", "PostgreSQL", "Supabase"] },
  { title: "AI / ML Engineer",            team: "AI Platform",  location: "Remote (Global)", type: "Full-time", description: "Build the agent execution sandbox, MCP integration layer, and AI model abstraction APIs.", tags: ["Python", "LLMs", "MCP", "Anthropic API"] },
  { title: "Developer Advocate",          team: "Growth",        location: "Remote (Global)", type: "Full-time", description: "Build the developer community. Create tutorials, run workshops, write docs, and be the voice of AgentDyne to the world.", tags: ["Technical Writing", "APIs", "Community", "Content"] },
  { title: "Product Designer",            team: "Design",        location: "Remote (Global)", type: "Full-time", description: "Own the AgentDyne design system and product experience from ideation to pixel-perfect delivery.", tags: ["Figma", "Design Systems", "User Research", "Motion"] },
  { title: "Enterprise Account Executive",team: "Sales",         location: "Remote (US / EU)",type: "Full-time", description: "Close enterprise deals with Fortune 500 companies adopting AgentDyne as their agent deployment platform.", tags: ["B2B SaaS", "Enterprise", "Technical Sales", "CRM"] },
  { title: "Backend Engineer — Payments", team: "Engineering",   location: "Remote (Global)", type: "Full-time", description: "Own all things Stripe — subscriptions, Connect payouts, metered billing, and fraud prevention.", tags: ["Node.js", "Stripe", "PostgreSQL", "Webhooks"] },
]

const PERKS = [
  { icon: Globe,    title: "Fully remote",      desc: "Work from anywhere. We have team members in 14 countries across every timezone." },
  { icon: DollarSign,title: "Competitive equity",desc: "Meaningful equity stake in a high-growth company at an early stage." },
  { icon: Zap,      title: "Move fast",          desc: "Ship weekly. No bureaucracy. Your work has direct user impact from day one." },
  { icon: Heart,    title: "Health benefits",    desc: "Full medical, dental, and vision coverage for you and your family (US/EU)." },
  { icon: BookOpen, title: "Learning budget",    desc: "$2,000/year for courses, conferences, and books." },
  { icon: Monitor,  title: "Home office setup",  desc: "$1,500 one-time budget to set up your ideal workspace." },
  { icon: Users,    title: "Team retreats",      desc: "Twice-yearly in-person team retreats in different cities around the world." },
  { icon: Brain,    title: "AI-first culture",   desc: "Use the latest AI tools freely. We're building the future — we should live in it." },
]

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* Hero */}
        <section className="py-24 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-6">
              <Zap className="h-3.5 w-3.5" /> We're hiring
            </span>
            <h1 className="text-5xl font-black tracking-tighter text-zinc-900 mb-5">
              Build the infrastructure for the{" "}
              <span className="gradient-text">AI-native economy</span>
            </h1>
            <p className="text-xl text-zinc-500 leading-relaxed mb-8">
              We're a small, ambitious team solving hard problems at the intersection of AI, developer tools,
              and marketplaces. Every person here owns something meaningful.
            </p>
            <div className="flex items-center gap-6 text-sm text-zinc-400 flex-wrap">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                {ROLES.length} open roles
              </span>
              <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> 14 countries</span>
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Fully remote</span>
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Series A — 2026</span>
            </div>
          </div>
        </section>

        {/* Perks */}
        <section className="py-16 bg-zinc-50 border-y border-zinc-100">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-8">Why AgentDyne</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {PERKS.map((perk) => (
                <div key={perk.title} className="bg-white border border-zinc-100 rounded-2xl p-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center mb-3">
                    <perk.icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <p className="font-semibold text-sm text-zinc-900 mb-1">{perk.title}</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">{perk.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Open Roles */}
        <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-2">Open Roles</h2>
          <p className="text-zinc-500 text-sm mb-8">All roles are remote-first with flexible hours.</p>
          <div className="space-y-4">
            {ROLES.map((role) => (
              <div key={role.title}
                className="bg-white border border-zinc-100 rounded-2xl p-6 hover:border-primary/20 hover:shadow-md transition-all group"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <h3 className="font-bold text-zinc-900 group-hover:text-primary transition-colors">{role.title}</h3>
                      <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-600 px-2.5 py-0.5 rounded-full">{role.team}</span>
                    </div>
                    <p className="text-sm text-zinc-500 leading-relaxed mb-3">{role.description}</p>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {role.tags.map(tag => (
                          <span key={tag} className="text-xs bg-zinc-50 border border-zinc-100 px-2.5 py-1 rounded-full text-zinc-600 font-mono">{tag}</span>
                        ))}
                      </div>
                      <span className="text-xs text-zinc-400 ml-auto flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{role.location} · {role.type}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <a href={`mailto:careers@agentdyne.com?subject=Application: ${encodeURIComponent(role.title)}&body=Hi AgentDyne team,%0D%0A%0D%0AI'm interested in the ${encodeURIComponent(role.title)} role.%0D%0A%0D%0A[Tell us about yourself and include links to your work]`}>
                      <Button size="sm" className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">Apply</Button>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 p-6 bg-zinc-50 border border-zinc-100 rounded-2xl flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="font-bold text-zinc-900">Don't see your role?</h3>
              <p className="text-sm text-zinc-500 mt-1">We always want to hear from exceptional people.</p>
            </div>
            <a href="mailto:careers@agentdyne.com?subject=Open Application">
              <Button variant="outline" className="rounded-xl border-zinc-200">Send open application</Button>
            </a>
          </div>
        </section>

        {/* Hiring process */}
        <section className="py-16 bg-zinc-50 border-t border-zinc-100">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-4">Our hiring process</h2>
            <p className="text-zinc-500 text-sm mb-10">Fast, transparent, and respectful of your time. Most offers made within 2 weeks.</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-left">
              {[
                { step: "01", title: "Application", desc: "Send your CV and a short note. 48h response guaranteed." },
                { step: "02", title: "Intro call",  desc: "30-min video call with the hiring manager. No trick questions." },
                { step: "03", title: "Take-home",   desc: "A realistic, paid task (2–4 hrs). We compensate your time." },
                { step: "04", title: "Final round", desc: "Meet the founding team. Offer within 48 hours." },
              ].map((s) => (
                <div key={s.step} className="bg-white border border-zinc-100 rounded-2xl p-5"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <span className="text-xs font-black text-primary">{s.step}</span>
                  <h3 className="font-bold text-sm text-zinc-900 mt-1 mb-2">{s.title}</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
