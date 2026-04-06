import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PATHS = [
  '/dashboard', '/my-agents', '/analytics', '/api-keys',
  '/billing', '/settings', '/admin', '/seller', '/builder',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isProtected = PROTECTED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (!isProtected) return NextResponse.next()

  const hasSession = Array.from(req.cookies.keys()).some(
    key => key.startsWith('sb-') && key.endsWith('-auth-token')
  )

  if (!hasSession) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.svg|.*\\.png|.*\\.jpg|.*\\.ico).*)'],
}
