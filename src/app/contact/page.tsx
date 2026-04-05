"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Mail, MessageSquare, Building, Phone, CheckCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import toast from "react-hot-toast"

export default function ContactPage() {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "", type: "general" })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.email || !form.message) { toast.error("Please fill in all required fields"); return }
    setLoading(true)
    // Simulate submission
    await new Promise(r => setTimeout(r, 1200))
    setDone(true)
    setLoading(false)
  }

  const CONTACT_OPTIONS = [
    { icon: MessageSquare, title: "General Enquiries",  desc: "Questions about the platform or your account.", email: "hello@agentdyne.com" },
    { icon: Building,      title: "Enterprise Sales",   desc: "Custom plans, contracts, and volume discounts.", email: "sales@agentdyne.com" },
    { icon: Mail,          title: "Technical Support",  desc: "API issues, bugs, and integration help.", email: "support@agentdyne.com" },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14">
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-14">
              <Badge className="mb-3">Get in touch</Badge>
              <h1 className="text-4xl font-black tracking-tight mb-3">We'd love to hear from you</h1>
              <p className="text-muted-foreground max-w-xl mx-auto">Whether you're building on AgentDyne or exploring enterprise options, our team is here to help.</p>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Contact options */}
              <div className="space-y-4">
                {CONTACT_OPTIONS.map((opt, i) => (
                  <motion.div key={opt.title} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                    className="bg-card border border-border rounded-2xl p-5">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                      <opt.icon className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="font-semibold text-sm">{opt.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 mb-3">{opt.desc}</p>
                    <a href={`mailto:${opt.email}`} className="text-xs text-primary hover:underline font-medium">{opt.email}</a>
                  </motion.div>
                ))}

                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
                  <h3 className="font-semibold text-sm mb-1">Response times</h3>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <p>⚡ Pro/Enterprise — under 4 hours</p>
                    <p>📧 Starter — under 24 hours</p>
                    <p>💬 Free — 2–3 business days</p>
                  </div>
                </div>
              </div>

              {/* Contact form */}
              <div className="lg:col-span-2">
                <div className="bg-card border border-border rounded-2xl p-8">
                  {done ? (
                    <div className="text-center py-12">
                      <CheckCircle className="h-14 w-14 text-green-400 mx-auto mb-4" />
                      <h2 className="text-xl font-bold mb-2">Message sent!</h2>
                      <p className="text-muted-foreground text-sm">Thanks for reaching out. We'll get back to you soon.</p>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <div className="mb-5">
                        <h2 className="text-xl font-bold">Send us a message</h2>
                        <p className="text-sm text-muted-foreground mt-1">Fill out the form and we'll respond promptly.</p>
                      </div>

                      {/* Type selector */}
                      <div className="space-y-1.5">
                        <Label>Topic</Label>
                        <div className="flex gap-2 flex-wrap">
                          {[
                            { key: "general",    label: "General" },
                            { key: "enterprise", label: "Enterprise" },
                            { key: "support",    label: "Support" },
                            { key: "billing",    label: "Billing" },
                          ].map(t => (
                            <button key={t.key} type="button"
                              onClick={() => setForm(f => ({ ...f, type: t.key }))}
                              className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${form.type === t.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Name *</Label>
                          <Input placeholder="John Smith" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Email *</Label>
                          <Input type="email" placeholder="you@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Company <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input placeholder="Acme Corp" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Message *</Label>
                        <Textarea placeholder="Tell us what you need…" rows={5} value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
                      </div>

                      <Button type="submit" variant="brand" className="w-full" disabled={loading}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
                        {loading ? "Sending…" : "Send Message"}
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
