/**
 * useNotifications — real-time notification hook
 *
 * Fetches notifications on mount, then subscribes to Supabase Realtime
 * for instant bell updates without polling. Falls back to polling every
 * 30s if Realtime is unavailable.
 *
 * Usage:
 *   const { notifications, unreadCount, markAllRead } = useNotifications()
 */
"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

export interface Notification {
  id:         string
  type:       string
  title:      string
  body?:      string | null
  is_read:    boolean
  read_at?:   string | null
  action_url?: string | null
  channel:    string
  created_at: string
}

export function useNotifications(limit = 20) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount,   setUnreadCount]   = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [userId,        setUserId]        = useState<string | null>(null)
  const supabase = createClient()
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const res  = await fetch(`/api/notifications?limit=${limit}`)
      if (!res.ok) return
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      setUnreadCount(data.unread_count ?? 0)
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [limit])

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
    await fetch("/api/notifications", { method: "PATCH" }).catch(() => {})
  }, [])

  // Optimistically mark single notification read
  const markRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }, [])

  useEffect(() => {
    // Get user ID for realtime subscription
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  useEffect(() => {
    if (!userId) return

    // Supabase Realtime subscription — instant updates
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: Notification }) => {
          const newNotif = payload.new
          setNotifications(prev => [newNotif, ...prev.slice(0, limit - 1)])
          setUnreadCount(prev => prev + 1)
        }
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR") {
          // Fallback: poll every 30s if Realtime fails
          if (!pollTimer.current) {
            pollTimer.current = setInterval(fetchNotifications, 30_000)
          }
        }
      })

    return () => {
      supabase.removeChannel(channel)
      if (pollTimer.current) {
        clearInterval(pollTimer.current)
        pollTimer.current = null
      }
    }
  }, [userId, limit, fetchNotifications])

  return { notifications, unreadCount, loading, markAllRead, markRead, refresh: fetchNotifications }
}
