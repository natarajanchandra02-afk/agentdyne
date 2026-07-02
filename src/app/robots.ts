import type { MetadataRoute } from "next"

/**
 * robots.txt — Next.js App Router convention (generates at /robots.txt).
 *
 * ✅ Bug fix: no robots.ts existed. Without an explicit policy, crawlers default
 * to "crawl everything," which means Googlebot could index dashboard routes,
 * API responses, admin pages, and auth callback URLs — none of which should
 * appear in search results and some of which (auth callback with tokens)
 * could leak sensitive query params into Google's crawl logs.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/my-agents",
          "/analytics",
          "/api-keys",
          "/billing",
          "/settings",
          "/admin",
          "/seller",
          "/builder",
          "/pipelines",
          "/executions",
          "/swarm",
          "/collections",
          "/revenue",
          "/compose",
          "/integrations/manage",   // dashboard-scoped variant, not the public catalog
          "/api/",                  // all API routes — nothing here should be indexed
          "/auth/",                 // auth callback + reset-password carry sensitive tokens
          "/login",
          "/signup",
          "/forgot-password",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
