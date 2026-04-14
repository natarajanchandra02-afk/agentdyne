import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

// Module-level singleton — one Supabase client for the whole app
// Prevents "multiple GoTrueClient instances" warning and auth state race conditions
let _supabase: ReturnType<typeof createClient> | null = null
function getSupabase() {
  if (!_supabase) _supabase = createClient()
  return _supabase
}

export function useUser() {
  const [user,    setUser]    = useState<User | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = getSupabase()
    const { data: p } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url, role, subscription_plan, is_verified")
      .eq("id", userId)
      .single()
    if (mounted.current) setProfile(p)
  }, [])

  useEffect(() => {
    mounted.current = true
    const supabase  = getSupabase()

    // Initial session check
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted.current) return
      setUser(data.user)
      if (data.user) fetchProfile(data.user.id)
      else setLoading(false)
    }).finally(() => {
      if (mounted.current) setLoading(false)
    })

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted.current) return
        const u = session?.user ?? null
        setUser(u)
        if (u) {
          await fetchProfile(u.id)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => {
      mounted.current = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  return { user, profile, loading }
}
