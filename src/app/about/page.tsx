import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Search, Hammer, Globe, ShieldCheck, ArrowRight, Users, Bot, MapPin } from "lucide-react"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "About — AgentDyne" }

const VALUES = [
  { icon: Search,     title: "Transparency",     desc: "Honest pricing, clear policies, and open communication with our community." },
  { icon: Hammer,     title: "Builder-first",    desc: "Every decision starts with: does this make builders more productive?" },
  { icon: Globe,      title: "Global by default",desc: "We build for everyone, everywhere — in every language and currency." },
  { icon: ShieldCheck,title: "Trust & Safety",   desc: "Every agent is reviewed. We take quality and security seriously." },
]

const TEAM = [
  { name: "Ravi Nataraj",   role: "CEO & Co-founder",     initials: "RN" },
  { name: "Anya Krishnan",  role: "CTO & Co-founder",     initials: "AK" },
  { name: "Marcus Lee",     role: "Head of Product",       initials: "ML" },
  { name: "Priya Sharma",   role: "Head of Engineering",   initials: "PS" },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">

        {/* Hero */}
        <section className="py-24 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-6">
            <Bot className="h-3.5 w-3.5" /> Our mission
          </div>
          <h1 className="text-5xl font-black tracking-tighter text-zinc-900 mb-6">
            Building the infrastructure for the{" "}
            <span className="gradient-text">AI-native economy</span>
          </h1>
          <p className="text-xl text-zinc-500 leading-relaxed mb-6">
            AgentDyne was founded in 2025 with a simple belief: AI agents should be as easy to find,
            deploy, and monetise as open-source libraries. We're building the marketplace and runtime
            infrastructure that makes that possible for every developer on the planet.
          </p>
          <p className="text-zinc-500 leading-relaxed mb-10">
            We support thousands of developers — from solo hackers to enterprise engineering teams —
            who use AgentDyne to discover trusted agents, integrate them in minutes, and ship
            AI-powered products faster than ever before.
          </p>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-px bg-zinc-100 rounded-2xl overflow-hidden border border-zinc-100 mb-12">
            {[
              { value: "89,000+", label: "Developers" },
              { value: "12,400+", label: "Active Agents" },
              { value: "127",     label: "Countries" },
            ].map(s => (
              <div key={s.label} className="bg-white px-6 py-8 text-center">
                <p className="text-4xl font-black gradient-text nums">{s.value}</p>
                <p className="text-sm text-zinc-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Values */}
          <h2 className="text-2xl font-bold text-zinc-900 mb-5">Our values</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
            {VALUES.map(v => (
              <div key={v.title} className="bg-white border border-zinc-100 rounded-2xl p-5"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center mb-3">
                  <v.icon className="h-4.5 w-4.5 text-primary" />
                </div>
                <p className="font-semibold text-zinc-900 text-sm mb-1">{v.title}</p>
                <p className="text-xs text-zinc-500 leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>

          {/* Team */}
          <h2 className="text-2xl font-bold text-zinc-900 mb-5">The team</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {TEAM.map(t => (
              <div key={t.name} className="bg-white border border-zinc-100 rounded-2xl p-5 text-center"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-violet-600 flex items-center justify-center text-white font-bold text-lg mx-auto mb-3">
                  {t.initials}
                </div>
                <p className="font-semibold text-zinc-900 text-sm">{t.name}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{t.role}</p>
              </div>
            ))}
          </div>

          {/* Backed by */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-6 mb-10">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Backed by</p>
            <div className="flex items-center gap-6 flex-wrap">
              {["Sequoia Capital", "Y Combinator", "a16z", "Founders Fund"].map(backer => (
                <span key={backer} className="text-sm font-semibold text-zinc-700">{backer}</span>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Link href="/careers">
              <Button className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
                Join our team <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/contact">
              <Button variant="outline" className="rounded-xl border-zinc-200">Get in touch</Button>
            </Link>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
