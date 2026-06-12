// REDIRECT: /dashboard/dashboard/revenue → /dashboard/revenue
// This file exists only to prevent 404s from old links.
// The correct route is (dashboard)/revenue/page.tsx

import { redirect } from "next/navigation"

export default function RedirectRevenue() {
  redirect("/dashboard/revenue")
}
