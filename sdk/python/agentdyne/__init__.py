"""
agentdyne — Python SDK for the AgentDyne platform.

Quick start::

    from agentdyne import AgentDyne

    client = AgentDyne(api_key="agd_...")
    result = client.execute("agent-id", "Summarize this: ...")
    print(result.output)

Streaming::

    for chunk in client.stream("agent-id", "Write a blog post about AI"):
        if chunk.type == "token" and chunk.delta:
            print(chunk.delta, end="", flush=True)

Async::

    from agentdyne import AsyncAgentDyne
    async with AsyncAgentDyne(api_key="agd_...") as client:
        result = await client.execute("agent-id", "Hello!")
"""

from .client import AgentDyne, AsyncAgentDyne
from .errors import (
    AgentDyneError,
    AuthenticationError,
    NotFoundError,
    QuotaExceededError,
    RateLimitError,
    ServerError,
    ValidationError,
    WebhookSignatureError,
)
from .types import (
    Agent,
    Execution,
    ExecuteResponse,
    Notification,
    Page,
    PaginationMeta,
    Review,
    StreamChunk,
    UserProfile,
    UserQuota,
    WebhookEvent,
)

__version__ = "2.0.0"
__all__ = [
    # Clients
    "AgentDyne",
    "AsyncAgentDyne",
    # Types
    "Agent",
    "Execution",
    "ExecuteResponse",
    "Notification",
    "Page",
    "PaginationMeta",
    "Review",
    "StreamChunk",
    "UserProfile",
    "UserQuota",
    "WebhookEvent",
    # Errors
    "AgentDyneError",
    "AuthenticationError",
    "NotFoundError",
    "QuotaExceededError",
    "RateLimitError",
    "ServerError",
    "ValidationError",
    "WebhookSignatureError",
]
