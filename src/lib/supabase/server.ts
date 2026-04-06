import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { Database } from "@/types/supabase"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Dummy client returned during static build when env vars are absent
function makeDummyServerClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
          order: () => ({ ascending: () => ({ data: [], error: null, count: 0 }) }),
          limit: () => ({ data: [], error: null }),
          gte: () => ({ data: [], error: null }),
          head: true,
        }),
        order: () => ({
          ascending: () => ({ data: [], error: null }),
          limit: () => ({ data: [], error: null }),
        }),
        count: () => ({ data: [], error: null, count: 0 }),
        limit: () => ({ data: [], error: null }),
        gte: () => ({ data: [], error: null }),
        range: () => ({ data: [], error: null, count: 0 }),
        textSearch: () => ({
          eq: () => ({
            order: () => ({
              range: () => ({ data: [], error: null, count: 0 }),
            }),
          }),
          order: () => ({
            range: () => ({ data: [], error: null, count: 0 }),
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({ single: async () => ({ data: null, error: null }) }),
          data: null,
          error: null,
        }),
      }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
      delete: () => ({ eq: () => ({ data: null, error: null }) }),
    }),
    rpc: async () => ({ data: null, error: null }),
  } as any
}

export const createClient = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return makeDummyServerClient()
  }

  const cookieStore = cookies()
  return createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export const createAdminClient = () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return makeDummyServerClient()
  }

  const cookieStore = cookies()
  return createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
