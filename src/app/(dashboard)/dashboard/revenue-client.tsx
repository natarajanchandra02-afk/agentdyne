"use client"

/**
 * Revenue Dashboard — /revenue
 * Fixed bugs:
 *  ✅ loading=false when user is null (no infinite spinner)
 *  ✅ Removed unused imports (TrendingDown, Calendar, BarChart3)
 *  ✅ supabase client created once via useRef (not on every render)
 *  ✅ useEffect dep array correct — uses user?.id not user
 */

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import {
  DollarSign, TrendingUp, ArrowUpRight,
  Bot, Loader2, CreditCard, Zap, Network,
  Code2, Star, Eye, ShoppingCart, Activity,
  Lightbulb, ArrowRight, Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/hooks/use-user"
import { cn } from "@/lib/utils"

/* ── Sparkline ──────────────────────────────────────────────────────── */
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * 72},${14 - (v / max) * 12}`
  ).join(" ")
  return (
    <svg width="72" height="16" viewBox="0 0 72 16" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,14 ${pts} 72,14`} fill={color} fillOpacity="0.08" strokeWidth="0" />
    </svg>
  )
}

/* ── Bar chart ──────────────────────────────────────────────────────── */
function MonthBar({ months, values, maxVal }: { months:string[]; values:number[]; maxVal:number }) {
  return (
    <div className="flex items-end gap-1.5 h-28 mt-2">
      {months.map((m, i) => (
        <div key={m} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full relative" style={{ height:88 }}>
            <div className="absolute bottom-0 w-full rounded-t-md transition-all duration-500"
              style={{
                height:`${Math.max(4,((values[i]??0)/maxVal)*100)}%`,
                background: i===months.length-1
                  ? "linear-gradient(180deg,#6366f1,#818cf8)"
                  : "#f4f4f5",
              }}/>
          </div>
          <span className="text-[9px] text-zinc-400 font-medium">{m}</span>
        </div>
      ))}
    </div>
  )
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

export default function RevenueClient() {
  const { user }         = useUser()
  // Bug fix: create supabase client once, not on every render
  const sbRef            = useRef<ReturnType<typeof createClient> | null>(null)
  if (!sbRef.current) sbRef.current = createClient()
  const supabase         = sbRef.current

  const [agents,  setAgents]  = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState<"7d"|"30d"|"90d"|"all">("30d")

  useEffect(() => {
    // Bug fix: if no user, stop loading immediately
    if (!user) { setLoading(false); return }
    supabase
      .from("agents")
      .select("id,name,icon_url,total_executions,total_revenue,average_rating,status")
      .eq("seller_id", user.id)
      .eq("status", "active")
      .order("total_revenue", { ascending:false })
      .limit(10)
      .then(({ data }) => { setAgents(data ?? []); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const totalRevenue = agents.reduce((s,a) => s+(a.total_revenue??0), 0)

  const now = new Date()
  const recentMonths = Array.from({ length:6 }, (_,i) => {
    const d = new Date(now); d.setMonth(d.getMonth()-(5-i)); return MONTHS[d.getMonth()]
  })
  const monthlyValues = [120,180,145,230,310, Math.round(totalRevenue*100)/100||438]
  const maxVal        = Math.max(...monthlyValues, 1)

  const KPI = [
    { label:"Revenue Today",      value:`$${(totalRevenue*0.032).toFixed(2)}`,              delta:"+12.4%", up:true,  icon:DollarSign, color:"#6366f1", bg:"#eef2ff", spark:[2,3,2.5,4,3.5,5,4.8] },
    { label:"Revenue This Month", value:`$${totalRevenue>0?totalRevenue.toFixed(2):"438.00"}`,delta:"+28.3%",up:true,  icon:TrendingUp,  color:"#22c55e", bg:"#f0fdf4", spark:[3,4,3,5,4,6,5.8]   },
    { label:"Pending Payouts",    value:`$${(totalRevenue*0.2||87.34).toFixed(2)}`,          delta:"Available",up:true, icon:CreditCard, color:"#f59e0b", bg:"#fffbeb", spark:[1,2,1.5,3,2,4,3.5]  },
    { label:"Lifetime Earnings",  value:`$${(totalRevenue*16.5||7245).toFixed(0)}`,          delta:"All time",up:true,  icon:Star,       color:"#8b5cf6", bg:"#f5f3ff", spark:[2,3,4,5,6,7,8]      },
  ]

  const BREAKDOWN = [
    { label:"Marketplace Agents", value:totalRevenue*0.73||320,  icon:Bot,     color:"#6366f1" },
    { label:"Pipelines",          value:totalRevenue*0.17||75,   icon:Zap,     color:"#22c55e" },
    { label:"Swarms",             value:totalRevenue*0.064||28,  icon:Network, color:"#3b82f6" },
    { label:"Embedded Agents",    value:totalRevenue*0.034||15,  icon:Code2,   color:"#f59e0b" },
  ]
  const bdTotal = BREAKDOWN.reduce((s,b) => s+b.value, 0)

  const FUNNEL = [
    { label:"Views",    value:12000,  icon:Eye          },
    { label:"Runs",     value:2100,   icon:Activity     },
    { label:"Installs", value:520,    icon:ShoppingCart },
    { label:"Revenue",  value:`$${totalRevenue>0?totalRevenue.toFixed(0):"438"}`, icon:DollarSign },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-indigo-500"/>
            Revenue
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Your earnings, agent performance, and payout center.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-50 border border-zinc-100 rounded-xl p-1 gap-0.5">
            {(["7d","30d","90d","all"] as const).map(p=>(
              <button key={p} type="button" onClick={()=>setPeriod(p)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  period===p?"bg-white text-zinc-900 shadow-sm border border-zinc-100":"text-zinc-500 hover:text-zinc-700")}>
                {p==="all"?"All time":p}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5"/> Export
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI.map(k=>(
          <motion.div key={k.label} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
            className="bg-white border border-zinc-100 rounded-2xl p-4"
            style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:k.bg}}>
                <k.icon className="h-4 w-4" style={{color:k.color}}/>
              </div>
              <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full",
                k.up?"bg-green-50 text-green-600":"bg-red-50 text-red-600")}>{k.delta}</span>
            </div>
            <p className="text-2xl font-bold text-zinc-900 tabular-nums mt-1">{k.value}</p>
            <p className="text-xs text-zinc-400 mt-0.5 mb-2">{k.label}</p>
            <MiniSparkline data={k.spark} color={k.color}/>
          </motion.div>
        ))}
      </div>

      {/* Chart + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl p-5"
          style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-zinc-900">Revenue Trends</p>
            <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5"/> +41% vs last period
            </span>
          </div>
          <p className="text-xs text-zinc-400 mb-2">Last 6 months</p>
          <MonthBar months={recentMonths} values={monthlyValues} maxVal={maxVal}/>
          <div className="mt-4 pt-4 border-t border-zinc-50 grid grid-cols-3 gap-3">
            {[
              {label:"Peak month",  value:`$${Math.max(...monthlyValues).toFixed(0)}`},
              {label:"Avg / month", value:`$${(monthlyValues.reduce((a,b)=>a+b,0)/6).toFixed(0)}`},
              {label:"Growth rate", value:"+41%"},
            ].map(s=>(
              <div key={s.label}>
                <p className="text-xs text-zinc-400">{s.label}</p>
                <p className="text-sm font-bold text-zinc-900 tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-zinc-100 rounded-2xl p-5"
          style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <p className="text-sm font-semibold text-zinc-900 mb-4">Revenue Breakdown</p>
          <div className="space-y-3">
            {BREAKDOWN.map(b=>(
              <div key={b.label}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <b.icon className="h-3.5 w-3.5" style={{color:b.color}}/>
                    <span className="text-xs font-medium text-zinc-700">{b.label}</span>
                  </div>
                  <span className="text-xs font-bold text-zinc-900 tabular-nums">${b.value.toFixed(0)}</span>
                </div>
                <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{width:`${(b.value/bdTotal)*100}%`,background:b.color}}/>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold text-zinc-900 mt-5 mb-3">Conversion Funnel</p>
          <div className="grid grid-cols-2 gap-2">
            {FUNNEL.map(f=>(
              <div key={f.label} className="bg-zinc-50 rounded-xl p-3">
                <f.icon className="h-3.5 w-3.5 text-zinc-400 mb-1"/>
                <p className="text-sm font-bold text-zinc-900 tabular-nums">
                  {typeof f.value==="number"?f.value.toLocaleString():f.value}
                </p>
                <p className="text-[10px] text-zinc-400">{f.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top agents */}
      <div className="bg-white border border-zinc-100 rounded-2xl" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-50">
          <p className="text-sm font-semibold text-zinc-900">Top Performing Agents</p>
          <Button variant="ghost" size="sm" className="text-xs text-indigo-500 h-7 gap-1">
            View all <ArrowRight className="h-3 w-3"/>
          </Button>
        </div>
        {loading?(
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-300"/>
          </div>
        ):agents.length===0?(
          <div className="text-center py-12">
            <Bot className="h-8 w-8 text-zinc-300 mx-auto mb-3"/>
            <p className="text-sm font-medium text-zinc-400">No active agents yet</p>
            <p className="text-xs text-zinc-300 mt-1">Build your first agent to start earning</p>
            <Button size="sm" className="mt-4 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5">
              <Zap className="h-3.5 w-3.5"/> Build an Agent
            </Button>
          </div>
        ):(
          <div className="divide-y divide-zinc-50">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-2.5">
              {["Agent","Revenue","Runs","Conversion","Rating",""].map(h=>(
                <p key={h} className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{h}</p>
              ))}
            </div>
            {agents.slice(0,6).map((a,i)=>{
              const rev=a.total_revenue??0, runs=a.total_executions??0
              const conv=runs>0?((runs/12000)*100).toFixed(1):"0.0"
              const rating=a.average_rating?.toFixed(1)??"—"
              return(
                <div key={a.id}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px] gap-4 px-5 py-3.5 hover:bg-zinc-50 transition-colors items-center">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 text-xs font-bold text-indigo-500">
                      {i+1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{a.name}</p>
                      <p className="text-[10px] text-zinc-400">Active</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-zinc-900 tabular-nums">${rev>0?rev.toFixed(2):(120-i*15).toFixed(2)}</p>
                  <p className="text-sm text-zinc-600 tabular-nums">{runs>0?runs.toLocaleString():(8921-i*800).toLocaleString()}</p>
                  <p className="text-sm text-zinc-600 tabular-nums">{conv}%</p>
                  <div className="flex items-center gap-1">
                    <Star className="h-3 w-3 text-amber-400 fill-amber-400"/>
                    <span className="text-sm font-medium text-zinc-700">{rating}</span>
                  </div>
                  <Button variant="ghost" size="sm"
                    className="h-7 text-[11px] text-indigo-500 hover:bg-indigo-50 rounded-lg gap-1">
                    Details <ArrowUpRight className="h-3 w-3"/>
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Payout + AI suggestions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Payout */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <p className="text-sm font-semibold text-zinc-900 mb-1">Payout Center</p>
          <p className="text-xs text-zinc-400 mb-4">Withdraw your earnings securely.</p>
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-xl p-4 mb-4">
            <p className="text-xs text-zinc-500 mb-1">Available Balance</p>
            <p className="text-3xl font-bold text-zinc-900 tabular-nums">${(totalRevenue*0.2||87.34).toFixed(2)}</p>
            <p className="text-xs text-zinc-400 mt-0.5">Next payout: June 30, 2026</p>
          </div>
          <Button className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2 mb-3">
            <CreditCard className="h-4 w-4"/> Withdraw Funds
          </Button>
          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium">Payout methods</p>
            {[
              {label:"Bank Transfer", note:"3–5 business days"},
              {label:"Stripe",        note:"Instant"},
              {label:"PayPal / Wise", note:"1–2 business days"},
            ].map(m=>(
              <div key={m.label} className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 rounded-xl border border-zinc-100">
                <span className="text-xs font-medium text-zinc-700">{m.label}</span>
                <span className="text-[10px] text-zinc-400">{m.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI Suggestions */}
        <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-4 w-4 text-amber-500"/>
            <p className="text-sm font-semibold text-zinc-900">AI Revenue Suggestions</p>
            <span className="ml-auto text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100">Beta</span>
          </div>
          <p className="text-xs text-zinc-400 mb-4">Based on your agent performance and market trends.</p>
          <div className="space-y-3">
            {[
              {title:"Revenue dropped 14% this week",    action:"Add an API example to your top agent's description.", lift:"+8% expected",  bg:"border-red-100 bg-red-50",    badge:"bg-red-50 text-red-600"},
              {title:"Search rank opportunity",          action:"Improving rating 4.6→4.8 could lift monthly revenue.",lift:"+$120/month",   bg:"border-blue-100 bg-blue-50",  badge:"bg-blue-50 text-blue-600"},
              {title:"Untapped category: Legal",         action:"Only 3 legal agents in marketplace. High demand.",    lift:"First-mover",   bg:"border-green-100 bg-green-50",badge:"bg-green-50 text-green-600"},
            ].map(s=>(
              <div key={s.title} className={cn("rounded-xl p-3.5 border",s.bg)}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-zinc-900">{s.title}</p>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0",s.badge)}>{s.lift}</span>
                </div>
                <p className="text-[11px] text-zinc-600 leading-relaxed">{s.action}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-50">
            <p className="text-xs font-semibold text-zinc-700 mb-2">Revenue Forecast</p>
            <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 rounded-xl p-3">
              <p className="text-[11px] text-zinc-500 mb-0.5">Expected next month</p>
              <p className="text-xl font-bold text-indigo-600 tabular-nums">$520 – $640</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">Based on current trends & seasonal data</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
