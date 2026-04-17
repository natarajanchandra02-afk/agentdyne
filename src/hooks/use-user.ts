/**
 * useUser — Supabase auth hook with module-level cache.
 *
 * ROOT CAUSE of "infinite loading" on navigation:
 * Each component instance calls useState(loading: true) independently.
 * Navigation to /my-agents, /billing etc. mounted a fresh component
 * that started from loading=true and waited for getSession() every time.
 *
 * FIX: Module-level cache. After the first resolution, all subsequent
 * hook calls return the cached user instantly (loading: false).
 * Cache is invalidated on sign-in / sign-out via onAuthStateChange.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

// ─── Module-level singletons (survive across component mounts/unmounts) ───────

let _supabase: ReturnType<typeof createClient> | null = null
function getSupabase() {
  if (!_supabase) _supabase = createClient()
  return _supabase
}

// Resolved cache — once set, all hook instances start with this
let _cachedUser:     User | null = null
let _cachedProfile:  any        = null
let _cacheResolved:  boolean    = false   // true = we know the auth state for sure
let _cacheLoading:   boolean    = true    // false once first resolution completes

// Subscribers — components that need to re-render when cache changes
const _subscribers = new Set<() => void>()

function notifySubscribers() {
  _subscribers.forEach(fn => fn())
}

// ─── Background auth init (runs once, shared across all instances) ────────────

let _initStarted = false

async function initAuth() {
  if (_initStarted) return
  _initStarted = true

  const supabase = getSupabase()

  // Safety net: even if Supabase hangs, show buttons after 1.5s
  const safetyTimer = setTimeout(() => {
    if (_cacheLoading) {
      _cacheLoading   = false
      _cacheResolved  = true
      notifySubscribers()
    }
  }, 1500)

  try {
    // FAST: read session from cookies/localStorage (no network, ~0–5ms)
    const { data: { session } } = await supabase.auth.getSession()
    clearTimeout(safetyTimer)

    _cachedUser    = session?.user ?? null
    _cacheLoading  = false
    _cacheResolved = true
    notifySubscribers()

    // Load profile in background (non-blocking)
    if (_cachedUser) {
      loadProfile(_cachedUser.id)
    }

    // SECURE: server-validate the JWT (runs in background, ~200–500ms)
    supabase.auth.getUser().then(({ data }) => {
      const serverUser = data.user ?? null
      if (serverUser?.id !== _cachedUser?.id) {
        _cachedUser = serverUser
        if (!serverUser) _cachedProfile = null
        else loadProfile(serverUser.id)
        notifySubscribers()
      }
    }).catch(() => { /* keep local session on network failure */ })

  } catch {
    clearTimeout(safetyTimer)
    _cacheLoading  = false
    _cacheResolved = true
    notifySubscribers()
  }

  // Listen for login / logout / token refresh
  supabase.auth.onAuthStateChange(async (event, session) => {
    const u = session?.user ?? null
    _cachedUser    = u
    _cacheLoading  = false
    _cacheResolved = true
    if (u) await loadProfile(u.id)
    else    _cachedProfile = null
    notifySubscribers()
  })
}

async function loadProfile(userId: string) {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url, role, subscription_plan, is_verified")
      .eq("id", userId)
      .single()
    _cachedProfile = data
    notifySubscribers()
  } catch {
    // Non-critical — auth still works without profile
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useUser() {
  // Initialise from cache immediately — no loading flash on navigation
  const [state, setState] = useState(() => ({
    user:    _cachedUser,
    profile: _cachedProfile,
    loading: _cacheLoading,
  }))

  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    // Subscribe to cache changes
    const update = () => {
      if (mounted.current) {
        setState({
          user:    _cachedUser,
          profile: _cachedProfile,
          loading: _cacheLoading,
        })
      }
    }
    _subscribers.add(update)

    // Kick off shared init (idempotent — only runs once across all instances)
    initAuth()

    // If cache already resolved, sync immediately
    if (_cacheResolved) {
      setState({
        user:    _cachedUser,
        profile: _cachedProfile,
        loading: false,
      })
    }

    return () => {
      mounted.current = false
      _subscribers.delete(update)
    }
  }, [])

  return state
}
