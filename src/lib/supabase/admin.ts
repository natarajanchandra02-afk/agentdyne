/**
 * Re-exports createAdminClient from the canonical server module.
 *
 * Both `@/lib/supabase/admin` and `@/lib/supabase/server` export
 * createAdminClient so that existing imports from either path work.
 *
 * The canonical implementation is in server.ts — it uses the plain
 * Supabase JS client (no cookies) with the service role key.
 */
export { createAdminClient } from "./server"
