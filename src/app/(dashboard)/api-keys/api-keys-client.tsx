"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Key, Plus, Copy, Check, Trash2, Eye, EyeOff, AlertTriangle, Zap, Clock, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/client"
import { generateApiKey, maskApiKey, formatDate, formatNumber } from "@/lib/utils"
import toast from "react-hot-toast"
import { createHash } from "crypto"

interface ApiKey { id: string; name: string; key_prefix: string; is_active: boolean; created_at: string; last_used_at: string | null; total_calls: number; expires_at: string | null }

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKey[] }) {
  const [keys, setKeys]           = useState<ApiKey[]>(initialKeys)
  const [newKeyName, setNewKeyName] = useState("")
  const [creating, setCreating]   = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied, setCopied]       = useState<string | null>(null)
  const supabase = createClient()

  const createKey = async () => {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const rawKey  = generateApiKey()
      const keyHash = await sha256(rawKey)
      const prefix  = rawKey.slice(0, 12)

      const { data, error } = await supabase.from("api_keys").insert({
        user_id: user.id, name: newKeyName.trim(), key_hash: keyHash,
        key_prefix: prefix, is_active: true,
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
    toast.success("Copied to clipboard")
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="page-header flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage keys for authenticating API requests to AgentDyne.</p>
        </div>
        <Button variant="brand" onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="h-4 w-4" /> New Key
        </Button>
      </div>

      {/* Newly created key banner */}
      <AnimatePresence>
        {justCreated && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm">Save your API key now</p>
                <p className="text-xs text-muted-foreground mt-0.5">This key will not be shown again. Copy it somewhere safe.</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-background border border-border rounded-xl px-3 py-2 truncate text-foreground">{justCreated}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(justCreated, "new")} className="flex-shrink-0 rounded-xl gap-1.5">
                    {copied === "new" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === "new" ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
              <button onClick={() => setJustCreated(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Create new API key</CardTitle>
                <CardDescription>Give your key a descriptive name to remember what it's used for.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label>Key name</Label>
                    <Input placeholder="e.g. Production App, CI/CD Pipeline…" value={newKeyName}
                      onChange={e => setNewKeyName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && createKey()} />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button variant="brand" onClick={createKey} disabled={creating || !newKeyName.trim()}>
                      {creating ? "Creating…" : "Create"}
                    </Button>
                    <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keys list */}
      <div className="space-y-3">
        {keys.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Key className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">No API keys yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first key to start integrating with AgentDyne.</p>
              <Button variant="brand" onClick={() => setShowForm(true)}>Create API Key</Button>
            </CardContent>
          </Card>
        ) : (
          keys.map((key, i) => (
            <motion.div key={key.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className={!key.is_active ? "opacity-50" : ""}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${key.is_active ? "bg-primary/10" : "bg-muted"}`}>
                        <Key className={`h-4 w-4 ${key.is_active ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">{key.name}</span>
                          <Badge variant={key.is_active ? "success" : "secondary"} className="text-[10px]">
                            {key.is_active ? "Active" : "Revoked"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <code className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-lg">{key.key_prefix}••••••••</code>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Created {formatDate(key.created_at)}</span>
                          {key.last_used_at && <span className="flex items-center gap-1"><Zap className="h-3 w-3" />Last used {formatDate(key.last_used_at)}</span>}
                          <span className="flex items-center gap-1"><Shield className="h-3 w-3" />{formatNumber(key.total_calls)} calls</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {key.is_active && (
                        <Button size="sm" variant="outline" className="rounded-xl gap-1.5 h-8 text-xs" onClick={() => revokeKey(key.id)}>
                          <EyeOff className="h-3 w-3" /> Revoke
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl text-muted-foreground hover:text-destructive" onClick={() => deleteKey(key.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>

      {/* Usage guide */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Using your API key</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs font-mono bg-muted rounded-xl p-4 overflow-auto text-muted-foreground">{`curl -X POST https://api.agentdyne.com/v1/agents/{agentId}/execute \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": "your input here"}'`}</pre>
        </CardContent>
      </Card>
    </div>
  )
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("")
}
