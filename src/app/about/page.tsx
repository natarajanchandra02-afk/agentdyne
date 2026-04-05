import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { Metadata } from "next"
export const metadata: Metadata = { title: "About — AgentDyne" }

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14">
        <section className="py-24 max-w-4xl mx-auto px-4 sm:px-6">
          <Badge className="mb-4">Our mission</Badge>
          <h1 className="text-5xl font-black tracking-tighter mb-6">
            We're building the infrastructure for the <span className="gradient-text">AI-native economy</span>
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed mb-6">
            AgentDyne was founded in 2025 with a simple belief: AI agents should be as easy to find,
            deploy, and monetise as open-source libraries. We're building the marketplace and runtime
            infrastructure that makes that possible for every developer on the planet.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-10">
            We support thousands of developers — from solo hackers to enterprise engineering teams —
            who use AgentDyne to discover trusted agents, integrate them in minutes, and ship
            AI-powered products faster than ever before.
          </p>

          <div className="grid grid-cols-3 gap-8 py-10 border-y border-border mb-10">
            {[
              { value: "89,000+", label: "Developers" },
              { value: "12,400+", label: "Active Agents" },
              { value: "127",     label: "Countries" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-4xl font-black gradient-text">{s.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          <h2 className="text-2xl font-bold mb-4">Our values</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
            {[
              { emoji: "🔍", title: "Transparency",  desc: "Honest pricing, clear policies, and open communication with our community." },
              { emoji: "🏗️", title: "Builder-first",  desc: "Every decision starts with: does this make builders more productive?" },
              { emoji: "🌍", title: "Global by default", desc: "We build for everyone, everywhere — in every language and currency." },
              { emoji: "🛡️", title: "Trust & Safety", desc: "Every agent is reviewed. We take quality and security seriously." },
            ].map(v => (
              <div key={v.title} className="bg-card border border-border rounded-2xl p-5">
                <p className="text-2xl mb-2">{v.emoji}</p>
                <p className="font-semibold text-sm">{v.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{v.desc}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <Link href="/careers"><Button variant="brand">Join our team →</Button></Link>
            <Link href="/contact"><Button variant="outline">Get in touch</Button></Link>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
