/**
 * Cloudflare Pages edge runtime wrapper for /builder/[id].
 *
 * next-on-pages requires ALL dynamic routes to export:
 *   export const runtime = 'edge'
 * This MUST come from a Server Component (not "use client").
 *
 * This thin wrapper is the Server Component. All rendering
 * delegates to builder-editor-page-client.tsx ("use client").
 */
export const runtime = 'edge'

export { default } from './builder-editor-page-client'
