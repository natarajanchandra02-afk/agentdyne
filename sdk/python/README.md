# agentdyne

Official Python SDK for [AgentDyne](https://agentdyne.com) — The Global Microagent Marketplace.

[![PyPI version](https://img.shields.io/pypi/v/agentdyne.svg)](https://pypi.org/project/agentdyne/)
[![Python](https://img.shields.io/pypi/pyversions/agentdyne.svg)](https://pypi.org/project/agentdyne/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Installation

```bash
pip install agentdyne

# With async support (adds httpx)
pip install agentdyne[async]
```

## Quick Start

```python
from agentdyne import AgentDyne

client = AgentDyne(api_key="agd_your_key_here")

# Execute an agent
result = client.execute("agent_id", "Summarize this email thread...")
print(result.output)
# → {'summary': '...', 'action_items': [...], 'urgency': 'high'}

# Stream output token-by-token
for chunk in client.stream("agent_id", "Explain quantum computing"):
    if chunk.type == "delta" and chunk.delta:
        print(chunk.delta, end="", flush=True)
```

## Authentication

```bash
export AGENTDYNE_API_KEY=agd_your_key_here
```

```python
# From environment (recommended)
client = AgentDyne()

# Or pass directly
client = AgentDyne(api_key="agd_your_key_here")
```

## Usage

### Agents

```python
# List with filters
page = client.list_agents(category="coding", sort="rating", limit=10)
for agent in page.data:
    print(agent.name, agent.average_rating, agent.pricing_model)

print(f"Total: {page.pagination.total}")

# Get single agent
agent = client.get_agent("agent_id")

# Search
results = client.search_agents("email summarizer")

# Iterate ALL agents automatically
for agent in client.paginate_agents(category="finance"):
    print(agent.name)
```

### Execute Agents

```python
import uuid

# Synchronous execution
result = client.execute(
    "code-review-agent",
    {"code": "def add(a, b):\n    return a + b", "language": "python"},
    idempotency_key=str(uuid.uuid4()),  # Safe to retry
)
print(result.output)
print(f"Latency: {result.latency_ms}ms  Cost: ${result.cost:.6f}")

# Streaming
for chunk in client.stream("content-writer", "Write a product description for AirPods"):
    if chunk.type == "delta" and chunk.delta:
        print(chunk.delta, end="", flush=True)
    elif chunk.type == "done":
        print()  # newline
```

### Executions

```python
# Get single execution
execution = client.get_execution("exec_id")
print(execution.status, execution.output)

# List history
page = client.list_executions(status="failed", limit=20)

# Poll until terminal
result = client.poll_execution("exec_id", interval_seconds=0.5, timeout_seconds=60)
```

### User & Quota

```python
me = client.me()
print(me.subscription_plan)  # "pro"
print(me.full_name)

quota = client.my_quota()
print(f"{quota.used}/{quota.quota} calls ({quota.percent_used:.1f}%)")
print(f"Resets: {quota.resets_at}")

# Update profile
client.update_profile(full_name="Ada Lovelace", bio="AI researcher")
```

### Reviews

```python
# List reviews
page = client.list_reviews("agent_id")
for review in page.data:
    print(f"★{review.rating} — {review.title}")

# Post a review
review = client.create_review(
    "agent_id",
    rating=5,
    title="Incredible",
    body="Handles every edge case perfectly.",
)
```

### Webhooks

```python
from agentdyne import AgentDyne, WebhookSignatureError

client = AgentDyne()

# Flask example
from flask import Flask, request

app = Flask(__name__)

@app.route("/webhook", methods=["POST"])
def webhook():
    payload   = request.get_data(as_text=True)
    signature = request.headers.get("X-AgentDyne-Signature", "")
    try:
        event = client.construct_webhook_event(
            payload, signature, "your_webhook_secret"
        )
    except WebhookSignatureError:
        return "Invalid signature", 400

    if event.type == "execution.completed":
        print("Execution done:", event.data)
    elif event.type == "payout.processed":
        print("Payout:", event.data)

    return "OK"
```

## Async Usage

```python
import asyncio
from agentdyne import AsyncAgentDyne

async def main():
    async with AsyncAgentDyne(api_key="agd_...") as client:
        # Execute
        result = await client.execute("agent_id", "Hello!")
        print(result.output)

        # Stream
        async for chunk in client.stream("agent_id", "Write a poem"):
            if chunk.type == "delta" and chunk.delta:
                print(chunk.delta, end="", flush=True)

asyncio.run(main())
```

## Error Handling

```python
from agentdyne.errors import (
    AgentDyneError,
    AuthenticationError,
    QuotaExceededError,
    RateLimitError,
    NotFoundError,
    SubscriptionRequiredError,
)
import time

try:
    result = client.execute("agent_id", "Hello")
except QuotaExceededError:
    print("Upgrade at agentdyne.com/billing")
except RateLimitError as e:
    time.sleep(e.retry_after_seconds)
except SubscriptionRequiredError as e:
    print(f"Subscribe to use agent: {e.agent_id}")
except NotFoundError:
    print("Agent not found")
except AuthenticationError:
    print("Check your API key")
except AgentDyneError as e:
    print(f"Error: {e} (HTTP {e.status_code}, code={e.code})")
```

## Requirements

- Python 3.9+
- No required dependencies for the sync client
- `httpx>=0.27` for the async client (`pip install agentdyne[async]`)

## License

MIT © 2026 AgentDyne, Inc.
