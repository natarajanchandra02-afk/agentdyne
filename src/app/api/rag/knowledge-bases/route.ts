export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit, strictRateLimit } from "@/lib/rate-limit"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * /api/rag/knowledge-bases
 *
 * GET    ?id=UUID  → single KB detail + document list
 * GET              → list all user's knowledge bases
 * POST             → create a new knowledge base
 * PATCH  ?id=UUID  → update name / description / visibility
 * DELETE ?id=UUID  → delete KB + all documents (CASCADE)
 *
 * Security:
 *   - Auth required on every method
 *   - Ownership enforced on all write + targeted-read operations
 *   - Max 20 KBs per user
 *   - Name max 100 chars, description max 500 chars
 *   - Rate limited: reads 100/min, writes 10/min
 */

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id    = searchParams.get("id")
    const page  = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20"))

    if (id) {
      if (!UUID_RE.test(id)) {
        return NextResponse.json({ error: "Invalid knowledge_base id" }, { status: 400 })
      }

      const { data: kb } = await supabase
        .from("knowledge_bases")
        .select("*")
        .eq("id", id)
        .single()

      if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 })
      if (!kb.is_public && kb.owner_id !== user.id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 })
      }

      const { data: docs, count } = await supabase
        .from("rag_documents")
        .select("id, title, chunk_count, status, created_at", { count: "exact" })
        .eq("knowledge_base_id", id)
        .neq("status", "deleted")
        .order("created_at", { ascending: false })
        .range((page - 1) * limit, page * limit - 1)

      return NextResponse.json({
        knowledge_base: kb,
        documents:      docs ?? [],
        pagination: {
          total:   count ?? 0, page, limit,
          pages:   Math.ceil((count ?? 0) / limit),
          hasNext: page < Math.ceil((count ?? 0) / limit),
          hasPrev: page > 1,
        },
      })
    }

    // List all user's KBs
    const { data: kbs, count } = await supabase
      .from("knowledge_bases")
      .select("id, name, description, is_public, doc_count, max_docs, created_at, updated_at", { count: "exact" })
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    return NextResponse.json({
      knowledge_bases: kbs ?? [],
      pagination: {
        total:   count ?? 0, page, limit,
        pages:   Math.ceil((count ?? 0) / limit),
        hasNext: page < Math.ceil((count ?? 0) / limit),
        hasPrev: page > 1,
      },
    })
  } catch (err: any) {
    console.error("GET /api/rag/knowledge-bases:", err)
    return NextResponse.json({ error: "Failed to fetch knowledge bases" }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: Record<string, any>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const cleanName = String(body.name        || "").replace(/\x00/g, "").trim()
    const cleanDesc = String(body.description || "").replace(/\x00/g, "").trim()
    const isPublic  = Boolean(body.is_public)

    if (cleanName.length < 2 || cleanName.length > 100) {
      return NextResponse.json({ error: "Name must be 2–100 characters" }, { status: 400 })
    }
    if (cleanDesc.length > 500) {
      return NextResponse.json({ error: "Description must be under 500 characters" }, { status: 400 })
    }

    // Per-user limit (abuse prevention)
    const { count: existing } = await supabase
      .from("knowledge_bases")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)

    if ((existing ?? 0) >= 20) {
      return NextResponse.json({
        error: "Maximum 20 knowledge bases per account. Delete unused ones to create more.",
        code:  "KB_LIMIT_REACHED",
      }, { status: 429 })
    }

    const { data: kb, error } = await supabase
      .from("knowledge_bases")
      .insert({
        owner_id:    user.id,
        name:        cleanName,
        description: cleanDesc || null,
        is_public:   isPublic,
        doc_count:   0,
        max_docs:    1000,
      })
      .select()
      .single()

    if (error) {
      console.error("POST /api/rag/knowledge-bases:", error)
      return NextResponse.json({ error: "Failed to create knowledge base" }, { status: 500 })
    }

    return NextResponse.json(kb, { status: 201 })
  } catch (err: any) {
    console.error("POST /api/rag/knowledge-bases:", err)
    return NextResponse.json({ error: "Failed to create knowledge base" }, { status: 500 })
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Valid ?id=UUID query param required" }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from("knowledge_bases")
      .select("owner_id")
      .eq("id", id)
      .single()

    if (!existing)                    return NextResponse.json({ error: "Not found" },   { status: 404 })
    if (existing.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let body: Record<string, any>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const updates: Record<string, any> = {}

    if (typeof body.name === "string") {
      const n = body.name.replace(/\x00/g, "").trim()
      if (n.length < 2 || n.length > 100) {
        return NextResponse.json({ error: "Name must be 2–100 characters" }, { status: 400 })
      }
      updates.name = n
    }
    if (typeof body.description === "string") {
      const d = body.description.replace(/\x00/g, "").trim()
      if (d.length > 500) return NextResponse.json({ error: "Description under 500 chars" }, { status: 400 })
      updates.description = d || null
    }
    if (typeof body.is_public === "boolean") updates.is_public = body.is_public

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }
    updates.updated_at = new Date().toISOString()

    const { data: kb, error } = await supabase
      .from("knowledge_bases")
      .update(updates)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(kb)
  } catch (err: any) {
    console.error("PATCH /api/rag/knowledge-bases:", err)
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Valid ?id=UUID query param required" }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from("knowledge_bases")
      .select("owner_id, name")
      .eq("id", id)
      .single()

    if (!existing)                    return NextResponse.json({ error: "Not found" },   { status: 404 })
    if (existing.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Deletes rag_documents + rag_chunks via CASCADE
    const { error } = await supabase.from("knowledge_bases").delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ ok: true, deleted_knowledge_base_id: id })
  } catch (err: any) {
    console.error("DELETE /api/rag/knowledge-bases:", err)
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}
