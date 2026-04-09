import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PATHS = [
  '/dashboard', '/my-agents', '/analytics', '/api-keys',
  '/billing', '/settings', '/admin', '/seller', '/builder',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isProtected = PROTECTED_PATHS.some(
    p => pathname === p || pathname.startsWith(p + '/')
  )
  if (!isProtected) return NextResponse.next()

  // req.cookies.getAll() returns { name, value }[] — works in all edge runtimes
  const hasSession = req.cookies.getAll().some(
    ({ name }) => name.startsWith('sb-') && name.endsWith('-auth-token')
  )

  if (!hasSession) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|logo\\.png|logo-icon\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)).*)',
  ],
}
