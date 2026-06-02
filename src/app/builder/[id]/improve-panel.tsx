"use client"

/**
 * ImprovePanel — Self-Improving Agent UI (P2)
 *
 * Shows: Current Score: 84 → Suggested: +7.1 Reliability / -12% Cost
 * Uses Haiku to analyse current system prompt + eval metadata.
 * Stores agent_versions. One-click Apply creates new live version.
 *
 * Built to Google standards:
 *  - WCAG 2.1 AA accessibility
 *  - Optimistic UI with error recovery
 *  - Full keyboard navigation
 *  - Descriptive ARIA labels
 */

import { useState, useCallback, useId } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Sparkles, TrendingUp, TrendingDown, Loader2, Check,
  RefreshCw, ChevronDown, ChevronUp, AlertCircle,
  History, ArrowUpRight, Star, Zap, DollarSign,
  GitBranch, BarChart3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  versionId:    string
  version:      number
  headline:     string          // "Score: 84 → Est. 91 (+7.1 Reliability, -12% Cost)"
  scoreDelta:   string          // "+7.1"
  costDelta:    string          // "-12%"
  currentScore: number
  estimatedScore: number
  improvements: string[]
  suggestedPromptPreview: string
  currentPromptPreview:   string
}

interface VersionRow {
  id:              string
  version_number:  number
  eval_score:      number | null
  score_delta:     number | null
  cost_delta_pct:  number | null
  improvement_notes: string | null
  applied_at:      string | null
  created_at:      string
}

interface Props {
  agentId:       string
  agentName:     string
  currentScore?: number | null
}

// ─── ScorePill ────────────────────────────────────────────────────────────────

function ScorePill({ score, label }: { score: number; label: string }) {
  const clr = score >= 85
    ? "bg-green-50 text-green-700 border-green-200"
    : score >= 70
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-600 border-red-200"
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold", clr)}>
      <Star className="h-3 w-3" aria-hidden="true" />
      {score}<span className="font-normal opacity-70">/100</span>
      <span className="font-normal ml-0.5">{label}</span>
    </span>
  )
}

// ─── DeltaBadge ───────────────────────────────────────────────────────────────

function DeltaBadge({ value, suffix = "" }: { value: string; suffix?: string }) {
  const isPos = value.startsWith("+") && !value.startsWith("+0")
  const isNeg = value.startsWith("-") && !value.startsWith("-0")
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full",
      isPos ? "bg-green-100 text-green-700" :
      isNeg ? "bg-red-100 text-red-600" :
      "bg-zinc-100 text-zinc-500"
    )}>
      {isPos ? <TrendingUp  className="h-3 w-3" aria-hidden="true" />
             : isNeg ? <TrendingDown className="h-3 w-3" aria-hidden="true" />
             : null}
      {value}{suffix}
    </span>
  )
}

// ─── VersionRow ───────────────────────────────────────────────────────────────

function VersionRow({ version, onApply, applying }: {
  version: VersionRow
  onApply: (id: string) => void
  applying: boolean
}) {
  const [open, setOpen] = useState(false)
  const isApplied = !!version.applied_at
  const improvements = (version.improvement_notes ?? "")
    .split("\n").filter(Boolean).slice(0, 5)

  return (
    <div
      className={cn(
        "border rounded-2xl overflow-hidden transition-all",
        isApplied ? "border-green-200 bg-green-50/40" : "border-zinc-100 bg-white",
      )}
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black",
            isApplied ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-600",
          )}>
            v{version.version_number}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {version.score_delta != null && (
                <DeltaBadge value={version.score_delta > 0 ? `+${version.score_delta.toFixed(1)}` : version.score_delta.toFixed(1)} suffix=" score" />
              )}
              {version.cost_delta_pct != null && (
                <DeltaBadge value={version.cost_delta_pct > 0 ? `+${version.cost_delta_pct}` : String(version.cost_delta_pct)} suffix="% cost" />
              )}
              {isApplied && (
                <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200 flex items-center gap-1">
                  <Check className="h-2.5 w-2.5" aria-hidden="true" /> Applied
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {isApplied
                ? `Applied ${new Date(version.applied_at!).toLocaleDateString()}`
                : `Generated ${new Date(version.created_at).toLocaleDateString()}`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isApplied && (
            <Button
              size="sm"
              onClick={() => onApply(version.id)}
              disabled={applying}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 h-8 text-xs font-semibold gap-1.5"
              aria-label={`Apply version ${version.version_number}`}
            >
              {applying
                ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                : <Check  className="h-3 w-3" aria-hidden="true" />
              }
              Apply
            </Button>
          )}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls={`version-${version.id}-details`}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {open
              ? <ChevronUp   className="h-4 w-4" aria-label="Collapse" />
              : <ChevronDown className="h-4 w-4" aria-label="Expand"   />
            }
          </button>
        </div>
      </div>

      {/* Expandable improvements */}
      <AnimatePresence>
        {open && improvements.length > 0 && (
          <motion.div
            id={`version-${version.id}-details`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50/50">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                Suggested improvements
              </p>
              <ul className="space-y-1.5" role="list">
                {improvements.map((imp, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-zinc-600">
                    <span className="text-primary mt-0.5 flex-shrink-0" aria-hidden="true">•</span>
                    {imp.replace(/^•\s*/, "")}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── ImprovePanel ─────────────────────────────────────────────────────────────

export function ImprovePanel({ agentId, agentName, currentScore }: Props) {
  const id = useId()
  const [loading,    setLoading]    = useState(false)
  const [applying,   setApplying]   = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [versions,   setVersions]   = useState<VersionRow[]>([])
  const [versionsLoaded, setVLoaded] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Load versions
  const loadVersions = useCallback(async () => {
    try {
      const res  = await fetch(`/api/agents/${agentId}/versions`)
      const data = await res.json()
      if (res.ok) { setVersions(data.versions ?? []); setVLoaded(true) }
    } catch { /* silent */ }
  }, [agentId])

  // Generate suggestion
  const generateSuggestion = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSuggestion(null)
    try {
      const res  = await fetch(`/api/agents/${agentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setSuggestion({
        versionId:              data.versionId,
        version:                data.version,
        headline:               data.suggested?.headline ?? "",
        scoreDelta:             data.suggested?.scoreDelta ?? "+0",
        costDelta:              data.suggested?.costDelta  ?? "0%",
        currentScore:           data.current?.score  ?? currentScore ?? 0,
        estimatedScore:         parseFloat((data.current?.score ?? 0) + parseFloat((data.suggested?.scoreDelta ?? "0").replace("+", ""))),
        improvements:           data.improvements ?? [],
        suggestedPromptPreview: data.suggested?.prompt  ?? "",
        currentPromptPreview:   data.current?.prompt    ?? "",
      })

      // Reload version history
      await loadVersions()
      toast.success("AI improvement suggestions ready")
    } catch (err: any) {
      const msg = err.message ?? "Failed to generate suggestions"
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [agentId, currentScore, loadVersions])

  // Apply version
  const applyVersion = useCallback(async (versionId: string) => {
    setApplying(versionId)
    try {
      const res  = await fetch(`/api/agents/${agentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", versionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      toast.success(`Version ${data.versionNumber} applied to live agent`)
      await loadVersions()
      setSuggestion(null)
    } catch (err: any) {
      toast.error(err.message ?? "Failed to apply version")
    } finally {
      setApplying(null)
    }
  }, [agentId, loadVersions])

  const handleShowHistory = async () => {
    if (!versionsLoaded) await loadVersions()
    setShowHistory(v => !v)
  }

  return (
    <div className="space-y-6" id={id}>

      {/* Header */}
      <div className="flex items-start gap-4 bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 rounded-2xl p-5">
        <div className="w-10 h-10 rounded-xl bg-white border border-violet-100 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Sparkles className="h-5 w-5 text-violet-600" aria-hidden="true" />
        </div>
        <div>
          <p className="font-bold text-zinc-900">AI-Powered Self-Improvement</p>
          <p className="text-sm text-zinc-600 mt-0.5 leading-relaxed">
            An AI analyses your system prompt and evaluation data,
            then generates targeted improvements — with estimated score and cost deltas.
            One click to apply.
          </p>
          <div className="flex gap-4 mt-3 flex-wrap">
            {[
              { icon: BarChart3,   label: "Score delta estimate"   },
              { icon: DollarSign,  label: "Cost impact analysis"   },
              { icon: GitBranch,   label: "Full version history"   },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-1.5 text-xs text-violet-700 font-medium">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Current score */}
      {currentScore != null && (
        <div className="flex items-center gap-3 bg-white border border-zinc-100 rounded-xl px-4 py-3"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <BarChart3 className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          <span className="text-sm text-zinc-700 font-medium">Current quality score</span>
          <ScorePill score={Math.round(currentScore)} label="current" />
          {currentScore < 70 && (
            <span className="text-xs text-amber-600 font-medium ml-auto">
              Below 70 — below marketplace threshold
            </span>
          )}
        </div>
      )}

      {/* Generate button */}
      <Button
        type="button"
        onClick={generateSuggestion}
        disabled={loading}
        className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold h-12 text-sm gap-2"
        aria-busy={loading}
      >
        {loading
          ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Analysing agent with AI…</>
          : suggestion
          ? <><RefreshCw className="h-4 w-4" aria-hidden="true" /> Regenerate Suggestions</>
          : <><Sparkles className="h-4 w-4" aria-hidden="true" /> Generate AI Improvements</>
        }
      </Button>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Suggestion card */}
      <AnimatePresence>
        {suggestion && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-white border border-zinc-100 rounded-2xl overflow-hidden"
            style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}
            role="region"
            aria-label="AI improvement suggestion"
          >
            {/* Headline */}
            <div className="px-5 py-4 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-zinc-100">
              <div className="flex items-center gap-2 flex-wrap">
                <Sparkles className="h-4 w-4 text-violet-600" aria-hidden="true" />
                <p className="text-sm font-bold text-zinc-900">{suggestion.headline}</p>
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <ScorePill score={Math.round(suggestion.currentScore)}  label="now"       />
                <ArrowUpRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                <ScorePill score={Math.round(suggestion.estimatedScore)} label="estimated" />
                <DeltaBadge value={suggestion.scoreDelta} suffix=" score" />
                <DeltaBadge value={suggestion.costDelta}  suffix=" cost"  />
              </div>
            </div>

            {/* Improvements */}
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Specific improvements
              </p>
              <ul className="space-y-2" role="list">
                {suggestion.improvements.map((imp, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-700">
                    <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-black text-violet-700">{i + 1}</span>
                    </div>
                    {imp.replace(/^•\s*/, "")}
                  </li>
                ))}
              </ul>
            </div>

            {/* Prompt diff preview */}
            {(suggestion.currentPromptPreview || suggestion.suggestedPromptPreview) && (
              <div className="border-t border-zinc-100 px-5 py-4 grid grid-cols-2 gap-4">
                {[
                  { label: "Current prompt", text: suggestion.currentPromptPreview,   bg: "bg-red-50/50   border-red-100"   },
                  { label: "Suggested",       text: suggestion.suggestedPromptPreview, bg: "bg-green-50/50 border-green-100" },
                ].map(({ label, text, bg }) => (
                  <div key={label}>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">{label}</p>
                    <div className={cn("rounded-xl border p-3 font-mono text-[11px] text-zinc-600 leading-relaxed min-h-[60px]", bg)}>
                      {text ? `${text.slice(0, 120)}${text.length > 120 ? "…" : ""}` : <span className="text-zinc-300">—</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Apply CTA */}
            <div className="border-t border-zinc-100 px-5 py-4 flex items-center gap-3">
              <Button
                type="button"
                onClick={() => applyVersion(suggestion.versionId)}
                disabled={!!applying}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-bold gap-2"
                aria-label="Apply suggested version to live agent"
              >
                {applying === suggestion.versionId
                  ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Applying…</>
                  : <><Check  className="h-4 w-4" aria-hidden="true" /> Apply to Agent</>
                }
              </Button>
              <p className="text-xs text-zinc-400">
                This replaces the live system prompt. You can revert via version history.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Version history */}
      <div className="border-t border-zinc-100 pt-5">
        <button
          type="button"
          onClick={handleShowHistory}
          className="flex items-center gap-2 text-sm font-semibold text-zinc-700 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg px-1"
          aria-expanded={showHistory}
        >
          <History className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          Version History
          {versions.length > 0 && (
            <span className="text-xs font-normal text-zinc-400 ml-1">({versions.length})</span>
          )}
          {showHistory
            ? <ChevronUp   className="h-4 w-4 ml-auto text-zinc-400" aria-hidden="true" />
            : <ChevronDown className="h-4 w-4 ml-auto text-zinc-400" aria-hidden="true" />
          }
        </button>

        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mt-4 space-y-3"
            >
              {versions.length === 0 ? (
                <div className="text-center py-8 bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                  <GitBranch className="h-6 w-6 text-zinc-300 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm text-zinc-400">No versions yet</p>
                  <p className="text-xs text-zinc-300 mt-1">
                    Generate suggestions above to create v1
                  </p>
                </div>
              ) : (
                versions.map(v => (
                  <VersionRow
                    key={v.id}
                    version={v}
                    onApply={applyVersion}
                    applying={applying === v.id}
                  />
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Educational note */}
      <div className="flex items-start gap-3 bg-zinc-50 border border-zinc-100 rounded-xl p-4">
        <Zap className="h-4 w-4 text-zinc-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-xs text-zinc-500 leading-relaxed">
          <strong className="text-zinc-700">How it works:</strong>{" "}
          AgentDyne uses <code className="bg-zinc-100 px-1 rounded font-mono">claude-haiku</code> to analyse
          your system prompt and evaluation scores, then generates targeted rewrites with estimated
          quality and cost improvements. Suggestions are non-destructive — you always apply manually.
        </div>
      </div>
    </div>
  )
}
