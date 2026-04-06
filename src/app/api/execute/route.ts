export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiRateLimit } from "@/lib/rate-limit";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req);
  if (limited) return limited;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let userId = user?.id;
    const apiKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");

    if (!userId && apiKey) {
      const keyHash = await hashApiKey(apiKey)
      const { data: keyData } = await supabase
        .from("api_keys")
        .select("user_id, is_active, rate_limit_per_minute")
        .eq("key_hash", keyHash)
        .single();

      if (!keyData?.is_active) {
        return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
      }
      userId = keyData.user_id;

      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("key_hash", keyHash);
    }

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { agentId, input } = await req.json();
    if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });

    const { data: agent } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .eq("status", "active")
      .single();

    if (!agent) return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan")
      .eq("id", userId)
      .single();

    if (profile && profile.monthly_execution_quota !== -1 && profile.executions_used_this_month >= profile.monthly_execution_quota) {
      return NextResponse.json({ error: "Monthly quota exceeded. Please upgrade your plan.", code: "QUOTA_EXCEEDED" }, { status: 429 });
    }

    if (agent.pricing_model === "subscription") {
      const { data: subscription } = await supabase
        .from("agent_subscriptions")
        .select("status")
        .eq("user_id", userId)
        .eq("agent_id", agentId)
        .single();

      const hasFreeAccess = (profile?.executions_used_this_month || 0) < (agent.free_calls_per_month || 0);
      if (!hasFreeAccess && subscription?.status !== "active") {
        return NextResponse.json({ error: "Subscription required", code: "SUBSCRIPTION_REQUIRED" }, { status: 403 });
      }
    }

    const { data: execution } = await supabase
      .from("executions")
      .insert({ agent_id: agentId, user_id: userId, status: "running", input })
      .select()
      .single();

    const startTime = Date.now();

    try {
      const userMessage = typeof input === "string" ? input : JSON.stringify(input);

      const response = await anthropic.messages.create({
        model: agent.model_name || "claude-sonnet-4-20250514",
        max_tokens: agent.max_tokens || 4096,
        system: agent.system_prompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: agent.temperature || 0.7,
      });

      const latencyMs = Date.now() - startTime;
      const outputText = response.content[0].type === "text" ? response.content[0].text : "";
      let output: any = outputText;
      try { output = JSON.parse(outputText); } catch {}

      await supabase.from("executions").update({
        status: "success",
        output,
        tokens_input: response.usage.input_tokens,
        tokens_output: response.usage.output_tokens,
        latency_ms: latencyMs,
        completed_at: new Date().toISOString(),
      }).eq("id", execution.id);

      await supabase.rpc("increment_executions_used", { user_id_param: userId });

      const cost = (response.usage.input_tokens * 0.000003) + (response.usage.output_tokens * 0.000015);

      return NextResponse.json({
        executionId: execution.id,
        output,
        latencyMs,
        tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
        cost,
      });

    } catch (aiError: any) {
      await supabase.from("executions").update({
        status: "failed",
        error_message: aiError.message,
        completed_at: new Date().toISOString(),
      }).eq("id", execution.id);
      throw aiError;
    }

  } catch (err: any) {
    console.error("Execute error:", err);
    return NextResponse.json({ error: err.message || "Execution failed" }, { status: 500 });
  }
}
