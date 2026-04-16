export const runtime = 'edge'

// Layout wrapper for /builder/[id] — declares Edge Runtime for Cloudflare Pages.
// The page itself is "use client" so runtime must be declared here in the layout.
export default function BuilderEditorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
