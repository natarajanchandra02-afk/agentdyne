"""
client.py — AgentDyne Python SDK v2.0.0

Fully-featured sync and async clients.

Usage (sync)::

    from agentdyne import AgentDyne

    client = AgentDyne(api_key="agd_...")

    # Execute
    result = client.execute("agent-id", "Summarise this email...")
    print(result.output, result.cost)

    # Stream token-by-token
    for chunk in client.stream("agent-id", "Write a blog post about AI"):
        if chunk.type == "token" and chunk.delta:
            print(chunk.delta, end="", flush=True)

    # Multi-agent swarm
    session = client.swarm(
        task="Research the top 5 AI frameworks",
        agent_ids=["agent-a", "agent-b"],
        mode="orchestrate",
    )
    print(session["finalAnswer"])

Usage (async)::

    import asyncio
    from agentdyne import AsyncAgentDyne

    async def main():
        async with AsyncAgentDyne(api_key="agd_...") as client:
            result = await client.execute("agent-id", "Hello!")
            print(result.output)

    asyncio.run(main())
"""

from __future__ import annotations

import json
import hmac
import hashlib
import time
from typing import Any, AsyncIterator, Dict, Generator, Iterator, List, Optional, Union

from .http   import HttpClient, AsyncHttpClient
from .errors import (
    AgentDyneError,
    AuthenticationError,
    QuotaExceededError,
    WebhookSignatureError,
)
from .types  import (
    Agent,
    Execution,
    ExecuteResponse,
    Notification,
    Page,
    StreamChunk,
    UserProfile,
    UserQuota,
    Review,
)

_DEFAULT_BASE_URL = "https://agentdyne.com"
_DEFAULT_TIMEOUT  = 60.0
_DEFAULT_RETRIES  = 2


# ─── Sync Client ──────────────────────────────────────────────────────────────

class AgentDyne:
    """
    Synchronous AgentDyne client.

    :param api_key:   Your AgentDyne API key (starts with ``agd_``).
                      Get yours at https://agentdyne.com/api-keys
    :param base_url:  Override the API base URL (default: https://agentdyne.com).
    :param timeout:   Request timeout in seconds (default: 60).
    :param max_retries: Max retries on transient errors (default: 2).
    """

    VERSION = "2.0.0"

    def __init__(
        self,
        *,
        api_key:     str,
        base_url:    str   = _DEFAULT_BASE_URL,
        timeout:     float = _DEFAULT_TIMEOUT,
        max_retries: int   = _DEFAULT_RETRIES,
    ) -> None:
        if not api_key or not api_key.strip():
            raise AuthenticationError(
                "api_key is required. Get yours at https://agentdyne.com/api-keys"
            )
        self._http = HttpClient(
            api_key     = api_key,
            base_url    = base_url,
            timeout     = timeout,
            max_retries = max_retries,
        )

    # ── Top-level shortcuts ────────────────────────────────────────────────────

    def execute(
        self,
        agent_id: str,
        input:    Union[str, Dict[str, Any]],
        *,
        idempotency_key:        Optional[str]  = None,
        enable_self_correction: bool           = True,
    ) -> ExecuteResponse:
        """
        Execute an agent and return the full response.

        :param agent_id:  UUID of the agent to run.
        :param input:     Text string or dict payload.
        :param idempotency_key: Deduplication key — same key returns cached result.
        :param enable_self_correction: Re-prompt if confidence below threshold.

        :returns: :class:`ExecuteResponse`

        :raises AuthenticationError: Invalid or missing API key.
        :raises QuotaExceededError:  Monthly or lifetime quota exhausted.
        :raises AgentDyneError:      Any other API error.

        Example::

            result = client.execute("agent-id", "What is 2 + 2?")
            print(result.output)          # "4"
            print(result.cost)            # 0.000021
            print(result.latency_ms)      # 840
        """
        body: Dict[str, Any] = {
            "agentId":               agent_id,
            "input":                 input,
            "enableSelfCorrection":  enable_self_correction,
        }
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key

        data = self._http.post("/api/execute", body)
        return ExecuteResponse.from_dict(data)

    def stream(
        self,
        agent_id: str,
        input:    Union[str, Dict[str, Any]],
        *,
        enable_self_correction: bool = True,
    ) -> Generator[StreamChunk, None, None]:
        """
        Stream an agent's output token-by-token via SSE.

        Yields :class:`StreamChunk` objects. Types:
          - ``token``      — delta text to append to your buffer.
          - ``start``      — execution started (contains ``executionId``).
          - ``correction`` — self-correction triggered (low confidence).
          - ``done``       — execution finished (contains cost, latencyMs, tokens).
          - ``error``      — execution failed.

        Example::

            buf = ""
            for chunk in client.stream("agent-id", "Write a haiku about AI"):
                if chunk.type == "token" and chunk.delta:
                    buf += chunk.delta
                    print(chunk.delta, end="", flush=True)
                elif chunk.type == "done":
                    print(f"\\nCost: ${chunk.metadata['cost']:.6f}")
        """
        body: Dict[str, Any] = {
            "agentId":              agent_id,
            "input":                input,
            "enableSelfCorrection": enable_self_correction,
        }
        for raw_line in self._http.stream("/api/execute/stream", body):
            try:
                if raw_line == "[DONE]":
                    return
                evt = json.loads(raw_line)
                t   = evt.get("type", "")

                if t == "token":
                    yield StreamChunk(type="token", delta=evt.get("token", ""))
                elif t == "start":
                    yield StreamChunk(
                        type         = "start",
                        execution_id = evt.get("executionId"),
                        metadata     = {"agentName": evt.get("agentName")},
                    )
                elif t == "correction":
                    yield StreamChunk(
                        type       = "correction",
                        confidence = evt.get("confidence"),
                        metadata   = {
                            "attempt": evt.get("attempt"),
                            "reason":  evt.get("reason"),
                        },
                    )
                elif t == "done":
                    yield StreamChunk(
                        type         = "done",
                        execution_id = evt.get("executionId"),
                        metadata     = {
                            "latencyMs":          evt.get("latencyMs"),
                            "cost":               evt.get("cost"),
                            "tokens":             evt.get("tokens"),
                            "correctionAttempts": evt.get("correctionAttempts"),
                            "model":              evt.get("model"),
                        },
                    )
                elif t == "error":
                    yield StreamChunk(
                        type  = "error",
                        error = evt.get("error", "Unknown error"),
                    )
                    return
            except json.JSONDecodeError:
                continue

    # ── Agents ─────────────────────────────────────────────────────────────────

    def get_agent(self, agent_id: str) -> Agent:
        """Fetch a single agent by UUID."""
        data = self._http.get(f"/api/agents/{agent_id}")
        return Agent.from_dict(data.get("agent") or data)

    def list_agents(
        self,
        *,
        category:  Optional[str] = None,
        query:     Optional[str] = None,
        page:      int           = 1,
        limit:     int           = 24,
        sort:      str           = "score",
    ) -> Page[Agent]:
        """Browse the marketplace or your own agents."""
        params: Dict[str, Any] = {
            "page": page, "limit": limit, "sort": sort,
        }
        if category: params["category"] = category
        if query:    params["q"]        = query
        data = self._http.get("/api/agents", params)
        return Page.from_dict(data, Agent)

    def create_agent(self, **kwargs: Any) -> Agent:
        """
        Create a new agent.

        Required fields: ``name``, ``system_prompt``.

        Example::

            agent = client.create_agent(
                name          = "Code Reviewer",
                system_prompt = "Review code for bugs and security issues.",
                model_name    = "claude-sonnet-4-6",
                description   = "Reviews Python and TypeScript code.",
                tags          = ["code", "review"],
                pricing_model = "free",
            )
        """
        data = self._http.post("/api/agents", kwargs)
        return Agent.from_dict(data.get("agent") or data)

    def update_agent(self, agent_id: str, **kwargs: Any) -> Agent:
        """Update an existing agent."""
        data = self._http.patch(f"/api/agents/{agent_id}", kwargs)
        return Agent.from_dict(data.get("agent") or data)

    def delete_agent(self, agent_id: str) -> None:
        """Permanently delete an agent."""
        self._http.delete(f"/api/agents/{agent_id}")

    def get_embed_code(
        self,
        agent_id: str,
        *,
        theme:         str = "light",
        position:      str = "bottom-right",
        primary_color: str = "#6366f1",
        domain:        str = "*",
        placeholder:   Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate embed code for deploying an agent as a chat widget.

        Returns a dict with ``scriptTag``, ``iframeTag``, ``previewUrl``.

        Example::

            embed = client.get_embed_code(
                "agent-id",
                theme    = "dark",
                position = "bottom-left",
            )
            print(embed["scriptTag"])
        """
        body: Dict[str, Any] = {
            "theme":        theme,
            "position":     position,
            "primaryColor": primary_color,
            "domain":       domain,
        }
        if placeholder:
            body["placeholder"] = placeholder
        return self._http.post(f"/api/agents/{agent_id}/embed", body)

    # ── Executions ─────────────────────────────────────────────────────────────

    def get_execution(self, execution_id: str) -> Execution:
        """Fetch a single execution record."""
        data = self._http.get(f"/api/executions/{execution_id}")
        return Execution.from_dict(data.get("execution") or data)

    def list_executions(
        self,
        *,
        agent_id: Optional[str] = None,
        status:   Optional[str] = None,
        page:     int           = 1,
        limit:    int           = 20,
    ) -> Page[Execution]:
        """List execution history."""
        params: Dict[str, Any] = {"page": page, "limit": limit}
        if agent_id: params["agentId"] = agent_id
        if status:   params["status"]  = status
        data = self._http.get("/api/executions", params)
        return Page.from_dict(data, Execution)

    # ── Pipelines ──────────────────────────────────────────────────────────────

    def run_pipeline(
        self,
        pipeline_id: str,
        input:       Union[str, Dict[str, Any]] = "",
        *,
        variables: Optional[Dict[str, str]] = None,
        state:     Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Execute a pipeline and return all node results.

        Supports parallel DAG execution — nodes at the same level
        run concurrently.

        Example::

            result = client.run_pipeline(
                "pipeline-id",
                "Analyse this market data and write a report",
                variables={"region": "APAC"},
            )
            print(result["output"])
            print(result["summary"]["total_cost_usd"])
        """
        body: Dict[str, Any] = {"input": input}
        if variables: body["variables"] = variables
        if state:     body["state"]     = state
        return self._http.post(f"/api/pipelines/{pipeline_id}/execute", body)

    def optimize_pipeline(self, pipeline_id: str) -> Dict[str, Any]:
        """
        Analyse a pipeline's execution history and surface optimisation
        recommendations: slow nodes, expensive nodes, recommended step reduction.

        Example::

            opt = client.optimize_pipeline("pipeline-id")
            print(opt["recommendation"]["headline"])
            # "Recommended: 5 Steps / -32% Cost / -41% Latency"
        """
        return self._http.get(f"/api/pipelines/{pipeline_id}/optimize")

    def apply_pipeline_optimization(self, pipeline_id: str) -> Dict[str, Any]:
        """Fork the pipeline with problem nodes removed (applies optimisation)."""
        return self._http.post(f"/api/pipelines/{pipeline_id}/optimize", {})

    # ── Multi-agent swarm ──────────────────────────────────────────────────────

    def swarm(
        self,
        *,
        task:       str,
        agent_ids:  List[str],
        name:       Optional[str] = None,
        mode:       str           = "orchestrate",
        max_rounds: int           = 2,
    ) -> Dict[str, Any]:
        """
        Launch a multi-agent swarm session.

        :param task:       The task all agents work on.
        :param agent_ids:  List of 2–8 active agent UUIDs.
        :param mode:       ``orchestrate`` | ``debate`` | ``parallel``.
        :param max_rounds: Rounds for debate mode (1–5).

        Requires Starter plan or above.

        Example::

            session = client.swarm(
                task       = "Research AI agent frameworks and write a comparison",
                agent_ids  = ["researcher-id", "writer-id", "critic-id"],
                mode       = "orchestrate",
            )
            print(session["finalAnswer"])
        """
        body: Dict[str, Any] = {
            "task":       task,
            "agentIds":   agent_ids,
            "mode":       mode,
            "maxRounds":  max_rounds,
        }
        if name:
            body["name"] = name
        return self._http.post("/api/swarm", body)

    # ── Agent self-improvement ─────────────────────────────────────────────────

    def suggest_improvements(self, agent_id: str) -> Dict[str, Any]:
        """
        Ask the AI to analyse this agent and suggest improvements.

        Returns a headline like ``"Score: 84 → Est. 91 (+7.1 Reliability, -12% Cost)"``
        plus a list of specific suggested changes.

        Example::

            suggestion = client.suggest_improvements("agent-id")
            print(suggestion["suggested"]["headline"])
            # "Score: 84 → Est. 91 (+7.1 Reliability, -12% Cost)"
            for imp in suggestion["improvements"]:
                print("-", imp)
        """
        return self._http.post(f"/api/agents/{agent_id}/versions", {"action": "suggest"})

    def apply_improvement(self, agent_id: str, version_id: str) -> Dict[str, Any]:
        """Apply an AI-suggested improvement version to the live agent."""
        return self._http.post(
            f"/api/agents/{agent_id}/versions",
            {"action": "apply", "versionId": version_id},
        )

    def list_versions(self, agent_id: str) -> List[Dict[str, Any]]:
        """List all version snapshots for an agent."""
        data = self._http.get(f"/api/agents/{agent_id}/versions")
        return data.get("versions", [])

    # ── Browser agents ─────────────────────────────────────────────────────────

    def run_browser_agent(
        self,
        agent_id:  str,
        task:      str,
        *,
        target_url:     Optional[str]              = None,
        extract_schema: Optional[Dict[str, str]]   = None,
    ) -> Dict[str, Any]:
        """
        Execute a browser agent (computer-use) that can navigate websites,
        fill forms, and extract structured data.

        Requires Pro plan. The agent must have ``agent_type = "browser"``.

        Example::

            result = client.run_browser_agent(
                "browser-agent-id",
                "Extract all product names and prices",
                target_url     = "https://example.com/products",
                extract_schema = {"name": "string", "price": "number"},
            )
            print(result["result"])
            print(f"Completed in {result['steps']} steps")
        """
        body: Dict[str, Any] = {"agentId": agent_id, "task": task}
        if target_url:     body["targetUrl"]     = target_url
        if extract_schema: body["extractSchema"] = extract_schema
        return self._http.post("/api/execute/browser", body)

    # ── Notifications ──────────────────────────────────────────────────────────

    def list_notifications(
        self,
        *,
        unread_only: bool = False,
        limit:       int  = 20,
    ) -> List[Notification]:
        """List account notifications."""
        params: Dict[str, Any] = {"limit": limit}
        if unread_only:
            params["unread"] = "1"
        data = self._http.get("/api/notifications", params)
        return [Notification.from_dict(n) for n in (data.get("notifications") or [])]

    def mark_all_notifications_read(self) -> None:
        """Mark all notifications as read."""
        self._http.patch("/api/notifications")

    # ── User + quota ───────────────────────────────────────────────────────────

    def get_profile(self) -> UserProfile:
        """Fetch the authenticated user's profile."""
        data = self._http.get("/api/user/profile")
        return UserProfile.from_dict(data)

    def get_quota(self) -> UserQuota:
        """Fetch current quota usage and limits."""
        data = self._http.get("/api/user/quota")
        return UserQuota.from_dict(data)

    # ── Reviews ────────────────────────────────────────────────────────────────

    def submit_review(
        self,
        agent_id: str,
        *,
        rating: int,
        title:  Optional[str] = None,
        body:   Optional[str] = None,
    ) -> Review:
        """
        Submit a 1–5 star review for an agent.

        Example::

            review = client.submit_review(
                "agent-id",
                rating = 5,
                title  = "Excellent code reviewer",
                body   = "Caught 3 bugs in my first run.",
            )
        """
        payload: Dict[str, Any] = {"rating": max(1, min(5, rating))}
        if title: payload["title"] = title
        if body:  payload["body"]  = body
        data = self._http.post(f"/api/agents/{agent_id}/reviews", payload)
        return Review.from_dict(data.get("review") or data)

    # ── Webhooks ───────────────────────────────────────────────────────────────

    @staticmethod
    def verify_webhook_signature(
        payload:   Union[str, bytes],
        signature: str,
        secret:    str,
        *,
        tolerance_seconds: int = 300,
    ) -> bool:
        """
        Verify an incoming AgentDyne webhook signature.

        Protects against replay attacks (default 5-minute tolerance).

        :param payload:   The raw request body (str or bytes).
        :param signature: The ``X-AgentDyne-Signature`` header value.
        :param secret:    Your webhook signing secret (``whsec_...``).
        :param tolerance_seconds: Max age of the timestamp in the signature.
        :raises WebhookSignatureError: If signature is invalid or expired.

        Example (Flask)::

            @app.route("/webhooks/agentdyne", methods=["POST"])
            def handle_webhook():
                try:
                    AgentDyne.verify_webhook_signature(
                        payload   = request.get_data(),
                        signature = request.headers["X-AgentDyne-Signature"],
                        secret    = os.environ["AGENTDYNE_WEBHOOK_SECRET"],
                    )
                except WebhookSignatureError as e:
                    return "Invalid signature", 400
                event = request.get_json()
                # process event...
                return "OK", 200
        """
        if isinstance(payload, str):
            payload = payload.encode("utf-8")

        if not signature.startswith("v1="):
            raise WebhookSignatureError("Signature must start with 'v1='")

        received_sig = signature.removeprefix("v1=")
        expected     = hmac.new(
            secret.encode("utf-8"), payload, hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(received_sig, expected):
            raise WebhookSignatureError("Signature mismatch — invalid secret or tampered payload")

        return True


# ─── Async Client ─────────────────────────────────────────────────────────────

class AsyncAgentDyne:
    """
    Async AgentDyne client. Requires ``pip install agentdyne[async]`` (httpx).

    Supports ``async with`` context manager for clean connection pooling.

    Example::

        async with AsyncAgentDyne(api_key="agd_...") as client:
            result = await client.execute("agent-id", "Hello!")
            print(result.output)
    """

    VERSION = "2.0.0"

    def __init__(
        self,
        *,
        api_key:     str,
        base_url:    str   = _DEFAULT_BASE_URL,
        timeout:     float = _DEFAULT_TIMEOUT,
        max_retries: int   = _DEFAULT_RETRIES,
    ) -> None:
        if not api_key or not api_key.strip():
            raise AuthenticationError(
                "api_key is required. Get yours at https://agentdyne.com/api-keys"
            )
        self._http = AsyncHttpClient(
            api_key     = api_key,
            base_url    = base_url,
            timeout     = timeout,
            max_retries = max_retries,
        )

    async def __aenter__(self) -> "AsyncAgentDyne":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying HTTP client and release connections."""
        await self._http.aclose()

    async def execute(
        self,
        agent_id: str,
        input:    Union[str, Dict[str, Any]],
        *,
        idempotency_key:        Optional[str] = None,
        enable_self_correction: bool          = True,
    ) -> ExecuteResponse:
        """Async version of :meth:`AgentDyne.execute`."""
        body: Dict[str, Any] = {
            "agentId":              agent_id,
            "input":                input,
            "enableSelfCorrection": enable_self_correction,
        }
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key
        data = await self._http.post("/api/execute", body)
        return ExecuteResponse.from_dict(data)

    async def stream(
        self,
        agent_id: str,
        input:    Union[str, Dict[str, Any]],
        *,
        enable_self_correction: bool = True,
    ) -> AsyncIterator[StreamChunk]:
        """Async streaming — yields :class:`StreamChunk` objects."""
        body: Dict[str, Any] = {
            "agentId":              agent_id,
            "input":                input,
            "enableSelfCorrection": enable_self_correction,
        }
        async for raw_line in self._http.stream("/api/execute/stream", body):
            try:
                if raw_line == "[DONE]":
                    return
                evt = json.loads(raw_line)
                t   = evt.get("type", "")
                if t == "token":
                    yield StreamChunk(type="token", delta=evt.get("token", ""))
                elif t == "start":
                    yield StreamChunk(type="start", execution_id=evt.get("executionId"),
                                      metadata={"agentName": evt.get("agentName")})
                elif t == "correction":
                    yield StreamChunk(type="correction", confidence=evt.get("confidence"),
                                      metadata={"attempt": evt.get("attempt"), "reason": evt.get("reason")})
                elif t == "done":
                    yield StreamChunk(type="done", execution_id=evt.get("executionId"),
                                      metadata={"latencyMs": evt.get("latencyMs"), "cost": evt.get("cost"),
                                                "tokens": evt.get("tokens"), "model": evt.get("model")})
                elif t == "error":
                    yield StreamChunk(type="error", error=evt.get("error", "Unknown error"))
                    return
            except json.JSONDecodeError:
                continue

    async def swarm(
        self,
        *,
        task:       str,
        agent_ids:  List[str],
        name:       Optional[str] = None,
        mode:       str           = "orchestrate",
        max_rounds: int           = 2,
    ) -> Dict[str, Any]:
        """Async version of :meth:`AgentDyne.swarm`."""
        body: Dict[str, Any] = {"task": task, "agentIds": agent_ids, "mode": mode, "maxRounds": max_rounds}
        if name: body["name"] = name
        return await self._http.post("/api/swarm", body)

    async def run_pipeline(
        self,
        pipeline_id: str,
        input:       Union[str, Dict[str, Any]] = "",
        *,
        variables: Optional[Dict[str, str]] = None,
        state:     Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Async version of :meth:`AgentDyne.run_pipeline`."""
        body: Dict[str, Any] = {"input": input}
        if variables: body["variables"] = variables
        if state:     body["state"]     = state
        return await self._http.post(f"/api/pipelines/{pipeline_id}/execute", body)

    async def run_browser_agent(
        self,
        agent_id: str,
        task: str,
        *,
        target_url:     Optional[str]            = None,
        extract_schema: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Async version of :meth:`AgentDyne.run_browser_agent`."""
        body: Dict[str, Any] = {"agentId": agent_id, "task": task}
        if target_url:     body["targetUrl"]     = target_url
        if extract_schema: body["extractSchema"] = extract_schema
        return await self._http.post("/api/execute/browser", body)

    async def get_profile(self) -> UserProfile:
        data = await self._http.get("/api/user/profile")
        return UserProfile.from_dict(data)

    async def get_quota(self) -> UserQuota:
        data = await self._http.get("/api/user/quota")
        return UserQuota.from_dict(data)

    async def list_notifications(self, *, unread_only: bool = False, limit: int = 20) -> List[Notification]:
        params: Dict[str, Any] = {"limit": limit}
        if unread_only: params["unread"] = "1"
        data = await self._http.get("/api/notifications", params)
        return [Notification.from_dict(n) for n in (data.get("notifications") or [])]

    async def suggest_improvements(self, agent_id: str) -> Dict[str, Any]:
        return await self._http.post(f"/api/agents/{agent_id}/versions", {"action": "suggest"})

    async def apply_improvement(self, agent_id: str, version_id: str) -> Dict[str, Any]:
        return await self._http.post(f"/api/agents/{agent_id}/versions", {"action": "apply", "versionId": version_id})

    # Webhook verification is sync — same implementation as sync client
    verify_webhook_signature = staticmethod(AgentDyne.verify_webhook_signature)
