import type { Metadata } from "next"
import CollectionsClient from "./collections-client"

export const metadata: Metadata = {
  title: "Collections — AgentDyne",
  description: "Organise your agents into focused collections for every workflow.",
}

export default function CollectionsPage() {
  return <CollectionsClient />
}
