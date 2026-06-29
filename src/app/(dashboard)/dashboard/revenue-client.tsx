/**
 * ⚠️  DEPRECATED — DO NOT IMPORT
 *
 * This file is a stale copy of the revenue client left over from an earlier
 * session when revenue-client.tsx lived inside (dashboard)/dashboard/.
 *
 * The canonical, bug-fixed version is now co-located at:
 *   src/app/(dashboard)/revenue/revenue-client.tsx
 *
 * Bugs that were present in this file and fixed in the canonical version:
 *   ✅ Bug 1  — loading never set to false when user is null (infinite spinner)
 *   ✅ Bug 2  — TrendingDown imported but unused
 *   ✅ Bug 3  — Calendar imported but unused
 *   ✅ Bug 4  — BarChart3 imported but unused
 *   ✅ Bug 4b — Fake/hardcoded monthly chart data (replaced with real queries)
 *   ✅ Bug 8  — Fragile cross-folder import path (fixed with relative import)
 *
 * TODO: delete this file once the team has confirmed no other imports reference it.
 *       grep -r "dashboard/revenue-client" src/  # should return 0 results
 */

// eslint-disable-next-line @typescript-eslint/no-empty-function
export default function DeprecatedRevenueClientStub() {
  throw new Error(
    "[AgentDyne] Imported deprecated revenue-client from (dashboard)/dashboard/. " +
    "Use (dashboard)/revenue/revenue-client instead."
  )
}
