import { AgentDetailClient } from "./page.client"

export const runtime = 'edge'

export default function Page({ params }: { params: { id: string } }) {
  return <AgentDetailClient id={params.id} />
}
