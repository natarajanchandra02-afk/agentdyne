"use client"

import { useState } from "react"
import { Plus, Trash2, RefreshCw, Check, X, Copy, Webhook, Loader2, Shield, Zap, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

const WEBHOOK_EVENTS = [
  { id: "execution.success",   label: "Execution succeeded",     desc: "Fired when an agent execution completes successfully"   },
  { id: "execution.failed",    label: "Execution failed",        desc: "Fired when an agent execution fails or times out"       },
  { id: "pipeline.success",    label: "Pipeline succeeded",      desc: "Fired when all pipeline steps complete"                 },
  { id: "pipeline.failed",     label: "Pipeline failed",         desc: "Fired when any pipeline step fails"                    },
  { id: "eval.completed",      label: "Evaluation completed",    desc: "Fired when an agent evaluation run finishes"            },
  { id: "quota.warning",       label: "Quota warning (80%)",     desc: "Fired when monthly execution quota hits 80%"           },
  { id: "agent.approved",      label: "Agent approved",          desc: "Fired when your agent passes marketplace review"       },
  { id: "agent.rejected",      label: "Agent rejected",          desc: "Fired when your agent is rejected with feedback"       },
  { id: "payout.processed",    label: "Payout processed",        desc: "Fired when a seller payout is sent"                    },
]

interface Webhook {
  id: string; url: string; events: string[]
  is_active: boolean; secret: string; last_triggered_at: string | null
  failure_count: number; created_at: string
}

interface Props { initialWebhooks: Webhook[] }

function EventCheckbox({ id, label, desc, checked, onChange }: {
  id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className={cn(
      "flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-all",
      checked ? "border-primary/30 bg-primary/[0.02]" : "border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50/50"
    )}>
      <div className={cn(
        "w-4 h-4 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-all",
        checked ? "bg-primary border-primary" : "border-zinc-300"
      )}>
        {checked && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      </div>
      <input type="checkbox" className="sr-only" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div>
        <p className="text-sm font-medium text-zinc-900">{label}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
      </div>
    </label>
  )
}

function WebhookRow({ webhook, onDelete, onTest, onToggle }: {
  webhook: Webhook
  onDelete: (id: string) => void
  onTest: (id: string) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [testing, setTesting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    await onTest(webhook.id)
    setTesting(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    await onDelete(webhook.id)
    setDeleting(false)
  }

  const copySecret = () => {
    navigator.clipboard.writeText(webhook.secret)
    toast.success("Secret copied")
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-4"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-sm font-mono text-zinc-900 truncate max-w-xs">{webhook.url}</code>
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
              webhook.is_active ? "bg-green-50 text-green-600 border border-green-100" : "bg-zinc-100 text-zinc-400"
            )}>
              {webhook.is_active ? "Active" : "Paused"}
            </span>
            {webhook.failure_count > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-100 flex items-center gap-1">
                <AlertCircle className="h-2.5 w-2.5" />{webhook.failure_count} failures
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {webhook.events.slice(0, 4).map(e => (
              <Badge key={e} variant="secondary" className="text-[10px] py-0 px-2 rounded-full">
                {e.replace(".", " ")}
              </Badge>
            ))}
            {webhook.events.length > 4 && (
              <Badge variant="secondary" className="text-[10px] py-0 px-2 rounded-full">
                +{webhook.events.length - 4} more
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}
            className="rounded-xl text-xs h-8 gap-1.5">
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Test
          </Button>
          <Button variant="outline" size="sm" onClick={() => onToggle(webhook.id, !webhook.is_active)}
            className="rounded-xl text-xs h-8">
            {webhook.is_active ? "Pause" : "Enable"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting}
            className="rounded-xl text-xs h-8 text-red-500 hover:bg-red-50 border-red-100">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Signing secret */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 flex items-center gap-3">
        <Shield className="h-4 w-4 text-zinc-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-zinc-500 mb-1">Signing secret</p>
          <code className="text-xs font-mono text-zinc-700 block truncate">
            {showSecret ? webhook.secret : `${webhook.secret.slice(0, 8)}${"•".repeat(24)}`}
          </code>
        </div>
        <button onClick={() => setShowSecret(!showSecret)} className="text-xs text-zinc-400 hover:text-zinc-600">
          {showSecret ? "Hide" : "Show"}
        </button>
        <button onClick={copySecret} className="text-zinc-400 hover:text-zinc-600">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      {webhook.last_triggered_at && (
        <p className="text-xs text-zinc-400">
          Last triggered: {new Date(webhook.last_triggered_at).toLocaleString()}
        </p>
      )}
    </div>
  )
}

export default function WebhooksClient({ initialWebhooks }: Props) {
  const [webhooks, setWebhooks]   = useState<Webhook[]>(initialWebhooks)
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [url, setUrl]             = useState("")
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["execution.success", "execution.failed"])

  const toggleEvent = (id: string, on: boolean) => {
    setSelectedEvents(prev => on ? [...prev, id] : prev.filter(e => e !== id))
  }

  const createWebhook = async () => {
    if (!url.trim()) { toast.error("URL is required"); return }
    if (!url.startsWith("https://")) { toast.error("URL must use HTTPS"); return }
    if (selectedEvents.length === 0) { toast.error("Select at least one event"); return }

    setSaving(true)
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create webhook")
      setWebhooks(prev => [data.webhook, ...prev])
      setUrl(""); setSelectedEvents(["execution.success", "execution.failed"])
      setShowForm(false)
      toast.success("Webhook created")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteWebhook = async (id: string) => {
    const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" })
    if (res.ok) {
      setWebhooks(prev => prev.filter(w => w.id !== id))
      toast.success("Webhook deleted")
    } else {
      toast.error("Failed to delete webhook")
    }
  }

  const testWebhook = async (id: string) => {
    const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" })
    const data = await res.json()
    if (res.ok) toast.success(`Test delivery sent (${data.status ?? 200})`)
    else toast.error(data.error ?? "Test failed")
  }

  const toggleWebhook = async (id: string, active: boolean) => {
    const res = await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: active }),
    })
    if (res.ok) {
      setWebhooks(prev => prev.map(w => w.id === id ? { ...w, is_active: active } : w))
      toast.success(active ? "Webhook enabled" : "Webhook paused")
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Webhook className="h-6 w-6 text-primary" /> Webhooks
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Receive real-time HTTP POST notifications for execution events.
            Payloads are signed with HMAC-SHA256 using your per-webhook secret.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 flex-shrink-0">
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "Cancel" : "Add Webhook"}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-6 space-y-5"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h2 className="text-sm font-semibold text-zinc-900">New Webhook</h2>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-zinc-700">Endpoint URL</Label>
            <div className="relative">
              <Zap className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://your-server.com/webhooks/agentdyne"
                className="pl-9 rounded-xl border-zinc-200 h-10 font-mono text-sm"
              />
            </div>
            <p className="text-xs text-zinc-400">Must be a publicly accessible HTTPS URL</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-zinc-700">Events to subscribe</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {WEBHOOK_EVENTS.map(evt => (
                <EventCheckbox
                  key={evt.id} id={evt.id} label={evt.label} desc={evt.desc}
                  checked={selectedEvents.includes(evt.id)}
                  onChange={v => toggleEvent(evt.id, v)}
                />
              ))}
            </div>
          </div>

          <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3">
            <p className="text-xs text-zinc-500 flex items-start gap-2">
              <Shield className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-zinc-400" />
              A unique signing secret will be generated. Verify payloads by computing
              <code className="mx-1 bg-zinc-100 px-1 rounded">HMAC-SHA256(secret, payload)</code>
              and comparing to the <code className="mx-1 bg-zinc-100 px-1 rounded">X-AgentDyne-Signature</code> header.
            </p>
          </div>

          <Button onClick={createWebhook} disabled={saving}
            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving ? "Creating…" : "Create Webhook"}
          </Button>
        </div>
      )}

      {/* Webhook list */}
      {webhooks.length === 0 && !showForm ? (
        <div className="text-center py-16 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
          <Webhook className="h-10 w-10 text-zinc-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-500">No webhooks configured</p>
          <p className="text-xs text-zinc-400 mt-1 mb-5">
            Add a webhook to receive real-time execution notifications
          </p>
          <Button onClick={() => setShowForm(true)}
            className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
            <Plus className="h-4 w-4" /> Add Your First Webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(w => (
            <WebhookRow key={w.id} webhook={w}
              onDelete={deleteWebhook} onTest={testWebhook} onToggle={toggleWebhook} />
          ))}
        </div>
      )}

      {/* Payload format docs */}
      {webhooks.length > 0 && (
        <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-zinc-900 mb-3">Payload format</h3>
          <pre className="text-xs text-zinc-600 bg-white border border-zinc-100 rounded-xl p-4 overflow-x-auto font-mono leading-relaxed">{`{
  "event": "execution.success",
  "timestamp": "2026-05-31T10:00:00Z",
  "data": {
    "executionId": "abc-123",
    "agentId": "xyz-456",
    "agentName": "Code Review Agent",
    "status": "success",
    "latencyMs": 1240,
    "costUsd": 0.00312,
    "tokens": { "input": 850, "output": 220 }
  }
}`}</pre>
        </div>
      )}
    </div>
  )
}
