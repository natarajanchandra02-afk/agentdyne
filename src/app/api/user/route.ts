export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()

    return NextResponse.json({ user: { ...user, profile } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const updates = await req.json()
    const allowedFields = ["full_name", "username", "bio", "website", "company", "avatar_url"]
    const filteredUpdates: Record<string, any> = {}
    for (const key of allowedFields) {
      if (key in updates) filteredUpdates[key] = updates[key]
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ ...filteredUpdates, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ profile: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
