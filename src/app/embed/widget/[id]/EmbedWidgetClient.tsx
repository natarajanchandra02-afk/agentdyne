"use client"
import { useState, useRef, useEffect } from "react"

interface Message { role: "user" | "assistant"; content: string; streaming?: boolean }

interface EmbedConfig {
  name?: string; description?: string; iconUrl?: string
  embedConfig?: { theme?: string; primaryColor?: string; placeholder?: string }
}

export default function EmbedWidgetClient({ agentId }: { agentId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState("")
  const [loading, setLoading]   = useState(false)
  const [config, setConfig]     = useState<EmbedConfig | null>(null)
  const bottomRef               = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/agents/${agentId}/embed`).then(r => r.json()).then(setConfig).catch(() => {})
  }, [agentId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput("")
    setMessages(prev => [...prev, { role: "user", content: userMsg }])
    setLoading(true)

    const token = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("token")

    try {
      const res = await fetch("/api/execute/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-embed-token": token } : {}),
        },
        body: JSON.stringify({ agentId, input: userMsg }),
      })

      if (!res.body) throw new Error("No stream")
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = "", streaming = ""

      setMessages(prev => [...prev, { role: "assistant", content: "", streaming: true }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split("\n"); buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (raw === "[DONE]") continue
          try {
            const evt = JSON.parse(raw)
            if (evt.type === "token") {
              streaming += evt.token
              setMessages(prev => {
                const next = [...prev]
                next[next.length - 1] = { role: "assistant", content: streaming, streaming: true }
                return next
              })
            }
            if (evt.type === "done") {
              setMessages(prev => {
                const next = [...prev]
                next[next.length - 1] = { role: "assistant", content: streaming, streaming: false }
                return next
              })
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }])
    } finally {
      setLoading(false)
    }
  }

  const primary     = config?.embedConfig?.primaryColor ?? "#6366f1"
  const placeholder = config?.embedConfig?.placeholder  ?? "Ask me anything..."

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", background: "#fff", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10, background: "#fafafa" }}>
        {config?.iconUrl && (
          <img src={config.iconUrl} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover" }} />
        )}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>{config?.name ?? "Agent"}</div>
          {config?.description && (
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{(config.description as string).slice(0, 60)}</div>
          )}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 10, color: "#9ca3af", display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
          Powered by AgentDyne
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", marginTop: 48 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
            <div>{config?.description ?? "How can I help you today?"}</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf:   m.role === "user" ? "flex-end" : "flex-start",
            maxWidth:    "85%",
            padding:     "8px 12px",
            borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
            background:  m.role === "user" ? primary : "#f3f4f6",
            color:       m.role === "user" ? "#fff" : "#111",
            fontSize:    13,
            lineHeight:  1.5,
            whiteSpace:  "pre-wrap",
            wordBreak:   "break-word",
          }}>
            {m.content}
            {m.streaming && <span style={{ opacity: 0.5 }}>▌</span>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 8, background: "#fafafa" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={placeholder}
          disabled={loading}
          style={{
            flex: 1, padding: "8px 12px",
            border: "1px solid #d1d5db", borderRadius: 8,
            fontSize: 13, outline: "none",
            background: "#fff",
            transition: "border-color 0.15s",
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: "8px 16px",
            background: loading || !input.trim() ? "#e5e7eb" : primary,
            color: loading || !input.trim() ? "#9ca3af" : "#fff",
            border: "none", borderRadius: 8, cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 13, transition: "all 0.15s",
          }}
        >
          {loading ? "···" : "Send"}
        </button>
      </div>
    </div>
  )
}
