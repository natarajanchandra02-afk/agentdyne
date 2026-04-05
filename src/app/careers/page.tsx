import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Careers — AgentDyne" }

const ROLES = [
  {
    title: "Senior Full-Stack Engineer",
    team: "Engineering",
    location: "Remote (Global)",
    type: "Full-time",
    description: "Build and scale the core AgentDyne platform. Work across Next.js, Supabase, and our agent execution runtime.",
    tags: ["TypeScript", "Next.js", "PostgreSQL", "Supabase"],
  },
  {
    title: "AI / ML Engineer",
    team: "AI Platform",
    location: "Remote (Global)",
    type: "Full-time",
    description: "Build the agent execution sandbox, MCP integration layer, and AI model abstraction APIs.",
    tags: ["Python", "LLMs", "MCP", "Anthropic API"],
  },
  {
    title: "Developer Advocate",
    team: "Growth",
    location: "Remote (Global)",
    type: "Full-time",
    description: "Build the developer community. Create tutorials, run workshops, write docs, and be the voice of AgentDyne to the world.",
    tags: ["Technical Writing", "APIs", "Community", "Content"],
  },
  {
    title: "Product Designer",
    team: "Design",
    location: "Remote (Global)",
    type: "Full-time",
    description: "Own the AgentDyne design system and product experience from ideation to pixel-perfect delivery.",
    tags: ["Figma", "Design Systems", "User Research", "Motion"],
  },
  {
    title: "Enterprise Account Executive",
    team: "Sales",
    location: "Remote (US / EU)",
    type: "Full-time",
    description: "Close enterprise deals with Fortune 500 companies adopting AgentDyne as their agent deployment platform.",
    tags: ["B2B SaaS", "Enterprise", "Technical Sales", "CRM"],
  },
  {
    title: "Backend Engineer — Payments",
    team: "Engineering",
    location: "Remote (Global)",
    type: "Full-time",
    description: "Own all things Stripe — subscriptions, Connect payouts, metered billing, and fraud prevention.",
    tags: ["Node.js", "Stripe", "PostgreSQL", "Webhooks"],
  },
]

const PERKS = [
  { emoji: "🌍", title: "Fully remote",        desc: "Work from anywhere. We have team members in 14 countries across every timezone." },
  { emoji: "💰", title: "Competitive equity",  desc: "Meaningful equity stake in a high-growth company at an early stage." },
  { emoji: "⚡", title: "Move fast",            desc: "Ship weekly. No bureaucracy. Your work has direct user impact from day one." },
  { emoji: "🏥", title: "Health benefits",      desc: "Full medical, dental, and vision coverage for you and your family (US/EU)." },
  { emoji: "📚", title: "Learning budget",      desc: "$2,000/year for courses, conferences, and books." },
  { emoji: "🖥️", title: "Home office setup",   desc: "$1,500 one-time budget to set up your ideal workspace." },
  { emoji: "🤝", title: "Team retreats",        desc: "Twice-yearly in-person team retreats in different cities around the world." },
  { emoji: "🧠", title: "AI-first culture",     desc: "Use the latest AI tools freely. We're building the future — we should live in it." },
]

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14">
        {/* Hero */}
        <section className="py-24 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <Badge className="mb-4">We're hiring</Badge>
            <h1 className="text-5xl font-black tracking-tighter mb-5">
              Build the infrastructure for the <span className="gradient-text">AI-native economy</span>
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed mb-8">
              We're a small, ambitious team solving hard problems at the intersection of AI, developer tools,
              and marketplaces. Every person here owns something meaningful. Every line of code ships to
              tens of thousands of developers.
            </p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                {ROLES.length} open roles
              </span>
              <span>14 countries</span>
              <span>Fully remote</span>
              <span>Series A — 2026</span>
            </div>
          </div>
        </section>

        {/* Perks */}
        <section className="py-16 bg-muted/20 border-y border-border">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold tracking-tight mb-8">Why AgentDyne</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {PERKS.map((perk) => (
                <div key={perk.title} className="bg-card border border-border rounded-2xl p-5">
                  <p className="text-2xl mb-3">{perk.emoji}</p>
                  <p className="font-semibold text-sm mb-1">{perk.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{perk.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Open Roles */}
        <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Open Roles</h2>
          <p className="text-muted-foreground text-sm mb-8">All roles are remote-first with flexible hours.</p>

          <div className="space-y-4">
            {ROLES.map((role) => (
              <div key={role.title}
                className="bg-card border border-border rounded-2xl p-6 hover:border-primary/30 hover:shadow-md transition-all group">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <h3 className="font-bold text-foreground group-hover:text-primary transition-colors">{role.title}</h3>
                      <Badge variant="secondary" className="text-xs">{role.team}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3">{role.description}</p>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {role.tags.map(tag => (
                          <span key={tag} className="text-xs bg-muted px-2.5 py-1 rounded-full text-muted-foreground font-mono">{tag}</span>
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground ml-auto">{role.location} · {role.type}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <a href={`mailto:careers@agentdyne.com?subject=Application: ${encodeURIComponent(role.title)}&body=Hi AgentDyne team,%0D%0A%0D%0AI'm interested in the ${encodeURIComponent(role.title)} role.%0D%0A%0D%0A[Tell us about yourself and include links to your work]`}>
                      <Button variant="brand" size="sm" className="rounded-xl">Apply</Button>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Open application */}
          <div className="mt-10 p-6 bg-card border border-border rounded-2xl flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="font-bold">Don't see your role?</h3>
              <p className="text-sm text-muted-foreground mt-1">We always want to hear from exceptional people, even if we don't have an open role right now.</p>
            </div>
            <a href="mailto:careers@agentdyne.com?subject=Open Application">
              <Button variant="outline">Send open application →</Button>
            </a>
          </div>
        </section>

        {/* Process */}
        <section className="py-16 bg-muted/20 border-t border-border">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-2xl font-bold tracking-tight mb-4">Our hiring process</h2>
            <p className="text-muted-foreground text-sm mb-10">Fast, transparent, and respectful of your time. Most offers are made within 2 weeks.</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-left">
              {[
                { step: "01", title: "Application",  desc: "Send your CV and a short note on why AgentDyne. 48h response guaranteed." },
                { step: "02", title: "Intro call",   desc: "30-min video call with the hiring manager. No trick questions." },
                { step: "03", title: "Take-home",    desc: "A realistic, paid task (2–4 hrs). We compensate your time." },
                { step: "04", title: "Final round",  desc: "Meet the founding team. Ask us anything. Offer within 48 hours." },
              ].map((s) => (
                <div key={s.step} className="bg-card border border-border rounded-2xl p-5">
                  <span className="text-xs font-black text-primary">{s.step}</span>
                  <h3 className="font-bold text-sm mt-1 mb-2">{s.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
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
