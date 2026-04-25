/**
 * /pipelines/[id] — Edge runtime stub (Cloudflare Pages requirement)
 *
 * The actual pipeline editor is served by (dashboard)/pipelines/[id]/page.tsx
 * which gets the sidebar from (dashboard)/layout.tsx.
 *
 * This file exists ONLY because next-on-pages requires every dynamic route
 * to export `runtime = 'edge'` from a Server Component file. The runtime
 * declaration in the "use client" (dashboard) page is not picked up by
 * next-on-pages at build time.
 *
 * Next.js App Router: when both (dashboard)/pipelines/[id]/page.tsx and
 * pipelines/[id]/page.tsx resolve to /pipelines/[id], the (dashboard)
 * version is rendered because route groups take layout precedence.
 * This file provides ONLY the runtime export; it never renders content.
 */
export const runtime = 'edge'
export { default } from "@/app/(dashboard)/pipelines/[id]/page"
