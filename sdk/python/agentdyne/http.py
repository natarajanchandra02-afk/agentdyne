"""
http.py — AgentDyne Python HTTP client.

Provides both synchronous (urllib-based, zero dependencies) and
async (httpx-based) variants.  Implements:

  - Exponential back-off with full jitter on 429 / 5xx
  - Retry-After header respect
  - Client-side timeout
  - SSE streaming for async client
"""

from __future__ import annotations

import json
import math
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Generator, Iterator, Optional

from .errors import (
    AgentDyneError,
    AuthenticationError,
    InternalServerError,
    NetworkError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExceededError,
    RateLimitError,
    RequestTimeoutError,
    SubscriptionRequiredError,
    ValidationError,
)

_SDK_VERSION = "1.0.0"
_DEFAULT_BASE_URL = "https://api.agentdyne.com"
_DEFAULT_TIMEOUT = 60.0
_DEFAULT_MAX_RETRIES = 3
_NON_RETRYABLE = {400, 401, 403, 404, 422}


# ---------------------------------------------------------------------------
# Back-off helper
# ---------------------------------------------------------------------------

def _backoff_delay(attempt: int, base: float = 0.5, cap: float = 30.0) -> float:
    """Full jitter exponential back-off."""
    ceiling = min(cap, base * math.pow(2, attempt))
    return random.uniform(0, ceiling)


# ---------------------------------------------------------------------------
# Synchronous HTTP client (stdlib only — zero dependencies)
# ---------------------------------------------------------------------------

class HttpClient:
    """Synchronous HTTP client using Python's built-in urllib."""

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT,
        max_retries: int = _DEFAULT_MAX_RETRIES,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries

    # ── Public methods ─────────────────────────────────────────────────────

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        return self._request("GET", path, params=params)

    def post(self, path: str, body: Any = None) -> Any:
        return self._request("POST", path, body=body)

    def patch(self, path: str, body: Any = None) -> Any:
        return self._request("PATCH", path, body=body)

    def delete(self, path: str) -> Any:
        return self._request("DELETE", path)

    def stream(self, path: str, body: Any) -> Iterator[str]:
        """Synchronous SSE stream — yields raw data lines."""
        url = self._build_url(path)
        headers = self._build_headers(stream=True)
        data = json.dumps(body).encode()

        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").rstrip("\n\r")
                    if line.startswith("data: "):
                        data_part = line[6:]
                        if data_part == "[DONE]":
                            return
                        yield data_part
        except urllib.error.URLError as e:
            raise NetworkError(str(e), cause=e) from e

    # ── Core request loop ──────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = self._build_url(path, params)
        headers = self._build_headers()
        data = json.dumps(body).encode() if body is not None else None

        last_error: Exception = AgentDyneError("Unknown error")

        for attempt in range(self._max_retries + 1):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else None

            except urllib.error.HTTPError as e:
                status = e.code
                try:
                    raw_body = e.read().decode("utf-8")
                    body_json: Dict[str, Any] = json.loads(raw_body)
                except Exception:
                    body_json = {}

                err = self._build_error(status, body_json)

                if status == 429:
                    retry_after = float(e.headers.get("Retry-After", "60"))
                    if attempt < self._max_retries:
                        time.sleep(retry_after)
                        last_error = err
                        continue
                    raise err

                if status >= 500 and status not in _NON_RETRYABLE and attempt < self._max_retries:
                    time.sleep(_backoff_delay(attempt))
                    last_error = err
                    continue

                raise err

            except urllib.error.URLError as e:
                last_error = NetworkError(str(e), cause=e)
                if attempt < self._max_retries:
                    time.sleep(_backoff_delay(attempt))
                    continue
                raise last_error

            except TimeoutError as e:
                raise RequestTimeoutError(self._timeout) from e

        raise last_error

    # ── Helpers ────────────────────────────────────────────────────────────

    def _build_url(self, path: str, params: Optional[Dict[str, Any]] = None) -> str:
        url = f"{self._base_url}{path}"
        if params:
            filtered = {k: str(v) for k, v in params.items() if v is not None}
            if filtered:
                url += "?" + urllib.parse.urlencode(filtered)
        return url

    def _build_headers(self, stream: bool = False) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type":  "application/json",
            "Accept":        "text/event-stream" if stream else "application/json",
            "User-Agent":    f"agentdyne-python/{_SDK_VERSION}",
            "X-SDK-Language":"python",
        }

    @staticmethod
    def _build_error(status: int, body: Dict[str, Any]) -> AgentDyneError:
        message = body.get("error") or body.get("message") or f"HTTP {status}"
        code    = body.get("code")
        raw     = body

        if status == 400: return ValidationError(message, body.get("fields"), raw)
        if status == 401: return AuthenticationError(message, raw)
        if status == 403:
            if code == "SUBSCRIPTION_REQUIRED":
                return SubscriptionRequiredError(raw=raw)
            return PermissionDeniedError(message, raw)
        if status == 404: return NotFoundError(raw=raw)
        if status == 429:
            if code == "QUOTA_EXCEEDED":
                return QuotaExceededError(raw=raw)
            return RateLimitError(raw=raw)
        if status >= 500: return InternalServerError(message, raw)
        return AgentDyneError(message, status_code=status, code=code, raw=raw)


# ---------------------------------------------------------------------------
# Async HTTP client (requires httpx)
# ---------------------------------------------------------------------------

try:
    import httpx  # type: ignore

    class AsyncHttpClient:
        """Async HTTP client using httpx. Install: pip install agentdyne[async]"""

        def __init__(
            self,
            api_key: str,
            base_url: str = _DEFAULT_BASE_URL,
            timeout: float = _DEFAULT_TIMEOUT,
            max_retries: int = _DEFAULT_MAX_RETRIES,
        ) -> None:
            self._api_key = api_key
            self._base_url = base_url.rstrip("/")
            self._timeout = timeout
            self._max_retries = max_retries
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                headers=self._build_headers(),
            )

        async def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
            return await self._request("GET", path, params=params)

        async def post(self, path: str, body: Any = None) -> Any:
            return await self._request("POST", path, body=body)

        async def patch(self, path: str, body: Any = None) -> Any:
            return await self._request("PATCH", path, body=body)

        async def delete(self, path: str) -> Any:
            return await self._request("DELETE", path)

        async def stream(self, path: str, body: Any):
            """Async SSE stream — yields raw data lines."""
            headers = {**self._build_headers(), "Accept": "text/event-stream"}
            async with self._client.stream(
                "POST", path, json=body, headers=headers
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        data_part = line[6:]
                        if data_part == "[DONE]":
                            return
                        yield data_part

        async def _request(
            self,
            method: str,
            path: str,
            body: Any = None,
            params: Optional[Dict[str, Any]] = None,
        ) -> Any:
            import asyncio

            last_error: Exception = AgentDyneError("Unknown error")

            for attempt in range(self._max_retries + 1):
                try:
                    resp = await self._client.request(
                        method, path, json=body, params=params
                    )
                except httpx.TimeoutException as e:
                    raise RequestTimeoutError(self._timeout) from e
                except httpx.NetworkError as e:
                    last_error = NetworkError(str(e), cause=e)
                    if attempt < self._max_retries:
                        await asyncio.sleep(_backoff_delay(attempt))
                        continue
                    raise last_error

                if resp.is_success:
                    return resp.json() if resp.content else None

                body_json: Dict[str, Any] = {}
                try:
                    body_json = resp.json()
                except Exception:
                    pass

                err = HttpClient._build_error(resp.status_code, body_json)

                if resp.status_code == 429:
                    retry_after = float(resp.headers.get("Retry-After", "60"))
                    if attempt < self._max_retries:
                        await asyncio.sleep(retry_after)
                        last_error = err
                        continue
                    raise err

                if resp.status_code >= 500 and attempt < self._max_retries:
                    await asyncio.sleep(_backoff_delay(attempt))
                    last_error = err
                    continue

                raise err

            raise last_error

        def _build_headers(self) -> Dict[str, str]:
            return {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type":  "application/json",
                "User-Agent":    f"agentdyne-python/{_SDK_VERSION}",
                "X-SDK-Language":"python",
            }

        async def aclose(self) -> None:
            await self._client.aclose()

        async def __aenter__(self) -> "AsyncHttpClient":
            return self

        async def __aexit__(self, *args: Any) -> None:
            await self.aclose()

except ImportError:
    AsyncHttpClient = None  # type: ignore
