import { createServerClient }           from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies }                       from "next/headers"
import type { Database }                 from "@/types/supabase"

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL   ?? ""
const SUPABASE_ANON_KEY    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY  ?? ""

// ─── Configuration checks ─────────────────────────────────────────────────────

function isValidUrl(url: string): boolean {
  try { new URL(url); return true } catch { return false }
}

const isAnonConfigured =
  !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
  isValidUrl(SUPABASE_URL) &&
  !SUPABASE_URL.includes("your-project") &&
  SUPABASE_ANON_KEY.length > 20

const isServiceConfigured =
  !!SUPABASE_URL && !!SUPABASE_SERVICE_KEY &&
  isValidUrl(SUPABASE_URL) &&
  !SUPABASE_URL.includes("your-project") &&
  SUPABASE_SERVICE_KEY.length > 20

// ─── Dummy client ─────────────────────────────────────────────────────────────
// Returned when env vars are absent. Prevents hard crashes but logs clear
// actionable instructions.

function makeDummyClient(reason: "anon" | "service") {
  const hint = reason === "anon"
    ? "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
    : "Set SUPABASE_SERVICE_ROLE_KEY (server-only, never NEXT_PUBLIC_)"

  if (process.env.NODE_ENV !== "test") {
    console.error(
      `[AgentDyne] Supabase ${reason} client not configured. ${hint}.\n` +
      `  Get values from: Supabase Dashboard → your project → Settings → API\n` +
      `  Cloudflare Pages: add env vars in Project → Settings → Environment Variables`
    )
  }

  const qb = (): any => {
    const q: any = {}
    ;["select","insert","update","upsert","delete","eq","neq","in","not","or","and",
      "gt","gte","lt","lte","is","ilike","like","filter","order","limit","range",
      "contains","textSearch","maybeSingle","single"].forEach(m => { q[m] = () => q })
    q.single    = async () => ({ data: null, error: null })
    q.maybeSingle = async () => ({ data: null, error: null })
    q.then      = (resolve: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
    return q
  }

  return {
    auth: {
      getUser:                async () => ({ data: { user: null }, error: null }),
      exchangeCodeForSession: async () => ({ data: null,          error: null }),
      updateUser:             async () => ({ data: null,          error: null }),
      signOut:                async () => ({ error: null }),
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null }),
        getUserById: async () => ({ data: { user: null }, error: null }),
        deleteUser: async () => ({ data: null, error: null }),
      },
    },
    from:    (_: string) => qb(),
    rpc:     async (_fn: string, _args?: any) => ({ data: null, error: null }),
    storage: {
      from: (_: string) => ({
        upload:       async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove:       async () => ({ data: null, error: null }),
        list:         async () => ({ data: [],   error: null }),
      }),
    },
    channel: (_: string) => ({
      on: () => ({ subscribe: () => {} }),
      subscribe: () => {},
    }),
    removeChannel: () => {},
  } as any
}

// ─── Session-aware client (anon key + cookie) ─────────────────────────────────
/**
 * createClient — App Router server components / API routes
 *
 * Uses anon key + cookie session → respects RLS.
 * Next.js 15: cookies() is async — always `await createClient()`.
 */
export async function createClient() {
  if (!isAnonConfigured) {
    return makeDummyClient("anon")
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

// ─── Admin client (service role — bypasses RLS) ───────────────────────────────
/**
 * createAdminClient — server-only, bypasses ALL Row Level Security
 *
 * ⚠️  Only for API routes, Server Actions, background jobs.
 * ⚠️  NEVER expose to the browser or use in client components.
 *
 * Does NOT use cookies — safe to call from webhook handlers, cron jobs,
 * and background tasks where the Next.js cookie store is unavailable.
 */
export function createAdminClient() {
  if (!isServiceConfigured) {
    return makeDummyClient("service")
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
