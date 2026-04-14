import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

// Routes that require authentication
const PROTECTED_PATHS = [
  "/dashboard", "/my-agents", "/analytics", "/api-keys",
  "/billing", "/settings", "/admin", "/seller", "/builder",
  "/leaderboard", "/pipelines",
]

// Routes only for unauthenticated users
const AUTH_ONLY_PATHS = ["/login", "/signup", "/forgot-password"]

// Security headers applied to every response
const SECURITY_HEADERS: Record<string, string> = {
  // Prevent clickjacking
  "X-Frame-Options": "SAMEORIGIN",
  // Stop MIME-type sniffing
  "X-Content-Type-Options": "nosniff",
  // Force HTTPS for 2 years, include subdomains
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  // Limit referrer info
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Permissions policy — disable unused browser APIs
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  // XSS protection (legacy but still valuable)
  "X-XSS-Protection": "1; mode=block",
  // Content Security Policy
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: http:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.anthropic.com https://api.openai.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ].join("; "),
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Skip static assets entirely ─────────────────────────────────────────
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|css|js|map)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // ── Build response with Supabase SSR (refreshes session & rotates tokens) ─
  // This is the ONLY correct pattern for @supabase/ssr middleware.
  // It validates the JWT via Supabase's /auth/v1/user endpoint and sets
  // fresh cookies if the token was rotated — without this, sessions expire
  // silently and users get redirected to login after 1 hour.
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
          // Apply cookies to the request (for downstream reads)
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value)
          )
          // Apply cookies to the response (so browser receives them)
          supabaseResponse = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    // getUser() cryptographically validates the JWT with Supabase's server.
    // Never use getSession() in middleware — it trusts the client-side cookie
    // without validation (security vulnerability).
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

  // Unauthenticated user trying to access protected route
  if (isProtected && !user) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("next", pathname)
    const res = NextResponse.redirect(loginUrl)
    applySecurityHeaders(res)
    return res
  }

  // Authenticated user trying to access login/signup — send to dashboard
  if (isAuthOnly && user) {
    const next = req.nextUrl.searchParams.get("next") ?? "/dashboard"
    // Validate next param to prevent open redirect
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"
    const res = NextResponse.redirect(new URL(safeNext, req.url))
    applySecurityHeaders(res)
    return res
  }

  // ── Apply security headers to all responses ──────────────────────────────
  applySecurityHeaders(supabaseResponse)

  return supabaseResponse
}

function applySecurityHeaders(res: NextResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(key, value)
  }
  // Remove fingerprinting headers
  res.headers.delete("X-Powered-By")
  res.headers.delete("Server")
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (static files)
     * - _next/image   (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public assets (images, fonts, etc.)
     *
     * The middleware must run on every route so Supabase can
     * refresh the session cookie transparently.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)).*)",
  ],
}
