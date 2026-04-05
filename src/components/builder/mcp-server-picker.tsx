"use client"

import { useState, useMemo } from "react"
import { Search, CheckCircle, ExternalLink, Zap, X, Plus, Copy, Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { MCP_SERVERS, MCP_CATEGORIES, type MCPServer, type MCPCategory } from "@/lib/mcp-servers"
import { cn } from "@/lib/utils"

interface Props {
  selected: string[]
  onChange: (ids: string[]) => void
  maxServers?: number
}

export function MCPServerPicker({ selected, onChange, maxServers = 5 }: Props) {
  const [search, setSearch]         = useState("")
  const [activeCategory, setCategory] = useState<MCPCategory | "all">("all")
  const [detailServer, setDetail]   = useState<MCPServer | null>(null)
  const [copied, setCopied]         = useState(false)

  const filtered = useMemo(() => {
    return MCP_SERVERS.filter(s => {
      const matchCat    = activeCategory === "all" || s.category === activeCategory
      const matchSearch = !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase()) ||
        s.tags.some(t => t.includes(search.toLowerCase()))
      return matchCat && matchSearch
    })
  }, [search, activeCategory])

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id))
    } else if (selected.length < maxServers) {
      onChange([...selected, id])
    }
  }

  const copyConfig = (server: MCPServer) => {
    const config = JSON.stringify({
      mcpServers: {
        [server.id]: {
          ...(server.url ? { url: server.url } : { command: "npx", args: ["-y", server.npmPackage] }),
          env: server.configExample,
        },
      },
    }, null, 2)
    navigator.clipboard.writeText(config)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const AUTH_LABELS: Record<string, string> = {
    api_key: "API Key",
    oauth:   "OAuth",
    url:     "URL",
    none:    "No auth",
  }

  const AUTH_COLORS: Record<string, string> = {
    api_key: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    oauth:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
    url:     "bg-green-500/10 text-green-400 border-green-500/20",
    none:    "bg-muted text-muted-foreground",
  }

  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      {/* Selected strip */}
      {selected.length > 0 && (
        <div className="px-4 py-3 border-b border-border bg-primary/5 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground mr-1">Connected:</span>
          {selected.map(id => {
            const srv = MCP_SERVERS.find(s => s.id === id)
            if (!srv) return null
            return (
              <div key={id} className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1">
                <span className="text-sm">{srv.icon}</span>
                <span className="text-xs font-medium">{srv.name}</span>
                <button onClick={() => toggle(id)} className="text-muted-foreground hover:text-destructive transition-colors ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          {selected.length < maxServers && (
            <span className="text-xs text-muted-foreground">{maxServers - selected.length} more allowed</span>
          )}
        </div>
      )}

      <div className="flex">
        {/* Category sidebar */}
        <div className="w-48 border-r border-border bg-muted/20 flex-shrink-0">
          <div className="p-3">
            <button onClick={() => setCategory("all")}
              className={cn("w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all",
                activeCategory === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
              All Servers
              <span className="ml-1.5 text-xs opacity-60">({MCP_SERVERS.length})</span>
            </button>
            <div className="mt-2 space-y-0.5">
              {MCP_CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => setCategory(cat.id)}
                  className={cn("w-full text-left px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2",
                    activeCategory === cat.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                  <span>{cat.icon}</span>
                  <span className="flex-1 truncate">{cat.label}</span>
                  <span className="opacity-50">{cat.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Server list */}
        <div className="flex-1 min-w-0">
          {/* Search */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search servers, tools…" className="pl-9 h-8 text-xs" />
            </div>
          </div>

          <ScrollArea className="h-72">
            <div className="p-2 space-y-1">
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-8">No servers match your search</p>
              ) : (
                filtered.map(server => {
                  const isSelected = selected.includes(server.id)
                  const isDisabled = !isSelected && selected.length >= maxServers
                  return (
                    <div key={server.id}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer group",
                        isSelected   ? "border-primary/40 bg-primary/5" :
                        isDisabled   ? "border-border opacity-40 cursor-not-allowed" :
                                       "border-transparent hover:border-border hover:bg-muted/50"
                      )}
                      onClick={() => !isDisabled && toggle(server.id)}
                    >
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-base flex-shrink-0">
                        {server.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{server.name}</span>
                          {server.verified && <CheckCircle className="h-3 w-3 text-blue-400 flex-shrink-0" />}
                          {server.featured && <Badge className="text-[9px] h-3.5 px-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Featured</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{server.description}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Badge className={cn("text-[9px] h-3.5 px-1 border", AUTH_COLORS[server.authType])}>
                            {AUTH_LABELS[server.authType]}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{server.setupMinutes}min setup</span>
                          {"⭐".repeat(server.popularity).slice(0, server.popularity)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={e => { e.stopPropagation(); setDetail(server) }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-accent">
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0",
                          isSelected ? "border-primary bg-primary" : "border-border")}>
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailServer} onOpenChange={() => setDetail(null)}>
        {detailServer && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-2xl">{detailServer.icon}</div>
                <div>
                  <DialogTitle className="flex items-center gap-2">
                    {detailServer.name}
                    {detailServer.verified && <CheckCircle className="h-4 w-4 text-blue-400" />}
                  </DialogTitle>
                  <DialogDescription>{detailServer.category}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{detailServer.description}</p>

              {/* Capabilities */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Capabilities</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailServer.capabilities.map(cap => (
                    <Badge key={cap} variant="secondary" className="text-xs font-mono">{cap}</Badge>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailServer.tags.map(tag => (
                    <span key={tag} className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">#{tag}</span>
                  ))}
                </div>
              </div>

              {/* Config */}
              {Object.keys(detailServer.configExample).length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Environment Variables</p>
                    <button onClick={() => copyConfig(detailServer)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      {copied ? <><Check className="h-3 w-3 text-green-400" />Copied</> : <><Copy className="h-3 w-3" />Copy config</>}
                    </button>
                  </div>
                  <div className="bg-muted/50 rounded-xl p-3 space-y-1">
                    {Object.entries(detailServer.configExample).map(([key]) => (
                      <div key={key} className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-primary">{key}</span>
                        <span className="text-muted-foreground">=</span>
                        <span className="text-muted-foreground">{"<your-value>"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button variant="brand" className="flex-1 gap-2" onClick={() => { toggle(detailServer.id); setDetail(null) }}>
                  {selected.includes(detailServer.id)
                    ? <><X className="h-4 w-4" />Remove</>
                    : <><Plus className="h-4 w-4" />Add to Agent</>}
                </Button>
                <a href={detailServer.docsUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className="gap-2"><ExternalLink className="h-4 w-4" />Docs</Button>
                </a>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
