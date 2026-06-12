import type { Metadata } from "next"
import CollectionsClient from "./collections-client"

export const metadata: Metadata = {
  title: "Collections — AgentDyne",
  description: "Organise your agents into collections. Think Pinterest boards for AI.",
}

export default function CollectionsPage() {
  return <CollectionsClient />
}
