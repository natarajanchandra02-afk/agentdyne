import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/types/supabase"

// Safe during Next.js static build — returns null if env vars missing
export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    // During static build without env vars, return a dummy client
    // Real client is created at runtime when env vars are available
    if (typeof window === "undefined") {
      // Server-side build: return minimal safe object
      return {
        auth: {
          getUser: async () => ({ data: { user: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
          signInWithPassword: async () => ({ error: new Error("No Supabase config") }),
          signInWithOAuth: async () => ({ error: new Error("No Supabase config") }),
          signUp: async () => ({ error: new Error("No Supabase config") }),
          signOut: async () => ({ error: null }),
          resetPasswordForEmail: async () => ({ error: new Error("No Supabase config") }),
          updateUser: async () => ({ error: new Error("No Supabase config") }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: null }),
              order: () => ({ data: [], error: null }),
              limit: () => ({ data: [], error: null }),
            }),
            order: () => ({ data: [], error: null }),
            limit: () => ({ data: [], error: null }),
          }),
          update: () => ({ eq: () => ({ data: null, error: null }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
          delete: () => ({ eq: () => ({ data: null, error: null }) }),
          upsert: () => ({ data: null, error: null }),
        }),
        storage: {
          from: () => ({
            upload: async () => ({ error: null }),
            getPublicUrl: () => ({ data: { publicUrl: "" } }),
          }),
        },
        rpc: async () => ({ data: null, error: null }),
      } as any
    }
  }

  return createBrowserClient<Database>(url!, key!)
}
