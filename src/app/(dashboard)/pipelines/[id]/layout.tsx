// Layout for /pipelines/[id]
// Declares Edge Runtime for Cloudflare Pages — required alongside "use client" pages.
// DashboardSidebar + outer flex wrapper come from (dashboard)/layout.tsx.
export const runtime = 'edge'

export default function PipelineEditorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
