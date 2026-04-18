export const runtime = 'edge'

// Layout for /executions/[id] — declares Edge Runtime for Cloudflare Pages.
// The page itself is "use client" so runtime must be declared here in the layout.
// Same pattern as /builder/[id]/layout.tsx and /marketplace/[id]/layout.tsx.
export default function ExecutionDetailLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
