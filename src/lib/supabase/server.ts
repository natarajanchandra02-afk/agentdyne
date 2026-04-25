import { createServerClient }  from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies }             from "next/headers"
import type { Database }       from "@/types/supabase"

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ─── Dummy client (returned when env vars are missing) ────────────────────────
// Prevents hard crashes during local dev or CI when Supabase isn't configured.
// Every method returns a safe no-op result.

function makeDummyClient() {
  const noRow = { data: null, error: null }
  const noCount = { data: [], error: null, count: 0 }
  const mockQueryBuilder = (): any => {
    const q: any = {
      select:     () => q,
      eq:         () => q,
      neq:        () => q,
      in:         () => q,
      not:        () => q,
      or:         () => q,
      and:        () => q,
      gt:         () => q,
      gte:        () => q,
      lt:         () => q,
      lte:        () => q,
      is:         () => q,
      ilike:      () => q,
      like:       () => q,
      filter:     () => q,
      order:      () => q,
      limit:      () => q,
      range:      () => q,
      single:     async () => noRow,
      maybeSingle: async () => noRow,
      then:       (resolve: any) => Promise.resolve(noCount).then(resolve),
    }
    q.insert = () => q
    q.update = () => q
    q.upsert = () => q
    q.delete = () => q
    return q
  }

  return {
    auth: {
      getUser:                async () => ({ data: { user: null }, error: null }),
      exchangeCodeForSession: async () => ({ data: null, error: null }),
      updateUser:             async () => ({ data: null, error: null }),
      signOut:                async () => ({ error: null }),
    },
    from:    (_: string) => mockQueryBuilder(),
    rpc:     async (_fn: string, _args?: any) => ({ data: null, error: null }),
    storage: {
      from: () => ({
        upload:       async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove:       async () => ({ data: null, error: null }),
      }),
    },
  } as any
}

/**
 * createClient
 *
 * Session-aware Supabase client for App Router server components / routes.
 * Uses anon key + cookie session — respects RLS.
 *
 * Next.js 15: cookies() is async — always await createClient().
 */
export async function createClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL or ANON_KEY missing — using dummy client")
    return makeDummyClient()
  }

  const cookieStore = await cookies()

  return createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll()     { return cookieStore.getAll() },
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Read-only context during static rendering — safe to ignore
          }
        },
      },
    }
  )
}

/**
 * createAdminClient
 *
 * Service-role Supabase client — bypasses ALL Row Level Security.
 * ⚠️  Only use in server-side code (API routes, Server Actions).
 * ⚠️  Never expose this to the browser — it grants full DB access.
 *
 * Uses the plain JS client (not SSR) because the service-role key
 * does not need cookie-based session management.
 * This avoids the `cookies()` dependency in webhook handlers and
 * background jobs where the cookie store may not be available.
 */
export function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[supabase] SUPABASE_SERVICE_ROLE_KEY missing — using dummy admin client")
    return makeDummyClient()
  }

  return createSupabaseClient<Database>(
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    {
      auth: {
        autoRefreshToken:   false,
        persistSession:     false,
        detectSessionInUrl: false,
      },
    }
  )
}
