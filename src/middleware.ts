import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

// ─── Route classification ─────────────────────────────────────────────────────

const PROTECTED_PATHS = [
  "/dashboard", "/my-agents", "/analytics", "/api-keys",
  "/billing", "/settings", "/admin", "/seller", "/builder",
  "/pipelines", "/executions", "/swarm",
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
  "/api/execute",
  "/api/swarm",
  "/api/embed",
  "/api/debug",
]

// Stripe webhooks: skip auth, never buffer body
const STRIPE_WEBHOOK_PATH = "/api/webhooks/stripe"

// Embed widget pages: served in iframes on external sites — need relaxed CSP
const EMBED_PATHS = ["/embed/", "/api/embed/"]

// ─── CSP builder ─────────────────────────────────────────────────────────────

function buildCSP(isProd: boolean, isEmbedRoute: boolean): string {
  if (isEmbedRoute) {
    // Embed widget: must work inside any third-party iframe.
    // Minimal CSP — no frame-ancestors restriction.
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com",
      "frame-ancestors *",
    ].join("; ")
  }

  return [
    "default-src 'self'",
    isProd
      ? "script-src 'self' 'unsafe-inline' https://js.stripe.com https://cdn.jsdelivr.net"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    [
      "connect-src 'self'",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://api.stripe.com",
      "https://api.anthropic.com",
      "https://api.openai.com",
      "https://generativelanguage.googleapis.com",
    ].join(" "),
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'none'",  // Only for non-embed routes
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ")
}

function buildSecurityHeaders(isProd: boolean, isEmbedRoute: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-XSS-Protection":       "1; mode=block",
    "Referrer-Policy":        "strict-origin-when-cross-origin",
    "Permissions-Policy":     "camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()",
    "Content-Security-Policy": buildCSP(isProd, isEmbedRoute),
  }

  // X-Frame-Options: embed widgets MUST be embeddable — omit this header for them.
  // For all other routes, deny framing entirely.
  if (!isEmbedRoute) {
    headers["X-Frame-Options"] = "DENY"
  }

  if (isProd) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
  }

  return headers
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS_ALLOWED_ORIGINS = new Set([
  "https://agentdyne.com",
  "https://www.agentdyne.com",
])

const CORS_ALLOW_HEADERS = [
  "Content-Type", "Authorization", "X-API-Key",
  "X-Request-ID", "X-Idempotency-Key", "X-Embed-Token", "Cache-Control",
].join(", ")

const CORS_EXPOSE_HEADERS = [
  "X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining",
  "X-RateLimit-Reset", "Retry-After",
].join(", ")

function buildCORSHeaders(origin: string | null, isPreflight: boolean, isEmbed: boolean): Record<string, string> {
  // Embed routes: allow any origin (needed for third-party sites embedding the widget)
  const allowedOrigin = isEmbed ? "*" : (() => {
    const isAllowed =
      !origin ||
      CORS_ALLOWED_ORIGINS.has(origin) ||
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:") ||
      origin.endsWith(".agentdyne.com") ||
      (origin.includes(".vercel.app") && origin.includes("agentdyne"))
    return isAllowed ? (origin ?? "*") : "https://agentdyne.com"
  })()

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin":   allowedOrigin,
    "Access-Control-Allow-Headers":  CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
    "Access-Control-Max-Age":        "86400",
  }

  // Don't send Allow-Credentials with wildcard origin (browser rejects it)
  if (allowedOrigin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true"
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
  "/pipelines", "/executions", "/marketplace", "/builder", "/swarm",
]

function sanitizeRedirect(rawNext: string | null): string {
  if (!rawNext) return "/dashboard"
  const safe =
    typeof rawNext === "string" &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.includes("://") &&
    !rawNext.includes("@") &&
    !rawNext.includes("\\") &&
    !rawNext.includes("\n") &&
    !rawNext.includes("\r") &&
    SAFE_REDIRECT_PREFIXES.some(p => rawNext === p || rawNext.startsWith(p + "/"))
  return safe ? rawNext : "/dashboard"
}

// ─── Main middleware ──────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isProd       = process.env.NODE_ENV === "production"
  const origin       = req.headers.get("origin")
  const method       = req.method

  const isEmbedRoute = EMBED_PATHS.some(p => pathname.startsWith(p))
  const isApiRoute   = pathname.startsWith("/api/")
  const isPublicApi  = PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))

  // ── 1. Static assets ──────────────────────────────────────────────────────
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|css|js|map|txt|xml)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // ── 2. Stripe webhooks — pass through immediately (no auth, no CSP) ──────
  if (pathname.startsWith(STRIPE_WEBHOOK_PATH)) {
    const res = NextResponse.next()
    res.headers.set("Access-Control-Allow-Origin", "https://stripe.com")
    return res
  }

  // ── 3. CORS preflight ─────────────────────────────────────────────────────
  if (isApiRoute && method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...buildCORSHeaders(origin, true, isEmbedRoute),
        ...buildSecurityHeaders(isProd, isEmbedRoute),
      },
    })
  }

  // ── 4. Request size guard ─────────────────────────────────────────────────
  if (isApiRoute && method === "POST") {
    const cl = req.headers.get("content-length")
    if (cl && parseInt(cl) > 10_000_000) {
      return NextResponse.json({ error: "Request body too large (max 10 MB)" }, { status: 413 })
    }
  }

  // ── 5. Supabase SSR session refresh ───────────────────────────────────────
  // IMPORTANT: We always attempt session refresh even when env vars are missing
  // so the request object stays correct. The dummy client guards handle the
  // case where vars are absent.
  let supabaseResponse = NextResponse.next({ request: req })
  let user: { id: string; email?: string } | null = null

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const supabaseConfigured =
    !!supabaseUrl && !!supabaseKey &&
    !supabaseUrl.includes("your-project") &&
    supabaseUrl.startsWith("https://") &&
    supabaseKey.length > 20

  if (supabaseConfigured) {
    try {
      const supabase = createServerClient(supabaseUrl!, supabaseKey!, {
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
      // Always use getUser() — validates JWT server-side (never getSession())
      const { data: { user: authedUser } } = await supabase.auth.getUser()
      user = authedUser
    } catch {
      user = null
    }
  }

  // ── 6. Route guards ───────────────────────────────────────────────────────
  const isProtected = PROTECTED_PATHS.some(
    p => pathname === p || pathname.startsWith(p + "/")
  )
  const isAuthOnly = AUTH_ONLY_PATHS.some(
    p => pathname === p || pathname.startsWith(p + "/")
  )

  if (isProtected && !user) {
    // If Supabase isn't configured, don't redirect in a loop — let the page render
    // so the config error is visible on the login page.
    if (!supabaseConfigured) {
      // Let protected routes render — they'll hit auth checks in the page component
    } else {
      const loginUrl = new URL("/login", req.url)
      loginUrl.searchParams.set("next", pathname)
      const res = NextResponse.redirect(loginUrl)
      applyHeaders(res, buildSecurityHeaders(isProd, false))
      return res
    }
  }

  if (isAuthOnly && user) {
    const safeNext = sanitizeRedirect(req.nextUrl.searchParams.get("next"))
    const res = NextResponse.redirect(new URL(safeNext, req.url))
    applyHeaders(res, buildSecurityHeaders(isProd, false))
    return res
  }

  // ── 7. Apply headers ──────────────────────────────────────────────────────
  applyHeaders(supabaseResponse, buildSecurityHeaders(isProd, isEmbedRoute))

  if (isApiRoute && (isPublicApi || isEmbedRoute)) {
    applyHeaders(supabaseResponse, buildCORSHeaders(origin, false, isEmbedRoute))
  }

  // Remove fingerprinting
  supabaseResponse.headers.delete("X-Powered-By")
  supabaseResponse.headers.delete("Server")

  // Distributed tracing
  const requestId =
    req.headers.get("x-request-id") ??
    crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  supabaseResponse.headers.set("X-Request-ID", requestId)

  return supabaseResponse
}

function applyHeaders(res: NextResponse, headers: Record<string, string>) {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt).*)",
  ],
}
