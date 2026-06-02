"""
errors.py — Exception hierarchy for the AgentDyne Python SDK.
"""

from __future__ import annotations
from typing import Optional


class AgentDyneError(Exception):
    """Base exception for all AgentDyne SDK errors."""
    def __init__(self, message: str = "", status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.message     = message
        self.status_code = status_code

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(message={self.message!r}, status_code={self.status_code})"


class AuthenticationError(AgentDyneError):
    """Raised when the API key is invalid or missing (HTTP 401)."""
    def __init__(self, message: str = "Invalid or missing API key") -> None:
        super().__init__(message, status_code=401)


class NotFoundError(AgentDyneError):
    """Raised when a resource is not found (HTTP 404)."""
    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message, status_code=404)


class ValidationError(AgentDyneError):
    """Raised when request validation fails (HTTP 422)."""
    def __init__(self, message: str = "Validation error") -> None:
        super().__init__(message, status_code=422)


class RateLimitError(AgentDyneError):
    """Raised when rate limit is exceeded (HTTP 429). Check retry_after."""
    def __init__(self, message: str = "Rate limit exceeded", retry_after: Optional[int] = None) -> None:
        super().__init__(message, status_code=429)
        self.retry_after = retry_after


class QuotaExceededError(AgentDyneError):
    """Raised when monthly execution quota is exceeded (HTTP 402)."""
    def __init__(self, message: str = "Execution quota exceeded. Upgrade your plan.") -> None:
        super().__init__(message, status_code=402)


class ServerError(AgentDyneError):
    """Raised on 5xx server errors."""
    def __init__(self, message: str = "Server error", status_code: int = 500) -> None:
        super().__init__(message, status_code=status_code)


class WebhookSignatureError(AgentDyneError):
    """Raised when webhook HMAC-SHA256 signature verification fails."""
    def __init__(self, message: str = "Webhook signature verification failed") -> None:
        super().__init__(message)
