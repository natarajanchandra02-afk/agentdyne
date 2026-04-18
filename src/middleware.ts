import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

// Routes that require authentication
const PROTECTED_PATHS = [
  "/dashboard", "/my-agents", "/analytics", "/api-keys",
  "/billing", "/settings", "/admin", "/seller", "/builder",
  "/pipelines", "/executions",
]

// Routes only for unauthenticated users (redirect logged-in users away)
const AUTH_ONLY_PATHS = ["/login", "/signup", "/forgot-password"]

// ── Security headers ─────────────────────────────────────────────────────────
// Two CSP variants:
//   PROD: no unsafe-eval (Next.js doesn't need it in production builds)
//         + upgrade-insecure-requests (safe because prod is always HTTPS)
//   DEV:  unsafe-eval kept (needed for Next.js HMR / React DevTools)
//         - upgrade-insecure-requests removed (localhost is HTTP, would break assets)

const CSP_BASE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.anthropic.com https://api.openai.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
]

const CSP_PROD = [...CSP_BASE, "upgrade-insecure-requests"].join("; ")
const CSP_DEV  = [...CSP_BASE, "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net"].join("; ")

// Overwrite the script-src in dev to include unsafe-eval
function buildCSP(isProd: boolean): string {
  const directives = [
    "default-src 'self'",
    isProd
      ? "script-src 'self' 'unsafe-inline' https://js.stripe.com https://cdn.jsdelivr.net"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: http:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.anthropic.com https://api.openai.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    // Only upgrade-insecure-requests in production (HTTPS guaranteed)
    // In dev/preview on HTTP, this directive would force HTTPS on static assets
    // and break _next/static CSS + JS loading
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ]
  return directives.join("; ")
}

function buildSecurityHeaders(isProd: boolean): Record<string, string> {
  return {
    "X-Frame-Options":           "SAMEORIGIN",
    "X-Content-Type-Options":    "nosniff",
    // HSTS only in production — on HTTP dev/preview it's meaningless
    ...(isProd ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" } : {}),
    "Referrer-Policy":           "strict-origin-when-cross-origin",
    "Permissions-Policy":        "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "X-XSS-Protection":          "1; mode=block",
    "Content-Security-Policy":   buildCSP(isProd),
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isProd = process.env.NODE_ENV === "production"

  // ── Skip static assets ───────────────────────────────────────────────────
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|css|js|map)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // ── Supabase SSR session refresh ─────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request: req })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  let user: { id: string; email?: string } | null = null

  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    // getUser() validates JWT server-side — never use getSession() here
    const { data: { user: authedUser } } = await supabase.auth.getUser()
    user = authedUser
  }

  // ── Route guards ─────────────────────────────────────────────────────────
  const isProtected = PROTECTED_PATHS.some(
    p => pathname === p || pathname.startsWith(p + "/")
  )
  const isAuthOnly = AUTH_ONLY_PATHS.some(
    p => pathname === p || pathname.startsWith(p + "/")
  )

  if (isProtected && !user) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("next", pathname)
    const res = NextResponse.redirect(loginUrl)
    applySecurityHeaders(res, isProd)
    return res
  }

  if (isAuthOnly && user) {
    const rawNext = req.nextUrl.searchParams.get("next") ?? "/dashboard"
    // Validate: must be a same-site relative path (no // open-redirect, no http://)
    const safeNext =
      rawNext.startsWith("/") &&
      !rawNext.startsWith("//") &&
      !rawNext.includes("://")
        ? rawNext
        : "/dashboard"
    const res = NextResponse.redirect(new URL(safeNext, req.url))
    applySecurityHeaders(res, isProd)
    return res
  }

  applySecurityHeaders(supabaseResponse, isProd)
  return supabaseResponse
}

function applySecurityHeaders(res: NextResponse, isProd: boolean) {
  const headers = buildSecurityHeaders(isProd)
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value)
  }
  res.headers.delete("X-Powered-By")
  res.headers.delete("Server")
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)).*)",
  ],
}
