"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Key, Plus, Copy, Check, Trash2, EyeOff, AlertTriangle, Zap, Clock, Shield, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { generateApiKey, maskApiKey, formatDate, formatNumber, cn } from "@/lib/utils"
import toast from "react-hot-toast"

interface ApiKey {
  id: string; name: string; key_prefix: string; is_active: boolean
  created_at: string; last_used_at: string | null; total_calls: number
}

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKey[] }) {
  const [keys, setKeys]             = useState<ApiKey[]>(initialKeys)
  const [newKeyName, setNewKeyName] = useState("")
  const [creating, setCreating]     = useState(false)
  const [showForm, setShowForm]     = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied, setCopied]         = useState<string | null>(null)
  const supabase = createClient()

  const createKey = async () => {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")
      const rawKey = generateApiKey()
      const msgBuffer = new TextEncoder().encode(rawKey)
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer)
      const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")
      const prefix  = rawKey.slice(0, 12)
      const { data, error } = await supabase.from("api_keys").insert({
        user_id: user.id, name: newKeyName.trim(),
        key_hash: keyHash, key_prefix: prefix, is_active: true,
      }).select().single()
      if (error) throw error
      setKeys(prev => [data, ...prev])
      setJustCreated(rawKey)
      setNewKeyName("")
      setShowForm(false)
      toast.success("API key created")
    } catch (e: any) { toast.error(e.message) }
    finally { setCreating(false) }
  }

  const revokeKey = async (id: string) => {
    const { error } = await supabase.from("api_keys").update({ is_active: false }).eq("id", id)
    if (error) { toast.error(error.message); return }
    setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k))
    toast.success("Key revoked")
  }

  const deleteKey = async (id: string) => {
    const { error } = await supabase.from("api_keys").delete().eq("id", id)
    if (error) { toast.error(error.message); return }
    setKeys(prev => prev.filter(k => k.id !== id))
    toast.success("Key deleted")
  }

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
    toast.success("Copied!")
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">API Keys</h1>
          <p className="text-zinc-500 text-sm mt-1">Authenticate your API requests to AgentDyne.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
          <Plus className="h-4 w-4" /> New Key
        </Button>
      </div>

      {/* New key banner */}
      <AnimatePresence>
        {justCreated && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-900 text-sm">Save your key — shown only once</p>
                <p className="text-xs text-zinc-500 mt-0.5">Copy it now. You won't be able to see it again.</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-white border border-amber-200 rounded-xl px-3 py-2 truncate text-zinc-700">
                    {justCreated}
                  </code>
                  <button onClick={() => copy(justCreated, "new")}
                    className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-xl hover:bg-zinc-700 transition-colors">
                    {copied === "new" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === "new" ? "Copied!" : "Copy"}
                  </button>
                </div>
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
            className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">Create new API key</h2>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs font-medium text-zinc-600">Key name</Label>
                <Input placeholder="e.g. Production App, CI/CD…" value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createKey()}
                  className="rounded-xl border-zinc-200 h-9 text-sm" />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={createKey} disabled={creating || !newKeyName.trim()}
                  className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 h-9 text-sm font-semibold">
                  {creating ? "Creating…" : "Create"}
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)}
                  className="rounded-xl border-zinc-200 h-9 text-sm">
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keys list */}
      <div className="space-y-3">
        {keys.length === 0 ? (
          <div className="bg-white border border-zinc-100 rounded-2xl py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center mx-auto mb-4">
              <Key className="h-6 w-6 text-zinc-400" />
            </div>
            <h3 className="font-semibold text-zinc-900 mb-1">No API keys yet</h3>
            <p className="text-sm text-zinc-400 mb-4">Create your first key to start using the API.</p>
            <Button onClick={() => setShowForm(true)}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
              Create API Key
            </Button>
          </div>
        ) : (
          keys.map((key, i) => (
            <motion.div key={key.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn("bg-white border border-zinc-100 rounded-2xl p-5 transition-all", !key.is_active && "opacity-50")}
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5",
                    key.is_active ? "bg-primary/8" : "bg-zinc-50")}>
                    <Key className={cn("h-4 w-4", key.is_active ? "text-primary" : "text-zinc-400")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-zinc-900">{key.name}</span>
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                        key.is_active ? "bg-green-50 text-green-600" : "bg-zinc-100 text-zinc-500")}>
                        {key.is_active ? "Active" : "Revoked"}
                      </span>
                    </div>
                    <code className="text-xs text-zinc-400 font-mono mt-1 block">
                      {key.key_prefix}••••••••••••
                    </code>
                    <div className="flex items-center gap-4 mt-2 text-xs text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Created {formatDate(key.created_at)}
                      </span>
                      {key.last_used_at && (
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" /> Last used {formatDate(key.last_used_at)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Shield className="h-3 w-3" /> {formatNumber(key.total_calls)} calls
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {key.is_active && (
                    <button onClick={() => revokeKey(key.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-3 py-1.5 rounded-xl transition-colors">
                      <EyeOff className="h-3.5 w-3.5" /> Revoke
                    </button>
                  )}
                  <button onClick={() => deleteKey(key.id)}
                    className="p-1.5 text-zinc-400 hover:text-red-500 rounded-xl transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Usage guide */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-zinc-900 mb-3">Quick start</h3>
        <pre className="text-xs font-mono bg-white border border-zinc-100 rounded-xl p-4 overflow-auto text-zinc-600">{`curl -X POST https://api.agentdyne.com/v1/agents/{id}/execute \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "your input here"}'`}</pre>
      </div>
    </div>
  )
}
