"use client"

/**
 * SupportChat — Floating AI support widget.
 *
 * Features:
 * - Streaming responses via /api/support/chat (SSE)
 * - Conversation memory (last 12 turns)
 * - Suggested questions for onboarding
 * - Minimise / maximise / close
 * - Keyboard: Enter to send, Shift+Enter for newline
 */

import { useState, useRef, useEffect, useCallback } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  MessageCircle, X, Send, Loader2, Bot,
  Minimize2, ChevronDown, RefreshCw, ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface Message { role: "user" | "assistant"; content: string; id: string }

const SUGGESTIONS = [
  "How do I create my first agent?",
  "Why is my execution failing?",
  "How do pipelines work?",
  "What's included in the free plan?",
  "How do I earn from my agents?",
  "How do I use the API?",
]

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 h-4">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-400"
          style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
      <style>{`@keyframes pulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
    </span>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user"
  return (
    <div className={cn("flex gap-2 max-w-full", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className={cn(
        "px-3 py-2 rounded-2xl text-xs leading-relaxed max-w-[82%] whitespace-pre-wrap break-words",
        isUser
          ? "bg-zinc-900 text-white rounded-tr-sm"
          : "bg-zinc-100 text-zinc-800 rounded-tl-sm"
      )}>
        {msg.content}
      </div>
    </div>
  )
}

export function SupportChat() {
  const [open,      setOpen]      = useState(false)
  const [minimised, setMinimised] = useState(false)
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState("")
  const [streaming, setStreaming] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const abortRef   = useRef<AbortController | null>(null)

  const idRef = useRef(0)
  const nextId = () => String(++idRef.current)

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open && !minimised)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, open, minimised])

  // Focus input when opening
  useEffect(() => {
    if (open && !minimised) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open, minimised])

  // Show unread indicator after 8s if widget not opened
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setHasUnread(true), 8000)
      return () => clearTimeout(t)
    }
    setHasUnread(false)
  }, [open])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    setInput("")
    const userMsg: Message = { role: "user", content: trimmed, id: nextId() }
    const assistantMsg: Message = { role: "assistant", content: "", id: nextId() }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const history = messages.concat(userMsg).slice(-11).map(m => ({
        role:    m.role,
        content: m.content,
      }))

      const res = await fetch("/api/support/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ messages: history }),
        signal:  abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: err.error || "Something went wrong. Try again or visit /contact." }
            : m
        ))
        return
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ""
      let   full    = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const payload = line.slice(5).trim()
          if (payload === "[DONE]") continue
          try {
            const parsed = JSON.parse(payload)
            if (parsed.text) {
              full += parsed.text
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, content: full } : m
              ))
            }
            if (parsed.error) {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, content: `Error: ${parsed.error}` } : m
              ))
            }
          } catch { /* malformed chunk */ }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: "Connection lost. Please try again." }
          : m
      ))
    } finally {
      setStreaming(false)
    }
  }, [messages, streaming])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setMessages([])
    setStreaming(false)
    setInput("")
  }

  const isLastAssistantEmpty =
    messages.length > 0 &&
    messages[messages.length - 1]?.role === "assistant" &&
    messages[messages.length - 1]?.content === "" &&
    streaming

  return (
    <>
      {/* Floating button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => { setOpen(true); setHasUnread(false) }}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-zinc-900 text-white shadow-2xl flex items-center justify-center hover:bg-zinc-700 transition-colors"
            aria-label="Open support chat"
          >
            <MessageCircle className="h-6 w-6" />
            {hasUnread && (
              <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 rounded-full ring-2 ring-white" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-zinc-100 overflow-hidden flex flex-col"
            style={{ maxHeight: minimised ? "56px" : "560px", height: minimised ? "56px" : "560px", transition: "max-height 0.25s ease, height 0.25s ease" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">Dyne AI Support</p>
                  <p className="text-[10px] text-zinc-400">Powered by Claude · Always available</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button onClick={reset} className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded-lg" title="New conversation">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={() => setMinimised(m => !m)} className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded-lg">
                  {minimised ? <MessageCircle className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => setOpen(false)} className="p-1.5 text-zinc-400 hover:text-white transition-colors rounded-lg">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Body — hidden when minimised */}
            {!minimised && (
              <>
                {/* Messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
                  {messages.length === 0 ? (
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Bot className="h-3.5 w-3.5 text-white" />
                        </div>
                        <div className="bg-zinc-100 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-zinc-800 leading-relaxed">
                          Hi! I'm Dyne, AgentDyne's AI assistant. Ask me anything about agents, pipelines, billing, or getting started. ⚡
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-2 pl-8">Suggested questions</p>
                        <div className="space-y-1.5">
                          {SUGGESTIONS.map(s => (
                            <button key={s}
                              onClick={() => send(s)}
                              className="w-full text-left text-xs text-zinc-600 hover:text-zinc-900 bg-zinc-50 hover:bg-zinc-100 border border-zinc-100 px-3 py-2 rounded-xl transition-all">
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map(msg => (
                        msg.content === "" && msg.role === "assistant" && streaming
                          ? (
                            <div key={msg.id} className="flex gap-2">
                              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Bot className="h-3.5 w-3.5 text-white" />
                              </div>
                              <div className="bg-zinc-100 rounded-2xl rounded-tl-sm px-3 py-2.5">
                                <TypingDots />
                              </div>
                            </div>
                          )
                          : <MessageBubble key={msg.id} msg={msg} />
                      ))}
                      {/* Quick actions after last assistant message */}
                      {!streaming && messages.length > 2 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {["How do I fix this?", "Tell me more", "Open docs"].map(q => (
                            <button key={q}
                              onClick={() => q === "Open docs" ? window.open("/docs", "_blank") : send(q)}
                              className="text-[10px] text-zinc-500 hover:text-zinc-800 bg-zinc-50 hover:bg-zinc-100 border border-zinc-100 px-2 py-1 rounded-full transition-all flex items-center gap-0.5">
                              {q === "Open docs" && <ExternalLink className="h-2.5 w-2.5" />}
                              {q}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Input */}
                <div className="border-t border-zinc-100 px-3 py-3 flex-shrink-0">
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKey}
                      disabled={streaming}
                      rows={1}
                      maxLength={1000}
                      placeholder="Ask anything… (Enter to send)"
                      className="flex-1 resize-none text-xs text-zinc-900 placeholder:text-zinc-400 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-zinc-400 transition-colors leading-relaxed disabled:opacity-50"
                      style={{ maxHeight: "80px" }}
                      onInput={e => {
                        const el = e.currentTarget
                        el.style.height = "auto"
                        el.style.height = Math.min(el.scrollHeight, 80) + "px"
                      }}
                    />
                    <button
                      onClick={() => send(input)}
                      disabled={!input.trim() || streaming}
                      className="w-9 h-9 rounded-xl bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
                      aria-label="Send message"
                    >
                      {streaming
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[9px] text-zinc-300 text-center mt-2">
                    AI-powered · May occasionally be wrong · <a href="/contact" className="hover:text-zinc-500 transition-colors">Contact support</a>
                  </p>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
