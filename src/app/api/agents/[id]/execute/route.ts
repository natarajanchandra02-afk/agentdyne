export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"

// POST /api/agents/[id]/execute — public API endpoint (alias for /api/execute)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const executeReq = new Request(`${req.nextUrl.origin}/api/execute`, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({ ...body, agentId: params.id }),
    })
    const response = await fetch(executeReq)
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
