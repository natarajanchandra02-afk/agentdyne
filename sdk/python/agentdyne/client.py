"""
client.py — Main AgentDyne Python client.

Provides both synchronous (AgentDyne) and async (AsyncAgentDyne) clients.
The sync client has zero required dependencies (pure stdlib).
The async client requires: pip install agentdyne[async]

Usage (sync)::

    from agentdyne import AgentDyne

    client = AgentDyne(api_key="agd_...")
    result = client.execute("agent_id", "Summarize this email...")
    print(result.output)

Usage (async)::

    from agentdyne import AsyncAgentDyne
    import asyncio

    async def main():
        async with AsyncAgentDyne(api_key="agd_...") as client:
            result = await client.execute("agent_id", "Hello!")
            print(result.output)

    asyncio.run(main())
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict, Generator, Iterator, List, Optional

from .errors import (
    AgentDyneError,
    QuotaExceededError,
    RateLimitError,
    WebhookSignatureError,
)
from .http import AsyncHttpClient, HttpClient
from .types import (
    Agent,
    Execution,
    ExecuteResponse,
    Notification,
    Page,
    Review,
    StreamChunk,
    UserProfile,
    UserQuota,
    WebhookEvent,
)

_TERMINAL_STATUSES = {"success", "failed", "timeout"}


# ---------------------------------------------------------------------------
# Synchronous Client
# ---------------------------------------------------------------------------


class AgentDyne:
    """
    Synchronous AgentDyne client.

    Zero required dependencies — uses Python's built-in urllib.

    Parameters
    ----------
    api_key:
        Your AgentDyne API key (starts with ``agd_``).
        Falls back to the ``AGENTDYNE_API_KEY`` environment variable.
    base_url:
        Override for local development (default: ``https://api.agentdyne.com``).
    max_retries:
        Number of retries on 429/5xx responses (default: 3).
    timeout:
        Request timeout in seconds (default: 60).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.agentdyne.com",
        max_retries: int = 3,
        timeout: float = 60.0,
    ) -> None:
        resolved_key = api_key or os.environ.get("AGENTDYNE_API_KEY")
        if not resolved_key:
            raise ValueError(
                "AgentDyne API key is required. "
                "Pass api_key= or set the AGENTDYNE_API_KEY environment variable."
            )
        self._http = HttpClient(
            api_key=resolved_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )

    # ── Agents ──────────────────────────────────────────────────────────────

    def list_agents(
        self,
        *,
        q: Optional[str] = None,
        category: Optional[str] = None,
        pricing: Optional[str] = None,
        sort: Optional[str] = None,
        page: int = 1,
        limit: int = 24,
    ) -> Page:
        """
        List agents with optional filters.

        Returns a :class:`Page` with ``.data`` (list of :class:`Agent`) and
        ``.pagination``.

        Example::

            page = client.list_agents(category="coding", sort="rating")
            for agent in page.data:
                print(agent.name, agent.average_rating)
        """
        params: Dict[str, Any] = {"page": page, "limit": limit}
        if q:        params["q"] = q
        if category: params["category"] = category
        if pricing:  params["pricing"] = pricing
        if sort:     params["sort"] = sort

        raw = self._http.get("/v1/agents", params)
        return Page.from_dict(raw, Agent)

    def get_agent(self, agent_id: str) -> Agent:
        """
        Retrieve a single agent by ID.

        Example::

            agent = client.get_agent("agent_id")
            print(agent.name, agent.pricing_model)
        """
        raw = self._http.get(f"/v1/agents/{agent_id}")
        return Agent.from_dict(raw)

    def search_agents(self, query: str, **kwargs: Any) -> Page:
        """
        Search agents by keyword.

        Example::

            results = client.search_agents("email summarizer")
        """
        return self.list_agents(q=query, **kwargs)

    def paginate_agents(self, **kwargs: Any) -> Iterator[Agent]:
        """
        Iterate through ALL matching agents across pages automatically.

        Example::

            for agent in client.paginate_agents(category="finance"):
                print(agent.name)
        """
        page_num = 1
        while True:
            page = self.list_agents(page=page_num, **kwargs)
            yield from page.data
            if not page.pagination.has_next:
                break
            page_num += 1

    # ── Execution ────────────────────────────────────────────────────────────

    def execute(
        self,
        agent_id: str,
        input: Any,  # noqa: A002
        *,
        idempotency_key: Optional[str] = None,
    ) -> ExecuteResponse:
        """
        Execute an agent and return its full output.

        Parameters
        ----------
        agent_id:
            The agent to run.
        input:
            Input string or JSON-serialisable dict/list.
        idempotency_key:
            Optional UUID — safe to retry on network failure.

        Example::

            result = client.execute("email-summarizer-pro", "Hi team, the Q4 report...")
            print(result.output)
            print(f"Latency: {result.latency_ms}ms  Cost: ${result.cost:.6f}")
        """
        body: Dict[str, Any] = {"input": input}
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        raw = self._http.post(f"/v1/agents/{agent_id}/execute", body)
        return ExecuteResponse.from_dict(raw)

    def stream(
        self,
        agent_id: str,
        input: Any,  # noqa: A002
    ) -> Iterator[StreamChunk]:
        """
        Stream an agent's output token-by-token.

        Yields :class:`StreamChunk` objects.  ``type == "delta"`` carries
        incremental text; ``type == "done"`` signals completion.

        Example::

            for chunk in client.stream("content-writer", "Write a haiku about AI"):
                if chunk.type == "delta" and chunk.delta:
                    print(chunk.delta, end="", flush=True)
        """
        for raw_line in self._http.stream(
            f"/v1/agents/{agent_id}/execute",
            {"input": input, "stream": True},
        ):
            try:
                data = json.loads(raw_line)
                chunk = StreamChunk(
                    type=data.get("type", "delta"),
                    delta=data.get("delta"),
                    execution_id=data.get("executionId"),
                    error=data.get("error"),
                )
            except (json.JSONDecodeError, KeyError):
                chunk = StreamChunk(type="delta", delta=raw_line)
            yield chunk
            if chunk.type == "done":
                return

    # ── Executions ───────────────────────────────────────────────────────────

    def get_execution(self, execution_id: str) -> Execution:
        """Retrieve a single execution by ID."""
        raw = self._http.get(f"/v1/executions/{execution_id}")
        return Execution.from_dict(raw)

    def list_executions(
        self,
        *,
        agent_id: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
    ) -> Page:
        """List your execution history."""
        params: Dict[str, Any] = {"page": page, "limit": limit}
        if agent_id: params["agentId"] = agent_id
        if status:   params["status"] = status
        raw = self._http.get("/v1/executions", params)
        return Page.from_dict(raw, Execution)

    def poll_execution(
        self,
        execution_id: str,
        *,
        interval_seconds: float = 1.0,
        timeout_seconds: float = 120.0,
    ) -> Execution:
        """
        Poll until an execution reaches a terminal state.

        Example::

            execution = client.poll_execution("exec_id", interval_seconds=0.5)
            print(execution.status, execution.output)
        """
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            ex = self.get_execution(execution_id)
            if ex.status in _TERMINAL_STATUSES:
                return ex
            time.sleep(interval_seconds)
        raise AgentDyneError(
            f'Execution "{execution_id}" did not complete within {timeout_seconds}s'
        )

    # ── User ────────────────────────────────────────────────────────────────

    def me(self) -> UserProfile:
        """Return the authenticated user's profile."""
        raw = self._http.get("/v1/user/me")
        return UserProfile.from_dict(raw)

    def my_quota(self) -> UserQuota:
        """Return quota usage for the current billing period."""
        raw = self._http.get("/v1/user/quota")
        return UserQuota.from_dict(raw)

    def update_profile(self, **updates: Any) -> UserProfile:
        """Update your profile (full_name, bio, website, company)."""
        raw = self._http.patch("/v1/user/me", updates)
        return UserProfile.from_dict(raw)

    # ── Reviews ──────────────────────────────────────────────────────────────

    def list_reviews(self, agent_id: str, *, page: int = 1, limit: int = 20) -> Page:
        """List approved reviews for an agent."""
        raw = self._http.get(
            f"/v1/agents/{agent_id}/reviews",
            {"page": page, "limit": limit},
        )
        return Page.from_dict(raw, Review)

    def create_review(
        self,
        agent_id: str,
        *,
        rating: int,
        title: Optional[str] = None,
        body: Optional[str] = None,
    ) -> Review:
        """Post a review for an agent you've used."""
        payload: Dict[str, Any] = {"rating": rating}
        if title: payload["title"] = title
        if body:  payload["body"]  = body
        raw = self._http.post(f"/v1/agents/{agent_id}/reviews", payload)
        return Review.from_dict(raw)

    # ── Notifications ────────────────────────────────────────────────────────

    def list_notifications(self) -> List[Notification]:
        """Return your notifications."""
        raw = self._http.get("/v1/notifications")
        return [Notification.from_dict(n) for n in raw.get("notifications", [])]

    def mark_notifications_read(self) -> bool:
        """Mark all notifications as read."""
        raw = self._http.patch("/v1/notifications")
        return raw.get("ok", False)

    # ── Webhooks ─────────────────────────────────────────────────────────────

    def construct_webhook_event(
        self,
        payload: str | bytes,
        signature: str,
        secret: str,
    ) -> WebhookEvent:
        """
        Verify and parse an incoming AgentDyne webhook.

        Raises :class:`WebhookSignatureError` if the signature is invalid.

        Example (Flask)::

            @app.route("/webhook", methods=["POST"])
            def webhook():
                payload   = request.get_data(as_text=True)
                signature = request.headers.get("X-AgentDyne-Signature", "")
                try:
                    event = client.construct_webhook_event(payload, signature, SECRET)
                except WebhookSignatureError:
                    return "Invalid signature", 400
                if event.type == "execution.completed":
                    ...
                return "OK"
        """
        if isinstance(payload, str):
            payload_bytes = payload.encode("utf-8")
        else:
            payload_bytes = payload

        sig_clean = signature.replace("sha256=", "")
        expected  = hmac.new(
            secret.encode("utf-8"), payload_bytes, hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(expected, sig_clean):
            raise WebhookSignatureError()

        try:
            data = json.loads(payload_bytes)
        except json.JSONDecodeError:
            raise WebhookSignatureError("Webhook payload is not valid JSON")

        return WebhookEvent.from_dict(data)


# ---------------------------------------------------------------------------
# Async Client
# ---------------------------------------------------------------------------

_ASYNC_UNAVAILABLE_MSG = (
    "AsyncAgentDyne requires httpx. "
    "Install it with: pip install agentdyne[async]"
)


class AsyncAgentDyne:
    """
    Asynchronous AgentDyne client.

    Requires httpx: ``pip install agentdyne[async]``

    Use as an async context manager for automatic connection cleanup::

        async with AsyncAgentDyne(api_key="agd_...") as client:
            result = await client.execute("agent_id", "Hello!")
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.agentdyne.com",
        max_retries: int = 3,
        timeout: float = 60.0,
    ) -> None:
        if AsyncHttpClient is None:
            raise ImportError(_ASYNC_UNAVAILABLE_MSG)

        resolved_key = api_key or os.environ.get("AGENTDYNE_API_KEY")
        if not resolved_key:
            raise ValueError(
                "AgentDyne API key is required. "
                "Pass api_key= or set the AGENTDYNE_API_KEY environment variable."
            )
        self._http = AsyncHttpClient(
            api_key=resolved_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )

    async def list_agents(self, *, q=None, category=None, pricing=None, sort=None, page=1, limit=24) -> Page:
        params: Dict[str, Any] = {"page": page, "limit": limit}
        if q:        params["q"] = q
        if category: params["category"] = category
        if pricing:  params["pricing"] = pricing
        if sort:     params["sort"] = sort
        raw = await self._http.get("/v1/agents", params)
        return Page.from_dict(raw, Agent)

    async def get_agent(self, agent_id: str) -> Agent:
        return Agent.from_dict(await self._http.get(f"/v1/agents/{agent_id}"))

    async def execute(self, agent_id: str, input: Any, *, idempotency_key: Optional[str] = None) -> ExecuteResponse:
        body: Dict[str, Any] = {"input": input}
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        raw = await self._http.post(f"/v1/agents/{agent_id}/execute", body)
        return ExecuteResponse.from_dict(raw)

    async def stream(self, agent_id: str, input: Any):  # noqa: A002
        async for raw_line in self._http.stream(
            f"/v1/agents/{agent_id}/execute", {"input": input, "stream": True}
        ):
            try:
                data = json.loads(raw_line)
                chunk = StreamChunk(
                    type=data.get("type", "delta"),
                    delta=data.get("delta"),
                    execution_id=data.get("executionId"),
                    error=data.get("error"),
                )
            except (json.JSONDecodeError, KeyError):
                chunk = StreamChunk(type="delta", delta=raw_line)
            yield chunk
            if chunk.type == "done":
                return

    async def me(self) -> UserProfile:
        return UserProfile.from_dict(await self._http.get("/v1/user/me"))

    async def my_quota(self) -> UserQuota:
        return UserQuota.from_dict(await self._http.get("/v1/user/quota"))

    async def get_execution(self, execution_id: str) -> Execution:
        return Execution.from_dict(await self._http.get(f"/v1/executions/{execution_id}"))

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "AsyncAgentDyne":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()
