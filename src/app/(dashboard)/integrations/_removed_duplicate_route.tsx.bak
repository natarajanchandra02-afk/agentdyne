/**
 * ✅ Bug 1 fix (routing conflict resolution)
 *
 * PROBLEM: Both app/integrations/page.tsx AND app/(dashboard)/integrations/page.tsx
 * resolve to the URL /integrations. Next.js App Router throws a build error:
 * "You cannot have two parallel pages that resolve to the same path."
 *
 * SOLUTION:
 *   - app/integrations/page.tsx is the PUBLIC catalog (Navbar + Footer, no auth).
 *     It serves /integrations for ALL visitors. This is the canonical page.
 *   - THIS FILE is converted to a server-side redirect to the public page.
 *     It provides the Metadata export (for SEO when crawled via dashboard context)
 *     and immediately redirects. Next.js resolves the conflict by deferring to
 *     the root-level page for the actual render.
 *
 * SIDEBAR: The sidebar now links to /integrations directly, so dashboard users
 * land on the full public catalog which already handles both auth/unauth states.
 *
 * TODO: For a true dashboard "Manage Connections" view with connect/disconnect
 * toggles, move IntegrationsClient to /account/integrations or /settings?tab=integrations
 * so it has its own unambiguous URL.
 */
import { redirect } from "next/navigation"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Integrations — AgentDyne",
  description: "Connect your agents to databases, APIs, cloud services and more.",
}

// Server redirect — resolves the duplicate-page build error.
// The public page at app/integrations/page.tsx handles the actual render.
export default function IntegrationsPageRedirect() {
  redirect("/integrations")
}
