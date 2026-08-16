/**
 * /connections — authenticated integrations manager
 *
 * Deliberately NOT at /integrations. Next.js route groups like (dashboard)
 * are invisible in the URL, so (dashboard)/integrations/page.tsx would
 * resolve to the exact same path as the public marketing page at
 * src/app/integrations/page.tsx — a genuine build-breaking collision.
 * That's exactly what _removed_duplicate_route.tsx.bak in the sibling
 * integrations/ folder documents happened before: someone hit the
 * collision and deleted the dashboard page.tsx to fix the build, but never
 * gave the (real, more capable) client component — user-scoped
 * connect/disconnect, usage tracking, a "Connected" filter — a new home.
 * It's been dead code ever since, and the sidebar's "Integrations" link
 * has been sending logged-in users to the logged-out marketing page.
 *
 * This file restores it at a non-colliding path and reuses the existing
 * component in place rather than duplicating it.
 */
export { default } from "../integrations/integrations-client"
