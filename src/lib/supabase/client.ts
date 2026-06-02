import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types/supabase"

// ─── Environment checks ───────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

/**
 * isSupabaseConfigured
 *
 * Returns true only when BOTH public vars are set to real (non-placeholder) values.
 * Used by the login page to show a configuration error banner instead of
 * silently failing with a cryptic "Supabase not configured" toast.
 *
 * Note: SUPABASE_SERVICE_ROLE_KEY is server-only — it is NOT checked here.
 * Login uses the anon key + browser client, not the service role key.
 */
export function isSupabaseConfigured(): boolean {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false
  if (SUPABASE_URL.includes("your-project") || SUPABASE_URL === "https://your-project.supabase.co") return false
  if (SUPABASE_ANON_KEY === "your-anon-key" || SUPABASE_ANON_KEY.length < 20) return false
  try { new URL(SUPABASE_URL) } catch { return false }
  return true
}

// ─── Dummy client ─────────────────────────────────────────────────────────────
// Returned ONLY when env vars are genuinely missing.
// Every auth method returns a clear, actionable error message.

function makeDummyClient() {
  const CONFIG_ERROR = {
    message:
      "Supabase is not configured. " +
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "in .env.local (local) or in Cloudflare Pages → Settings → Environment Variables (production). " +
      "Get both values from: Supabase Dashboard → your project → Settings → API",
    code: "SUPABASE_NOT_CONFIGURED",
  }

  const qb = (): any => {
    const q: any = {}
    const noop = () => q
    ;["select","insert","update","upsert","delete","eq","neq","in","not","or","and",
      "gt","gte","lt","lte","is","ilike","like","filter","order","limit","range",
      "contains","textSearch","maybeSingle"].forEach(m => { q[m] = noop })
    q.single = async () => ({ data: null, error: null })
    q.then   = (resolve: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
    return q
  }

  return {
    auth: {
      getSession:             async () => ({ data: { session: null }, error: null }),
      getUser:                async () => ({ data: { user: null },    error: null }),
      onAuthStateChange:      () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword:     async () => ({ data: null, error: CONFIG_ERROR }),
      signInWithOAuth:        async () => ({ data: null, error: CONFIG_ERROR }),
      signUp:                 async () => ({ data: null, error: CONFIG_ERROR }),
      signOut:                async () => ({ error: null }),
      resetPasswordForEmail:  async () => ({ data: null, error: null }),
      updateUser:             async () => ({ data: null, error: null }),
    },
    from:    (_: string) => qb(),
    rpc:     async (..._: any[]) => ({ data: null, error: null }),
    channel: (_: string) => ({
      on: () => ({ subscribe: () => ({ status: "CLOSED" }) }),
      subscribe: (_cb?: any) => {
        _cb?.("CHANNEL_ERROR")
        return {}
      },
    }),
    removeChannel: () => {},
    storage: {
      from: (_: string) => ({
        upload:       async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        remove:       async () => ({ data: null, error: null }),
      }),
    },
  } as any
}

// ─── Singleton real client ────────────────────────────────────────────────────
// One GoTrueClient per browser tab — prevents auth state conflicts.

let _realClient: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createClient() {
  if (!isSupabaseConfigured()) {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
      console.error(
        "[AgentDyne] Supabase is NOT configured.\n" +
        "Required variables:\n" +
        "  NEXT_PUBLIC_SUPABASE_URL   — your Supabase project URL\n" +
        "  NEXT_PUBLIC_SUPABASE_ANON_KEY — your public anon key\n\n" +
        "Get them from: Supabase Dashboard → your project → Settings → API\n\n" +
        "Note: SUPABASE_SERVICE_ROLE_KEY is server-only. " +
        "Login requires the NEXT_PUBLIC_ vars, not the service role key.\n\n" +
        "Cloudflare Pages: add the NEXT_PUBLIC_ vars in Project → Settings → Environment Variables " +
        "(they must be set as 'production' vars, NOT as build-only secrets)."
      )
    }
    return makeDummyClient()
  }

  if (!_realClient) {
    _realClient = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return _realClient
}
