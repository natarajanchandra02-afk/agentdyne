"""
agentdyne — Official Python SDK for AgentDyne.

Quick start::

    from agentdyne import AgentDyne

    client = AgentDyne(api_key="agd_...")
    result = client.execute("agent_id", "Summarize this email...")
    print(result.output)
"""

from .client import AgentDyne, AsyncAgentDyne
from .errors import (
    AgentDyneError,
    AuthenticationError,
    ExecutionTimeoutError,
    InternalServerError,
    NetworkError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExceededError,
    RateLimitError,
    RequestTimeoutError,
    SubscriptionRequiredError,
    ValidationError,
    WebhookSignatureError,
)
from .types import (
    Agent,
    Execution,
    ExecuteResponse,
    Notification,
    Page,
    Pagination,
    Review,
    SellerProfile,
    StreamChunk,
    Tokens,
    UserProfile,
    UserQuota,
    WebhookEvent,
)

__version__ = "1.0.0"
__all__ = [
    # Clients
    "AgentDyne",
    "AsyncAgentDyne",
    # Errors
    "AgentDyneError",
    "AuthenticationError",
    "ExecutionTimeoutError",
    "InternalServerError",
    "NetworkError",
    "NotFoundError",
    "PermissionDeniedError",
    "QuotaExceededError",
    "RateLimitError",
    "RequestTimeoutError",
    "SubscriptionRequiredError",
    "ValidationError",
    "WebhookSignatureError",
    # Types
    "Agent",
    "Execution",
    "ExecuteResponse",
    "Notification",
    "Page",
    "Pagination",
    "Review",
    "SellerProfile",
    "StreamChunk",
    "Tokens",
    "UserProfile",
    "UserQuota",
    "WebhookEvent",
]
