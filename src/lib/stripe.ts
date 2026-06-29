import Stripe from "stripe";

// ✅ Bug fix: quota numbers now match constants.ts PLAN_QUOTAS (single source of truth).
// Previous values were 2× the real enforced limits (100/1000/10000 vs 50/500/5000).
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
  appInfo: { name: "AgentDyne", version: "1.0.0" },
  httpClient: Stripe.createFetchHttpClient(),
});

export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    priceId: null,
    calls: 50,           // ✅ was 100 — corrected to match constants.ts PLAN_QUOTAS.free
    period: "lifetime",
    features: ["50 lifetime executions", "Access to platform agents", "Community support"],
  },
  starter: {
    name: "Starter",
    price: 19,
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    calls: 500,          // ✅ was 1000 — corrected to match constants.ts PLAN_QUOTAS.starter
    period: "month",
    features: ["500 agent calls/month", "All agents + API access", "Pipelines (up to 5 steps)", "Email support", "Marketplace publishing"],
  },
  pro: {
    name: "Pro",
    price: 79,
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    calls: 5_000,        // ✅ was 10000 — corrected to match constants.ts PLAN_QUOTAS.pro
    period: "month",
    features: ["5,000 agent calls/month", "All agents", "Full pipelines (unlimited steps)", "Priority execution", "Analytics dashboard", "Priority support", "Custom API keys"],
  },
  enterprise: {
    name: "Enterprise",
    price: null,
    priceId: null,
    calls: -1,
    period: "",
    features: ["Unlimited calls", "Custom SLA", "Dedicated support", "SSO/SAML", "Custom contracts", "On-premise option"],
  },
} as const;

export const PLATFORM_FEE_PERCENT = 0.20;

export async function createStripeCustomer(email: string, name?: string) {
  return stripe.customers.create({ email, name });
}

export async function createCheckoutSession({
  customerId,
  priceId,
  userId,
  successUrl,
  cancelUrl,
  planKey,
}: {
  customerId: string;
  priceId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
  planKey?: string;
}) {
  return stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, plan: planKey ?? "" },
    subscription_data: { metadata: { userId, plan: planKey ?? "" } },
    allow_promotion_codes: true,
  });
}

export async function createConnectAccount(email: string) {
  return stripe.accounts.create({
    type: "express",
    email,
    capabilities: { transfers: { requested: true } },
  });
}

export async function createConnectOnboardingLink(accountId: string, returnUrl: string) {
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: returnUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
}

export async function createPaymentIntent({
  amount,
  currency = "usd",
  customerId,
  metadata = {},
}: {
  amount: number;
  currency?: string;
  customerId: string;
  metadata?: Record<string, string>;
}) {
  return stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
    customer: customerId,
    metadata,
    automatic_payment_methods: { enabled: true },
  });
}

export async function transferToSeller({
  amount,
  sellerAccountId,
  metadata = {},
}: {
  amount: number;
  sellerAccountId: string;
  metadata?: Record<string, string>;
}) {
  return stripe.transfers.create({
    amount: Math.round(amount * 100),
    currency: "usd",
    destination: sellerAccountId,
    metadata,
  });
}
