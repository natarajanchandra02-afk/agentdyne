/**
 * Pricing page — SEO metadata wrapper (server component)
 * The actual page content remains a client component for interactivity.
 * This pattern keeps "use client" working while adding full SEO/OG metadata.
 */
import type { Metadata } from "next"
import PricingClientPage from "./pricing-client"

export const metadata: Metadata = {
  title:       "Pricing — AgentDyne",
  description: "Start free with 50 lifetime executions. Scale to Pro at $79/mo for 5,000 runs. Transparent per-call pricing, no hidden fees. Payouts to sellers via Stripe.",
  keywords:    ["AI agents pricing", "AgentDyne plans", "AI API pricing", "agent marketplace", "LLM cost", "pay per call AI"],
  openGraph: {
    title:       "AgentDyne Pricing — Pay For What You Actually Use",
    description: "Free plan with 50 calls. Starter $19/mo, Pro $79/mo, Enterprise custom. No hidden infra costs.",
    url:         "https://agentdyne.com/pricing",
    siteName:    "AgentDyne",
    type:        "website",
    images: [{ url: "https://agentdyne.com/og-pricing.png", width: 1200, height: 630, alt: "AgentDyne Pricing" }],
  },
  twitter: {
    card:        "summary_large_image",
    title:       "AgentDyne Pricing — Start Free",
    description: "50 free executions, then scale with transparent per-call pricing.",
    images:      ["https://agentdyne.com/og-pricing.png"],
  },
  alternates: { canonical: "https://agentdyne.com/pricing" },
}

export default function PricingPage() {
  return <PricingClientPage />
}
