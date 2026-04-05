import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import type { Metadata } from "next"
export const metadata: Metadata = { title: "Terms of Service — AgentDyne" }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold mb-3 tracking-tight">{title}</h2>
      <div className="text-muted-foreground text-sm leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-14 max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="mb-10">
          <h1 className="text-4xl font-black tracking-tight mb-2">Terms of Service</h1>
          <p className="text-muted-foreground text-sm">Last updated: March 31, 2026</p>
        </div>

        <Section title="1. Acceptance of Terms">
          <p>By accessing or using AgentDyne ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Platform.</p>
        </Section>
        <Section title="2. Description of Service">
          <p>AgentDyne is a marketplace and runtime platform for AI microagents. We provide tools for discovering, deploying, publishing, and monetising AI agents. Services include API access, builder tools, analytics, and payment processing.</p>
        </Section>
        <Section title="3. User Accounts">
          <p>You must provide accurate information when creating an account. You are responsible for maintaining the security of your credentials and API keys. You must be at least 18 years old to use the Platform.</p>
        </Section>
        <Section title="4. Acceptable Use">
          <p>You agree not to use the Platform to: generate harmful, illegal, or abusive content; violate intellectual property rights; circumvent rate limits or access controls; engage in automated abuse or scraping beyond permitted API usage; or resell access without our explicit written consent.</p>
        </Section>
        <Section title="5. Agent Publishing">
          <p>By publishing an agent, you grant AgentDyne a non-exclusive licence to host, display, and distribute it on the Platform. You warrant that your agent does not infringe third-party rights and complies with our Content Policy. We reserve the right to remove agents that violate our policies.</p>
        </Section>
        <Section title="6. Payments and Refunds">
          <p>Payments are processed by Stripe. Subscription fees are non-refundable except as required by law. Per-call charges are billed monthly. AgentDyne retains a 20% platform fee on all seller transactions.</p>
        </Section>
        <Section title="7. Intellectual Property">
          <p>AgentDyne and its licensors own all rights to the Platform. Your agents and content remain your property. You retain all rights to inputs and outputs generated through the Platform.</p>
        </Section>
        <Section title="8. Limitation of Liability">
          <p>To the maximum extent permitted by law, AgentDyne shall not be liable for indirect, incidental, or consequential damages arising from use of the Platform. Our total liability shall not exceed the fees paid by you in the 12 months preceding the claim.</p>
        </Section>
        <Section title="9. Termination">
          <p>We may suspend or terminate your account for violation of these Terms, with or without notice. You may close your account at any time from the Settings page.</p>
        </Section>
        <Section title="10. Changes to Terms">
          <p>We may update these Terms at any time. Continued use of the Platform after changes constitutes acceptance. Material changes will be communicated via email with at least 14 days notice.</p>
        </Section>
        <Section title="11. Governing Law">
          <p>These Terms are governed by the laws of Delaware, USA. Any disputes shall be resolved through binding arbitration, except for injunctive relief claims.</p>
        </Section>
        <Section title="12. Contact">
          <p>For questions about these Terms, contact us at <a href="mailto:legal@agentdyne.com" className="text-primary hover:underline">legal@agentdyne.com</a>.</p>
        </Section>
      </div>
      <Footer />
    </div>
  )
}
