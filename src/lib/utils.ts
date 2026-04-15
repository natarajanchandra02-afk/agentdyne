import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
}

export function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date(date))
}

export function formatRelativeTime(date: string | Date) {
  const diff    = Date.now() - new Date(date).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1)  return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)   return `${hours}h ago`
  const days  = Math.floor(hours / 24)
  if (days < 30)    return `${days}d ago`
  return formatDate(date)
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function truncate(str: string, length: number) {
  if (str.length <= length) return str
  return str.slice(0, length) + "..."
}

export function generateApiKey(): string {
  // CSPRNG — never use Math.random() for security tokens
  // 36 random bytes → 48-char base64url string → prefix → "agd_" + 48 chars
  const raw = new Uint8Array(36)
  crypto.getRandomValues(raw)
  const b64 = btoa(String.fromCharCode(...Array.from(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  return `agd_${b64}`
}

export function maskApiKey(key: string) {
  if (key.length < 12) return "***"
  return key.slice(0, 8) + "..." + key.slice(-4)
}

export function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
}

export function categoryLabel(category: string) {
  return category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())
}

/**
 * Lucide icon name for each agent category.
 * Import the icon in each component using:
 *   import { getCategoryIcon } from "@/lib/utils"
 *   const Icon = getCategoryIcon(category)
 *   <Icon className="h-4 w-4" />
 */
export const CATEGORY_ICON_NAMES: Record<string, string> = {
  productivity:     "Zap",
  coding:           "Code2",
  marketing:        "Megaphone",
  finance:          "TrendingUp",
  legal:            "Scale",
  customer_support: "Headphones",
  data_analysis:    "BarChart3",
  content:          "PenLine",
  research:         "FlaskConical",
  hr:               "Users",
  sales:            "LineChart",
  devops:           "Settings2",
  security:         "ShieldCheck",
  other:            "Bot",
}

// Lazy map — avoids importing all icons in utils.ts (keeps bundle small)
// Each consumer should import from lucide-react directly.
// This is kept for reference / category pill labels.
export const CATEGORY_ICON_COLOR: Record<string, string> = {
  productivity:     "text-amber-500",
  coding:           "text-blue-500",
  marketing:        "text-pink-500",
  finance:          "text-green-600",
  legal:            "text-violet-500",
  customer_support: "text-cyan-500",
  data_analysis:    "text-indigo-500",
  content:          "text-orange-500",
  research:         "text-teal-500",
  hr:               "text-rose-500",
  sales:            "text-emerald-500",
  devops:           "text-slate-500",
  security:         "text-red-500",
  other:            "text-zinc-500",
}

// Keep backward-compat for anything that imported CATEGORY_ICONS.
// Returns empty string (no emoji). Consumers should migrate to icon components.
export const CATEGORY_ICONS: Record<string, string> = Object.fromEntries(
  Object.keys(CATEGORY_ICON_NAMES).map(k => [k, ""])
)
