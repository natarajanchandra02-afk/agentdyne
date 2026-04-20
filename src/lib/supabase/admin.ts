/**
 * Supabase admin client — uses SERVICE ROLE KEY.
 *
 * Bypasses Row Level Security entirely.
 * ONLY import this in server-side code (API routes, Server Components).
 * NEVER expose this in client bundles — it grants full DB access.
 *
 * Gracefully returns a no-op dummy when env vars are missing (e.g. at
 * build time) so the build does not crash on missing SUPABASE_SERVICE_ROLE_KEY.
 * All methods on the dummy return safe empty results — actual runtime calls
 * will fail loudly in the API response, not silently at the module level.
 */
import { createClient as _createClient } from "@supabase/supabase-js"

function makeDummy() {
  const noop = () => ({
    select: () => noop(),
    eq:     () => noop(),
    single: () => Promise.resolve({ data: null, error: { message: "Admin client not configured" } }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: { message: "Admin client not configured" } }),
    update: () => noop(),
    delete: () => noop(),
    order:  () => noop(),
    limit:  () => noop(),
    range:  () => Promise.resolve({ data: [], error: null, count: 0 }),
    ilike:  () => noop(),
    or:     () => noop(),
  })
  return {
    from: (_: string) => noop(),
    rpc:  (_: string) => Promise.resolve({ data: null, error: { message: "Admin client not configured" } }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
  } as any
}

export function createAdminClient() {
  const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !svcKey) {
    // Return dummy at build time — don't throw (would break Cloudflare Pages build)
    // At runtime this will return error responses; set env vars in CF dashboard.
    console.error(
      "[AgentDyne] createAdminClient: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL not set. " +
      "Admin operations will fail. Add these in Cloudflare Pages → Settings → Environment Variables."
    )
    return makeDummy()
  }

  return _createClient(url, svcKey, {
    auth: {
      autoRefreshToken:   false,
      persistSession:     false,
      detectSessionInUrl: false,
    },
  })
}
