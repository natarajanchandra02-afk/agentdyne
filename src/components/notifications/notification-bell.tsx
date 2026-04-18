"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Bell, X, Check, AlertCircle, CreditCard, Zap, ShieldAlert, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatRelativeTime } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type NotifType =
  | "billing_failure"
  | "credits_topup"
  | "agent_approved"
  | "agent_rejected"
  | "execution_failed"
  | "quota_warning"
  | "security_alert"
  | "system"
  | string

interface Notification {
  id:         string
  title:      string
  body:       string
  type:       NotifType
  is_read:    boolean
  action_url: string | null
  created_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon map by notification type
// ─────────────────────────────────────────────────────────────────────────────

function NotifIcon({ type, className }: { type: NotifType; className?: string }) {
  const map: Record<NotifType, { icon: any; color: string; bg: string }> = {
    billing_failure:  { icon: CreditCard,  color: "text-red-500",    bg: "bg-red-50"    },
    credits_topup:    { icon: CreditCard,  color: "text-green-500",  bg: "bg-green-50"  },
    agent_approved:   { icon: Check,       color: "text-green-500",  bg: "bg-green-50"  },
    agent_rejected:   { icon: X,           color: "text-red-500",    bg: "bg-red-50"    },
    execution_failed: { icon: AlertCircle, color: "text-amber-500",  bg: "bg-amber-50"  },
    quota_warning:    { icon: Zap,         color: "text-amber-500",  bg: "bg-amber-50"  },
    security_alert:   { icon: ShieldAlert, color: "text-red-500",    bg: "bg-red-50"    },
    system:           { icon: Info,        color: "text-blue-500",   bg: "bg-blue-50"   },
  }
  const cfg = map[type] ?? { icon: Bell, color: "text-zinc-400", bg: "bg-zinc-50" }
  const Icon = cfg.icon
  return (
    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0", cfg.bg, className)}>
      <Icon className={cn("h-4 w-4", cfg.color)} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000   // Poll every 30 seconds

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open,          setOpen]          = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [markingRead,   setMarkingRead]   = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fetchedRef  = useRef(false)

  const unreadCount = notifications.filter(n => !n.is_read).length

  // ── Fetch notifications ────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    try {
      const res  = await fetch("/api/notifications")
      if (!res.ok) return
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      fetchedRef.current = true
    } catch { /* silent — non-critical */ }
  }, [])

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open])

  // ── Mark all read when panel opens ────────────────────────────────────────
  const handleOpen = async () => {
    setOpen(o => !o)

    if (!open && unreadCount > 0 && !markingRead) {
      setMarkingRead(true)
      try {
        await fetch("/api/notifications", { method: "PATCH" })
        // Optimistically mark all as read
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      } catch { /* non-critical */ }
      finally { setMarkingRead(false) }
    }
  }

  // ── Navigate to action URL ─────────────────────────────────────────────────
  const handleNotifClick = (notif: Notification) => {
    setOpen(false)
    if (notif.action_url) {
      window.location.href = notif.action_url
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ""}`}
        className={cn(
          "relative h-9 w-9 rounded-xl flex items-center justify-center transition-colors",
          open
            ? "bg-zinc-100 text-zinc-900"
            : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
        )}
      >
        <Bell className="h-4 w-4" />

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className={cn(
          "absolute right-0 top-11 z-50 w-80 bg-white rounded-2xl shadow-xl border border-zinc-100",
          "animate-in fade-in-0 zoom-in-95 duration-150 origin-top-right"
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50">
            <h3 className="text-sm font-semibold text-zinc-900">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <span className="text-[10px] bg-red-50 text-red-500 font-bold px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-[380px] overflow-y-auto py-1 divide-y divide-zinc-50">
            {notifications.length === 0 ? (
              <div className="text-center py-10">
                <Bell className="h-8 w-8 text-zinc-200 mx-auto mb-2" />
                <p className="text-sm text-zinc-400">You're all caught up</p>
                <p className="text-xs text-zinc-300 mt-0.5">No new notifications</p>
              </div>
            ) : notifications.map(notif => (
              <button
                key={notif.id}
                onClick={() => handleNotifClick(notif)}
                className={cn(
                  "flex items-start gap-3 w-full text-left px-4 py-3 transition-colors",
                  notif.action_url
                    ? "hover:bg-zinc-50 cursor-pointer"
                    : "cursor-default",
                  !notif.is_read && "bg-blue-50/30"
                )}
              >
                <NotifIcon type={notif.type} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn(
                      "text-xs leading-snug line-clamp-1",
                      notif.is_read ? "font-medium text-zinc-700" : "font-semibold text-zinc-900"
                    )}>
                      {notif.title}
                    </p>
                    {!notif.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0 mt-1" />
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2 leading-snug">
                    {notif.body}
                  </p>
                  <p className="text-[10px] text-zinc-300 mt-1">
                    {formatRelativeTime(notif.created_at)}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-zinc-50">
              <button
                onClick={() => { setOpen(false); window.location.href = "/dashboard" }}
                className="text-xs text-primary hover:underline font-semibold w-full text-center"
              >
                View all in Dashboard →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
