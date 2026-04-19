/**
 * Supabase admin client — uses SERVICE ROLE KEY.
 *
 * Bypasses Row Level Security entirely.
 * ONLY import this in server-side code (API routes, Server Components).
 * NEVER expose this in client bundles — it grants full DB access.
 */
import { createClient as _createClient } from "@supabase/supabase-js"

export function createAdminClient() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !svcKey) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set."
    )
  }

  return _createClient(url, svcKey, {
    auth: {
      autoRefreshToken:  false,
      persistSession:    false,
      detectSessionInUrl: false,
    },
  })
}
