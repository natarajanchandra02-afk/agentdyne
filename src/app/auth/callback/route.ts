export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Safe path characters: starts with /, no protocol, no double-slash
function isSafePath(next: string): boolean {
  return (
    typeof next === "string" &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("://") &&
    !next.includes("\n") &&
    !next.includes("\r")
  )
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code      = searchParams.get("code")
  const rawNext   = searchParams.get("next") ?? "/dashboard"
  const error     = searchParams.get("error")
  const errorDesc = searchParams.get("error_description")

  // Validate the `next` redirect target — prevent open redirect
  const safeNext = isSafePath(rawNext) ? rawNext : "/dashboard"

  if (error) {
    const loginUrl = new URL("/login", origin)
    // Only pass safe error descriptions (strip anything suspicious)
    const safeDesc = (errorDesc || error).slice(0, 200).replace(/[<>"']/g, "")
    loginUrl.searchParams.set("error", safeDesc)
    return NextResponse.redirect(loginUrl)
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      // Use the validated safeNext for redirect
      const forwardedHost = req.headers.get("x-forwarded-host")
      const isLocalEnv    = process.env.NODE_ENV === "development"

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${safeNext}`)
      } else if (forwardedHost) {
        // Validate forwardedHost is the expected domain to prevent host-header injection
        const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? ""
        const allowed = appUrl.replace(/^https?:\/\//, "")
        if (forwardedHost === allowed || !allowed) {
          return NextResponse.redirect(`https://${forwardedHost}${safeNext}`)
        }
        // Unexpected host — fall back to origin
        return NextResponse.redirect(`${origin}${safeNext}`)
      } else {
        return NextResponse.redirect(`${origin}${safeNext}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
