import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

// ─── Route classification ─────────────────────────────────────────────────────

const PROTECTED_PATHS = [
  "/dashboard", "/my-agents", "/analytics", "/api-keys",
  "/billing", "/settings", "/admin", "/seller", "/builder",
  "/pipelines", "/executions", "/swarm",
  // ✅ Bug fix: added all routes that require auth
  "/collections", "/revenue",
  "/compose",
  // ✅ Bug fix: "/integrations" REMOVED from this list.
  // It was added here to close an auth gap on the DASHBOARD's integrations
  // page — but that page is now just a redirect to the PUBLIC catalog at
  // app/integrations/page.tsx (same fix, applied during the routing-conflict
  // cleanup). Since Next.js route groups like (dashboard) are invisible in
  // the actual URL, both pages resolve to the exact same path: /integrations.
  // Protecting that path here meant every logged-out visitor — including
  // anyone just browsing the public MCP catalog, same as /marketplace or
  // /pricing — was silently redirected to /login instead of seeing the page.
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
  "/api/collections",
]

const STRIPE_WEBHOOK_PATH = "/api/webhooks/stripe"
const EMBED_PATHS = ["/embed/", "/api/embed/"]

// ─── CSP builder ─────────────────────────────────────────────────────────────

function buildCSP(isProd: boolean, isEmbedRoute: boolean): string {
  if (isEmbedRoute) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      // M2 FIX: added 'unsafe-inline' to style-src already; SMIL animations
      // are controlled by the browser engine not CSP — but keeping permissive
      // connect-src ensures the swarm graph fetch works in iframes.
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
    "frame-ancestors 'none'",
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
  // ✅ Bug fix: all new routes also safe for redirect
  "/collections", "/revenue", "/integrations", "/compose",
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

  // ── 2. Stripe webhooks — pass through immediately ─────────────────────────
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

  // ✅ MFA (AAL2) enforcement — server-side, not just a client-side login step.
  // Without this, a session that authenticated at AAL1 (password only, factor
  // not yet challenged) could still reach every protected route directly by
  // URL, completely bypassing the login page's MFA challenge screen. This
  // check makes the requirement real rather than cosmetic: any account with a
  // verified TOTP factor MUST satisfy AAL2 before touching a protected page,
  // no matter how the request got there.
  if (isProtected && user && supabaseConfigured) {
    try {
      const supabaseAal = createServerClient(supabaseUrl!, supabaseKey!, {
        cookies: { getAll() { return req.cookies.getAll() }, setAll() {} },
      })
      const { data: aal } = await supabaseAal.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
        const loginUrl = new URL("/login", req.url)
        loginUrl.searchParams.set("next", pathname)
        loginUrl.searchParams.set("mfa", "required")
        const res = NextResponse.redirect(loginUrl)
        applyHeaders(res, buildSecurityHeaders(isProd, false))
        return res
      }
    } catch {
      // If the AAL check itself fails (network hiccup, etc.), fail OPEN rather
      // than locking every user out of the platform on a transient error —
      // the login page's own MFA step is still a second, independent layer.
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

  supabaseResponse.headers.delete("X-Powered-By")
  supabaseResponse.headers.delete("Server")

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
