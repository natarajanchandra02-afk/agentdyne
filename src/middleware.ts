import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

// ─── Route classification ─────────────────────────────────────────────────────

const PROTECTED_PATHS = [
  "/dashboard", "/my-agents", "/analytics", "/api-keys",
  "/billing", "/settings", "/admin", "/seller", "/builder",
  "/pipelines", "/executions",
]

const AUTH_ONLY_PATHS = ["/login", "/signup", "/forgot-password"]

const PUBLIC_API_PREFIXES = [
  "/api/agents",
  "/api/search",
  "/api/leaderboard",
  "/api/discover",
  "/api/registry",
  "/api/executions",
  "/api/pipelines",
  "/api/rag",
  "/api/memory",
  "/api/feedback",
  "/api/thoughtgate",
  "/api/credits",
  "/api/user",
  "/api/notifications",
  "/api/health",
  "/api/run",
]

const WEBHOOK_PATHS = ["/api/webhooks/"]

// ─── Security headers ─────────────────────────────────────────────────────────

function buildCSP(isProd: boolean): string {
  const directives = [
    "default-src 'self'",
    isProd
      ? "script-src 'self' 'unsafe-inline' https://js.stripe.com https://cdn.jsdelivr.net"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ]
  return directives.join("; ")
}

function buildSecurityHeaders(isProd: boolean): Record<string, string> {
  return {
    "X-Frame-Options":         "DENY",
    "X-Content-Type-Options":  "nosniff",
    "X-XSS-Protection":        "1; mode=block",
    "Referrer-Policy":         "strict-origin-when-cross-origin",
    "Permissions-Policy":      "camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()",
    "Content-Security-Policy": buildCSP(isProd),
    ...(isProd ? {
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    } : {}),
  }
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS_ALLOWED_ORIGINS = new Set([
  "https://agentdyne.com",
  "https://www.agentdyne.com",
])

// All headers that client SDK / external callers may send
const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-API-Key",
  "X-Request-ID",
  "X-Idempotency-Key",    // ← required for idempotent execute calls
  "Cache-Control",
].join(", ")

const CORS_EXPOSE_HEADERS = [
  "X-Request-ID",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
  "Retry-After",
].join(", ")

function buildCORSHeaders(origin: string | null, isPreflight: boolean): Record<string, string> {
  const isAllowed =
    !origin ||
    CORS_ALLOWED_ORIGINS.has(origin) ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.endsWith(".agentdyne.com") ||
    (origin.includes(".vercel.app") && origin.includes("agentdyne"))

  const allowedOrigin = isAllowed ? (origin ?? "*") : "https://agentdyne.com"

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin":      allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":     CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers":    CORS_EXPOSE_HEADERS,
    "Access-Control-Max-Age":           "86400",
  }

  if (isPreflight) {
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
  }

  return headers
}

// ─── Open-redirect guard ──────────────────────────────────────────────────────

const SAFE_REDIRECT_PREFIXES = [
  "/dashboard", "/my-agents", "/analytics", "/api-keys",
  "/billing", "/settings", "/admin", "/seller",
  "/pipelines", "/executions", "/marketplace", "/builder",
]

function sanitizeRedirect(rawNext: string | null): string {
  if (!rawNext) return "/dashboard"
  const isSafe =
    typeof rawNext === "string" &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.includes("://") &&
    !rawNext.includes("@") &&
    !rawNext.includes("\\") &&
    !rawNext.includes("\n") &&
    !rawNext.includes("\r") &&
    SAFE_REDIRECT_PREFIXES.some(p => rawNext === p || rawNext.startsWith(p + "/"))
  return isSafe ? rawNext : "/dashboard"
}

// ─── Main middleware ──────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isProd       = process.env.NODE_ENV === "production"
  const origin       = req.headers.get("origin")
  const method       = req.method

  // ── 1. Static assets — pass through immediately ──────────────────────────
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|css|js|map|txt|xml)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // ── 2. Stripe webhooks — skip auth, never touch body ────────────────────
  if (WEBHOOK_PATHS.some(p => pathname.startsWith(p))) {
    const res = NextResponse.next()
    applyHeaders(res, buildSecurityHeaders(isProd))
    return res
  }

  // ── 3. CORS preflight — respond immediately ──────────────────────────────
  const isApiRoute  = pathname.startsWith("/api/")
  const isPublicApi = PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))

  if (isApiRoute && method === "OPTIONS") {
    return new NextResponse(null, {
      status:  204,
      headers: {
        ...buildCORSHeaders(origin, true),
        ...buildSecurityHeaders(isProd),
      },
    })
  }

  // ── 4. Request size guard ─────────────────────────────────────────────────
  if (isApiRoute && method === "POST") {
    const cl = req.headers.get("content-length")
    if (cl && parseInt(cl) > 10_000_000) {
      return NextResponse.json({ error: "Request body too large (max 10MB)" }, { status: 413 })
    }
  }

  // ── 5. Supabase SSR session refresh ──────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request: req })
  let user: { id: string; email?: string } | null = null

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    try {
      // Always use getUser() — validates JWT server-side (never getSession())
      const { data: { user: authedUser } } = await supabase.auth.getUser()
      user = authedUser
    } catch {
      user = null
    }
  }

  // ── 6. UI route guards ────────────────────────────────────────────────────
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
    applyHeaders(res, buildSecurityHeaders(isProd))
    return res
  }

  if (isAuthOnly && user) {
    const safeNext = sanitizeRedirect(req.nextUrl.searchParams.get("next"))
    const res = NextResponse.redirect(new URL(safeNext, req.url))
    applyHeaders(res, buildSecurityHeaders(isProd))
    return res
  }

  // ── 7. Apply security + CORS headers ─────────────────────────────────────
  applyHeaders(supabaseResponse, buildSecurityHeaders(isProd))

  if (isApiRoute && isPublicApi) {
    applyHeaders(supabaseResponse, buildCORSHeaders(origin, false))
  }

  // Remove server fingerprinting
  supabaseResponse.headers.delete("X-Powered-By")
  supabaseResponse.headers.delete("Server")

  // Request ID for distributed tracing
  const requestId =
    req.headers.get("x-request-id") ??
    crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  supabaseResponse.headers.set("X-Request-ID", requestId)

  return supabaseResponse
}

function applyHeaders(res: NextResponse, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value)
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
}
