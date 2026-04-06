import Stripe from "stripe";

// Use Fetch-based HTTP client for edge runtime compatibility (Cloudflare Workers)
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
    calls: 100,
    features: ["100 agent calls/month", "Access to free agents", "Community support"],
  },
  starter: {
    name: "Starter",
    price: 19,
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    calls: 1000,
    features: ["1,000 agent calls/month", "All free agents", "Paid agents access", "Email support", "API access"],
  },
  pro: {
    name: "Pro",
    price: 79,
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    calls: 10000,
    features: ["10,000 agent calls/month", "All agents", "Priority execution", "Analytics dashboard", "Priority support", "Custom API keys"],
  },
  enterprise: {
    name: "Enterprise",
    price: null,
    priceId: null,
    calls: -1,
    features: ["Unlimited calls", "Custom SLA", "Dedicated support", "SSO/SAML", "Custom contracts", "On-premise option"],
  },
} as const;

export const PLATFORM_FEE_PERCENT = 0.20; // 20% platform fee

export async function createStripeCustomer(email: string, name?: string) {
  return stripe.customers.create({ email, name });
}

export async function createCheckoutSession({
  customerId,
  priceId,
  userId,
  successUrl,
  cancelUrl,
}: {
  customerId: string;
  priceId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
    subscription_data: { metadata: { userId } },
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
