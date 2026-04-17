import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

// Module-level singleton — one Supabase client for the entire app lifetime.
let _supabase: ReturnType<typeof createClient> | null = null
function getSupabase() {
  if (!_supabase) _supabase = createClient()
  return _supabase
}

export function useUser() {
  const [user,    setUser]    = useState<User | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const mounted   = useRef(true)

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const supabase = getSupabase()
      const { data: p } = await supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url, role, subscription_plan, is_verified")
        .eq("id", userId)
        .single()
      if (mounted.current) setProfile(p)
    } catch {
      // Profile fetch failure is non-critical — don't block the auth flow
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const supabase  = getSupabase()

    // ── SAFETY NET — always show buttons within 3s even if Supabase hangs ──
    // Cloudflare env vars missing or network slow → loading skeleton must not
    // spin forever. After 3s we force loading=false and show Sign In buttons.
    const safetyTimer = setTimeout(() => {
      if (mounted.current) setLoading(false)
    }, 3000)

    // ── FAST PATH: read from localStorage (~0ms) ────────────────────────────
    // getSession() is synchronous-ish (reads IndexedDB/localStorage).
    // Sets loading=false immediately so the navbar renders Sign In / avatar
    // without waiting for a network round-trip to Supabase.
    const fastInit = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!mounted.current) return
        clearTimeout(safetyTimer)           // Network responded — cancel the safety timer
        const u = session?.user ?? null
        setUser(u)
        setLoading(false)                   // ← buttons visible NOW
        if (u) fetchProfile(u.id)
      } catch {
        // getSession not available (dummy client or SSR) — safety net takes over
        if (mounted.current) {
          clearTimeout(safetyTimer)
          setLoading(false)
        }
      }
    }
    fastInit()

    // ── SECURE PATH: server-validate the JWT ───────────────────────────────
    // Runs in background. If token is expired/revoked, corrects displayed state.
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted.current) return
      const serverUser = data.user ?? null
      setUser(prev => {
        if (prev?.id !== serverUser?.id) {
          if (!serverUser) setProfile(null)
          else fetchProfile(serverUser.id)
          return serverUser
        }
        return prev
      })
    }).catch(() => {
      // Network validation failed — keep whatever getSession returned
    })

    // ── REALTIME: login / logout / token-refresh events ────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted.current) return
        const u = session?.user ?? null
        setUser(u)
        if (u) await fetchProfile(u.id)
        else    setProfile(null)
        setLoading(false)
      }
    )

    return () => {
      mounted.current = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  return { user, profile, loading }
}
