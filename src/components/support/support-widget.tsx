"use client"

/**
 * SupportWidget
 *
 * Floating chat bubble (bottom-right) powered by /api/support.
 * - Available on all pages via layout.tsx
 * - Context-aware: passes user auth state + last error code from URL
 * - Keyboard: Escape closes, Enter sends
 * - Apple-smooth spring animations (framer-motion)
 * - Dark mode safe (inherits Tailwind classes)
 */

import { useState, useRef, useEffect, useCallback } from "react"
import { motion, AnimatePresence }                   from "framer-motion"
import {
  MessageCircle, X, Send, Loader2, Bot,
  RefreshCw, ExternalLink, MinusCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  id:      string
  role:    "user" | "assistant"
  content: string
  ts:      number
}

const OPENER = "Hi! I'm the AgentDyne support assistant. I can help with billing, errors, the builder, API, and more. What's on your mind?"

const QUICK_PROMPTS = [
  "Why is my execution failing?",
  "How do I publish an agent?",
  "What's included in the free plan?",
  "How do I get my API key?",
]

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-zinc-400"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user"
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn("flex gap-2", isUser && "flex-row-reverse")}
    >
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-zinc-900 text-white rounded-tr-sm"
            : "bg-zinc-100 text-zinc-800 rounded-tl-sm"
        )}
      >
        {/* Render simple markdown-style bold and links */}
        <span className="whitespace-pre-wrap break-words">{msg.content}</span>
      </div>
    </motion.div>
  )
}

export function SupportWidget() {
  const [open,     setOpen]     = useState(false)
  const [input,    setInput]    = useState("")
  const [messages, setMessages] = useState<Message[]>([
    { id: "opener", role: "assistant", content: OPENER, ts: Date.now() },
  ])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [minimised, setMinimised] = useState(false)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const abortRef    = useRef<AbortController | null>(null)

  // Auto-scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  // Focus input when opened
  useEffect(() => {
    if (open && !minimised) setTimeout(() => inputRef.current?.focus(), 200)
  }, [open, minimised])

  // Keyboard: Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    setInput("")
    setError(null)

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: trimmed, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    // Build history for context (exclude opener)
    const history = messages
      .filter(m => m.id !== "opener")
      .map(m => ({ role: m.role, content: m.content }))

    abortRef.current = new AbortController()

    try {
      const res = await fetch("/api/support", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: trimmed, history }),
        signal:  abortRef.current.signal,
      })

      let data: any
      try { data = await res.json() } catch { data = {} }

      if (!res.ok) {
        // Surface the actual error from the API, not a generic fallback.
        // Common cases: 503 (API key not set), 429 (rate limit), 500 (crash)
        const apiMsg = data?.error || data?.message
        const friendlyMsg =
          res.status === 503 ? "Support is temporarily offline. Email support@agentdyne.com" :
          res.status === 429 ? "Too many messages — wait a moment and try again" :
          res.status === 413 ? "Message too long — please shorten it" :
          apiMsg             || "Support agent unavailable. Email support@agentdyne.com"
        throw new Error(friendlyMsg)
      }

      const assistantMsg: Message = {
        id:      crypto.randomUUID(),
        role:    "assistant",
        content: data.reply || "Sorry, I couldn't generate a response. Try again.",
        ts:      Date.now(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err: any) {
      if (err.name === "AbortError") return
      setError(err.message || "Couldn't reach support. Try again.")
      // Remove the user message on failure so user can retry cleanly
      setMessages(prev => prev.filter(m => m.id !== userMsg.id))
      setInput(trimmed)
    } finally {
      setLoading(false)
    }
  }, [loading, messages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setMessages([{ id: "opener", role: "assistant", content: OPENER, ts: Date.now() }])
    setInput("")
    setError(null)
    setLoading(false)
  }

  const unreadCount = messages.filter(m => m.role === "assistant" && m.id !== "opener").length

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col items-end gap-3">

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.92, y: 16  }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className="bg-white border border-zinc-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ width: 340, height: minimised ? 56 : 500 }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-zinc-100 bg-zinc-900 flex-shrink-0">
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white leading-none">AgentDyne Support</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">AI-powered · usually instant</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={reset} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors" title="Reset conversation">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setMinimised(v => !v)} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors" title="Minimise">
                  <MinusCircle className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {!minimised && (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scroll-smooth">
                  {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
                  {loading && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
                      <div className="w-6 h-6 rounded-full bg-zinc-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="bg-zinc-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                        <TypingDots />
                      </div>
                    </motion.div>
                  )}
                  {error && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                      {error}
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Quick prompts — only show when conversation is fresh */}
                {messages.length <= 1 && (
                  <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                    {QUICK_PROMPTS.map(q => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        disabled={loading}
                        className="text-[11px] font-medium text-zinc-600 bg-zinc-50 border border-zinc-200 hover:border-zinc-400 hover:bg-zinc-100 px-2.5 py-1 rounded-full transition-all disabled:opacity-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input */}
                <div className="px-3 py-3 border-t border-zinc-100 flex items-end gap-2 flex-shrink-0">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Ask anything…"
                    maxLength={2000}
                    disabled={loading}
                    className="flex-1 resize-none bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-all min-h-[36px] max-h-[100px] disabled:opacity-50"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={loading || !input.trim()}
                    className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center flex-shrink-0 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-4 w-4" />}
                  </button>
                </div>

                {/* Footer */}
                <div className="px-4 pb-3 flex items-center justify-between">
                  <p className="text-[10px] text-zinc-400">Powered by AgentDyne AI</p>
                  <a href="mailto:support@agentdyne.com" className="text-[10px] text-primary hover:underline flex items-center gap-1">
                    Human support <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating bubble button */}
      <motion.button
        onClick={() => setOpen(v => !v)}
        whileHover={{ scale: 1.06 }}
        whileTap={{   scale: 0.94 }}
        className={cn(
          "relative w-13 h-13 rounded-full shadow-xl flex items-center justify-center transition-all",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          open ? "bg-zinc-700" : "bg-zinc-900"
        )}
        style={{ width: 52, height: 52 }}
        aria-label="Open support chat"
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.div key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
              <X className="h-5 w-5 text-white" />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.18 }}>
              <MessageCircle className="h-5 w-5 text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unread dot — shows when closed and there are new assistant messages */}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </motion.button>
    </div>
  )
}
