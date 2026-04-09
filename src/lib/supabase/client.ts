import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types/supabase"

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Client-side: warn loudly if env vars are placeholder/missing
  if (typeof window !== "undefined") {
    if (!url || url.includes("your-project") || url === "https://your-project.supabase.co") {
      console.error(
        "❌ NEXT_PUBLIC_SUPABASE_URL is not set or is still the placeholder value.\n" +
        "Go to your Supabase dashboard → Settings → API and copy your real Project URL."
      )
    }
    if (!key || key === "your-anon-key") {
      console.error(
        "❌ NEXT_PUBLIC_SUPABASE_ANON_KEY is not set or is still the placeholder value.\n" +
        "Go to your Supabase dashboard → Settings → API and copy your real anon key."
      )
    }
  }

  // Server-side build without env vars — return dummy
  if (!url || !key || url.includes("your-project")) {
    if (typeof window === "undefined") {
      return {
        auth: {
          getUser:              async () => ({ data: { user: null }, error: null }),
          onAuthStateChange:    ()      => ({ data: { subscription: { unsubscribe: () => {} } } }),
          signInWithPassword:   async () => ({ data: null, error: null }),
          signInWithOAuth:      async () => ({ data: null, error: null }),
          signUp:               async () => ({ data: null, error: null }),
          signOut:              async () => ({ error: null }),
          resetPasswordForEmail:async () => ({ data: null, error: null }),
          updateUser:           async () => ({ data: null, error: null }),
        },
        from: () => ({
          select: () => ({
            eq:    () => ({ single: async () => ({ data: null, error: null }), order: () => ({ data: [], error: null }), limit: () => ({ data: [], error: null }) }),
            order: () => ({ data: [], error: null }),
            limit: () => ({ data: [], error: null }),
          }),
          update: () => ({ eq: () => ({ data: null, error: null }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
          delete: () => ({ eq: () => ({ data: null, error: null }) }),
          upsert: () => ({ data: null, error: null }),
        }),
        storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
        rpc: async () => ({ data: null, error: null }),
      } as any
    }
  }

  return createBrowserClient<Database>(url!, key!)
}
