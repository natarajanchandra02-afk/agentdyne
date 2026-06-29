/**
 * ⚠️  DEPRECATED — DO NOT IMPORT
 *
 * This file is a stale copy of the integrations client left over from an
 * earlier session when integrations-client.tsx lived inside (dashboard)/dashboard/.
 *
 * The canonical, bug-fixed version is now co-located at:
 *   src/app/(dashboard)/integrations/integrations-client.tsx
 *
 * Bugs fixed in the canonical version:
 *   ✅ Bug 9  — loading never set to false when user is null (infinite spinner)
 *   ✅ Bug 5  — supabase client recreated on every render (fixed with useRef)
 *   ✅ Bug 17 — emoji used for KPI icons (replaced with Lucide icons)
 *
 * TODO: delete this file once confirmed no imports reference it.
 *       grep -r "dashboard/integrations-client" src/  # should return 0 results
 */

// eslint-disable-next-line @typescript-eslint/no-empty-function
export default function DeprecatedIntegrationsClientStub() {
  throw new Error(
    "[AgentDyne] Imported deprecated integrations-client from (dashboard)/dashboard/. " +
    "Use (dashboard)/integrations/integrations-client instead."
  )
}
