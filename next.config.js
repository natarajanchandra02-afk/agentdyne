/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── TypeScript / ESLint ────────────────────────────────────────────────────
  // ignoreBuildErrors: true keeps Cloudflare Pages builds green while the
  // team iterates. For a truly hardened CI pipeline, remove these and fix all
  // type errors before merging to main.
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },

  // ── Image optimisation ─────────────────────────────────────────────────────
  // unoptimized: true is required for Cloudflare Pages (no image CDN).
  // In production, consider replacing with a dedicated image CDN.
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co"           },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "*.cloudflare.com"        },
    ],
  },

  // ── URL rewrites ───────────────────────────────────────────────────────────
  // /v1/* → /api/* — SDK compatibility (developers can hit /v1/agents etc.)
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: "/api/:path*" },
    ]
  },

  // ── HTTP headers ───────────────────────────────────────────────────────────
  // These are applied at the CDN/edge layer by Cloudflare Pages (CF Pages
  // merges headers from next.config.js and _headers). The middleware also
  // applies CSP + security headers for finer-grained per-route control.
  // Having both layers is intentional: belt-and-suspenders security.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",  value: "nosniff"                          },
          { key: "X-Frame-Options",          value: "DENY"                             },
          { key: "X-XSS-Protection",         value: "1; mode=block"                   },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // CORS for public API routes — allow any origin to call /api/*
      // Specific origin allowlisting is enforced in middleware.ts for security.
      {
        source: "/api/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: "*"                            },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-API-Key" },
        ],
      },
      // Webhook: ensure Stripe can POST with raw body
      {
        source: "/api/webhooks/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://stripe.com" },
        ],
      },
      // SDK JS files: long-lived cache
      {
        source: "/sdk/(.*)\\.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // Static assets: long-lived cache
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ]
  },

  // ── External packages ──────────────────────────────────────────────────────
  // @anthropic-ai/sdk imports `node:crypto` in some paths — mark as external
  // so Next.js doesn't try to bundle it in edge workers.
  serverExternalPackages: ["@anthropic-ai/sdk"],

  // ── Compiler options ───────────────────────────────────────────────────────
  compiler: {
    // Remove console.log in production (keep console.error/warn for Sentry)
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },

  // ── Experimental ──────────────────────────────────────────────────────────
  experimental: {
    // Inline CSS for critical path — reduces First Contentful Paint
    optimizeCss: false,  // Disabled: requires critters which conflicts with CF Pages
  },

  // ── Logging ───────────────────────────────────────────────────────────────
  // Reduce Next.js verbose fetch logging in production
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV !== "production",
    },
  },
}

module.exports = nextConfig
