import type { MetadataRoute } from "next"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Dynamic sitemap.xml — generated at request time (Next.js App Router convention).
 *
 * ✅ Bug fix: no sitemap.ts existed anywhere in the app directory prior to this.
 * For a marketplace whose growth model depends on organic search discovery of
 * individual agent pages, launching without a crawl map means Google has to
 * discover every /marketplace/[id] page purely through internal link crawling —
 * much slower and less reliable than an explicit sitemap.
 *
 * Includes:
 *   - All static marketing/legal pages
 *   - All marketplace category filter pages
 *   - Every published (status = active) agent detail page, pulled live from DB
 *   - Blog posts (if a blog_posts table exists — falls back gracefully if not)
 *
 * Revisit: Next.js caches this route; Cloudflare Pages will regenerate on
 * each deploy. For a very large agent catalog (10k+), consider paginating
 * via sitemap index files (sitemap-0.xml, sitemap-1.xml, ...) instead of
 * one flat file — Google's practical limit is 50,000 URLs per sitemap file.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com"

const CATEGORIES = [
  "productivity", "coding", "marketing", "finance", "legal",
  "customer_support", "data_analysis", "content", "research",
  "hr", "sales", "devops", "security", "other",
]

const STATIC_ROUTES: { path: string; priority: number; changeFreq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/",           priority: 1.0, changeFreq: "daily"   },
  { path: "/marketplace", priority: 0.9, changeFreq: "hourly" },
  { path: "/pricing",    priority: 0.8, changeFreq: "weekly"  },
  { path: "/about",      priority: 0.5, changeFreq: "monthly" },
  { path: "/docs",       priority: 0.7, changeFreq: "weekly"  },
  { path: "/blog",       priority: 0.6, changeFreq: "daily"   },
  { path: "/changelog",  priority: 0.4, changeFreq: "weekly"  },
  { path: "/careers",    priority: 0.3, changeFreq: "weekly"  },
  { path: "/contact",    priority: 0.3, changeFreq: "monthly" },
  { path: "/leaderboard", priority: 0.5, changeFreq: "daily"  },
  { path: "/integrations", priority: 0.6, changeFreq: "weekly" },
  { path: "/terms",      priority: 0.2, changeFreq: "yearly"  },
  { path: "/privacy",    priority: 0.2, changeFreq: "yearly"  },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map(r => ({
    url:            `${BASE_URL}${r.path}`,
    lastModified:   now,
    changeFrequency: r.changeFreq,
    priority:       r.priority,
  }))

  const categoryEntries: MetadataRoute.Sitemap = CATEGORIES.map(cat => ({
    url:            `${BASE_URL}/marketplace?category=${cat}`,
    lastModified:   now,
    changeFrequency: "daily",
    priority:       0.6,
  }))

  // Live agent pages — best-effort. If the DB call fails (e.g. during a
  // deploy-time build with no DB access), we still return the static routes
  // rather than failing the whole sitemap.
  let agentEntries: MetadataRoute.Sitemap = []
  let blogEntries: MetadataRoute.Sitemap = []

  try {
    const supabase = await createAdminClient()

    const { data: agents } = await supabase
      .from("agents")
      .select("id, slug, updated_at")
      .eq("status", "active")
      .order("total_executions", { ascending: false })
      .limit(45_000) // stay under the 50k-per-sitemap practical limit

    agentEntries = (agents ?? []).map((a: any) => ({
      url:            `${BASE_URL}/marketplace/${a.slug || a.id}`,
      lastModified:   a.updated_at ? new Date(a.updated_at) : now,
      changeFrequency: "weekly" as const,
      priority:       0.7,
    }))
  } catch (err) {
    console.error("[sitemap] Failed to fetch agents — returning static routes only:", err)
  }

  try {
    const supabase = await createAdminClient()
    const { data: posts } = await supabase
      .from("blog_posts")
      .select("slug, updated_at")
      .eq("published", true)
      .limit(5_000)

    blogEntries = (posts ?? []).map((p: any) => ({
      url:            `${BASE_URL}/blog/${p.slug}`,
      lastModified:   p.updated_at ? new Date(p.updated_at) : now,
      changeFrequency: "monthly" as const,
      priority:       0.5,
    }))
  } catch {
    // blog_posts table may not exist — fine, sitemap still works without it
  }

  return [...staticEntries, ...categoryEntries, ...agentEntries, ...blogEntries]
}
