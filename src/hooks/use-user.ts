import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

// Module-level singleton — one Supabase client for the entire app lifetime.
// Prevents "multiple GoTrueClient instances" warnings and auth race conditions.
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

    // ── FAST PATH: getSession() reads from localStorage (~0ms, no network) ──
    // This gives an immediate answer so the navbar renders Sign in / avatar
    // instantly without showing a grey skeleton for 200-500ms.
    // Security note: getSession() trusts the stored token without server
    // validation. The SECURE PATH below validates it server-side in background.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted.current) return
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)                       // ← loading false = buttons visible NOW
      if (u) fetchProfile(u.id)
    }).catch(() => {
      // localStorage unavailable (SSR edge case) — fall through to auth listener
      if (mounted.current) setLoading(false)
    })

    // ── SECURE PATH: getUser() validates the JWT with Supabase servers ──────
    // Runs in background after the fast path. If the session turns out to be
    // expired or revoked, this corrects the displayed state silently.
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted.current) return
      const serverUser = data.user ?? null

      setUser(prev => {
        if (prev?.id !== serverUser?.id) {
          // Session was invalid — clear profile or fetch new one
          if (!serverUser) {
            setProfile(null)
          } else {
            fetchProfile(serverUser.id)
          }
          return serverUser
        }
        return prev   // No change — avoid unnecessary re-renders
      })
    }).catch(() => {
      // Network error validating session — keep whatever getSession() returned
    })

    // ── REALTIME: Listen for login / logout / token refresh events ──────────
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
