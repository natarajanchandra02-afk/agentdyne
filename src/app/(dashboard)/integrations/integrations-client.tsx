"use client"

/**
 * Dashboard Integrations — /integrations
 * GPT: "Integrations should be a mini marketplace, not a settings page"
 * Shows: Connected accounts + MCP registry + agent access control + usage metrics
 */

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Search, CheckCircle, ExternalLink, Zap, Shield, Clock,
  Database, MessageSquare, Code2, Cloud, Bot, DollarSign,
  Megaphone, Lock, FolderOpen, BarChart3, ShoppingBag,
  Plus, Settings, AlertCircle, Globe, Activity,
  Link2, Server, ChevronRight, X, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── Static integration catalogue ─────────────────────────────────────────

type Category = "databases" | "communication" | "productivity" | "development"
  | "cloud" | "ai" | "finance" | "analytics" | "files"

interface Integration {
  id: string; name: string; description: string
  category: Category; icon: string; color: string
  setupMinutes: number; verified: boolean
  capabilities: string[]; docsUrl: string; tags: string[]
  isMCP?: boolean
}

const INTEGRATIONS: Integration[] = [
  // Databases
  { id:"supabase",   name:"Supabase",    category:"databases",     icon:"🗄️",  color:"#3ecf8e", verified:true,  setupMinutes:3,  capabilities:["read","write","realtime","rpc"],            docsUrl:"https://supabase.com/docs",           tags:["postgres","database","realtime"], isMCP:true  },
  { id:"postgres",   name:"PostgreSQL",  category:"databases",     icon:"🐘",  color:"#336791", verified:true,  setupMinutes:5,  capabilities:["query","insert","update","delete"],         docsUrl:"https://postgresql.org/docs",         tags:["sql","database"]                              },
  { id:"mongodb",    name:"MongoDB",     category:"databases",     icon:"🍃",  color:"#47a248", verified:true,  setupMinutes:4,  capabilities:["find","insert","update","aggregate"],       docsUrl:"https://mongodb.com/docs",            tags:["nosql","database"]                            },
  { id:"redis",      name:"Redis",       category:"databases",     icon:"⚡",  color:"#dc382d", verified:true,  setupMinutes:3,  capabilities:["get","set","pub/sub","cache"],              docsUrl:"https://redis.io/docs",               tags:["cache","queue","pubsub"]                       },
  { id:"mysql",      name:"MySQL",       category:"databases",     icon:"🐬",  color:"#00618a", verified:false, setupMinutes:5,  capabilities:["query","stored procs","triggers"],          docsUrl:"https://dev.mysql.com/doc",           tags:["sql","database"]                              },
  // Communication
  { id:"slack",      name:"Slack",       category:"communication", icon:"💬",  color:"#4a154b", verified:true,  setupMinutes:2,  capabilities:["send message","channels","threads","files"],docsUrl:"https://api.slack.com",               tags:["messaging","team","notifications"], isMCP:true },
  { id:"discord",    name:"Discord",     category:"communication", icon:"🎮",  color:"#5865f2", verified:true,  setupMinutes:3,  capabilities:["send","webhooks","threads","moderation"],   docsUrl:"https://discord.com/developers",      tags:["community","gaming","messaging"]               },
  { id:"gmail",      name:"Gmail",       category:"communication", icon:"📧",  color:"#ea4335", verified:true,  setupMinutes:2,  capabilities:["send","read","labels","drafts"],            docsUrl:"https://developers.google.com/gmail", tags:["email","google"], isMCP:true                  },
  { id:"sendgrid",   name:"SendGrid",    category:"communication", icon:"📮",  color:"#1a82e2", verified:true,  setupMinutes:5,  capabilities:["send","templates","analytics"],             docsUrl:"https://docs.sendgrid.com",           tags:["email","transactional"]                        },
  // Productivity
  { id:"github",     name:"GitHub",      category:"development",   icon:"🐙",  color:"#24292f", verified:true,  setupMinutes:2,  capabilities:["repos","issues","PRs","commits","actions"], docsUrl:"https://docs.github.com",             tags:["git","code","devops"], isMCP:true              },
  { id:"notion",     name:"Notion",      category:"productivity",  icon:"📓",  color:"#000000", verified:true,  setupMinutes:3,  capabilities:["pages","databases","blocks","search"],      docsUrl:"https://developers.notion.com",       tags:["docs","wiki","workspace"], isMCP:true          },
  { id:"jira",       name:"Jira",        category:"productivity",  icon:"🔷",  color:"#0052cc", verified:true,  setupMinutes:5,  capabilities:["issues","sprints","boards","comments"],     docsUrl:"https://developer.atlassian.com",     tags:["project","tickets","agile"]                    },
  { id:"linear",     name:"Linear",      category:"productivity",  icon:"🔮",  color:"#5e6ad2", verified:true,  setupMinutes:2,  capabilities:["issues","cycles","projects","roadmap"],     docsUrl:"https://linear.app/docs",             tags:["project","issues","startup"]                   },
  { id:"google-drive",name:"Google Drive",category:"files",        icon:"📁",  color:"#4285f4", verified:true,  setupMinutes:2,  capabilities:["read","write","share","search"],            docsUrl:"https://developers.google.com/drive", tags:["storage","files","google"], isMCP:true         },
  // Cloud
  { id:"aws-s3",     name:"AWS S3",      category:"cloud",         icon:"☁️",  color:"#ff9900", verified:true,  setupMinutes:8,  capabilities:["upload","download","list","presign"],       docsUrl:"https://docs.aws.amazon.com/s3",      tags:["storage","aws","cloud"]                        },
  { id:"cloudflare", name:"Cloudflare",  category:"cloud",         icon:"🌐",  color:"#f48120", verified:true,  setupMinutes:5,  capabilities:["workers","kv","r2","pages"],                docsUrl:"https://developers.cloudflare.com",   tags:["cdn","edge","serverless"]                      },
  { id:"vercel",     name:"Vercel",      category:"cloud",         icon:"▲",   color:"#000000", verified:true,  setupMinutes:3,  capabilities:["deployments","domains","env","logs"],       docsUrl:"https://vercel.com/docs",             tags:["hosting","deployment","nextjs"]                },
  // AI
  { id:"anthropic",  name:"Anthropic",   category:"ai",            icon:"🤖",  color:"#cc785c", verified:true,  setupMinutes:2,  capabilities:["claude","messages","streaming","tools"],    docsUrl:"https://docs.anthropic.com",          tags:["llm","claude","ai"]                            },
  { id:"openai",     name:"OpenAI",      category:"ai",            icon:"🧠",  color:"#10a37f", verified:true,  setupMinutes:2,  capabilities:["chat","embeddings","dall-e","whisper"],     docsUrl:"https://platform.openai.com/docs",    tags:["llm","gpt","ai"]                               },
  { id:"gemini",     name:"Gemini",      category:"ai",            icon:"✨",  color:"#4285f4", verified:true,  setupMinutes:2,  capabilities:["chat","multimodal","code","search"],         docsUrl:"https://ai.google.dev",               tags:["llm","google","ai"]                            },
  // Finance
  { id:"stripe",     name:"Stripe",      category:"finance",       icon:"💳",  color:"#635bff", verified:true,  setupMinutes:5,  capabilities:["payments","invoices","subscriptions","webhooks"],docsUrl:"https://stripe.com/docs",        tags:["payments","billing","saas"], isMCP:true         },
  { id:"hubspot",    name:"HubSpot",     category:"analytics",     icon:"🧡",  color:"#ff7a59", verified:true,  setupMinutes:5,  capabilities:["contacts","deals","campaigns","reports"],   docsUrl:"https://developers.hubspot.com",      tags:["crm","marketing","sales"]                      },
  { id:"salesforce", name:"Salesforce",  category:"analytics",     icon:"☁️",  color:"#00a1e0", verified:false, setupMinutes:10, capabilities:["leads","opportunities","reports","flows"],  docsUrl:"https://developer.salesforce.com",    tags:["crm","enterprise","sales"]                     },
]

const CATEGORIES: { id: Category | "all"; label: string; icon: any }[] = [
  { id:"all",          label:"All",          icon:Globe      },
  { id:"databases",    label:"Databases",    icon:Database   },
  { id:"communication",label:"Comms",        icon:MessageSquare },
  { id:"development",  label:"Dev Tools",    icon:Code2      },
  { id:"productivity", label:"Productivity", icon:Zap        },
  { id:"cloud",        label:"Cloud",        icon:Cloud      },
  { id:"ai",           label:"AI / LLMs",    icon:Bot        },
  { id:"finance",      label:"Finance",      icon:DollarSign },
  { id:"analytics",    label:"Analytics",    icon:BarChart3  },
  { id:"files",        label:"Files",        icon:FolderOpen },
]

const CAT_BG: Record<string, string> = {
  databases:     "bg-blue-50 text-blue-600",
  communication: "bg-cyan-50 text-cyan-600",
  productivity:  "bg-violet-50 text-violet-600",
  development:   "bg-orange-50 text-orange-600",
  cloud:         "bg-sky-50 text-sky-600",
  ai:            "bg-indigo-50 text-indigo-600",
  finance:       "bg-green-50 text-green-600",
  analytics:     "bg-teal-50 text-teal-600",
  files:         "bg-amber-50 text-amber-600",
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function IntegrationsClient() {
  const { user }                               = useUser()
  const [search,      setSearch]               = useState("")
  const [category,    setCategory]             = useState<Category | "all">("all")
  const [activeTab,   setActiveTab]            = useState<"all" | "connected" | "mcp">("all")
  const [connected,   setConnected]            = useState<Set<string>>(new Set())
  const [connecting,  setConnecting]           = useState<string | null>(null)
  const [loading,     setLoading]              = useState(true)
  const [usageData,   setUsageData]            = useState<Record<string, number>>({})

  const supabase = createClient()

  // Load connected integrations from DB
  useEffect(() => {
    if (!user) return
    supabase
      .from("user_integrations")
      .select("integration_id, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .then(({ data }) => {
        setConnected(new Set((data ?? []).map((r: any) => r.integration_id)))
        setLoading(false)
      })
    // Load usage
    supabase
      .from("integration_usage")
      .select("integration_id, calls")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const map: Record<string, number> = {}
        ;(data ?? []).forEach((r: any) => { map[r.integration_id] = r.calls })
        setUsageData(map)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const toggleConnect = useCallback(async (integ: Integration) => {
    if (!user) { toast.error("Sign in to connect integrations"); return }
    setConnecting(integ.id)
    try {
      if (connected.has(integ.id)) {
        // Disconnect
        await supabase.rpc("disconnect_user_integration", {
          p_user_id:        user.id,
          p_integration_id: integ.id,
        })
        setConnected(prev => { const n = new Set(prev); n.delete(integ.id); return n })
        toast.success(`${integ.name} disconnected`)
      } else {
        // Connect
        await supabase.rpc("upsert_user_integration", {
          p_user_id:        user.id,
          p_integration_id: integ.id,
          p_name:           integ.name,
          p_category:       integ.category,
          p_config:         {},
        })
        setConnected(prev => new Set([...prev, integ.id]))
        toast.success(`${integ.name} connected!`)
      }
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update integration")
    } finally {
      setConnecting(null)
    }
  }, [user, connected, supabase])

  const filtered = INTEGRATIONS.filter(s => {
    if (activeTab === "connected" && !connected.has(s.id)) return false
    if (activeTab === "mcp"       && !s.isMCP)             return false
    if (category !== "all"        && s.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.includes(q))
    }
    return true
  })

  const connectedCount = connected.size
  const mcpCount       = INTEGRATIONS.filter(s => s.isMCP).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Link2 className="h-6 w-6 text-primary" />
            Integrations
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Connect your agents to {INTEGRATIONS.length} services — databases, APIs, cloud, and more.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400 bg-white border border-zinc-100 px-3 py-2 rounded-xl">
          <Shield className="h-3.5 w-3.5 text-green-500" />
          Credentials encrypted at rest · Zero secret storage
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:"Total integrations",   value:INTEGRATIONS.length, color:"text-primary",   icon:Globe         },
          { label:"Connected",            value:connectedCount,       color:"text-green-600", icon:CheckCircle   },
          { label:"MCP servers",          value:mcpCount,             color:"text-violet-600",icon:Server        },
          { label:"Quick setup (≤3 min)", value:INTEGRATIONS.filter(s=>s.setupMinutes<=3).length, color:"text-amber-600", icon:Clock },
        ].map(s => (
          <div key={s.label} className="bg-white border border-zinc-100 rounded-2xl p-4 flex items-center gap-3"
            style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <s.icon className={cn("h-5 w-5 flex-shrink-0", s.color)} />
            <div>
              <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.value}</p>
              <p className="text-xs text-zinc-400">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + search bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center bg-zinc-50 border border-zinc-100 rounded-xl p-1 gap-0.5">
          {[
            { id:"all",       label:`All (${INTEGRATIONS.length})` },
            { id:"connected", label:`Connected (${connectedCount})` },
            { id:"mcp",       label:`MCP (${mcpCount})` },
          ].map(tab => (
            <button key={tab.id} type="button"
              onClick={() => setActiveTab(tab.id as "all"|"connected"|"mcp")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                activeTab === tab.id
                  ? "bg-white text-zinc-900 shadow-sm border border-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700"
              )}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input type="text" placeholder="Search integrations…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 h-9 rounded-xl border border-zinc-200 bg-white text-sm placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 transition-all" />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-zinc-100">
              <X className="h-3.5 w-3.5 text-zinc-400" />
            </button>
          )}
        </div>
      </div>

      {/* Category chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setCategory(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
              category === id
                ? id === "all"
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-primary text-white border-primary"
                : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
            )}>
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {/* Count */}
      <p className="text-xs text-zinc-400">
        {filtered.length} integration{filtered.length !== 1 ? "s" : ""}
        {connectedCount > 0 && ` · ${connectedCount} connected`}
      </p>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((integ, i) => {
              const isConnected = connected.has(integ.id)
              const isConnecting = connecting === integ.id
              const iconBg = CAT_BG[integ.category] || "bg-zinc-50 text-zinc-500"
              const usage = usageData[integ.id] ?? 0

              return (
                <motion.div key={integ.id}
                  layout
                  initial={{ opacity:0, y:8 }}
                  animate={{ opacity:1, y:0 }}
                  exit={{ opacity:0, scale:0.95 }}
                  transition={{ delay: Math.min(i*0.02, 0.25) }}>
                  <div className={cn(
                    "bg-white border rounded-2xl p-5 flex flex-col h-full transition-all",
                    isConnected
                      ? "border-green-200 shadow-[0_0_0_3px_rgba(34,197,94,0.07)]"
                      : "border-zinc-100 hover:border-zinc-200 hover:shadow-md"
                  )}
                    style={{boxShadow: isConnected ? undefined : "0 1px 3px rgba(0,0,0,0.04)"}}>

                    {/* Header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0",
                        iconBg
                      )}>
                        {integ.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <h3 className="font-semibold text-sm text-zinc-900">{integ.name}</h3>
                          {integ.verified && (
                            <CheckCircle className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                          )}
                          {integ.isMCP && (
                            <Badge className="text-[9px] h-4 px-1.5 bg-violet-50 text-violet-600 border-violet-200 font-bold">
                              MCP
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" /> {integ.setupMinutes}min setup
                          </span>
                          {isConnected && (
                            <span className="text-[10px] font-bold bg-green-50 text-green-600 border border-green-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                              <CheckCircle className="h-2.5 w-2.5" /> Connected
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-zinc-500 leading-relaxed flex-1 mb-3">
                      {integ.description}
                    </p>

                    {/* Capabilities */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {integ.capabilities.slice(0,3).map(cap => (
                        <span key={cap}
                          className="text-[10px] font-mono bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-500">
                          {cap}
                        </span>
                      ))}
                      {integ.capabilities.length > 3 && (
                        <span className="text-[10px] bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full text-zinc-400">
                          +{integ.capabilities.length - 3}
                        </span>
                      )}
                    </div>

                    {/* Usage — shown if connected */}
                    {isConnected && usage > 0 && (
                      <div className="flex items-center gap-1.5 mb-3 text-[11px] text-zinc-400">
                        <Activity className="h-3 w-3" />
                        <span className="tabular-nums font-medium">{usage.toLocaleString()} calls this month</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-3 border-t border-zinc-50">
                      <button type="button"
                        onClick={() => toggleConnect(integ)}
                        disabled={isConnecting}
                        className={cn(
                          "flex-1 h-8 text-xs rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all",
                          isConnecting
                            ? "bg-zinc-100 text-zinc-400 cursor-wait"
                            : isConnected
                            ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-100"
                            : "bg-zinc-900 text-white hover:bg-zinc-700"
                        )}>
                        {isConnecting
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Connecting…</>
                          : isConnected
                          ? <><Settings className="h-3 w-3" /> Disconnect</>
                          : <><Plus className="h-3 w-3" /> Connect</>}
                      </button>
                      <a href={integ.docsUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm"
                          className="h-8 w-8 p-0 rounded-xl border-zinc-200 hover:border-zinc-400">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 bg-white border border-zinc-100 rounded-2xl">
          <AlertCircle className="h-8 w-8 text-zinc-200 mx-auto mb-3" />
          <p className="text-zinc-400 font-medium">No integrations found</p>
          <p className="text-zinc-300 text-sm mt-1">
            {activeTab === "connected"
              ? "You haven't connected any integrations yet."
              : "Try a different keyword or category."}
          </p>
          {activeTab === "connected" && (
            <button onClick={() => setActiveTab("all")}
              className="mt-3 text-xs font-semibold text-primary hover:underline">
              Browse all integrations →
            </button>
          )}
        </div>
      )}

      {/* Usage summary — shown when connected */}
      {connectedCount > 0 && Object.keys(usageData).length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <p className="text-sm font-semibold text-zinc-900 mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-zinc-400" />
            Usage This Month
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(usageData).slice(0,8).map(([id, calls]) => {
              const integ = INTEGRATIONS.find(i => i.id === id)
              if (!integ) return null
              return (
                <div key={id} className="bg-zinc-50 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">{integ.icon}</span>
                    <span className="text-xs font-semibold text-zinc-700 truncate">{integ.name}</span>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-zinc-900">
                    {(calls as number).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-zinc-400">API calls</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
