export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/auth/signout
 * Server-side sign-out — revokes the session and clears all auth cookies.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const body  = await req.json().catch(() => ({}))
      const scope = body.scope === "global" ? "global" : "local"
      await supabase.auth.signOut({ scope })
    }

    const response = NextResponse.json({ ok: true })

    // Clear all Supabase auth cookies (handles chunked cookies: .0, .1, etc.)
    const cookieNames = req.cookies.getAll()
      .map(c => c.name)
      .filter(n =>
        n.includes("-auth-token") ||
        n.includes("-refresh-token") ||
        n.includes("-code-verifier")
      )

    for (const name of cookieNames) {
      response.cookies.set(name, "", {
        maxAge:   0,
        path:     "/",
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        sameSite: "lax",
      })
    }

    return response
  } catch (err: any) {
    // Return success even on error — client will clear local state
    return NextResponse.json({ ok: true })
  }
}
