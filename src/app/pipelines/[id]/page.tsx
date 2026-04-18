export const runtime = 'edge'

import { redirect } from "next/navigation"

/**
 * /pipelines/[id] canonical route.
 * The actual editor lives inside (dashboard)/pipelines/[id]/page.tsx
 * which is served at the same URL through the route group.
 *
 * This file exists ONLY to satisfy Cloudflare Pages / next-on-pages:
 * "all non-static routes must export runtime = 'edge'".
 *
 * Without this file the build fails:
 *   ⚡️ The following routes were not configured to run with the Edge Runtime:
 *       /pipelines/[id]
 *
 * The redirect here is never reached in a correct build because Next.js
 * will resolve to (dashboard)/pipelines/[id]/page.tsx first (route group
 * matching takes precedence). If for any reason it is reached it redirects
 * safely to the dashboard pipelines list.
 */
export default function PipelineEdgePlaceholder() {
  redirect("/pipelines")
}
