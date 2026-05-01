"use client"

import { useState, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Key, Plus, Copy, Check, Trash2, EyeOff, AlertTriangle,
  Zap, Clock, Shield, X, Code2, Terminal, ExternalLink,
  Globe, Lock, RefreshCw, Activity, ChevronDown, ChevronUp,
  Server, Cpu, AlertCircle, Info,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { hashApiKey } from "@/lib/api-key-auth"
import { formatDate, formatNumber, cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiKey {
  id:                   string
  name:                 string
  key_prefix:           string
  is_active:            boolean
  created_at:           string
  last_used_at:         string | null
  last_used_ip:         string | null
  total_calls:          number
  calls_today:          number
  errors_today:         number
  cost_total_usd:       number
  permissions:          string[]
  environment:          string
  allowed_agent_ids:    string[]
  ip_allowlist:         string[]
  expires_at:           string | null
  rate_limit_per_minute: number
  rate_limit_per_day:   number
}

type SdkTab     = "curl" | "python" | "node"
type ExpireOpt  = "30d" | "90d" | "1y" | "never"
type EnvType    = "production" | "test"

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBaseUrl() {
  if (typeof window === "undefined") return "https://agentdyne.com"
  return window.location.origin
}

function generateRawKey(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  const b64 = btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
  return `agd_${b64.slice(0, 40)}`
}

function expiresFromOpt(opt: ExpireOpt): string | null {
  if (opt === "never") return null
  const ms = { "30d": 30, "90d": 90, "1y": 365 }[opt] * 86400000
  return new Date(Date.now() + ms).toISOString()
}

// ── SDK Examples ──────────────────────────────────────────────────────────────

const SDK_EXAMPLES = {
  curl: (key: string) => `# Execute an agent
curl -X POST ${getBaseUrl()}/api/agents/{AGENT_ID}/execute \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"input": "your input here"}'

# Execute a pipeline
curl -X POST ${getBaseUrl()}/api/pipelines/{PIPELINE_ID}/execute \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "your input", "variables": {}}'

# Execute via share key (no auth needed for caller)
curl -X POST ${getBaseUrl()}/api/run/{SHARE_KEY} \\
  -H "Content-Type: application/json" \\
  -d '{"input": "your input"}'`,

  python: (key: string) => `import httpx, uuid

BASE_URL = "${getBaseUrl()}"
API_KEY  = "${key}"  # ⚠️ Server-side only — never expose in frontend

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type":  "application/json",
}

with httpx.Client(headers=headers) as client:
    # Execute agent (with idempotency to prevent duplicate runs)
    resp = client.post(
        f"{BASE_URL}/api/agents/{{AGENT_ID}}/execute",
        json={"input": "your input here"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    result = resp.json()
    print(result["output"])

    # Handle errors
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After", 60)
        print(f"Rate limited — retry after {retry_after}s")`,

  node: (key: string) => `// ⚠️ Server-side only — NEVER use API keys in browser/frontend code
const BASE_URL = "${getBaseUrl()}";
const API_KEY  = process.env.AGENTDYNE_API_KEY; // load from env

async function runAgent(agentId: string, input: string) {
  const resp = await fetch(\`\${BASE_URL}/api/agents/\${agentId}/execute\`, {
    method:  "POST",
    headers: {
      Authorization:    \`Bearer \${API_KEY}\`,
      "Content-Type":   "application/json",
      "Idempotency-Key": crypto.randomUUID(), // prevent duplicate runs on retry
    },
    body: JSON.stringify({ input }),
  });

  if (resp.status === 429) {
    const retryAfter = resp.headers.get("Retry-After") ?? "60";
    throw new Error(\`Rate limited — retry after \${retryAfter}s\`);
  }

  const { output, latency_ms, cost_usd } = await resp.json();
  return { output, latency_ms, cost_usd };
}`,
}

const SDK_TABS: Array<{ key: SdkTab; label: string; icon: React.ReactNode }> = [
  { key: "curl",   label: "cURL",    icon: <Terminal className="h-3.5 w-3.5" /> },
  { key: "python", label: "Python",  icon: <Code2    className="h-3.5 w-3.5" /> },
  { key: "node",   label: "Node.js", icon: <Code2    className="h-3.5 w-3.5" /> },
]

// ── Main component ────────────────────────────────────────────────────────────

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKey[] }) {
  const [keys,        setKeys]        = useState<ApiKey[]>(initialKeys)
  const [showForm,    setShowForm]    = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied,      setCopied]      = useState<string | null>(null)
  const [sdkTab,      setSdkTab]      = useState<SdkTab>("curl")
  const [rotating,    setRotating]    = useState<string | null>(null)

  // Create form state
  const [name,        setName]        = useState("")
  const [environment, setEnvironment] = useState<EnvType>("production")
  const [expiry,      setExpiry]      = useState<ExpireOpt>("1y")
  const [rateMinute,  setRateMinute]  = useState("60")
  const [creating,    setCreating]    = useState(false)

  const supabase    = createClient()
  const exampleKey  = justCreated ?? "agd_YOUR_API_KEY_HERE"
  const activeKeys  = keys.filter(k => k.is_active)
  const revokedKeys = keys.filter(k => !k.is_active)

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
    toast.success("Copied!")
  }

  const createKey = async () => {
    if (!name.trim()) { toast.error("Key name is required"); return }
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const rawKey  = generateRawKey()
      const keyHash = await hashApiKey(rawKey)   // HMAC-SHA256 (secure)
      const prefix  = rawKey.slice(0, 14)        // "agd_" + 10 chars

      const { data, error } = await supabase.from("api_keys").insert({
        user_id:              user.id,
        name:                 name.trim(),
        key_hash:             keyHash,
        key_prefix:           prefix,
        hash_algo:            "hmac-sha256",
        is_active:            true,
        environment,
        permissions:          ["execute", "read"],
        rate_limit_per_minute: parseInt(rateMinute) || 60,
        rate_limit_per_day:   5000,
        expires_at:           expiresFromOpt(expiry),
        allowed_agent_ids:    [],
        ip_allowlist:         [],
      }).select().single()

      if (error) throw error

      setKeys(prev => [data, ...prev])
      setJustCreated(rawKey)
      setName("")
      setShowForm(false)
      toast.success("API key created — save it now, it won't be shown again!")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setCreating(false)
    }
  }

  const revokeKey = async (id: string) => {
    const { error } = await supabase.from("api_keys")
      .update({ is_active: false }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k))
    toast.success("Key revoked")
  }

  const deleteKey = async (id: string) => {
    if (!confirm("Delete this key permanently? Any integrations using it will break immediately.")) return
    const { error } = await supabase.from("api_keys").delete().eq("id", id)
    if (error) { toast.error(error.message); return }
    setKeys(prev => prev.filter(k => k.id !== id))
    toast.success("Key deleted")
  }

  // Rotation: create new key → keep old active for 5 min → revoke old
  const rotateKey = async (oldKey: ApiKey) => {
    if (!confirm(`Rotate "${oldKey.name}"? A new key will be created. The old key stays active for 5 minutes to give your app time to swap it.`)) return
    setRotating(oldKey.id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const rawKey  = generateRawKey()
      const keyHash = await hashApiKey(rawKey)
      const prefix  = rawKey.slice(0, 14)

      const revokeAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

      const { data: newKey, error } = await supabase.from("api_keys").insert({
        user_id:              user.id,
        name:                 oldKey.name,
        key_hash:             keyHash,
        key_prefix:           prefix,
        hash_algo:            "hmac-sha256",
        is_active:            true,
        environment:          oldKey.environment,
        permissions:          oldKey.permissions,
        rate_limit_per_minute: oldKey.rate_limit_per_minute,
        rate_limit_per_day:   oldKey.rate_limit_per_day,
        expires_at:           oldKey.expires_at,
        allowed_agent_ids:    oldKey.allowed_agent_ids,
        ip_allowlist:         oldKey.ip_allowlist,
      }).select().single()

      if (error) throw error

      // Schedule old key revocation after 5 minutes
      await supabase.from("api_keys").update({
        rotate_before: revokeAt,
      }).eq("id", oldKey.id)

      // Actually revoke old key after 5 min (client-side timer — best effort)
      setTimeout(async () => {
        await supabase.from("api_keys").update({ is_active: false }).eq("id", oldKey.id)
        setKeys(prev => prev.map(k => k.id === oldKey.id ? { ...k, is_active: false } : k))
      }, 5 * 60 * 1000)

      setKeys(prev => [newKey, ...prev])
      setJustCreated(rawKey)
      toast.success("New key created — old key auto-revokes in 5 minutes")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRotating(null)
    }
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">API Keys</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Authenticate server-side requests to the AgentDyne API.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
          <Plus className="h-4 w-4" /> New Key
        </Button>
      </div>

      {/* Security notices */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3.5">
          <Shield className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-700 leading-relaxed">
            <p className="font-semibold mb-0.5">HMAC-SHA256 hashed</p>
            We store a keyed hash — not the raw key. Even a DB leak cannot recover your key.
          </div>
        </div>
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3.5">
          <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-700 leading-relaxed">
            <p className="font-semibold mb-0.5">Server-side only</p>
            Never use in browser, React components, or mobile apps. Always load from env vars.
          </div>
        </div>
      </div>

      {/* "Shown only once" banner */}
      <AnimatePresence>
        {justCreated && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-900 text-sm">Save your key — shown only once</p>
                <p className="text-xs text-zinc-500 mt-0.5 mb-3">
                  We store a one-way hash. Once you close this, you cannot retrieve the full key.
                  Store it in your environment variables, password manager, or secrets vault — never in code.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-white border border-amber-200 rounded-xl px-3 py-2 truncate text-zinc-700">
                    {justCreated}
                  </code>
                  <button onClick={() => copy(justCreated, "new")}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-xl hover:bg-zinc-700 transition-colors">
                    {copied === "new" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === "new" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400 mt-2">
                  Example: <code className="font-mono">AGENTDYNE_API_KEY={justCreated.slice(0, 20)}…</code> in your .env
                </p>
              </div>
              <button onClick={() => setJustCreated(null)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-4"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <h2 className="text-sm font-semibold text-zinc-900">Create new API key</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-600">Key name</Label>
                <Input placeholder="e.g. Production Server, CI/CD, Local Dev"
                  value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createKey()}
                  className="rounded-xl border-zinc-200 h-9 text-sm" />
              </div>

              {/* Environment */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-600">Environment</Label>
                <div className="flex gap-2">
                  {(["production", "test"] as EnvType[]).map(env => (
                    <button key={env} onClick={() => setEnvironment(env)}
                      className={cn(
                        "flex-1 h-9 rounded-xl border text-xs font-semibold transition-all",
                        environment === env
                          ? env === "production"
                            ? "bg-zinc-900 text-white border-zinc-900"
                            : "bg-blue-50 text-blue-700 border-blue-200"
                          : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                      )}>
                      {env === "production" ? "🚀 Production" : "🧪 Test"}
                    </button>
                  ))}
                </div>
                {environment === "test" && (
                  <p className="text-[11px] text-blue-600">Test keys are visually distinct — safe for dev environments.</p>
                )}
              </div>

              {/* Expiry */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-600">Expiration</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {([["30d","30 days"],["90d","90 days"],["1y","1 year"],["never","Never"]] as [ExpireOpt,string][]).map(([val,label]) => (
                    <button key={val} onClick={() => setExpiry(val)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl border text-xs font-medium transition-all",
                        expiry === val
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                      )}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rate limit */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-600">Rate limit (requests / minute)</Label>
                <Input type="number" min={1} max={1000} value={rateMinute}
                  onChange={e => setRateMinute(e.target.value)}
                  className="rounded-xl border-zinc-200 h-9 text-sm w-32" />
                <p className="text-[11px] text-zinc-400">Daily limit: 5,000 calls</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={createKey} disabled={creating || !name.trim()}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 h-9 text-sm font-semibold">
                {creating ? "Creating…" : "Create Key"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}
                className="rounded-xl border-zinc-200 h-9 text-sm">
                Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Key list */}
      <div className="space-y-3">
        {keys.length === 0 ? (
          <div className="bg-white border border-zinc-100 rounded-2xl py-16 text-center"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="w-12 h-12 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
              <Key className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="font-semibold text-zinc-900 mb-1">No API keys yet</h3>
            <p className="text-sm text-zinc-400 mb-4">Create a key to start calling agents from your server-side code.</p>
            <Button onClick={() => setShowForm(true)}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
              <Plus className="h-4 w-4" /> Create your first key
            </Button>
          </div>
        ) : (
          <>
            {activeKeys.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Active ({activeKeys.length})</p>
                {activeKeys.map((key, i) => (
                  <KeyCard key={key.id} apiKey={key} index={i}
                    onRevoke={() => revokeKey(key.id)}
                    onDelete={() => deleteKey(key.id)}
                    onRotate={() => rotateKey(key)}
                    onCopy={copy} copiedId={copied}
                    rotating={rotating === key.id}
                  />
                ))}
              </div>
            )}
            {revokedKeys.length > 0 && (
              <div className="space-y-3 mt-4">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Revoked ({revokedKeys.length})</p>
                {revokedKeys.map((key, i) => (
                  <KeyCard key={key.id} apiKey={key} index={i}
                    onRevoke={() => {}} onDelete={() => deleteKey(key.id)}
                    onRotate={() => {}} onCopy={copy} copiedId={copied} rotating={false}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* SDK Quickstart */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-900">Quickstart</h3>
          <a href="/docs" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline">
            Full docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-xl p-0.5 w-fit mb-3">
          {SDK_TABS.map(tab => (
            <button key={tab.key} onClick={() => setSdkTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                sdkTab === tab.key ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-900"
              )}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <pre className="text-xs font-mono bg-zinc-900 text-zinc-200 rounded-xl px-4 py-4 overflow-x-auto leading-relaxed whitespace-pre">
            {SDK_EXAMPLES[sdkTab](exampleKey)}
          </pre>
          <button onClick={() => copy(SDK_EXAMPLES[sdkTab](exampleKey), `sdk-${sdkTab}`)}
            className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 transition-colors">
            {copied === `sdk-${sdkTab}` ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-zinc-400" />}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="flex items-start gap-2 bg-white border border-zinc-100 rounded-xl px-3 py-2.5">
            <RefreshCw className="h-3.5 w-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[11px] font-semibold text-zinc-700">Idempotency-Key</p>
              <p className="text-[10px] text-zinc-400">Add header to prevent duplicate runs on retry</p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-white border border-zinc-100 rounded-xl px-3 py-2.5">
            <Server className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[11px] font-semibold text-zinc-700">Server-side only</p>
              <p className="text-[10px] text-zinc-400">Never use in browser or frontend code</p>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-white border border-zinc-100 rounded-xl px-3 py-2.5">
            <Cpu className="h-3.5 w-3.5 text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[11px] font-semibold text-zinc-700">Rate limits</p>
              <p className="text-[10px] text-zinc-400">429 → check Retry-After header</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Key card ──────────────────────────────────────────────────────────────────

function KeyCard({ apiKey: key, index, onRevoke, onDelete, onRotate, onCopy, copiedId, rotating }: {
  apiKey:   ApiKey
  index:    number
  onRevoke: () => void
  onDelete: () => void
  onRotate: () => void
  onCopy:   (text: string, id: string) => void
  copiedId: string | null
  rotating: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isTest   = key.environment === "test"
  const isExpired = key.expires_at ? new Date(key.expires_at) < new Date() : false
  const expireSoon = key.expires_at && !isExpired
    ? (new Date(key.expires_at).getTime() - Date.now()) < 7 * 86400000
    : false

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        "bg-white border rounded-2xl transition-all",
        isTest ? "border-blue-100" : "border-zinc-100",
        !key.is_active && "opacity-55"
      )}
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

      {/* Test environment badge */}
      {isTest && (
        <div className="flex items-center gap-1.5 bg-blue-50 border-b border-blue-100 px-5 py-2 rounded-t-2xl">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Test Environment</span>
        </div>
      )}

      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left: key info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5",
              key.is_active ? (isTest ? "bg-blue-50" : "bg-primary/8") : "bg-zinc-50"
            )}>
              <Key className={cn("h-4 w-4", key.is_active ? (isTest ? "text-blue-500" : "text-primary") : "text-zinc-400")} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-zinc-900">{key.name}</span>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1",
                  key.is_active ? "bg-green-50 text-green-600" : "bg-zinc-100 text-zinc-500"
                )}>
                  {key.is_active ? <><Globe className="h-2.5 w-2.5" /> Active</> : <><Lock className="h-2.5 w-2.5" /> Revoked</>}
                </span>
                {expireSoon && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-2.5 w-2.5" /> Expires soon
                  </span>
                )}
              </div>

              {/* Prefix + copy */}
              <div className="flex items-center gap-2 mt-1">
                <code className="text-xs text-zinc-400 font-mono">{key.key_prefix}••••••••••</code>
                <button onClick={() => onCopy(key.key_prefix, `pfx-${key.id}`)}
                  className="text-zinc-300 hover:text-zinc-600 transition-colors" title="Copy prefix">
                  {copiedId === `pfx-${key.id}` ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>

              {/* Permissions */}
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {(key.permissions ?? []).map(p => (
                  <span key={p} className="text-[10px] bg-zinc-50 border border-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full font-mono">{p}</span>
                ))}
                {(key.allowed_agent_ids?.length ?? 0) > 0 && (
                  <span className="text-[10px] bg-purple-50 border border-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">
                    {key.allowed_agent_ids.length} agent scope
                  </span>
                )}
                {(key.ip_allowlist?.length ?? 0) > 0 && (
                  <span className="text-[10px] bg-green-50 border border-green-100 text-green-600 px-1.5 py-0.5 rounded-full">
                    IP restricted
                  </span>
                )}
              </div>

              {/* Usage stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 mt-2.5">
                <div className="text-xs text-zinc-400 flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  <span className="text-zinc-600 font-medium">{formatNumber(key.calls_today ?? 0)}</span> today
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  <span className="text-zinc-600 font-medium">{formatNumber(key.total_calls ?? 0)}</span> total
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 text-red-300" />
                  <span className={cn("font-medium", (key.errors_today ?? 0) > 0 ? "text-red-500" : "text-zinc-600")}>
                    {key.errors_today ?? 0}
                  </span> errors
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  <span className="text-zinc-600 font-medium">${(key.cost_total_usd ?? 0).toFixed(4)}</span> cost
                </div>
              </div>

              {/* Timestamps + IP */}
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-400 flex-wrap">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Created {formatDate(key.created_at)}
                </span>
                {key.last_used_at && (
                  <span className="flex items-center gap-1">
                    Last used {formatDate(key.last_used_at)}
                    {key.last_used_ip && (
                      <span className="ml-1 font-mono bg-zinc-100 px-1 rounded text-zinc-500">
                        {key.last_used_ip}
                      </span>
                    )}
                  </span>
                )}
                {key.expires_at && (
                  <span className={cn("flex items-center gap-1", isExpired && "text-red-400")}>
                    {isExpired ? "Expired" : "Expires"} {formatDate(key.expires_at)}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  {key.rate_limit_per_minute}/min limit
                </span>
              </div>
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {key.is_active && (
              <>
                <button onClick={onRotate} disabled={rotating}
                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-2.5 py-1.5 rounded-xl transition-colors disabled:opacity-50"
                  title="Rotate key — creates new key, old stays active 5 min">
                  <RefreshCw className={cn("h-3.5 w-3.5", rotating && "animate-spin")} />
                  Rotate
                </button>
                <button onClick={onRevoke}
                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-2.5 py-1.5 rounded-xl transition-colors">
                  <EyeOff className="h-3.5 w-3.5" /> Revoke
                </button>
              </>
            )}
            <button onClick={onDelete}
              className="p-1.5 text-zinc-400 hover:text-red-500 rounded-xl transition-colors" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
            <button onClick={() => setExpanded(!expanded)}
              className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-xl transition-colors" title="Details">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Expanded details */}
        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden">
              <div className="border-t border-zinc-50 mt-4 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-zinc-400 font-medium mb-1">Agent scope</p>
                  <p className="text-zinc-600">
                    {(key.allowed_agent_ids?.length ?? 0) === 0
                      ? "All agents (unrestricted)"
                      : `${key.allowed_agent_ids.length} specific agent(s) only`}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-400 font-medium mb-1">IP allowlist</p>
                  <p className="text-zinc-600">
                    {(key.ip_allowlist?.length ?? 0) === 0
                      ? "All IPs allowed"
                      : key.ip_allowlist.join(", ")}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-400 font-medium mb-1">Rate limits</p>
                  <p className="text-zinc-600">{key.rate_limit_per_minute}/min · {formatNumber(key.rate_limit_per_day ?? 5000)}/day</p>
                </div>
                <div>
                  <p className="text-zinc-400 font-medium mb-1">Key ID (for support)</p>
                  <code className="text-zinc-500 font-mono text-[10px]">{key.id}</code>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
