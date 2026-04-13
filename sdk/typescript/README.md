# @agentdyne/sdk

Official JavaScript / TypeScript SDK for [AgentDyne](https://agentdyne.com) — The Global Microagent Marketplace.

[![npm version](https://img.shields.io/npm/v/@agentdyne/sdk.svg)](https://www.npmjs.com/package/@agentdyne/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)

## Installation

```bash
npm install @agentdyne/sdk
# or
yarn add @agentdyne/sdk
# or
pnpm add @agentdyne/sdk
```

## Quick Start

```typescript
import AgentDyne from "@agentdyne/sdk";

const client = new AgentDyne({
  apiKey: process.env.AGENTDYNE_API_KEY!,
});

// Execute an agent
const result = await client.execute("agent_id", "Summarize this email...");
console.log(result.output);
// → { summary: "...", actionItems: [...], urgency: "high" }

// Stream output token-by-token
for await (const chunk of client.stream("agent_id", "Explain quantum computing")) {
  if (chunk.type === "delta") process.stdout.write(chunk.delta ?? "");
}
```

## Authentication

Create your API key at [agentdyne.com/api-keys](https://agentdyne.com/api-keys).

Set it as an environment variable:

```bash
export AGENTDYNE_API_KEY=agd_your_key_here
```

Or pass it directly:

```typescript
const client = new AgentDyne({ apiKey: "agd_your_key_here" });
```

## Core Concepts

### Agents

```typescript
// List agents with filters
const { data, pagination } = await client.agents.list({
  category: "coding",
  sort: "rating",
  limit: 10,
});

// Get a single agent
const agent = await client.agents.get("agent_id");

// Search by keyword
const results = await client.agents.search("email summarizer");

// Iterate ALL agents automatically (async generator)
for await (const agent of client.agents.paginate({ category: "finance" })) {
  console.log(agent.name, agent.average_rating);
}

// Featured agents
const featured = await client.agents.featured();
```

### Execute Agents

```typescript
// Synchronous (waits for completion)
const result = await client.agents.execute("agent_id", {
  input: { text: "Quarterly revenue grew 40%..." },
});
console.log(result.output, result.latencyMs, result.cost);

// With idempotency key (safe to retry on network failure)
const result = await client.agents.execute("agent_id", {
  input: "Hello",
  idempotencyKey: crypto.randomUUID(),
});

// Streaming (token-by-token)
for await (const chunk of client.agents.stream("agent_id", { input: "Hello" })) {
  switch (chunk.type) {
    case "delta": process.stdout.write(chunk.delta ?? ""); break;
    case "done":  console.log("\nDone! executionId:", chunk.executionId); break;
    case "error": console.error("Stream error:", chunk.error); break;
  }
}
```

### Executions

```typescript
// List execution history
const { data } = await client.executions.list({ status: "failed", limit: 20 });

// Get a specific execution
const exec = await client.executions.get("exec_id");

// Poll until terminal state (success / failed / timeout)
const result = await client.executions.poll("exec_id", {
  intervalMs: 500,  // poll every 500ms
  timeoutMs: 60000, // give up after 60s
});
```

### User & Quota

```typescript
const me = await client.user.me();
console.log(me.subscription_plan); // "pro"

const quota = await client.user.quota();
console.log(`${quota.used}/${quota.quota} calls used (${quota.percentUsed.toFixed(1)}%)`);

// Update profile
await client.user.update({ full_name: "Ada Lovelace", bio: "AI researcher" });
```

### Reviews

```typescript
// List reviews for an agent
const { data: reviews } = await client.agents.reviews.list("agent_id");

// Post a review (requires prior execution)
await client.agents.reviews.create("agent_id", {
  rating: 5,
  title:  "Incredible accuracy",
  body:   "Handles edge cases I didn't even consider.",
});
```

### Webhooks

```typescript
// In a Next.js App Router handler:
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-agentdyne-signature") ?? "";

  const client = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! });
  const event = await client.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.AGENTDYNE_WEBHOOK_SECRET!
  );

  switch (event.type) {
    case "execution.completed":
      console.log("Execution finished:", event.data.executionId);
      break;
    case "subscription.created":
      // Provision user access...
      break;
  }

  return Response.json({ received: true });
}
```

## Error Handling

Every error extends `AgentDyneError` — use `instanceof` checks for specific handling:

```typescript
import {
  AgentDyneError,
  AuthenticationError,
  QuotaExceededError,
  RateLimitError,
  NotFoundError,
  SubscriptionRequiredError,
} from "@agentdyne/sdk";

try {
  await client.execute("agent_id", "Hello");
} catch (err) {
  if (err instanceof QuotaExceededError) {
    console.log("Upgrade plan at agentdyne.com/billing");
  } else if (err instanceof RateLimitError) {
    await new Promise(r => setTimeout(r, err.retryAfterMs));
  } else if (err instanceof SubscriptionRequiredError) {
    console.log("Subscribe to use this agent");
  } else if (err instanceof NotFoundError) {
    console.log("Agent not found");
  } else if (err instanceof AuthenticationError) {
    console.log("Check your API key");
  } else if (err instanceof AgentDyneError) {
    console.log(err.message, err.statusCode, err.code);
  }
}
```

## Configuration

```typescript
const client = new AgentDyne({
  apiKey:     "agd_...",          // Required
  baseUrl:    "http://localhost:3000", // Override for local dev
  maxRetries: 3,                  // Retries on 429/5xx (default: 3)
  timeout:    60_000,             // Request timeout ms (default: 60000)
  fetch:      customFetch,        // Custom fetch implementation
});
```

## Framework Examples

### Next.js App Router

```typescript
// app/api/summarize/route.ts
import AgentDyne from "@agentdyne/sdk";

const client = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! });

export async function POST(req: Request) {
  const { text } = await req.json();
  const result = await client.execute("email-summarizer-pro", { input: text });
  return Response.json(result.output);
}
```

### Edge Runtime (Cloudflare Workers)

```typescript
import AgentDyne from "@agentdyne/sdk";

export default {
  async fetch(request: Request, env: Env) {
    const client = new AgentDyne({ apiKey: env.AGENTDYNE_API_KEY });
    const result = await client.execute("agent_id", "Hello from the edge!");
    return new Response(JSON.stringify(result.output), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
```

### Node.js Script

```typescript
import AgentDyne from "@agentdyne/sdk";

const client = new AgentDyne({ apiKey: process.env.AGENTDYNE_API_KEY! });

async function main() {
  // Stream a long-form response
  process.stdout.write("Output: ");
  for await (const chunk of client.stream("content-writer", "Write a blog post about AI agents")) {
    if (chunk.type === "delta") process.stdout.write(chunk.delta ?? "");
  }
  console.log("\n✓ Done");
}

main().catch(console.error);
```

## Requirements

- Node.js ≥ 18 (uses native `fetch` and `crypto.subtle`)
- TypeScript ≥ 5.0 (optional but recommended)
- Works in: Node.js, Deno, Bun, Cloudflare Workers, Vercel Edge, browsers

## License

MIT © 2026 AgentDyne, Inc.
