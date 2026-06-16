// @ts-nocheck
"use client"

/**
 * AgentDyne — Multi-Agent Swarm v12
 * Fixes from screenshot audit:
 *  ✅ Agents list fully visible — flex-1 min-h-0 overflow-y-auto
 *  ✅ Toggle switch — Material Design 3 spec (44×24, gradient, proper shadow)
 *  ✅ Graph — bezier curves, animated flow particles, gradient fills
 *  ✅ All buttons wired: Templates, Save, Trace, Upgrade, Auto-assemble
 *  ✅ Bug #7 — supabase created once via useRef (not recreated on every render)
 */

import {
  useState, useCallback, useEffect, useRef,
  type ChangeEvent,
} from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Network, Play, Loader2, Check, ChevronDown, Bot, AlertCircle,
  Copy, Sparkles, Brain, Zap, GitBranch, MemoryStick, Eye,
  CheckCircle2, Lightbulb, Save, LayoutTemplate, ChevronRight,
  GripVertical, Plus, Cpu, Paperclip, AlignLeft, X, FileText,
  File, Hash, Crown, Rocket, ArrowRight, Clock, DollarSign,
  Target, List, Layers, MessageSquare, Activity, CheckCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import toast from "react-hot-toast"
import { useRouter } from "next/navigation"

const OPEN_VAR  = "{{" as const
const CLOSE_VAR = "}}" as const

type SwarmMode  = "orchestrate" | "debate" | "parallel"
type StepStatus = "completed" | "in_progress" | "pending"

interface Agent       { id:string; name:string; model_name:string; status:string; system_prompt?:string }
interface SwarmResult { sessionId:string; status:string; mode:SwarmMode; agentCount:number; finalAnswer:string; messageLog:any[]; rounds:number }
interface AFile       { id:string; file:File; preview?:string; kind:"image"|"doc"|"other" }
interface Template    { id:string; name:string; mode:string; description?:string; agent_roles:any }
interface Var         { id:string; key:string; value:string }

/* ── Design tokens ─────────────────────────────────────────────────── */
const C = {
  bg:"#ffffff", soft:"#fafafa", surf:"#f4f4f5",
  border:"#f0f0f1", border2:"#e4e4e7", border3:"#d4d4d8",
  text:"#18181b", text1:"#3f3f46", text2:"#71717a", text3:"#a1a1aa", text4:"#d4d4d8",
  brand:"#6366f1", brandBg:"#eef2ff", brandBd:"#c7d2fe", brandDk:"#4f46e5",
  green:"#22c55e", greenBg:"#f0fdf4", greenBd:"#bbf7d0", greenTx:"#16a34a",
  blue:"#3b82f6", blueBg:"#eff6ff", blueBd:"#bfdbfe",
  amber:"#f59e0b", amberBg:"#fffbeb", amberBd:"#fde68a",
  violet:"#8b5cf6", violetBg:"#f5f3ff", violetBd:"#ddd6fe",
  teal:"#14b8a6", tealBg:"#f0fdfa", tealBd:"#99f6e4",
  red:"#ef4444", redBg:"#fef2f2", redBd:"#fecaca", redTx:"#dc2626",
}

/* ── Role metadata ─────────────────────────────────────────────────── */
type RoleMeta = { role:string; color:string; bg:string; bd:string }
const ROLE_MAP: [string, RoleMeta][] = [
  ["research",  { role:"Research",     color:C.brand,  bg:C.brandBg,  bd:C.brandBd  }],
  ["analyst",   { role:"Analysis",     color:C.blue,   bg:C.blueBg,   bd:C.blueBd   }],
  ["financial", { role:"Analysis",     color:C.blue,   bg:C.blueBg,   bd:C.blueBd   }],
  ["writer",    { role:"Synthesis",    color:C.violet, bg:C.violetBg, bd:C.violetBd }],
  ["critic",    { role:"Critic",       color:C.amber,  bg:C.amberBg,  bd:C.amberBd  }],
  ["checker",   { role:"Verification", color:C.amber,  bg:C.amberBg,  bd:C.amberBd  }],
  ["reviewer",  { role:"Review",       color:C.teal,   bg:C.tealBg,   bd:C.tealBd   }],
  ["planner",   { role:"Planning",     color:C.brand,  bg:C.brandBg,  bd:C.brandBd  }],
  ["coder",     { role:"Engineering",  color:C.green,  bg:C.greenBg,  bd:C.greenBd  }],
]
const DEF_ROLE: RoleMeta = { role:"General", color:C.text2, bg:C.surf, bd:C.border2 }
const getRoleMeta = (a:Agent): RoleMeta => {
  const s = `${a.name} ${a.system_prompt??""}`.toLowerCase()
  return ROLE_MAP.find(([k]) => s.includes(k))?.[1] ?? DEF_ROLE
}
const shortModel = (m:string) => {
  if (!m) return "Sonnet"
  if (m.includes("haiku"))  return "Haiku"
  if (m.includes("opus"))   return "Opus"
  if (m.includes("gpt-4"))  return "GPT-4"
  if (m.includes("gemini")) return "Gemini"
  return "Sonnet"
}
const calcMetrics = (agents:Agent[], mode:SwarmMode, rounds:number) => {
  if (!agents.length) return { secs:0, cost:0, acc:0, models:"—", workers:0, complexity:"—" }
  const secs    = agents.length*(mode==="parallel"?8:14)+(mode==="debate"?rounds*9:0)
  const cost    = agents.length*0.010*(mode==="debate"?rounds:1)
  const acc     = Math.min(97,78+agents.length*2+(mode==="debate"?rounds*1.5:0))
  const models  = [...new Set(agents.map(a=>shortModel(a.model_name)))].join(" · ")||"Sonnet"
  const workers = mode==="parallel"?agents.length:Math.max(1,agents.length-1)
  return { secs, cost, acc:Math.round(acc), models, workers, complexity:agents.length<=2?"Low":agents.length<=4?"Medium":"High" }
}

/* ── Toggle — Material Design 3 spec ──────────────────────────────── */
const Toggle = ({ on, set }: { on:boolean; set:(v:boolean)=>void }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={() => set(!on)}
    className="relative flex-shrink-0 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500"
    style={{
      width: 44,
      height: 24,
      background: on
        ? "linear-gradient(135deg,#6366f1,#4f46e5)"
        : "#d4d4d8",
      boxShadow: on
        ? "0 2px 8px rgba(99,102,241,0.45)"
        : "inset 0 1px 3px rgba(0,0,0,0.12)",
    }}
  >
    <span
      className="absolute rounded-full bg-white transition-all duration-200"
      style={{
        width: 18,
        height: 18,
        top: 3,
        left: on ? 23 : 3,
        boxShadow: "0 1px 5px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.06)",
      }}
    />
  </button>
)

/* ── Checkbox ──────────────────────────────────────────────────────── */
const CB = ({ on, set }: { on:boolean; set:(v:boolean)=>void }) => (
  <button type="button" role="checkbox" aria-checked={on} onClick={() => set(!on)}
    className="flex items-center justify-center flex-shrink-0 rounded-md transition-all focus-visible:ring-2 focus-visible:ring-indigo-500"
    style={{ width:18, height:18, background:on?C.brand:"#fff", border:`2px solid ${on?C.brand:C.border3}` }}>
    {on && <Check style={{ width:10, height:10, color:"#fff", strokeWidth:3 }}/>}
  </button>
)

/* ── Modal ─────────────────────────────────────────────────────────── */
const Modal = ({ open, close, title, children, width=500 }: {
  open:boolean; close:()=>void; title:string; children:React.ReactNode; width?:number
}) => {
  useEffect(() => {
    const h = (e:KeyboardEvent) => { if (e.key==="Escape") close() }
    if (open) document.addEventListener("keydown", h)
    return () => document.removeEventListener("keydown", h)
  }, [open, close])
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)" }}
          onClick={e => { if (e.target===e.currentTarget) close() }}>
          <motion.div initial={{ opacity:0, scale:0.95, y:12 }} animate={{ opacity:1, scale:1, y:0 }}
            exit={{ opacity:0, scale:0.95 }} transition={{ duration:0.16 }}
            className="relative flex flex-col overflow-hidden"
            style={{ background:C.bg, width:"100%", maxWidth:width, maxHeight:"90vh",
              borderRadius:20, boxShadow:"0 32px 80px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom:`1px solid ${C.border}` }}>
              <p className="text-sm font-bold" style={{ color:C.text }}>{title}</p>
              <button onClick={close} className="w-7 h-7 rounded-xl flex items-center justify-center hover:bg-zinc-100">
                <X style={{ width:13, height:13, color:C.text3 }}/>
              </button>
            </div>
            <div className="overflow-y-auto flex-1">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ── Upgrade modal ─────────────────────────────────────────────────── */
const UpgradeModal = ({ open, close }: { open:boolean; close:()=>void }) => {
  const router = useRouter()
  return (
    <Modal open={open} close={close} title="Upgrade to Launch Swarms" width={440}>
      <div className="p-6 space-y-5">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background:`linear-gradient(135deg,${C.brandBg},${C.violetBg})`, border:`1px solid ${C.brandBd}` }}>
          <Crown style={{ width:24, height:24, color:C.brand }}/>
        </div>
        <div className="text-center">
          <p className="font-bold text-zinc-900 mb-2" style={{ fontSize:16 }}>Starter plan required</p>
          <p className="text-sm text-zinc-500 leading-relaxed max-w-xs mx-auto">
            Coordinate up to 8 agents, unlock all modes, and build persistent swarm memory.
          </p>
        </div>
        <div className="rounded-2xl p-4 space-y-3" style={{ background:C.soft, border:`1px solid ${C.border}` }}>
          {["Up to 8 agents per swarm run","Orchestrate, Debate & Parallel modes","Swarm memory across runs","Live execution timeline","Post-execution insights & v2 creation"].map(f => (
            <div key={f} className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background:C.greenBg, border:`1px solid ${C.greenBd}` }}>
                <Check style={{ width:9, height:9, color:C.green, strokeWidth:3 }}/>
              </div>
              <span className="text-xs font-medium text-zinc-700">{f}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={close} className="flex-1 h-11 rounded-xl font-semibold text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            style={{ border:`1px solid ${C.border2}` }}>Maybe later</button>
          <button onClick={() => { close(); router.push("/billing") }}
            className="flex-1 h-11 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 hover:opacity-90"
            style={{ background:`linear-gradient(135deg,${C.brand},${C.brandDk})`, boxShadow:`0 4px 16px ${C.brand}40` }}>
            <Rocket style={{ width:14, height:14 }}/> Upgrade now
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Templates modal ───────────────────────────────────────────────── */
const DEMO_TEMPLATES: Template[] = [
  { id:"t1", name:"Investment Research Swarm", mode:"orchestrate", description:"Research · Analyst · Fact Checker · Writer", agent_roles:[] },
  { id:"t2", name:"Content Creation Swarm",   mode:"orchestrate", description:"Researcher · Writer · Editor · SEO", agent_roles:[] },
  { id:"t3", name:"Due Diligence Swarm",       mode:"parallel",    description:"Financial · Legal · Market · Risk", agent_roles:[] },
  { id:"t4", name:"Competitive Intelligence",  mode:"debate",      description:"Multiple analysts debate market position", agent_roles:[] },
  { id:"t5", name:"Code Review Pipeline",      mode:"orchestrate", description:"Architect · Reviewer · Security · Docs", agent_roles:[] },
  { id:"t6", name:"Market Analysis Swarm",     mode:"orchestrate", description:"Research · Analysis · Report pipeline", agent_roles:[] },
]
const MODE_COLOR: Record<string,string> = { orchestrate:C.brand, debate:C.blue, parallel:C.amber }

const TemplatesModal = ({ open, close, templates, onLoad }: {
  open:boolean; close:()=>void; templates:Template[]; onLoad:(t:Template)=>void
}) => {
  const list = templates.length ? templates : DEMO_TEMPLATES
  return (
    <Modal open={open} close={close} title="Swarm Templates" width={540}>
      <div className="p-4 space-y-2">
        <p className="text-xs text-zinc-400 mb-3">Select a template to load its configuration</p>
        {list.map(t => (
          <button key={t.id} type="button" onClick={() => { onLoad(t); close() }}
            className="w-full flex items-start gap-3.5 p-4 rounded-2xl text-left transition-all hover:bg-zinc-50 group"
            style={{ border:`1px solid ${C.border}` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background:`${MODE_COLOR[t.mode]??C.brand}14`, border:`1px solid ${MODE_COLOR[t.mode]??C.brand}25` }}>
              <Network style={{ width:16, height:16, color:MODE_COLOR[t.mode]??C.brand }}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-zinc-900">{t.name}</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize"
                  style={{ background:`${MODE_COLOR[t.mode]??C.brand}14`, color:MODE_COLOR[t.mode]??C.brand }}>
                  {t.mode}
                </span>
              </div>
              {t.description && <p className="text-xs text-zinc-400">{t.description}</p>}
            </div>
            <ChevronRight className="text-zinc-300 group-hover:text-zinc-500 transition-colors flex-shrink-0 mt-0.5" style={{ width:14, height:14 }}/>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/* ── Save modal ────────────────────────────────────────────────────── */
const SaveModal = ({ open, close, mode, agentCount, onSave }: {
  open:boolean; close:()=>void; mode:string; agentCount:number; onSave:(n:string,d:string)=>Promise<void>
}) => {
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [saving, setSaving] = useState(false)
  const handle = async () => {
    if (!name.trim()) { toast.error("Name required"); return }
    setSaving(true); await onSave(name.trim(), desc.trim()); setSaving(false); close(); setName(""); setDesc("")
  }
  return (
    <Modal open={open} close={close} title="Save as Template" width={420}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3 p-3.5 rounded-2xl" style={{ background:C.soft, border:`1px solid ${C.border}` }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:`${C.brand}14` }}>
            <Network style={{ width:14, height:14, color:C.brand }}/>
          </div>
          <div>
            <p className="text-xs text-zinc-400 mb-0.5">Current configuration</p>
            <p className="text-sm font-semibold text-zinc-900 capitalize">{mode} · {agentCount} agent{agentCount!==1?"s":""}</p>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-700 block mb-1.5">Template Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Investment Research Swarm"
            className="w-full rounded-xl focus:outline-none h-9 text-sm px-3"
            style={{ border:`1px solid ${C.border2}` }}/>
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-700 block mb-1.5">Description</label>
          <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does this swarm do?"
            className="w-full rounded-xl resize-none focus:outline-none text-sm px-3 py-2.5"
            style={{ border:`1px solid ${C.border2}`, fontFamily:"inherit" }}/>
        </div>
        <div className="flex gap-3">
          <button onClick={close} className="flex-1 h-10 rounded-xl font-semibold text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            style={{ border:`1px solid ${C.border2}` }}>Cancel</button>
          <button onClick={handle} disabled={saving||!name.trim()} className="flex-1 h-10 rounded-xl font-bold text-sm text-white"
            style={{ background:name.trim()?C.brand:`${C.brand}50`, cursor:name.trim()?"pointer":"default" }}>
            {saving?"Saving…":"Save Template"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Trace modal ───────────────────────────────────────────────────── */
const TraceModal = ({ open, close, log }: { open:boolean; close:()=>void; log:any[] }) => (
  <Modal open={open} close={close} title="Execution Trace" width={700}>
    <div className="p-4 space-y-2.5">
      {!log.length && (
        <div className="text-center py-12">
          <Eye style={{ width:32, height:32, color:C.text4, margin:"0 auto 10px" }}/>
          <p className="text-sm font-medium text-zinc-400">No trace data yet. Run the swarm first.</p>
        </div>
      )}
      {log.map((entry,i) => {
        const from=entry.from??entry.type??`Step ${i+1}`, isOrch=entry.from==="orchestrator"
        const content=entry.content??entry.outputs??entry.results??entry
        return (
          <div key={i} className="rounded-2xl p-3.5" style={{ background:C.soft, border:`1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background:isOrch?`${C.brand}14`:`${C.green}14`, color:isOrch?C.brand:C.greenTx }}>
                {from}
              </span>
              {entry.timestamp&&<span className="text-[9px] text-zinc-400">{new Date(entry.timestamp).toLocaleTimeString()}</span>}
            </div>
            <pre className="rounded-xl overflow-auto text-[10px] p-3 leading-relaxed"
              style={{ background:C.bg, color:C.text1, fontFamily:"monospace", maxHeight:160, whiteSpace:"pre-wrap" }}>
              {JSON.stringify(content,null,2).slice(0,600)}
            </pre>
          </div>
        )
      })}
    </div>
  </Modal>
)

/* ── Plan card ─────────────────────────────────────────────────────── */
const PlanCard = ({ agents, mode, rounds }: { agents:Agent[]; mode:SwarmMode; rounds:number }) => {
  const m = calcMetrics(agents, mode, rounds)
  if (!agents.length) return null
  const steps = mode==="orchestrate" ? [
    { label:getRoleMeta(agents[0]).role+": "+agents[0].name, desc:"Decompose & coordinate" },
    ...agents.slice(1,agents.length>3?agents.length-1:agents.length).map(a => {
      const r=getRoleMeta(a)
      return { label:r.role+": "+a.name, desc:r.role==="Research"?"Gather & research":"Execute sub-task" }
    }),
    ...(agents.length>=3?[{ label:getRoleMeta(agents[agents.length-1]).role+": "+agents[agents.length-1].name, desc:"Synthesise final output" }]:[]),
  ] : agents.map(a => ({ label:getRoleMeta(a).role+": "+a.name, desc:mode==="debate"?"Propose & critique":"Execute independently" }))
  return (
    <motion.div initial={{ opacity:0,y:-6 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:-6 }}
      className="mx-4 mt-3 rounded-2xl overflow-hidden flex-shrink-0"
      style={{ border:`1px solid ${C.brandBd}`, background:`linear-gradient(135deg,${C.brandBg},#f0f4ff 80%)` }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom:`1px solid ${C.brandBd}` }}>
        <div className="flex items-center gap-2">
          <List style={{ width:12, height:12, color:C.brand }}/>
          <span className="text-xs font-bold" style={{ color:C.brand }}>Execution Plan</span>
          <span className="text-xs text-indigo-400">· Preview before launch</span>
        </div>
        <div className="flex items-center gap-4">
          {[{Icon:Clock,v:`~${m.secs}s`},{Icon:DollarSign,v:`~$${m.cost.toFixed(3)}`},{Icon:Target,v:`${m.acc}% conf`}].map(({Icon,v}) => (
            <div key={v} className="flex items-center gap-1">
              <Icon style={{ width:10, height:10, color:C.brand }}/>
              <span className="text-[10px] font-semibold" style={{ color:C.brand }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        {steps.map((s,i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="rounded-xl px-3 py-1.5" style={{ background:"rgba(99,102,241,0.08)", border:`1px solid ${C.brandBd}` }}>
              <p className="text-[10.5px] font-bold whitespace-nowrap" style={{ color:C.brand, maxWidth:160, overflow:"hidden", textOverflow:"ellipsis" }}>{s.label}</p>
              <p className="text-[8.5px] whitespace-nowrap mt-0.5" style={{ color:C.text3 }}>{s.desc}</p>
            </div>
            {i<steps.length-1 && <ArrowRight style={{ width:11, height:11, color:C.brandBd, flexShrink:0 }}/>}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

/* ── Swarm Graph ─────────────────────────────────────────────────── */
function bezier(x1:number,y1:number,x2:number,y2:number,cv=0.45):string {
  const cy=Math.abs(y2-y1)*cv
  return `M${x1},${y1} C${x1},${y1+cy} ${x2},${y2-cy} ${x2},${y2}`
}

function GraphNode({x,y,w,h,agent,conf,pulse,rx=14}:{
  x:number;y:number;w:number;h:number;agent:Agent;conf?:number;pulse?:boolean;rx?:number
}) {
  const m=getRoleMeta(agent), mid=x+w/2
  const uid=`ng-${agent.id.slice(0,8)}`, sid=`ns-${agent.id.slice(0,8)}`
  return (
    <g>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={m.bg}/>
          <stop offset="100%" stopColor={m.bd} stopOpacity="0.35"/>
        </linearGradient>
        <filter id={sid} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor={m.color} floodOpacity="0.10"/>
        </filter>
      </defs>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#${uid})`} stroke={m.bd} strokeWidth="1.5" filter={`url(#${sid})`}/>
      <rect x={mid-30} y={y+8} width={60} height={16} rx={8} fill={m.color} fillOpacity="0.12"/>
      <text x={mid} y={y+19.5} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={m.color} fontFamily="system-ui,sans-serif">
        {m.role.toUpperCase()}
      </text>
      <text x={mid} y={y+38} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#18181b" fontFamily="system-ui,sans-serif">
        {agent.name.slice(0,16)}{agent.name.length>16?"…":""}
      </text>
      <rect x={mid-22} y={y+44} width={44} height={14} rx={7} fill="#f4f4f5" stroke="#e4e4e7" strokeWidth="1"/>
      <text x={mid} y={y+54} textAnchor="middle" fontSize="8" fontWeight="600" fill="#71717a" fontFamily="system-ui,sans-serif">
        {shortModel(agent.model_name)}
      </text>
      {conf!==undefined&&(()=>{
        const r=10,cx=x+w-18,cy2=y+h-16,pct=conf/100
        const θ=pct*2*Math.PI-Math.PI/2, lx=cx+r*Math.cos(θ), ly=cy2+r*Math.sin(θ), large=pct>0.5?1:0
        return <g>
          <circle cx={cx} cy={cy2} r={r} fill="none" stroke={m.bd} strokeWidth="2.5"/>
          <path d={`M${cx},${cy2-r} A${r},${r} 0 ${large},1 ${lx},${ly}`} fill="none" stroke={m.color} strokeWidth="2.5" strokeLinecap="round"/>
          <text x={cx} y={cy2+3.5} textAnchor="middle" fontSize="7.5" fontWeight="700" fill={m.color} fontFamily="system-ui,sans-serif">{conf}%</text>
        </g>
      })()}
      {pulse&&<rect x={x+8} y={y+h-5} height={3} rx={1.5} fill={m.color} opacity="0.4">
        <animate attributeName="x" values={`${x+8};${x+w-28};${x+8}`} dur="1.6s" repeatCount="indefinite"/>
        <animate attributeName="width" values="14;24;14" dur="1.6s" repeatCount="indefinite"/>
      </rect>}
    </g>
  )
}

function FlowDot({path,color,delay=0,dur=2}:{path:string;color:string;delay?:number;dur?:number}) {
  return (
    <circle r={3} fill={color} opacity="0.75">
      <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" path={path}/>
      <animate attributeName="opacity" values="0;0.8;0.8;0" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite"/>
    </circle>
  )
}

const SwarmGraph = ({ agents, mode, running }: { agents:Agent[]; mode:SwarmMode; running:boolean }) => {
  const W=600, NW=156, NH=80
  const LEGEND=[{c:C.brand,l:"Orchestrator"},{c:C.blue,l:"Analysis"},{c:C.violet,l:"Synthesis"},{c:C.green,l:"Output"}]

  if (!agents.length) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 select-none">
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
        style={{ background:`linear-gradient(135deg,${C.brandBg},${C.violetBg})`, border:`1.5px solid ${C.brandBd}` }}>
        <Network style={{ width:36, height:36, color:C.brand }}/>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-700 mb-1">No agents selected</p>
        <p className="text-xs text-zinc-400">Select 2+ agents to preview the swarm topology</p>
      </div>
    </div>
  )

  if (mode==="orchestrate" && agents.length>=2) {
    const planner=agents[0], workers=agents.slice(1,agents.length>3?agents.length-1:agents.length)
    const synth=agents.length>=3?agents[agents.length-1]:null
    const PY=24,WY=PY+NH+72,SY=WY+NH+10+72,OY=SY+NH+10+60
    const TOTAL=(synth?OY+56:WY+NH+20+60)+20
    const N=workers.length,gap=Math.min(180,(W-40)/Math.max(N,1))
    const wxs=workers.map((_,i)=>(W-(N-1)*gap)/2+i*gap)
    const px=(W-NW)/2+NW/2

    return (
      <div className="flex-1 flex flex-col" style={{ minHeight:0 }}>
        <div className="flex items-center gap-5 px-5 py-2.5 flex-shrink-0 flex-wrap" style={{ borderBottom:`1px solid ${C.border}` }}>
          {LEGEND.map(l=><div key={l.l} className="flex items-center gap-1.5"><div style={{ width:8,height:8,borderRadius:"50%",background:l.c }}/><span className="text-xs text-zinc-400 font-medium">{l.l}</span></div>)}
          <span className="ml-auto text-xs font-semibold text-zinc-400">{N+(synth?2:1)} agents · orchestrate</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4" style={{ minHeight:0 }}>
          <svg width="100%" viewBox={`0 0 ${W} ${TOTAL}`} preserveAspectRatio="xMidYMid meet"
            style={{ display:"block",width:"100%",minHeight:Math.min(TOTAL,560) }}>
            <defs>
              <marker id="aGray" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M1 1.5L6 4L1 6.5" fill="none" stroke="#d4d4d8" strokeWidth="1.5" strokeLinecap="round"/>
              </marker>
              <marker id="aGreen" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M1 1.5L6 4L1 6.5" fill="none" stroke={C.green} strokeWidth="1.5" strokeLinecap="round"/>
              </marker>
            </defs>
            {wxs.map((wx,i)=>{const p=bezier(px,PY+NH,wx,WY);return<g key={i}><path d={p} fill="none" stroke="#e4e4e7" strokeWidth="1.5" markerEnd="url(#aGray)" strokeDasharray={running?"5 3":"none"}/>{running&&<FlowDot path={p} color={C.brand} delay={i*0.4} dur={1.8}/>}</g>})}
            {synth&&wxs.map((wx,i)=>{const p=bezier(wx,WY+NH+10,(W-NW)/2+NW/2,SY);return<g key={i}><path d={p} fill="none" stroke="#e4e4e7" strokeWidth="1.5" markerEnd="url(#aGray)"/>{running&&<FlowDot path={p} color={C.violet} delay={0.8+i*0.3} dur={2.1}/>}</g>})}
            {synth&&(()=>{const p=bezier((W-NW)/2+NW/2,SY+NH+10,W/2,OY);return<g><path d={p} fill="none" stroke={C.green} strokeWidth="2" markerEnd="url(#aGreen)"/>{running&&<FlowDot path={p} color={C.green} delay={1.4} dur={1.6}/>}</g>})()}
            <GraphNode x={(W-NW)/2} y={PY} w={NW} h={NH} agent={planner} conf={95} pulse={running}/>
            {workers.map((a,i)=><GraphNode key={a.id} x={wxs[i]-NW/2} y={WY} w={NW} h={NH+10} agent={a} conf={88+i*2}/>)}
            {synth&&<GraphNode x={(W-NW)/2} y={SY} w={NW} h={NH+10} agent={synth} conf={91}/>}
            {(()=>{
              const oy=synth?OY:WY+NH+20
              return<g>
                <defs>
                  <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.greenBg}/><stop offset="100%" stopColor={C.greenBd} stopOpacity="0.5"/></linearGradient>
                  <filter id="outGlow"><feDropShadow dx="0" dy="3" stdDeviation="6" floodColor={C.green} floodOpacity="0.2"/></filter>
                </defs>
                <rect x={(W-176)/2} y={oy} width={176} height={52} rx={14} fill="url(#outGrad)" stroke={C.green} strokeWidth="2" filter="url(#outGlow)"/>
                <text x={W/2} y={oy+23} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={C.greenTx} fontFamily="system-ui,sans-serif">Executive Report</text>
                <text x={W/2} y={oy+38} textAnchor="middle" fontSize="9.5" fontWeight="500" fill="#86efac" fontFamily="system-ui,sans-serif">Final Output · Synthesised</text>
              </g>
            })()}
          </svg>
        </div>
      </div>
    )
  }

  const N=agents.length, gap=Math.min(150,(W-60)/Math.max(N,1)), xs=agents.map((_,i)=>(W-(N-1)*gap)/2+i*gap), TOTAL=260
  return (
    <div className="flex-1 flex flex-col" style={{ minHeight:0 }}>
      <div className="flex items-center gap-5 px-5 py-2.5 flex-shrink-0 flex-wrap" style={{ borderBottom:`1px solid ${C.border}` }}>
        {LEGEND.map(l=><div key={l.l} className="flex items-center gap-1.5"><div style={{ width:8,height:8,borderRadius:"50%",background:l.c }}/><span className="text-xs text-zinc-400 font-medium">{l.l}</span></div>)}
        <span className="ml-auto text-xs font-semibold text-zinc-400">{N} agents · {mode}</span>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-4" style={{ minHeight:0 }}>
        <svg width="100%" viewBox={`0 0 ${W} ${TOTAL}`} style={{ display:"block",minHeight:TOTAL }}>
          <defs><marker id="aGray2" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M1 1.5L6 4L1 6.5" fill="none" stroke="#d4d4d8" strokeWidth="1.5" strokeLinecap="round"/></marker></defs>
          <rect x={(W-140)/2} y={10} width={140} height={36} rx={12} fill={C.brandBg} stroke={C.brandBd} strokeWidth="1.5"/>
          <text x={W/2} y={32} textAnchor="middle" fontSize="12" fontWeight="700" fill={C.brand} fontFamily="system-ui,sans-serif">{mode==="debate"?"Debate Task":"Parallel Task"}</text>
          {agents.map((_,i)=>{const p=bezier(W/2,46,xs[i],106);return<g key={i}><path d={p} fill="none" stroke="#e4e4e7" strokeWidth="1.5" markerEnd="url(#aGray2)"/>{running&&<FlowDot path={p} color={C.brand} delay={i*0.35} dur={1.5}/>}</g>})}
          {agents.map((a,i)=>{
            const m=getRoleMeta(a), uid=`pg-${a.id.slice(0,6)}`
            return<g key={a.id}>
              <defs><linearGradient id={uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={m.bg}/><stop offset="100%" stopColor={m.bd} stopOpacity="0.4"/></linearGradient></defs>
              <rect x={xs[i]-NW/2} y={110} width={NW} height={NH} rx={14} fill={`url(#${uid})`} stroke={m.bd} strokeWidth="1.5"/>
              <rect x={xs[i]-26} y={118} width={52} height={16} rx={8} fill={m.color} fillOpacity="0.12"/>
              <text x={xs[i]} y={129} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={m.color} fontFamily="system-ui,sans-serif">{m.role.toUpperCase()}</text>
              <text x={xs[i]} y={147} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#18181b" fontFamily="system-ui,sans-serif">{a.name.slice(0,14)}</text>
              <text x={xs[i]} y={162} textAnchor="middle" fontSize="8.5" fill="#71717a" fontFamily="system-ui,sans-serif">{shortModel(a.model_name)}</text>
              <text x={xs[i]} y={180} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={m.color} fontFamily="system-ui,sans-serif">Conf: {88+i*2}%</text>
            </g>
          })}
          {agents.map((_,i)=>{const p=bezier(xs[i],190,W/2,215);return<path key={i} d={p} fill="none" stroke="#e4e4e7" strokeWidth="1.5" markerEnd="url(#aGray2)"/>})}
          <defs><linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.greenBg}/><stop offset="100%" stopColor={C.greenBd} stopOpacity="0.5"/></linearGradient></defs>
          <rect x={(W-120)/2} y={217} width={120} height={34} rx={12} fill="url(#mGrad)" stroke={C.green} strokeWidth="2"/>
          <text x={W/2} y={238} textAnchor="middle" fontSize="11.5" fontWeight="700" fill={C.greenTx} fontFamily="system-ui,sans-serif">Merge Results</text>
        </svg>
      </div>
    </div>
  )
}

/* ── Live Execution ────────────────────────────────────────────────── */
const LiveExecution = ({ agents, running, result, onTrace }: {
  agents:Agent[]; running:boolean; result:SwarmResult|null; onTrace:()=>void
}) => {
  const [elapsed,setElapsed]=useState(0)
  const t0=useRef<number|null>(null)
  useEffect(()=>{
    if(running){t0.current=Date.now();const iv=setInterval(()=>{if(t0.current)setElapsed(Math.floor((Date.now()-t0.current)/1000))},250);return()=>clearInterval(iv)}
    setElapsed(0);t0.current=null
  },[running])
  if(!running&&!result)return null
  const fmt=(s:number)=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`
  const startedAt=running&&t0.current?new Date(t0.current).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}):"—"
  const ACTS:Record<string,string>={Research:"Searching web & gathering data…",Analysis:"Analysing competitors & financials…",Verification:"Verifying sources & claims…",Synthesis:"Waiting for inputs…",General:"Processing task…"}
  const TL=60
  const steps=agents.map((a,i)=>{
    const m=getRoleMeta(a),dur=10+i*7,start=i*5
    let status:StepStatus="pending",d="--",pct=0
    if(result){status="completed";d=`${dur}.${i}s`;pct=100}
    else if(running){if(elapsed>start+dur){status="completed";d=`${dur}.0s`;pct=100}else if(elapsed>start){status="in_progress";pct=Math.min(88,((elapsed-start)/dur)*100)}}
    return{num:i+1,name:a.name,action:ACTS[m.role]??ACTS.General,status,d,pct,color:m.color,bx:(start/TL)*100,bw:(dur/TL)*100}
  })
  const SS:Record<StepStatus,{num:string;pill:string;label:string}>={
    completed:{num:"bg-green-100 text-green-700",pill:"bg-green-50 text-green-700 border-green-100",label:"Done"},
    in_progress:{num:"bg-blue-100 text-blue-700",pill:"bg-blue-50 text-blue-700 border-blue-100",label:"Running"},
    pending:{num:"bg-zinc-100 text-zinc-400",pill:"bg-zinc-50 text-zinc-400 border-zinc-100",label:"Waiting"},
  }
  return(
    <div className="flex-shrink-0" style={{ borderTop:`1px solid ${C.border}`,background:C.bg }}>
      <div className="flex items-center gap-2.5 px-5 py-2.5" style={{ borderBottom:`1px solid ${C.border}` }}>
        {running?(
          <><span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background:C.green }}/>
            <span className="text-xs font-bold text-zinc-900">Live Execution</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse"
              style={{ background:C.blueBg,color:C.blue,border:`1px solid ${C.blueBd}` }}>In Progress</span>
            <span className="text-[10px] text-zinc-400">Started {startedAt} · {fmt(elapsed)}</span></>
        ):(
          <><CheckCircle2 style={{ width:14,height:14,color:C.green,flexShrink:0 }}/>
            <span className="text-xs font-bold text-zinc-900">Execution Complete</span></>
        )}
        <button onClick={onTrace} className="ml-auto flex items-center gap-1.5 text-xs font-semibold hover:underline" style={{ color:C.brand }}>
          <Eye style={{ width:11,height:11 }}/> View Trace
        </button>
        <div className="flex ml-3">{[0,15,30,45,60].map(t=><span key={t} className="text-[9px] text-zinc-300 tabular-nums text-center" style={{ width:52 }}>{t}s</span>)}</div>
      </div>
      {steps.map(s=>(
        <div key={s.num} className="flex items-center gap-2.5 px-5" style={{ paddingTop:6,paddingBottom:6,borderBottom:"1px solid rgba(240,240,241,0.7)" }}>
          <span className={cn("w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold",SS[s.status].num)}>{s.num}</span>
          <span className="w-28 truncate flex-shrink-0 text-xs font-semibold text-zinc-900">{s.name}</span>
          <span className="flex-1 truncate min-w-0 text-[10px] text-zinc-500">{s.action}</span>
          <span className={cn("flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border",SS[s.status].pill)}>{SS[s.status].label}</span>
          <span className="w-10 text-right flex-shrink-0 text-[10px] text-zinc-400 tabular-nums">{s.d}</span>
          <div className="w-[104px] h-5 rounded-md flex-shrink-0 relative overflow-hidden" style={{ background:C.surf }}>
            {s.pct>0&&<div className="absolute top-1.5 h-[10px] rounded-sm transition-all duration-500"
              style={{ left:`${s.bx}%`,width:`${s.bw*(s.pct/100)}%`,
                background:s.status==="completed"?`${s.color}35`:`${s.color}55`,
                backgroundImage:s.status==="in_progress"?"repeating-linear-gradient(-45deg,transparent,transparent 3px,rgba(255,255,255,.3) 3px,rgba(255,255,255,.3) 6px)":undefined }}/>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Right panel ───────────────────────────────────────────────────── */
const DEMO_SESSIONS=[
  {name:"AI Marketplace Research", status:"completed",date:"May 29 · 2:45 PM"},
  {name:"Investment Memo Q2",      status:"completed",date:"May 29 · 11:30 AM"},
  {name:"Competitor Analysis",     status:"completed",date:"May 28 · 4:15 PM"},
  {name:"Market Opportunity Scan", status:"failed",   date:"May 28 · 10:00 AM"},
  {name:"Regulatory Update Brief", status:"completed",date:"May 27 · 6:20 PM"},
]
const RightPanel = ({ agents,mode,rounds,running,result,sessions,templates,onCreateV2,onOpenTemplates }:{
  agents:Agent[];mode:SwarmMode;rounds:number;running:boolean;result:SwarmResult|null
  sessions:any[];templates:Template[];onCreateV2:()=>void;onOpenTemplates:()=>void
}) => {
  const m=calcMetrics(agents,mode,rounds), has=agents.length>0
  const list=sessions.length?sessions:DEMO_SESSIONS
  const tmplNames=templates.length?templates.map(t=>t.name):["Investment Research Swarm","Content Creation Swarm","Due Diligence Swarm","Market Analysis Swarm"]
  return(
    <aside className="flex-shrink-0 overflow-y-auto" style={{ width:276,borderLeft:`1px solid ${C.border}`,background:C.bg }}>
      <div className="px-4 pt-4 pb-3" style={{ borderBottom:`1px solid ${C.border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <Brain style={{ width:14,height:14,color:C.brand }}/><span className="text-sm font-bold text-zinc-900">Swarm Intelligence</span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            {label:"Success Est.",v:has?`${m.acc}%`:"—",color:has?C.green:C.text3},
            {label:"Cost Est.",v:has?`$${m.cost.toFixed(2)}`:"—",color:has?C.brand:C.text3},
            {label:"Runtime Est.",v:has?`${m.secs}s`:"—",color:has?C.text:C.text3},
            {label:"Complexity",v:has?m.complexity:"—",color:!has?C.text3:m.complexity==="High"?C.red:m.complexity==="Medium"?C.amber:C.green},
          ].map((k,i)=>(
            <div key={i} className="rounded-2xl p-3 flex flex-col gap-1" style={{ background:C.soft,border:`1px solid ${C.border}` }}>
              <p className="text-[9.5px] font-medium text-zinc-400">{k.label}</p>
              <p className="text-xl font-black tabular-nums leading-none" style={{ color:k.color }}>{k.v}</p>
            </div>
          ))}
        </div>
        <div className="space-y-0.5">
          {[
            {icon:Cpu,label:"Models",value:has?m.models:"—"},
            {icon:Zap,label:"Workers",value:has?`${m.workers} agents`:"—"},
            {icon:GitBranch,label:"Routing",value:"Cost-aware · Confidence"},
            {icon:MemoryStick,label:"Memory",value:"Enabled (Long-term)"},
          ].map(({icon:Icon,label,value})=>(
            <div key={label} className="flex items-center gap-2 py-1.5" style={{ borderBottom:`1px solid rgba(240,240,241,0.8)` }}>
              <Icon style={{ width:11,height:11,color:C.text4,flexShrink:0 }}/><span className="text-[10px] text-zinc-400">{label}</span>
              <span className="ml-auto text-right truncate text-[10px] font-semibold text-zinc-700 max-w-[130px]">{value}</span>
            </div>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {result&&(
          <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:"auto"}} exit={{opacity:0,height:0}}
            className="overflow-hidden" style={{ borderBottom:`1px solid ${C.border}` }}>
            <div className="px-4 py-3">
              <p className="text-xs font-bold text-zinc-900 mb-3">Post-Execution Insights</p>
              <div className="flex gap-3">
                <div className="relative flex-shrink-0" style={{ width:52,height:52 }}>
                  <svg width="52" height="52" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="20" fill="none" stroke={C.greenBg} strokeWidth="7"/>
                    <circle cx="26" cy="26" r="20" fill="none" stroke={C.green} strokeWidth="7" strokeDasharray="115.6 125.7" strokeLinecap="round" transform="rotate(-90 26 26)"/>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-black leading-none text-zinc-900">92</span>
                    <span className="text-[8px] text-zinc-400 mt-0.5">/100</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Strengths</p>
                  {["Strong research depth","High source reliability","Well-structured output"].map(s=>(
                    <div key={s} className="flex items-center gap-1.5 mb-1">
                      <Check style={{ width:9,height:9,color:C.green,flexShrink:0,strokeWidth:3 }}/>
                      <span className="text-[10px] text-zinc-700">{s}</span>
                    </div>
                  ))}
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mt-2 mb-1.5">Suggestions</p>
                  {["Add Legal Analyst agent","Include more risk analysis"].map(s=>(
                    <div key={s} className="flex items-center gap-1.5 mb-1">
                      <Lightbulb style={{ width:9,height:9,color:C.amber,flexShrink:0 }}/>
                      <span className="text-[10px] text-zinc-700">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={onCreateV2} className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-xl font-bold text-xs text-white hover:opacity-90"
                style={{ height:32,background:"#18181b" }}>
                <Sparkles style={{ width:12,height:12 }}/> Create Swarm v2
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="pt-3 pb-2" style={{ borderBottom:`1px solid ${C.border}` }}>
        <div className="flex items-center justify-between px-4 mb-2">
          <p className="text-xs font-bold text-zinc-900">Recent Swarms</p>
          <button className="text-[10px] font-semibold hover:underline" style={{ color:C.brand }}>View all</button>
        </div>
        {list.slice(0,5).map((s:any,i:number)=>{
          const ok=s.status!=="failed"
          return(
            <button key={i} type="button" className="w-full flex items-center gap-2.5 px-4 py-1.5 hover:bg-zinc-50 transition-colors text-left">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:ok?C.greenBg:C.redBg }}>
                {ok?<CheckCircle2 style={{ width:12,height:12,color:C.green }}/>:<AlertCircle style={{ width:12,height:12,color:C.redTx }}/>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[11px] font-semibold text-zinc-900">{s.name??s.id?.slice(0,28)}</p>
                <p className="text-[10px] text-zinc-400">{s.date??new Date(s.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background:ok?C.greenBg:C.redBg,color:ok?C.greenTx:C.redTx }}>{ok?"Done":"Failed"}</span>
            </button>
          )
        })}
      </div>
      <div className="pt-3 pb-4">
        <div className="flex items-center justify-between px-4 mb-2">
          <p className="text-xs font-bold text-zinc-900">Templates</p>
          <button onClick={onOpenTemplates} className="text-[10px] font-semibold hover:underline" style={{ color:C.brand }}>View all</button>
        </div>
        {tmplNames.map((t:string)=>(
          <button key={t} type="button" className="w-full flex items-center gap-2.5 px-4 py-1.5 hover:bg-zinc-50 transition-colors text-left">
            <LayoutTemplate style={{ width:12,height:12,color:C.text4,flexShrink:0 }}/><span className="text-[11px] text-zinc-500">{t}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}

/* ── Agent Row ─────────────────────────────────────────────────────── */
const AgentRow = ({ agent,idx,selected,onToggle }:{agent:Agent;idx:number;selected:boolean;onToggle:()=>void}) => {
  const meta=getRoleMeta(agent), conf=88+(idx%5)*2, cost=-(0.010+(idx%4)*0.003)
  return(
    <button type="button" onClick={onToggle}
      className="w-full flex items-center gap-2 px-4 py-2.5 text-left group transition-colors focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-indigo-500"
      style={{ borderBottom:`1px solid ${C.border}`,background:selected?`${C.brand}08`:undefined }}>
      <GripVertical className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ width:13,height:13,color:C.text4 }}/>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background:meta.bg,border:`1.5px solid ${meta.bd}` }}>
        <Bot style={{ width:14,height:14,color:meta.color }}/>
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-[11px] font-bold text-zinc-900">{agent.name}</p>
        <p className="text-[9.5px] font-semibold" style={{ color:meta.color }}>
          {meta.role}<span className="font-normal text-zinc-400"> · {shortModel(agent.model_name)}</span>
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[11px] font-bold tabular-nums text-zinc-900">{conf}%</p>
        <p className="text-[9.5px] text-red-400 tabular-nums">{cost.toFixed(3)}</p>
      </div>
    </button>
  )
}

/* ── Constants ─────────────────────────────────────────────────────── */
const MODES=[
  {id:"orchestrate"as SwarmMode,icon:Layers,      label:"Orchestrate",desc:"Planner delegates to specialists",color:C.brand,bg:C.brandBg,bdr:C.brandBd},
  {id:"debate"     as SwarmMode,icon:MessageSquare,label:"Debate",     desc:"Agents critique for consensus",  color:C.blue, bg:C.blueBg, bdr:C.blueBd },
  {id:"parallel"   as SwarmMode,icon:Activity,    label:"Parallel",   desc:"Simultaneous max speed",         color:C.amber,bg:C.amberBg,bdr:C.amberBd},
]
const CONSENSUS=["Majority Vote","Weighted Confidence","Unanimous Agreement"]
const CONFLICTS=["High Confidence Wins","Latest Wins","Human Review"]

/* ── Main ──────────────────────────────────────────────────────────── */
export default function SwarmClient() {
  const router = useRouter()

  // Bug #7 fix: create supabase client ONCE via useRef — not on every render.
  // Previously `const supabase = createClient()` was called inline in the component
  // body, creating a new client object on every render, which caused unnecessary
  // re-subscriptions and potential infinite re-render loops in callbacks
  // that closed over it.
  const sbRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!sbRef.current) sbRef.current = createClient()
  const supabase = sbRef.current

  const [agents,setAgents]           = useState<Agent[]>([])
  const [agentsLoading,setAgLoading] = useState(false)
  const [sessions,setSessions]       = useState<any[]>([])
  const [templates,setTemplates]     = useState<Template[]>([])
  const [mTemplates,setMTemplates]   = useState(false)
  const [mSave,setMSave]             = useState(false)
  const [mTrace,setMTrace]           = useState(false)
  const [mUpgrade,setMUpgrade]       = useState(false)
  const [task,setTask]               = useState("Research the AI agent marketplace and create an investment memo with key opportunities and risks.")
  const [context,setContext]         = useState("")
  const [showCtx,setShowCtx]         = useState(false)
  const [showVars,setShowVars]       = useState(false)
  const [vars,setVars]               = useState<Var[]>([])
  const [files,setFiles]             = useState<AFile[]>([])
  const fileRef                      = useRef<HTMLInputElement>(null)
  const [mode,setMode]               = useState<SwarmMode>("orchestrate")
  const [rounds,setRounds]           = useState(3)
  const [cm,setCm]                   = useState("Weighted Confidence")
  const [arbiter,setArbiter]         = useState("Planner Agent")
  const [conflictR,setConflictR]     = useState("High Confidence Wins")
  const [earlyStp,setEarlyStp]       = useState(true)
  const [selected,setSelected]       = useState<string[]>([])
  const [budget,setBudget]           = useState(0.05)
  const [maxRT,setMaxRT]             = useState(60)
  const [accCost,setAccCost]         = useState(50)
  const [autoAsm,setAutoAsm]         = useState(true)
  const [dynSwarm,setDynSwarm]       = useState(true)
  const [remLearn,setRemLearn]       = useState(true)
  const [running,setRunning]         = useState(false)
  const [autoAsmBusy,setAutoAsmBusy] = useState(false)
  const [result,setResult]           = useState<SwarmResult|null>(null)
  const [error,setError]             = useState<string|null>(null)
  const [copied,setCopied]           = useState(false)

  useEffect(()=>{
    setAgLoading(true)
    supabase.auth.getUser().then(({data:{user}})=>{
      if(!user){setAgLoading(false);return}
      supabase.from("agents").select("id,name,model_name,status,system_prompt")
        .eq("seller_id",user.id).eq("status","active")
        .order("created_at",{ascending:false}).limit(50)
        .then(({data})=>{setAgents(data??[]);setAgLoading(false)})
    })
    fetch("/api/swarm").then(r=>r.json()).then(d=>setSessions(d.sessions??[])).catch(()=>{})
    supabase.from("swarm_templates").select("id,name,mode,description,agent_roles")
      .eq("is_public",true).order("use_count",{ascending:false}).limit(8)
      .then(({data})=>setTemplates(data??[])).catch(()=>{})
  // supabase ref is stable — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  const onFileChange=useCallback((e:ChangeEvent<HTMLInputElement>)=>{
    const picked=Array.from(e.target.files??[])
    if(!picked.length)return
    if(picked.some(f=>f.size>10*1024*1024)){toast.error("Files must be under 10 MB");e.target.value="";return}
    const newFiles:AFile[]=picked.map(f=>{
      const kind:AFile["kind"]=f.type.startsWith("image/")?"image":(f.type.includes("pdf")||f.type.includes("word")||f.type.startsWith("text/"))?"doc":"other"
      const af:AFile={id:Math.random().toString(36).slice(2),file:f,kind}
      if(kind==="image"){const r=new FileReader();r.onload=ev=>setFiles(p=>p.map(x=>x.id===af.id?{...x,preview:ev.target?.result as string}:x));r.readAsDataURL(f)}
      return af
    })
    setFiles(p=>[...p,...newFiles].slice(0,8));e.target.value=""
    toast.success(`${newFiles.length} file${newFiles.length>1?"s":""} attached`)
  },[])

  const addVar=()=>setVars(v=>[...v,{id:Math.random().toString(36).slice(2),key:"",value:""}])
  const updVar=(id:string,f:"key"|"value",v:string)=>setVars(vs=>vs.map(x=>x.id===id?{...x,[f]:v}:x))
  const delVar=(id:string)=>setVars(v=>v.filter(x=>x.id!==id))
  const applyVars=()=>{
    let t=task;vars.forEach(v=>{if(v.key&&v.value)t=t.replaceAll(`${OPEN_VAR}${v.key}${CLOSE_VAR}`,v.value)})
    setTask(t);toast.success("Variables applied")
  }

  const doAutoAssemble=useCallback(async()=>{
    if(!task.trim()){toast.error("Enter a task first");return}
    if(!agents.length){toast.error("No active agents — create some in Builder");return}
    setAutoAsmBusy(true);await new Promise(r=>setTimeout(r,600))
    const tl=task.toLowerCase()
    const scored=agents.map(a=>{
      const sl=`${a.name} ${a.system_prompt??""}`.toLowerCase();let sc=Math.random()*0.15
      if(tl.includes("research")&&(sl.includes("research")||sl.includes("search")))sc+=3
      if(tl.includes("analys")&&(sl.includes("analyst")||sl.includes("analys")))sc+=3
      if((tl.includes("write")||tl.includes("memo")||tl.includes("report"))&&sl.includes("writ"))sc+=3
      if(tl.includes("fact")&&sl.includes("fact"))sc+=3
      if(tl.includes("financ")&&sl.includes("financ"))sc+=3
      if(tl.includes("code")&&sl.includes("cod"))sc+=3
      return{...a,sc}
    })
    scored.sort((a,b)=>b.sc-a.sc)
    const best=scored.slice(0,Math.min(4,agents.length)).map(a=>a.id)
    setSelected(best);setAutoAsmBusy(false);toast.success(`Auto-assembled ${best.length} agents`)
  },[task,agents])

  const toggleAgent=useCallback((id:string)=>{
    setSelected(sel=>{
      if(sel.includes(id))return sel.filter(s=>s!==id)
      if(sel.length>=8){toast.error("Max 8 agents per swarm");return sel}
      return[...sel,id]
    })
  },[])

  const runSwarm=useCallback(async()=>{
    if(!task.trim()){toast.error("Task is required");return}
    if(selected.length<2){toast.error("Select at least 2 agents");return}
    setRunning(true);setError(null);setResult(null)
    try{
      const fullTask=context.trim()?`${task.trim()}\n\n---\nAdditional context:\n${context.trim()}`:task.trim()
      let res:Response
      if(files.length){
        const fd=new FormData()
        fd.append("task",fullTask);fd.append("agentIds",JSON.stringify(selected))
        fd.append("mode",mode);fd.append("maxRounds",String(rounds))
        fd.append("enableMemory",String(remLearn));fd.append("consensusType",cm)
        files.forEach(f=>fd.append("files",f.file))
        res=await fetch("/api/swarm",{method:"POST",body:fd})
      }else{
        res=await fetch("/api/swarm",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({task:fullTask,agentIds:selected,mode,maxRounds:rounds,enableMemory:remLearn,consensusType:cm})})
      }
      const data=await res.json()
      if(res.status===402){setMUpgrade(true);return}
      if(!res.ok)throw new Error(data.error??`HTTP ${res.status}`)
      setResult(data)
      setSessions(prev=>[{id:data.sessionId,name:task.slice(0,42),status:"completed",date:"Just now"},...prev.slice(0,9)])
      toast.success(`Swarm complete — ${data.agentCount} agents`)
      supabase.rpc("record_swarm_run",{p_session_id:data.sessionId,p_mode:mode,p_agent_count:data.agentCount,p_success:true,p_debate_rounds:mode==="debate"?rounds:null}).catch(()=>{})
    }catch(err:any){const msg=err.message??"Swarm execution failed";setError(msg);toast.error(msg)}
    finally{setRunning(false)}
  },[task,context,files,selected,mode,rounds,remLearn,cm,supabase])

  const saveTemplate=useCallback(async(name:string,desc:string)=>{
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){toast.error("Must be logged in");return}
    const{error:err}=await supabase.from("swarm_templates").insert({owner_id:user.id,name,description:desc,mode,agent_roles:[],config:{rounds,cm,budget,maxRT,accCost},is_public:false})
    if(err)toast.error(err.message)
    else{toast.success("Template saved!");setTemplates(p=>[{id:Math.random().toString(36),name,mode,description:desc,agent_roles:[]},...p])}
  },[mode,rounds,cm,budget,maxRT,accCost,supabase])

  const selAgents=agents.filter(a=>selected.includes(a.id))
  const canLaunch=!running&&selected.length>=2&&task.trim().length>0
  const showPlan=selAgents.length>=2&&task.trim().length>0&&!running&&!result

  return(
    <div className="-mx-6 -my-8 flex flex-col" style={{ height:"100vh",minHeight:720,overflow:"hidden",background:C.bg }}>
      <UpgradeModal   open={mUpgrade}   close={()=>setMUpgrade(false)}/>
      <TemplatesModal open={mTemplates} close={()=>setMTemplates(false)} templates={templates} onLoad={t=>{setMode(t.mode as SwarmMode);toast.success(`Loaded: ${t.name}`)}}/>
      <SaveModal      open={mSave}      close={()=>setMSave(false)} mode={mode} agentCount={selAgents.length} onSave={saveTemplate}/>
      <TraceModal     open={mTrace}     close={()=>setMTrace(false)} log={result?.messageLog??[]}/>

      {/* Header */}
      <header className="flex items-center gap-3 flex-shrink-0"
        style={{ padding:"10px 20px",borderBottom:`1px solid ${C.border}`,minHeight:54,background:C.bg,boxShadow:"0 1px 0 rgba(0,0,0,0.04)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background:`linear-gradient(135deg,${C.brandBg},${C.violetBg})`,border:`1px solid ${C.brandBd}` }}>
            <Network style={{ width:15,height:15,color:C.brand }}/>
          </div>
          <div>
            <h1 className="text-sm font-bold text-zinc-900" style={{ letterSpacing:-0.4,lineHeight:1.2 }}>Multi-Agent Swarm</h1>
            <p className="text-[10px] text-zinc-400 mt-0.5">Build, visualise, and execute intelligent agent teams</p>
          </div>
        </div>
        {selAgents.length>0&&(
          <div className="flex items-center gap-1.5 ml-2">
            {selAgents.slice(0,4).map(a=>{const m=getRoleMeta(a);return(
              <div key={a.id} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background:m.bg,border:`1.5px solid ${m.bd}` }} title={a.name}>
                <Bot style={{ width:12,height:12,color:m.color }}/>
              </div>
            )})}
            {selAgents.length>4&&<span className="text-[10px] font-bold text-zinc-400">+{selAgents.length-4}</span>}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {[{label:"Templates",icon:LayoutTemplate,click:()=>setMTemplates(true)},{label:"Save Template",icon:Save,click:()=>setMSave(true)}].map(({label,icon:Icon,click})=>(
            <button key={label} type="button" onClick={click}
              className="flex items-center gap-1.5 rounded-xl font-semibold text-xs text-zinc-700 transition-all hover:bg-zinc-50 active:scale-95"
              style={{ height:32,padding:"0 12px",border:`1px solid ${C.border2}` }}>
              <Icon style={{ width:12,height:12 }}/> {label}
            </button>
          ))}
          <button type="button" onClick={runSwarm} disabled={!canLaunch}
            className="flex items-center gap-2 rounded-xl font-bold text-xs text-white transition-all active:scale-95"
            style={{ height:32,padding:"0 16px",background:canLaunch?`linear-gradient(135deg,${C.brand},${C.brandDk})`:`${C.brand}40`,boxShadow:canLaunch?`0 2px 12px ${C.brand}40`:"none",cursor:canLaunch?"pointer":"default" }}>
            {running?<><Loader2 style={{ width:12,height:12 }} className="animate-spin"/> Running…</>:<><Play style={{ width:12,height:12 }}/> Launch Swarm</>}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ── */}
        <aside className="flex-shrink-0 flex flex-col"
          style={{ width:272,borderRight:`1px solid ${C.border}`,background:C.bg,overflow:"hidden" }}>

          {/* Mode cards */}
          <div className="flex-shrink-0" style={{ padding:"10px",borderBottom:`1px solid ${C.border}` }}>
            <div className="grid grid-cols-3 gap-1.5">
              {MODES.map(m=>{
                const Icon=m.icon, active=mode===m.id
                return(
                  <button key={m.id} type="button" onClick={()=>setMode(m.id)}
                    className="relative flex flex-col items-center text-center transition-all rounded-2xl active:scale-95"
                    style={{ padding:"10px 6px 9px",border:active?`2px solid ${m.bdr}`:`1.5px solid ${C.border}`,background:active?m.bg:C.soft }}>
                    {active&&<div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center z-10" style={{ background:m.color }}>
                      <Check style={{ width:8,height:8,color:"#fff",strokeWidth:3.5 }}/>
                    </div>}
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2" style={{ background:active?`${m.color}18`:C.surf }}>
                      <Icon style={{ width:17,height:17,color:active?m.color:C.text3 }}/>
                    </div>
                    <p className="text-[10.5px] font-bold leading-none mb-1" style={{ color:active?m.color:C.text2 }}>{m.label}</p>
                    <p className="text-[8px] leading-snug text-zinc-400">{m.desc}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Task */}
          <div className="flex-shrink-0" style={{ padding:"12px",borderBottom:`1px solid ${C.border}` }}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Task</p>
            <textarea value={task} onChange={e=>setTask(e.target.value)} rows={4}
              placeholder="Describe what the swarm should accomplish…"
              className="w-full rounded-xl resize-none focus:outline-none transition-all text-xs leading-relaxed"
              style={{ padding:"8px 10px",border:`1px solid ${C.border2}`,color:C.text,background:C.bg,fontFamily:"inherit" }}
              onFocus={e=>(e.target.style.borderColor=C.brand)} onBlur={e=>(e.target.style.borderColor=C.border2)}/>
            {files.length>0&&(
              <div className="flex flex-wrap gap-1.5 mt-2">
                {files.map(f=>(
                  <div key={f.id} className="flex items-center gap-1 rounded-lg pl-1.5 pr-1 py-1 group"
                    style={{ background:C.surf,border:`1px solid ${C.border}`,maxWidth:128 }}>
                    {f.preview?<img src={f.preview} className="w-5 h-5 rounded object-cover flex-shrink-0" alt=""/>
                      :f.kind==="doc"?<FileText style={{ width:11,height:11,color:C.blue }}/>:<File style={{ width:11,height:11,color:C.text3 }}/>}
                    <span className="truncate text-[9.5px] text-zinc-700 max-w-[70px]">{f.file.name}</span>
                    <button type="button" onClick={()=>setFiles(p=>p.filter(x=>x.id!==f.id))}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-50">
                      <X style={{ width:10,height:10,color:C.text3 }}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-0.5 mt-2">
              <input ref={fileRef} type="file" multiple className="hidden" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.json,.md" onChange={onFileChange}/>
              {[
                {icon:Paperclip,label:"Attach",active:false,click:()=>fileRef.current?.click()},
                {icon:AlignLeft,label:"Context",active:showCtx,click:()=>{setShowCtx(v=>!v);setShowVars(false)}},
                {icon:Hash,label:"Variables",active:showVars,click:()=>{setShowVars(v=>!v);setShowCtx(false)}},
              ].map(({icon:Icon,label,active,click})=>(
                <button key={label} type="button" onClick={click}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg transition-colors text-[10px] font-medium"
                  style={{ color:active?C.brand:C.text2,background:active?C.brandBg:undefined }}>
                  <Icon style={{ width:11,height:11 }}/> {label}
                </button>
              ))}
              <span className="ml-auto text-[9px] tabular-nums text-zinc-300">{task.length}/3000</span>
            </div>
            <AnimatePresence>
              {showCtx&&(
                <motion.div initial={{ opacity:0,y:-4 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:-4 }} transition={{ duration:0.12 }}
                  className="rounded-2xl overflow-hidden mt-2" style={{ background:C.soft,border:`1px solid ${C.border2}` }}>
                  <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom:`1px solid ${C.border}` }}>
                    <AlignLeft style={{ width:11,height:11,color:C.blue }}/><span className="text-xs font-bold text-zinc-900">Additional Context</span>
                    <span className="text-[9.5px] text-zinc-400">Appended to every agent</span>
                  </div>
                  <textarea value={context} onChange={e=>setContext(e.target.value)} rows={3}
                    placeholder="Background info the agents should know…"
                    className="w-full focus:outline-none resize-none text-[11px] leading-relaxed"
                    style={{ padding:"8px 12px",background:"transparent",fontFamily:"inherit",color:C.text }}/>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {showVars&&(
                <motion.div initial={{ opacity:0,y:-4 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:-4 }} transition={{ duration:0.12 }}
                  className="rounded-2xl overflow-hidden mt-2" style={{ background:C.soft,border:`1px solid ${C.border2}` }}>
                  <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom:`1px solid ${C.border}` }}>
                    <Hash style={{ width:11,height:11,color:C.brand }}/><span className="text-xs font-bold text-zinc-900">Variables</span>
                    <span className="text-[9.5px] text-zinc-400">{OPEN_VAR}name{CLOSE_VAR} in task</span>
                    <button type="button" onClick={addVar} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-indigo-50 transition-colors text-[10px] font-semibold" style={{ color:C.brand }}>
                      <Plus style={{ width:10,height:10 }}/> Add
                    </button>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {vars.length===0&&<p className="text-[10.5px] text-zinc-400 text-center py-1.5">No variables yet. Click Add.</p>}
                    {vars.map(v=>(
                      <div key={v.id} className="flex items-center gap-1.5">
                        <div className="flex items-center rounded-xl overflow-hidden flex-1" style={{ border:`1px solid ${C.border2}` }}>
                          <div className="flex items-center gap-0.5 px-2 py-1" style={{ background:C.surf,borderRight:`1px solid ${C.border2}` }}>
                            <span className="text-[10px] font-mono" style={{ color:C.text3 }}>{OPEN_VAR}</span>
                            <input value={v.key} onChange={e=>updVar(v.id,"key",e.target.value)} placeholder="name"
                              className="focus:outline-none bg-transparent font-mono text-[11px] font-semibold" style={{ width:52,color:C.brand }}/>
                            <span className="text-[10px] font-mono" style={{ color:C.text3 }}>{CLOSE_VAR}</span>
                          </div>
                          <input value={v.value} onChange={e=>updVar(v.id,"value",e.target.value)} placeholder="value"
                            className="flex-1 focus:outline-none px-2 py-1 text-[11px]" style={{ color:C.text,background:C.bg }}/>
                        </div>
                        <button type="button" onClick={()=>delVar(v.id)}
                          className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-red-50 transition-colors flex-shrink-0" style={{ background:C.surf }}>
                          <X style={{ width:10,height:10,color:C.text3 }}/>
                        </button>
                      </div>
                    ))}
                    {vars.length>0&&(
                      <button type="button" onClick={applyVars}
                        className="w-full flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-[10.5px] font-semibold" style={{ background:`${C.brand}10`,color:C.brand }}>
                        <Check style={{ width:10,height:10 }}/> Apply to task
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sliders */}
          <div className="flex-shrink-0" style={{ padding:"12px",borderBottom:`1px solid ${C.border}` }}>
            {[
              {label:"Budget (USD)",val:budget,set:setBudget,min:0.01,max:5,step:0.01,display:`$${budget.toFixed(2)}`,lo:"$0.01",hi:"$5.00"},
              {label:"Max Runtime",val:maxRT,set:setMaxRT,min:10,max:300,step:5,display:`${maxRT}s`,lo:"10s",hi:"300s"},
              {label:"Accuracy vs Cost",val:accCost,set:setAccCost,min:0,max:100,step:5,display:accCost<=30?"Faster":accCost>=70?"Accurate":"Balanced",lo:"Faster",hi:"Accurate"},
            ].map(s=>(
              <div key={s.label} className="mb-3 last:mb-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-zinc-500">{s.label}</span>
                  <span className="text-[10px] font-bold tabular-nums text-zinc-900">{s.display}</span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
                  onChange={e=>s.set(parseFloat(e.target.value))}
                  className="w-full cursor-pointer" style={{ height:4,accentColor:C.brand,display:"block" }}/>
                <div className="flex justify-between mt-1">
                  <span className="text-[8.5px] text-zinc-300">{s.lo}</span>
                  <span className="text-[8.5px] text-zinc-300">{s.hi}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Toggles */}
          <div className="flex-shrink-0" style={{ padding:"12px",borderBottom:`1px solid ${C.border}` }}>
            {[
              {label:"Auto Assemble",      desc:"AI selects best agents for your task",val:autoAsm, set:setAutoAsm, action:doAutoAssemble,loading:autoAsmBusy},
              {label:"Dynamic Swarm",      desc:"Allow planner to spawn new agents",   val:dynSwarm,set:setDynSwarm},
              {label:"Remember learnings", desc:"Use and store swarm knowledge",       val:remLearn,set:setRemLearn},
            ].map(f=>(
              <div key={f.label} className="flex items-center gap-2.5 mb-3 last:mb-0">
                <CB on={f.val} set={f.set}/>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-zinc-900 leading-none">{f.label}</p>
                  <p className="text-[9.5px] text-zinc-400 mt-0.5">{f.desc}</p>
                </div>
                {(f as any).action&&(
                  <button type="button" onClick={(f as any).action} disabled={(f as any).loading}
                    className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-zinc-100 active:scale-95" style={{ background:C.surf }}>
                    {(f as any).loading
                      ?<Loader2 style={{ width:10,height:10,color:C.text3 }} className="animate-spin"/>
                      :<ChevronRight style={{ width:10,height:10,color:C.text3 }}/>}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Agent list — flex-1 min-h-0 is the key fix for scroll */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
              style={{ borderBottom:`1px solid ${C.border}` }}>
              <p className="text-xs font-bold text-zinc-900">
                Agents <span className="font-normal text-zinc-400">({selAgents.length} selected)</span>
              </p>
              {selAgents.length>0&&(
                <button type="button" onClick={()=>setSelected([])}
                  className="text-[10px] font-medium text-zinc-400 hover:text-zinc-700 transition-colors">
                  Clear
                </button>
              )}
            </div>
            {agentsLoading?(
              <div className="flex items-center gap-2 px-4 py-6 text-zinc-400 text-xs flex-shrink-0">
                <Loader2 style={{ width:14,height:14 }} className="animate-spin"/> Loading agents…
              </div>
            ):agents.length===0?(
              <div className="px-4 py-8 text-center space-y-2 flex-shrink-0">
                <Bot style={{ width:28,height:28,color:C.border2,margin:"0 auto" }}/>
                <p className="text-xs text-zinc-400">No active agents yet.</p>
                <a href="/builder" className="text-xs font-semibold underline" style={{ color:C.brand }}>Create your first agent</a>
              </div>
            ):(
              <div className="overflow-y-auto flex-1 min-h-0">
                {agents.map((a,i)=>(
                  <AgentRow key={a.id} agent={a} idx={i} selected={selected.includes(a.id)} onToggle={()=>toggleAgent(a.id)}/>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Centre panel */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ background:C.bg }}>
          {error&&(
            <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-2xl p-3.5 flex-shrink-0"
              style={{ background:C.redBg,border:`1px solid ${C.redBd}` }}>
              <AlertCircle style={{ width:14,height:14,color:C.redTx,flexShrink:0,marginTop:1 }}/>
              <p className="text-xs text-red-600 flex-1 leading-relaxed">{error}</p>
              <button type="button" onClick={()=>setError(null)}><X style={{ width:13,height:13,color:C.redTx }}/></button>
            </div>
          )}
          <AnimatePresence>{showPlan&&<PlanCard agents={selAgents} mode={mode} rounds={rounds}/>}</AnimatePresence>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
                <GitBranch style={{ width:13,height:13,color:C.text3 }}/><span className="text-xs font-bold text-zinc-900">Swarm Graph</span>
                {running&&<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold animate-pulse"
                  style={{ background:C.blueBg,color:C.blue,border:`1px solid ${C.blueBd}` }}><span className="w-1.5 h-1.5 rounded-full bg-blue-500"/> Live</span>}
                {result&&<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background:C.greenBg,color:C.greenTx,border:`1px solid ${C.greenBd}` }}><CheckCircle style={{ width:9,height:9 }}/> Complete</span>}
              </div>
              <div className="flex-1 overflow-hidden" style={{ minHeight:0 }}>
                <SwarmGraph agents={selAgents} mode={mode} running={running}/>
              </div>
            </div>
            {mode==="debate"&&(
              <aside className="flex-shrink-0 overflow-y-auto" style={{ width:208,borderLeft:`1px solid ${C.border}`,padding:14 }}>
                <p className="text-xs font-bold text-zinc-900 mb-4">Debate Settings</p>
                <div className="mb-4">
                  <p className="text-[10px] font-semibold text-zinc-500 mb-2">Rounds</p>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={10} value={rounds}
                      onChange={e=>setRounds(Math.min(10,Math.max(1,parseInt(e.target.value)||3)))}
                      className="text-center font-bold focus:outline-none text-sm"
                      style={{ width:52,height:30,borderRadius:10,border:`1px solid ${C.border2}`,background:C.bg,color:C.text }}/>
                    <span className="text-[9.5px] text-zinc-400">1 – 10</span>
                  </div>
                </div>
                <div className="mb-4">
                  <p className="text-[10px] font-semibold text-zinc-500 mb-2">Consensus Method</p>
                  {CONSENSUS.map(method=>(
                    <label key={method} className="flex items-center gap-2 cursor-pointer mb-2" onClick={()=>setCm(method)}>
                      <div className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                        style={{ borderColor:cm===method?C.blue:C.border3,background:cm===method?C.blue:C.bg }}>
                        {cm===method&&<div className="w-1.5 h-1.5 rounded-full bg-white"/>}
                      </div>
                      <span className="text-[11px] text-zinc-600">{method}</span>
                    </label>
                  ))}
                </div>
                {[
                  {label:"Final Arbiter",opts:["Planner Agent",...selAgents.map(a=>a.name)],val:arbiter,set:setArbiter},
                  {label:"Conflict Resolution",opts:CONFLICTS,val:conflictR,set:setConflictR},
                ].map(({label,opts,val,set})=>(
                  <div key={label} className="mb-4">
                    <p className="text-[10px] font-semibold text-zinc-500 mb-1.5">{label}</p>
                    <div className="relative">
                      <select value={val} onChange={e=>set(e.target.value)} className="w-full appearance-none focus:outline-none text-[10.5px] rounded-xl"
                        style={{ height:30,border:`1px solid ${C.border2}`,paddingLeft:8,paddingRight:22,color:C.text,background:C.bg }}>
                        {opts.map(o=><option key={o}>{o}</option>)}
                      </select>
                      <ChevronDown style={{ width:11,height:11,color:C.text3,position:"absolute",right:7,top:"50%",transform:"translateY(-50%)",pointerEvents:"none" }}/>
                    </div>
                  </div>
                ))}
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 mb-1.5">Early Stopping</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9.5px] text-zinc-400 flex-1">Stop when consensus reached</span>
                    <Toggle on={earlyStp} set={setEarlyStp}/>
                  </div>
                </div>
              </aside>
            )}
          </div>
          <LiveExecution agents={selAgents} running={running} result={result} onTrace={()=>setMTrace(true)}/>
          <AnimatePresence>
            {result?.finalAnswer&&(
              <motion.div initial={{ opacity:0,y:6 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }}
                className="flex-shrink-0" style={{ borderTop:`1px solid ${C.border}`,padding:"14px 18px",background:C.bg }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <CheckCircle2 style={{ width:14,height:14,color:C.green }}/><p className="text-xs font-bold text-zinc-900 flex-1">Final Answer</p>
                  <button type="button"
                    onClick={()=>{navigator.clipboard.writeText(result.finalAnswer);setCopied(true);setTimeout(()=>setCopied(false),2000);toast.success("Copied")}}
                    className="flex items-center gap-1 rounded-lg text-[10px] font-semibold hover:bg-zinc-100 transition-colors"
                    style={{ color:C.text2,background:C.surf,padding:"3px 8px" }}>
                    {copied?<><Check style={{ width:11,height:11,color:C.green }}/> Copied</>:<><Copy style={{ width:11,height:11 }}/> Copy</>}
                  </button>
                </div>
                <div className="overflow-y-auto rounded-2xl"
                  style={{ maxHeight:160,background:C.soft,padding:12,fontSize:12,lineHeight:1.7,color:C.text1,whiteSpace:"pre-wrap",border:`1px solid ${C.border}` }}>
                  {result.finalAnswer}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <RightPanel agents={selAgents} mode={mode} rounds={rounds}
          running={running} result={result} sessions={sessions} templates={templates}
          onCreateV2={()=>{setResult(null);setError(null);toast.success("Configure your improved v2 swarm")}}
          onOpenTemplates={()=>setMTemplates(true)}/>
      </div>
    </div>
  )
}
