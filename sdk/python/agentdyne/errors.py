"""
errors.py — AgentDyne Python SDK exception hierarchy.

All exceptions inherit from AgentDyneError, enabling broad catches
alongside specific handling for common failure modes.

Usage::

    from agentdyne import AgentDyne
    from agentdyne.errors import QuotaExceededError, RateLimitError
    import time

    client = AgentDyne(api_key="agd_...")
    try:
        result = client.execute("agent_id", "Hello")
    except QuotaExceededError:
        print("Upgrade at agentdyne.com/billing")
    except RateLimitError as e:
        time.sleep(e.retry_after_seconds)
"""

from __future__ import annotations
from typing import Any, Dict, Optional


class AgentDyneError(Exception):
    """Base class for all AgentDyne SDK errors."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        code: Optional[str] = None,
        raw: Optional[Any] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.raw = raw

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"message={str(self)!r}, "
            f"status_code={self.status_code!r}, "
            f"code={self.code!r})"
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": self.__class__.__name__,
            "message": str(self),
            "status_code": self.status_code,
            "code": self.code,
        }


# ---------------------------------------------------------------------------
# Authentication & authorisation
# ---------------------------------------------------------------------------


class AuthenticationError(AgentDyneError):
    """API key is missing, invalid, or revoked (HTTP 401)."""

    def __init__(self, message: str = "Invalid or missing API key", raw: Any = None) -> None:
        super().__init__(message, status_code=401, code="AUTHENTICATION_ERROR", raw=raw)


class PermissionDeniedError(AgentDyneError):
    """Authenticated user lacks permission for the operation (HTTP 403)."""

    def __init__(self, message: str = "Permission denied", raw: Any = None) -> None:
        super().__init__(message, status_code=403, code="PERMISSION_DENIED", raw=raw)


class SubscriptionRequiredError(AgentDyneError):
    """Agent requires an active subscription (HTTP 403 / SUBSCRIPTION_REQUIRED)."""

    def __init__(self, agent_id: Optional[str] = None, raw: Any = None) -> None:
        msg = (
            f'Agent "{agent_id}" requires an active subscription'
            if agent_id
            else "An active subscription is required"
        )
        super().__init__(msg, status_code=403, code="SUBSCRIPTION_REQUIRED", raw=raw)
        self.agent_id = agent_id


# ---------------------------------------------------------------------------
# Resource errors
# ---------------------------------------------------------------------------


class NotFoundError(AgentDyneError):
    """Requested resource does not exist (HTTP 404)."""

    def __init__(
        self,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        raw: Any = None,
    ) -> None:
        what = resource_type or "Resource"
        if resource_id:
            what = f'{what} "{resource_id}"'
        super().__init__(f"{what} not found", status_code=404, code="NOT_FOUND", raw=raw)
        self.resource_type = resource_type
        self.resource_id = resource_id


class ValidationError(AgentDyneError):
    """Malformed request or missing required fields (HTTP 400)."""

    def __init__(
        self,
        message: str,
        fields: Optional[Dict[str, str]] = None,
        raw: Any = None,
    ) -> None:
        super().__init__(message, status_code=400, code="VALIDATION_ERROR", raw=raw)
        self.fields = fields or {}


# ---------------------------------------------------------------------------
# Rate limiting & quotas
# ---------------------------------------------------------------------------


class RateLimitError(AgentDyneError):
    """Per-minute API rate limit exceeded (HTTP 429)."""

    def __init__(self, retry_after_seconds: float = 60.0, raw: Any = None) -> None:
        super().__init__(
            f"Rate limit exceeded. Retry after {retry_after_seconds:.0f}s",
            status_code=429,
            code="RATE_LIMIT_EXCEEDED",
            raw=raw,
        )
        self.retry_after_seconds = retry_after_seconds


class QuotaExceededError(AgentDyneError):
    """Monthly execution quota exhausted (HTTP 429 / QUOTA_EXCEEDED)."""

    def __init__(self, plan: Optional[str] = None, raw: Any = None) -> None:
        msg = (
            f'Monthly quota exceeded on the "{plan}" plan. Please upgrade.'
            if plan
            else "Monthly execution quota exceeded. Please upgrade."
        )
        super().__init__(msg, status_code=429, code="QUOTA_EXCEEDED", raw=raw)
        self.plan = plan


# ---------------------------------------------------------------------------
# Network & server errors
# ---------------------------------------------------------------------------


class ExecutionTimeoutError(AgentDyneError):
    """Agent execution exceeded its configured timeout."""

    def __init__(self, execution_id: Optional[str] = None, raw: Any = None) -> None:
        msg = f'Execution "{execution_id}" timed out' if execution_id else "Execution timed out"
        super().__init__(msg, status_code=408, code="EXECUTION_TIMEOUT", raw=raw)
        self.execution_id = execution_id


class InternalServerError(AgentDyneError):
    """Unrecoverable 5xx response from the AgentDyne API."""

    def __init__(self, message: str = "Internal server error", raw: Any = None) -> None:
        super().__init__(message, status_code=500, code="INTERNAL_SERVER_ERROR", raw=raw)


class NetworkError(AgentDyneError):
    """Network-level failure (no connectivity, DNS, TLS error)."""

    def __init__(self, message: str, cause: Optional[Exception] = None) -> None:
        super().__init__(message, code="NETWORK_ERROR")
        self.__cause__ = cause


class RequestTimeoutError(AgentDyneError):
    """Client-side request timeout exceeded."""

    def __init__(self, timeout_seconds: float) -> None:
        super().__init__(
            f"Request timed out after {timeout_seconds:.0f}s",
            code="REQUEST_TIMEOUT",
        )
        self.timeout_seconds = timeout_seconds


# ---------------------------------------------------------------------------
# Webhook errors
# ---------------------------------------------------------------------------


class WebhookSignatureError(AgentDyneError):
    """Webhook HMAC-SHA256 signature verification failed."""

    def __init__(self, message: str = "Webhook signature verification failed") -> None:
        super().__init__(message, code="WEBHOOK_SIGNATURE_INVALID")
