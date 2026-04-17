export const runtime = 'edge'

// Placeholder — this file must export runtime = 'edge' for Cloudflare Pages.
// The pipelines/[id] route is reserved for a future pipeline detail/editor view.
// For now it redirects to the pipelines list.

import { redirect } from "next/navigation"

export default function PipelineDetailPage() {
  redirect("/pipelines")
}
