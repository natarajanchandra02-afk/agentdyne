// REDIRECT: /dashboard/dashboard/integrations → /dashboard/integrations
// This file exists only to prevent 404s from old links.
// The correct route is (dashboard)/integrations/page.tsx

import { redirect } from "next/navigation"

export default function RedirectIntegrations() {
  redirect("/dashboard/integrations")
}
