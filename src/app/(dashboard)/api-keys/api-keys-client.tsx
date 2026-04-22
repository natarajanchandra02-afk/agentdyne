"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Key, Plus, Copy, Check, Trash2, EyeOff, AlertTriangle,
  Zap, Clock, Shield, X, Code2, Terminal, ExternalLink,
  Globe, Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { generateApiKey, formatDate, formatNumber, cn } from "@/lib/utils"
import toast from "react-hot-toast"

interface ApiKey {
  id:           string
  name:         string
  key_prefix:   string
  is_active:    boolean
  created_at:   string
  last_used_at: string | null
  total_calls:  number
  permissions?: string[]
}

// ── SDK examples — use relative path so the correct domain is always used ─────
// Using window.location.origin to get the current deployment URL.
// This ensures it works correctly whether deployed to agentdyne.com, a staging
// domain, or localhost — zero hardcoding.

function getBaseUrl() {
  if (typeof window === "undefined") return "https://agentdyne.com"
  return window.location.origin
}

const SDK_EXAMPLES = {
  curl: (key: string) => `# Replace {AGENT_ID} with an agent ID from the marketplace
curl -X POST ${getBaseUrl()}/api/agents/{AGENT_ID}/execute \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "your input here"}'`,

  python: (key: string) => `import httpx

BASE_URL = "${getBaseUrl()}"
API_KEY  = "${key}"

with httpx.Client(headers={"Authorization": f"Bearer {API_KEY}"}) as client:
    response = client.post(
        f"{BASE_URL}/api/agents/{{AGENT_ID}}/execute",
        json={"input": "your input here"},
    )
    result = response.json()
    print(result["output"])`,

  node: (key: string) => `const BASE_URL = "${getBaseUrl()}";
const API_KEY  = "${key}";

const response = await fetch(\`\${BASE_URL}/api/agents/\${AGENT_ID}/execute\`, {
  method: "POST",
  headers: {
    Authorization:  \`Bearer \${API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ input: "your input here" }),
});
const { output, latencyMs, cost } = await response.json();`,
}

type SdkTab = "curl" | "python" | "node"

const SDK_TABS: Array<{ key: SdkTab; label: string; icon: React.ReactNode }> = [
  { key: "curl",   label: "cURL",    icon: <Terminal className="h-3.5 w-3.5" /> },
  { key: "python", label: "Python",  icon: <Code2    className="h-3.5 w-3.5" /> },
  { key: "node",   label: "Node.js", icon: <Code2    className="h-3.5 w-3.5" /> },
]

// ── Main component ────────────────────────────────────────────────────────────

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKey[] }) {
  const [keys,        setKeys]        = useState<ApiKey[]>(initialKeys)
  const [newKeyName,  setNewKeyName]  = useState("")
  const [creating,    setCreating]    = useState(false)
  const [showForm,    setShowForm]    = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied,      setCopied]      = useState<string | null>(null)
  const [sdkTab,      setSdkTab]      = useState<SdkTab>("curl")
  const supabase = createClient()

  // Use the real key in examples, placeholder otherwise
  const exampleKey = justCreated ?? "agd_YOUR_API_KEY_HERE"

  const createKey = async () => {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      // CSPRNG key generation — 36 random bytes → base64url → "agd_" prefix
      const rawKey    = generateApiKey()
      const msgBuffer = new TextEncoder().encode(rawKey)
      const hashBuf   = await crypto.subtle.digest("SHA-256", msgBuffer)
      const keyHash   = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("")
      const prefix    = rawKey.slice(0, 12)  // first 12 chars for display

      const { data, error } = await supabase.from("api_keys").insert({
        user_id:    user.id,
        name:       newKeyName.trim(),
        key_hash:   keyHash,
        key_prefix: prefix,
        is_active:  true,
        permissions: ["execute", "read"],  // default scopes
      }).select().single()

      if (error) throw error

      setKeys(prev => [data, ...prev])
      setJustCreated(rawKey)
      setNewKeyName("")
      setShowForm(false)
      toast.success("API key created — save it now!")
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
    toast.success("Key revoked — it can no longer authenticate requests")
  }

  const deleteKey = async (id: string) => {
    if (!confirm("Delete this API key permanently? Active integrations using it will break immediately.")) return
    const { error } = await supabase.from("api_keys").delete().eq("id", id)
    if (error) { toast.error(error.message); return }
    setKeys(prev => prev.filter(k => k.id !== id))
    toast.success("Key deleted")
  }

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
    toast.success("Copied!")
  }

  const activeKeys  = keys.filter(k => k.is_active)
  const revokedKeys = keys.filter(k => !k.is_active)

  return (
    <div className="space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">API Keys</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Authenticate requests to the AgentDyne API. Keys are hashed with SHA-256 — store yours securely.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
          <Plus className="h-4 w-4" /> New Key
        </Button>
      </div>

      {/* ── Security notice ────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4">
        <Shield className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 leading-relaxed">
          <span className="font-semibold">Security:</span> We store a one-way SHA-256 hash of your key — never the raw key.
          All API calls are authenticated server-side. Never commit keys to Git.
          Keys expire in 1 year by default.
        </div>
      </div>

      {/* ── "Shown only once" banner ───────────────────────────────────────── */}
      <AnimatePresence>
        {justCreated && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-900 text-sm">Save your key — shown only once</p>
                <p className="text-xs text-zinc-500 mt-0.5 mb-3">
                  We store a one-way hash only. Once you close this banner, you cannot retrieve the full key again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-white border border-amber-200 rounded-xl px-3 py-2 truncate text-zinc-700 min-w-0">
                    {justCreated}
                  </code>
                  <button
                    onClick={() => copy(justCreated, "new")}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-xl hover:bg-zinc-700 transition-colors">
                    {copied === "new"
                      ? <Check className="h-3.5 w-3.5 text-green-400" />
                      : <Copy className="h-3.5 w-3.5" />}
                    {copied === "new" ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
              <button onClick={() => setJustCreated(null)} className="text-zinc-400 hover:text-zinc-600 flex-shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Create form ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-white border border-zinc-100 rounded-2xl p-5"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">Create new API key</h2>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs font-medium text-zinc-600">Key name (describe where you'll use it)</Label>
                <Input
                  placeholder="e.g. Production App, CI/CD Pipeline, Local Dev…"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createKey()}
                  className="rounded-xl border-zinc-200 h-9 text-sm"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={createKey} disabled={creating || !newKeyName.trim()}
                  className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 h-9 text-sm font-semibold">
                  {creating ? "Creating…" : "Create Key"}
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)}
                  className="rounded-xl border-zinc-200 h-9 text-sm">
                  Cancel
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-zinc-400 mt-2">
              New keys have <code className="bg-zinc-100 px-1 rounded text-[10px]">execute</code> and <code className="bg-zinc-100 px-1 rounded text-[10px]">read</code> permissions.
              Execution costs are billed to your account.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Active keys ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {keys.length === 0 ? (
          <div className="bg-white border border-zinc-100 rounded-2xl py-16 text-center"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div className="w-12 h-12 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
              <Key className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="font-semibold text-zinc-900 mb-1">No API keys yet</h3>
            <p className="text-sm text-zinc-400 mb-4">Create a key to start calling agents from your code or CI/CD pipeline.</p>
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
                    onCopy={copy}
                    copiedId={copied}
                  />
                ))}
              </div>
            )}
            {revokedKeys.length > 0 && (
              <div className="space-y-3 mt-4">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Revoked ({revokedKeys.length})</p>
                {revokedKeys.map((key, i) => (
                  <KeyCard key={key.id} apiKey={key} index={i}
                    onRevoke={() => revokeKey(key.id)}
                    onDelete={() => deleteKey(key.id)}
                    onCopy={copy}
                    copiedId={copied}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── SDK Quickstart ─────────────────────────────────────────────────── */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-900">Quickstart</h3>
          <a href="/docs" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline">
            Full docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Tabs */}
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

        {/* Code block */}
        <div className="relative">
          <pre className="text-xs font-mono bg-zinc-900 text-zinc-200 rounded-xl px-4 py-4 overflow-x-auto leading-relaxed whitespace-pre">
            {SDK_EXAMPLES[sdkTab](exampleKey)}
          </pre>
          <button
            onClick={() => copy(SDK_EXAMPLES[sdkTab](exampleKey), `sdk-${sdkTab}`)}
            className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 transition-colors"
            title="Copy">
            {copied === `sdk-${sdkTab}`
              ? <Check className="h-3.5 w-3.5 text-green-400" />
              : <Copy className="h-3.5 w-3.5 text-zinc-400" />}
          </button>
        </div>

        <p className="text-xs text-zinc-400 mt-3 leading-relaxed">
          Replace <code className="bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded font-mono">{"{AGENT_ID}"}</code> with an
          agent ID from the{" "}
          <a href="/marketplace" className="text-primary hover:underline">marketplace</a>.
          Get agent IDs from the agent detail page → API tab.
        </p>
      </div>
    </div>
  )
}

// ── Key card component ────────────────────────────────────────────────────────

function KeyCard({ apiKey: key, index, onRevoke, onDelete, onCopy, copiedId }: {
  apiKey:    ApiKey
  index:     number
  onRevoke:  () => void
  onDelete:  () => void
  onCopy:    (text: string, id: string) => void
  copiedId:  string | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        "bg-white border border-zinc-100 rounded-2xl p-5 transition-all",
        !key.is_active && "opacity-55"
      )}
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5",
            key.is_active ? "bg-primary/8" : "bg-zinc-50"
          )}>
            <Key className={cn("h-4 w-4", key.is_active ? "text-primary" : "text-zinc-400")} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-zinc-900">{key.name}</span>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1",
                key.is_active ? "bg-green-50 text-green-600" : "bg-zinc-100 text-zinc-500"
              )}>
                {key.is_active
                  ? <><Globe className="h-2.5 w-2.5" /> Active</>
                  : <><Lock className="h-2.5 w-2.5" /> Revoked</>}
              </span>
            </div>
            <code className="text-xs text-zinc-400 font-mono mt-1 block">
              {key.key_prefix}••••••••••••
            </code>
            {/* Permissions */}
            {key.permissions && key.permissions.length > 0 && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {key.permissions.map(p => (
                  <span key={p} className="text-[10px] bg-zinc-50 border border-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full font-mono">
                    {p}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-400 flex-wrap">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Created {formatDate(key.created_at)}
              </span>
              {key.last_used_at && (
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" /> Last used {formatDate(key.last_used_at)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Shield className="h-3 w-3" /> {formatNumber(key.total_calls)} total calls
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {key.is_active && (
            <button onClick={onRevoke}
              className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-3 py-1.5 rounded-xl transition-colors">
              <EyeOff className="h-3.5 w-3.5" /> Revoke
            </button>
          )}
          <button onClick={onDelete}
            className="p-1.5 text-zinc-400 hover:text-red-500 rounded-xl transition-colors"
            title="Delete key permanently">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
