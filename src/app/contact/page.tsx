"use client"

import { useState } from "react"
import { Mail, MessageSquare, Building, CheckCircle, Loader2, Zap, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"
import type { Metadata } from "next"

const CONTACT_OPTIONS = [
  { icon: MessageSquare, title: "General Enquiries",  desc: "Questions about the platform or your account.", email: "hello@agentdyne.com" },
  { icon: Building,      title: "Enterprise Sales",   desc: "Custom plans, contracts, and volume discounts.", email: "sales@agentdyne.com" },
  { icon: Mail,          title: "Technical Support",  desc: "API issues, bugs, and integration help.",        email: "support@agentdyne.com" },
]

const RESPONSE_TIMES = [
  { icon: Zap,   plan: "Pro / Enterprise", time: "Under 4 hours",      color: "text-primary" },
  { icon: Mail,  plan: "Starter",          time: "Under 24 hours",     color: "text-zinc-600" },
  { icon: Clock, plan: "Free",             time: "2–3 business days",  color: "text-zinc-400" },
]

const TOPICS = [
  { key: "general",    label: "General" },
  { key: "enterprise", label: "Enterprise" },
  { key: "support",    label: "Support" },
  { key: "billing",    label: "Billing" },
]

export default function ContactPage() {
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const [form,    setForm]    = useState({ name: "", email: "", company: "", message: "", type: "general" })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.email || !form.message) {
      toast.error("Please fill in all required fields")
      return
    }
    setLoading(true)
    await new Promise(r => setTimeout(r, 1200))
    setDone(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="pt-14">
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

            {/* Header */}
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 bg-primary/8 text-primary border border-primary/20 text-xs px-3 py-1.5 rounded-full font-semibold mb-4">
                <Mail className="h-3.5 w-3.5" /> Get in touch
              </div>
              <h1 className="text-4xl font-black tracking-tight text-zinc-900 mb-3">
                We'd love to hear from you
              </h1>
              <p className="text-zinc-500 max-w-xl mx-auto">
                Whether you're building on AgentDyne or exploring enterprise options, our team is here to help.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left — contact options + response times */}
              <div className="space-y-4">
                {CONTACT_OPTIONS.map((opt) => (
                  <div key={opt.title}
                    className="bg-white border border-zinc-100 rounded-2xl p-5"
                    style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center mb-3">
                      <opt.icon className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="font-semibold text-zinc-900 text-sm mb-1">{opt.title}</h3>
                    <p className="text-xs text-zinc-500 mb-3">{opt.desc}</p>
                    <a href={`mailto:${opt.email}`} className="text-xs text-primary hover:underline font-medium">
                      {opt.email}
                    </a>
                  </div>
                ))}

                {/* Response times — icons not emojis */}
                <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
                  <h3 className="font-semibold text-zinc-900 text-sm mb-3">Response times</h3>
                  <div className="space-y-2.5">
                    {RESPONSE_TIMES.map(rt => (
                      <div key={rt.plan} className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-lg bg-white border border-zinc-100 flex items-center justify-center flex-shrink-0">
                          <rt.icon className={cn("h-3 w-3", rt.color)} />
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-zinc-700">{rt.plan}</span>
                          <span className="text-xs text-zinc-400 ml-1.5">— {rt.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right — form */}
              <div className="lg:col-span-2">
                <div className="bg-white border border-zinc-100 rounded-2xl p-8"
                  style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  {done ? (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-5">
                        <CheckCircle className="h-8 w-8 text-green-500" />
                      </div>
                      <h2 className="text-xl font-bold text-zinc-900 mb-2">Message sent!</h2>
                      <p className="text-zinc-500 text-sm">Thanks for reaching out. We'll get back to you soon.</p>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <div className="mb-2">
                        <h2 className="text-xl font-bold text-zinc-900">Send us a message</h2>
                        <p className="text-sm text-zinc-500 mt-1">Fill out the form and we'll respond promptly.</p>
                      </div>

                      {/* Topic */}
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Topic</Label>
                        <div className="flex gap-2 flex-wrap">
                          {TOPICS.map(t => (
                            <button key={t.key} type="button"
                              onClick={() => setForm(f => ({ ...f, type: t.key }))}
                              className={cn(
                                "px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                                form.type === t.key
                                  ? "border-zinc-900 bg-zinc-900 text-white"
                                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400 bg-white"
                              )}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Name *</Label>
                          <Input placeholder="John Smith" className="rounded-xl border-zinc-200 h-10"
                            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium text-zinc-700">Email *</Label>
                          <Input type="email" placeholder="you@company.com" className="rounded-xl border-zinc-200 h-10"
                            value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">
                          Company <span className="text-zinc-400 font-normal">(optional)</span>
                        </Label>
                        <Input placeholder="Acme Corp" className="rounded-xl border-zinc-200 h-10"
                          value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium text-zinc-700">Message *</Label>
                        <Textarea placeholder="Tell us what you need…" rows={5}
                          className="rounded-xl border-zinc-200 resize-none text-sm"
                          value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
                      </div>

                      <Button type="submit" disabled={loading}
                        className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold h-10 gap-2">
                        {loading
                          ? <><Loader2 className="h-4 w-4 animate-spin" />Sending…</>
                          : <><Mail className="h-4 w-4" />Send Message</>}
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
