export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/search
 *
 * Hybrid search: semantic (vector) + keyword (full-text), merged by rank.
 * Semantic search uses pgvector with cosine similarity on agent embeddings.
 * Falls back to keyword-only if embeddings are unavailable.
 *
 * Body:
 *   query         - natural language search string (required)
 *   category      - filter by category
 *   pricing       - filter by pricing model
 *   max_cost      - filter by max price_per_call
 *   min_score     - filter by min composite_score
 *   page          - pagination
 *   limit         - max 50
 *   mode          - "hybrid" (default) | "semantic" | "keyword"
 */
export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const body     = await req.json()

    const {
      query,
      category,
      pricing,
      max_cost,
      min_score = 0,
      page      = 1,
      limit     = 20,
      mode      = "hybrid",
    } = body

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json({ error: "query is required" }, { status: 400 })
    }

    const safeLimit = Math.min(50, Math.max(1, parseInt(String(limit))))

    // ── Keyword search (always available) ────────────────────────────────────
    let kwQuery = supabase
      .from("agents")
      .select(
        `id, name, slug, description, category, pricing_model, price_per_call,
         average_rating, total_reviews, total_executions, average_latency_ms,
         composite_score, is_featured, is_verified, icon_url,
         profiles!seller_id(full_name, is_verified)`,
        { count: "exact" }
      )
      .eq("status", "active")
      .textSearch("description", query.trim(), { type: "websearch", config: "english" })
      .gte("composite_score", min_score)
      .order("composite_score", { ascending: false })
      .limit(safeLimit * 3) // fetch more for merge

    if (category)  kwQuery = kwQuery.eq("category",      category)  as typeof kwQuery
    if (pricing)   kwQuery = kwQuery.eq("pricing_model", pricing)   as typeof kwQuery
    if (max_cost)  kwQuery = kwQuery.lte("price_per_call", max_cost) as typeof kwQuery

    const { data: kwResults, count, error: kwError } = await kwQuery

    if (kwError) throw kwError

    // ── Semantic search (requires pgvector + embeddings) ─────────────────────
    let semanticResults: any[] = []

    if (mode !== "keyword") {
      try {
        // Generate embedding via OpenAI-compatible endpoint
        // In production: use openai or voyageai client
        // Here we use a simple REST call to be edge-compatible
        const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: query.trim(),
          }),
        })

        if (embeddingRes.ok) {
          const embData   = await embeddingRes.json() as any
          const embedding = embData.data?.[0]?.embedding as number[]

          if (embedding) {
            const { data: semRows } = await supabase.rpc(
              "search_agents_semantic",
              {
                query_embedding: embedding,
                match_threshold: 0.65,
                match_count:     safeLimit * 2,
              }
            )
            semanticResults = semRows ?? []
          }
        }
      } catch {
        // Silently fall back to keyword-only — don't break search
        semanticResults = []
      }
    }

    // ── Merge + deduplicate ──────────────────────────────────────────────────
    const seen    = new Set<string>()
    const merged: any[] = []

    // 1. Boost items that appear in BOTH result sets (true hybrid match)
    for (const sem of semanticResults) {
      const kwMatch = (kwResults ?? []).find(k => k.id === sem.agent_id)
      if (kwMatch) {
        merged.push({
          ...kwMatch,
          similarity:   sem.similarity,
          search_score: sem.similarity * 0.5 + (kwMatch.composite_score / 100) * 0.5,
          match_type:   "hybrid",
        })
        seen.add(sem.agent_id)
      }
    }

    // 2. Remaining semantic-only results
    if (mode !== "keyword") {
      for (const sem of semanticResults) {
        if (seen.has(sem.agent_id)) continue
        merged.push({
          id:               sem.agent_id,
          name:             sem.name,
          description:      sem.description,
          category:         sem.category,
          composite_score:  sem.composite_score,
          average_rating:   sem.average_rating,
          pricing_model:    sem.pricing_model,
          price_per_call:   sem.price_per_call,
          total_executions: sem.total_executions,
          similarity:       sem.similarity,
          search_score:     sem.similarity * 0.6,
          match_type:       "semantic",
        })
        seen.add(sem.agent_id)
      }
    }

    // 3. Remaining keyword-only results
    for (const kw of kwResults ?? []) {
      if (seen.has(kw.id)) continue
      merged.push({
        ...kw,
        similarity:   null,
        search_score: (kw.composite_score / 100) * 0.4,
        match_type:   "keyword",
      })
      seen.add(kw.id)
    }

    // Sort by hybrid score
    merged.sort((a, b) => (b.search_score ?? 0) - (a.search_score ?? 0))

    // Paginate
    const pageNum     = Math.max(1, parseInt(String(page)))
    const paginated   = merged.slice((pageNum - 1) * safeLimit, pageNum * safeLimit)
    const totalMerged = merged.length
    const pages       = Math.ceil(totalMerged / safeLimit)

    return NextResponse.json({
      data: paginated,
      pagination: {
        total:   totalMerged,
        page:    pageNum,
        limit:   safeLimit,
        pages,
        hasNext: pageNum < pages,
        hasPrev: pageNum > 1,
      },
      meta: {
        query,
        mode:         semanticResults.length > 0 ? "hybrid" : "keyword",
        semantic_hits: semanticResults.length,
        keyword_hits:  (kwResults ?? []).length,
      },
    })
  } catch (err: any) {
    console.error("POST /api/search:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET /api/search — convenience wrapper for quick searches
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const query    = searchParams.get("q") ?? ""
  const category = searchParams.get("category") ?? undefined
  const limit    = parseInt(searchParams.get("limit") ?? "20")

  // Reconstruct as POST body
  const fakeReq = new Request(req.url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ query, category, limit, mode: "keyword" }),
  })

  return POST(new NextRequest(fakeReq))
}
