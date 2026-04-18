// ⚠️  THIS FILE MUST BE DELETED before the next build.
//
// Having both:
//   app/(dashboard)/pipelines/[id]/page.tsx   → resolves to /pipelines/[id]
//   app/pipelines/[id]/page.tsx               → resolves to /pipelines/[id]
//
// causes Next.js to throw:
//   "You cannot have two parallel pages that resolve to the same path."
//
// The canonical implementation is now in app/pipelines/[id]/page.tsx
// (with DashboardSidebar wrapper + export const runtime = 'edge').
//
// To fix: delete this file from the filesystem.
// MCP filesystem tool cannot delete — must be done manually:
//   rm "src/app/(dashboard)/pipelines/[id]/page.tsx"
//   git add -A && git commit -m "fix: remove duplicate pipelines/[id] route"
//
// The redirect below serves as a fallback during the transition period.
// If Next.js errors at build time on this conflict, delete this file first.

export const runtime = 'edge'
import { redirect } from "next/navigation"

export default function PipelineEditorGroupFallback() {
  // Both files resolve to /pipelines/[id] — the non-group file takes precedence.
  // This redirect is never actually reached in a correct build.
  redirect("/pipelines")
}
