import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));
}

export function formatRelativeTime(date: string | Date) {
  const now = Date.now();
  const d = new Date(date).getTime();
  const diff = now - d;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(str: string, length: number) {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

export function generateApiKey() {
  const prefix = "agd";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const key = Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${prefix}_${key}`;
}

export function maskApiKey(key: string) {
  if (key.length < 12) return "***";
  return key.slice(0, 8) + "..." + key.slice(-4);
}

export function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

export function categoryLabel(category: string) {
  return category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export const CATEGORY_ICONS: Record<string, string> = {
  productivity: "⚡",
  coding: "💻",
  marketing: "📣",
  finance: "💰",
  legal: "⚖️",
  customer_support: "🎧",
  data_analysis: "📊",
  content: "✍️",
  research: "🔬",
  hr: "👥",
  sales: "📈",
  devops: "🛠️",
  security: "🔒",
  other: "🤖",
};
