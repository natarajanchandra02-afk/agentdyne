import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Privacy Policy — AgentDyne" }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h2 className="text-xl font-bold mb-3 tracking-tight">{title}</h2>
      <div className="text-muted-foreground text-sm leading-relaxed space-y-3">{children}</div>
    </div>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14 max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="mb-12">
          <h1 className="text-4xl font-black tracking-tight mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm">Last updated: March 31, 2026</p>
          <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-2xl text-sm text-muted-foreground">
            AgentDyne is committed to protecting your privacy. This policy explains what we collect, how we use it, and your rights.
          </div>
        </div>

        <Section title="1. Information We Collect">
          <p><strong className="text-foreground">Account information:</strong> Name, email address, and hashed password when you register. Optional profile fields (username, bio, website, company).</p>
          <p><strong className="text-foreground">Usage data:</strong> API calls made, agent executions, pages visited, features used, and error logs — used to improve the platform.</p>
          <p><strong className="text-foreground">Payment information:</strong> All payments are processed by Stripe. We store only your Stripe Customer ID — never raw card numbers or CVVs.</p>
          <p><strong className="text-foreground">Communications:</strong> Emails you send us and notification preferences.</p>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>To provide, maintain, and improve the AgentDyne platform and services.</p>
          <p>To process transactions and send related information including purchase confirmations and invoices.</p>
          <p>To send operational emails: password resets, subscription updates, payout notifications.</p>
          <p>To detect, investigate, and prevent fraudulent transactions, abuse, and other illegal activities.</p>
          <p>To comply with legal obligations and enforce our Terms of Service.</p>
          <p><strong className="text-foreground">We never sell your personal data to third parties.</strong></p>
        </Section>

        <Section title="3. Agent Inputs and Outputs">
          <p>Text you send to agents as input, and the outputs produced, are processed solely to deliver the service to you.</p>
          <p>We do not use your agent inputs or outputs to train AI models.</p>
          <p>Execution logs (input, output, latency, status) are retained for 90 days and then permanently deleted.</p>
          <p>Sellers can see aggregated execution counts and revenue for their agents but cannot see individual user inputs or outputs.</p>
        </Section>

        <Section title="4. Data Sharing and Sub-processors">
          <p>We share your data only with the following categories of third parties, all of whom are bound by data processing agreements:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong className="text-foreground">Stripe</strong> — payment processing and seller payouts</li>
            <li><strong className="text-foreground">Supabase</strong> — database hosting (EU and US regions)</li>
            <li><strong className="text-foreground">Vercel</strong> — application hosting and edge CDN</li>
            <li><strong className="text-foreground">Resend</strong> — transactional email delivery</li>
            <li><strong className="text-foreground">Anthropic / OpenAI</strong> — AI model inference for agent execution</li>
          </ul>
          <p>We may disclose your information if required by law, court order, or to protect the rights and safety of AgentDyne or its users.</p>
        </Section>

        <Section title="5. Your Rights">
          <p>Depending on your location, you may have the following rights:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong className="text-foreground">Access</strong> — request a copy of all data we hold about you</li>
            <li><strong className="text-foreground">Correction</strong> — update inaccurate or incomplete data</li>
            <li><strong className="text-foreground">Deletion</strong> — request deletion of your account and personal data</li>
            <li><strong className="text-foreground">Portability</strong> — receive your data in a machine-readable format</li>
            <li><strong className="text-foreground">Objection</strong> — opt out of certain processing activities</li>
          </ul>
          <p>Submit requests to <a href="mailto:privacy@agentdyne.com" className="text-primary hover:underline">privacy@agentdyne.com</a>. We respond within 30 days. You may also delete your account directly from Settings → Danger Zone.</p>
        </Section>

        <Section title="6. Cookies and Tracking">
          <p><strong className="text-foreground">Essential cookies:</strong> Required for authentication sessions and security. Cannot be disabled.</p>
          <p><strong className="text-foreground">Preference cookies:</strong> Store your theme and UI preferences.</p>
          <p>We do not use advertising or tracking cookies. We do not participate in cross-site tracking.</p>
          <p>You can manage cookie preferences in your browser settings. Disabling essential cookies will prevent login.</p>
        </Section>

        <Section title="7. Data Security">
          <p>All data is encrypted in transit using TLS 1.3. Data at rest is encrypted using AES-256.</p>
          <p>API keys are hashed with SHA-256 — we cannot recover your raw key if lost.</p>
          <p>We conduct regular security audits and penetration tests. We maintain a responsible disclosure program.</p>
          <p>In the event of a data breach affecting your personal data, we will notify you within 72 hours as required by GDPR.</p>
        </Section>

        <Section title="8. Data Retention">
          <p>Account data is retained until you delete your account. Execution logs are retained for 90 days. Financial records are retained for 7 years as required by law. Deleted account data is purged from backups within 30 days.</p>
        </Section>

        <Section title="9. Children's Privacy">
          <p>AgentDyne is not directed at children under 18. We do not knowingly collect personal information from minors. If you believe a minor has created an account, contact us immediately.</p>
        </Section>

        <Section title="10. International Transfers">
          <p>Your data may be processed in the United States and other countries where our service providers operate. We use Standard Contractual Clauses (SCCs) approved by the European Commission for cross-border transfers from the EEA.</p>
        </Section>

        <Section title="11. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. Material changes will be communicated by email and via a notice in the dashboard at least 14 days before taking effect. Continued use constitutes acceptance.</p>
        </Section>

        <Section title="12. Contact">
          <p>Privacy questions: <a href="mailto:privacy@agentdyne.com" className="text-primary hover:underline">privacy@agentdyne.com</a></p>
          <p>Data Protection Officer: <a href="mailto:dpo@agentdyne.com" className="text-primary hover:underline">dpo@agentdyne.com</a></p>
          <p>Postal address: AgentDyne, Inc., 2261 Market Street #4667, San Francisco, CA 94114</p>
        </Section>
      </div>
      <Footer />
    </div>
  )
}
