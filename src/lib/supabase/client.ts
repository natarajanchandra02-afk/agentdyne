import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types/supabase"

// ─── Dummy Supabase client ────────────────────────────────────────────────────
// Returned when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are missing or placeholder.
// Prevents network errors, console spam, and infinite loading on first deploy.
// All operations return empty/null — the UI shows Sign In buttons (not a crash).

const DUMMY_CLIENT = {
  auth: {
    getSession:             async () => ({ data: { session: null }, error: null }),
    getUser:                async () => ({ data: { user: null }, error: null }),
    onAuthStateChange:      () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword:     async () => ({ data: null, error: { message: "Supabase not configured" } }),
    signInWithOAuth:        async () => ({ data: null, error: { message: "Supabase not configured" } }),
    signUp:                 async () => ({ data: null, error: { message: "Supabase not configured" } }),
    signOut:                async () => ({ error: null }),
    resetPasswordForEmail:  async () => ({ data: null, error: null }),
    updateUser:             async () => ({ data: null, error: null }),
  },
  from: (_table: string) => ({
    select: (..._args: any[]) => ({
      eq:       (..._a: any[]) => ({
        single:  async () => ({ data: null, error: null }),
        order:   (..._b: any[]) => ({ data: [], error: null, count: 0 }),
        limit:   (..._b: any[]) => ({ data: [], error: null, count: 0 }),
        in:      (..._b: any[]) => ({ data: [], error: null }),
        then:    (resolve: any) => resolve({ data: [], error: null }),
      }),
      in:      (..._a: any[]) => ({ data: [], error: null }),
      order:   (..._a: any[]) => ({
        limit:   (..._b: any[]) => ({ data: [], error: null, count: 0 }),
        then:    (resolve: any) => resolve({ data: [], error: null }),
        data: [], error: null, count: 0,
      }),
      limit:   (..._a: any[]) => ({ data: [], error: null }),
      single:  async () => ({ data: null, error: null }),
      textSearch: (..._a: any[]) => ({
        eq: (..._b: any[]) => ({
          order: (..._c: any[]) => ({ data: [], error: null, count: 0 }),
        }),
        order: (..._b: any[]) => ({ data: [], error: null, count: 0 }),
      }),
      contains: (..._a: any[]) => ({
        order: (..._b: any[]) => ({ data: [], error: null, count: 0 }),
      }),
      then:    (resolve: any) => resolve({ data: [], error: null, count: 0 }),
      data: [], error: null, count: 0,
    }),
    update: (..._args: any[]) => ({
      eq: (..._a: any[]) => ({ data: null, error: null }),
      then: (resolve: any) => resolve({ data: null, error: null }),
    }),
    insert: (..._args: any[]) => ({
      select: (..._a: any[]) => ({
        single: async () => ({ data: null, error: null }),
      }),
      then: (resolve: any) => resolve({ data: null, error: null }),
    }),
    delete: (..._args: any[]) => ({
      eq: (..._a: any[]) => ({ data: null, error: null }),
    }),
    upsert: (..._args: any[]) => ({ data: null, error: null }),
  }),
  storage: {
    from: (_bucket: string) => ({
      upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "" } }),
    }),
  },
  rpc: async (..._args: any[]) => ({ data: null, error: null }),
} as any

// ─── Singleton real client ───────────────────────────────────────────────────

let _realClient: ReturnType<typeof createBrowserClient<Database>> | null = null

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Detect missing / placeholder env vars
  const isMissing =
    !url || !key ||
    url === "https://your-project.supabase.co" ||
    url.includes("your-project") ||
    key === "your-anon-key"

  if (isMissing) {
    if (typeof window !== "undefined") {
      console.warn(
        "[AgentDyne] Supabase env vars not set.\n" +
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local\n" +
        "Get them from: Supabase Dashboard → Settings → API"
      )
    }
    return DUMMY_CLIENT
  }

  // Singleton — prevents multiple GoTrueClient instances
  if (!_realClient) {
    _realClient = createBrowserClient<Database>(url, key)
  }
  return _realClient
}
