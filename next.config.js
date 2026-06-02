/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── TypeScript / ESLint ────────────────────────────────────────────────────
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },

  // ── Image optimisation ─────────────────────────────────────────────────────
  images: {
    unoptimized: true,   // Required for Cloudflare Pages (no image CDN)
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co"               },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com"     },
      { protocol: "https", hostname: "*.cloudflare.com"            },
    ],
  },

  // ── URL rewrites ───────────────────────────────────────────────────────────
  // /v1/* → /api/* for SDK backwards compat
  // /embed/{id}.js → /api/embed/{id} for the viral widget script
  async rewrites() {
    return [
      { source: "/v1/:path*",         destination: "/api/:path*"        },
      { source: "/embed/:id\\.js",    destination: "/api/embed/:id"     },
    ]
  },

  // ── HTTP headers ───────────────────────────────────────────────────────────
  async headers() {
    return [
      // ── Default security headers for all routes ──────────────────────────
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",  value: "nosniff"                          },
          { key: "X-XSS-Protection",         value: "1; mode=block"                   },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
        ],
      },

      // ── Embed widget pages: allow iframing on any external site ──────────
      // This REMOVES X-Frame-Options and sets permissive frame-ancestors.
      // Required for the "Stripe Checkout for AI" viral embed feature.
      {
        source: "/embed/(.*)",
        headers: [
          // Override the default DENY — embed widget MUST be iframeable
          { key: "X-Frame-Options",          value: "ALLOWALL"  },
          { key: "Content-Security-Policy",  value: "frame-ancestors *" },
          { key: "Access-Control-Allow-Origin", value: "*"      },
        ],
      },

      // ── Embed JS script: CORS + caching ──────────────────────────────────
      {
        source: "/api/embed/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: "*"                         },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS"        },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, X-API-Key, X-Embed-Token" },
          { key: "Cache-Control",                value: "public, max-age=3600, s-maxage=86400" },
        ],
      },

      // ── Public API routes: CORS ───────────────────────────────────────────
      {
        source: "/api/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: "*"                            },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-API-Key, X-Embed-Token" },
        ],
      },

      // ── Stripe webhooks: Stripe origin only ──────────────────────────────
      {
        source: "/api/webhooks/stripe(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://stripe.com" },
        ],
      },

      // ── Static assets: immutable cache ───────────────────────────────────
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ]
  },

  // ── External packages ──────────────────────────────────────────────────────
  serverExternalPackages: ["@anthropic-ai/sdk"],

  // ── Compiler ──────────────────────────────────────────────────────────────
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn", "info"] }
      : false,
  },

  // ── Logging ───────────────────────────────────────────────────────────────
  logging: {
    fetches: { fullUrl: process.env.NODE_ENV !== "production" },
  },

  // ── Experimental ──────────────────────────────────────────────────────────
  experimental: {
    optimizeCss: false,  // Disabled: critters conflicts with CF Pages edge runtime
  },
}

module.exports = nextConfig
