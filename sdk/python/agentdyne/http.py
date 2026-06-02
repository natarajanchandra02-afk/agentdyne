"""
http.py — HTTP transport for the AgentDyne Python SDK.

Sync: pure stdlib (urllib) — zero dependencies.
Async: httpx (optional, installed with `pip install agentdyne[async]`).
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, AsyncIterator, Dict, Generator, Iterator, Optional

from .errors import (
    AgentDyneError,
    AuthenticationError,
    NotFoundError,
    QuotaExceededError,
    RateLimitError,
    ServerError,
    ValidationError,
)

# Try to import httpx for async support
try:
    import httpx as _httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _httpx = None        # type: ignore
    _HTTPX_AVAILABLE = False

_DEFAULT_HEADERS = {
    "User-Agent":   "agentdyne-python/2.0.0",
    "Content-Type": "application/json",
    "Accept":       "application/json",
}

_RETRY_STATUS = {429, 500, 502, 503, 504}


def _raise_for_status(status: int, body: bytes, url: str) -> None:
    try:
        data = json.loads(body) if body else {}
        message = data.get("error") or data.get("message") or str(body[:200])
    except Exception:
        message = str(body[:200])

    if status == 401:
        raise AuthenticationError(message)
    if status == 404:
        raise NotFoundError(message)
    if status == 422:
        raise ValidationError(message)
    if status == 429:
        raise RateLimitError(message, retry_after=None)
    if status == 402:
        raise QuotaExceededError(message)
    if status >= 500:
        raise ServerError(message, status_code=status)
    if status >= 400:
        raise AgentDyneError(message, status_code=status)


class HttpClient:
    """Synchronous HTTP client — pure stdlib, zero deps."""

    def __init__(self, *, api_key: str, base_url: str, timeout: float, max_retries: int) -> None:
        self._api_key    = api_key
        self._base_url   = base_url.rstrip("/")
        self._timeout    = timeout
        self._max_retries = max_retries

    def _headers(self) -> Dict[str, str]:
        return {**_DEFAULT_HEADERS, "X-API-Key": self._api_key}

    def _url(self, path: str, params: Optional[Dict[str, Any]] = None) -> str:
        url = f"{self._base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return url

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        body:   Optional[Dict[str, Any]] = None,
    ) -> Any:
        url     = self._url(path, params)
        data    = json.dumps(body).encode("utf-8") if body is not None else None
        headers = self._headers()
        if data:
            headers["Content-Length"] = str(len(data))

        for attempt in range(self._max_retries + 1):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    resp_body = resp.read()
                    return json.loads(resp_body) if resp_body else {}
            except urllib.error.HTTPError as exc:
                resp_body = exc.read()
                if exc.code in _RETRY_STATUS and attempt < self._max_retries:
                    time.sleep(2 ** attempt)
                    continue
                _raise_for_status(exc.code, resp_body, url)
                raise  # unreachable — _raise_for_status always raises
            except urllib.error.URLError as exc:
                if attempt < self._max_retries:
                    time.sleep(2 ** attempt)
                    continue
                raise AgentDyneError(f"Request failed: {exc.reason}") from exc

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        return self._request("GET", path, params=params)

    def post(self, path: str, body: Dict[str, Any]) -> Any:
        return self._request("POST", path, body=body)

    def patch(self, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        return self._request("PATCH", path, body=body or {})

    def delete(self, path: str) -> Any:
        return self._request("DELETE", path)

    def stream(self, path: str, body: Dict[str, Any]) -> Iterator[str]:
        """Yield raw SSE data lines from a streaming endpoint."""
        url  = self._url(path)
        data = json.dumps(body).encode("utf-8")
        headers = {**self._headers(), "Accept": "text/event-stream", "Content-Length": str(len(data))}
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").strip()
                    if line.startswith("data: "):
                        text = line[6:]
                        if text == "[DONE]":
                            return
                        yield text
        except urllib.error.HTTPError as exc:
            resp_body = exc.read()
            _raise_for_status(exc.code, resp_body, url)


class AsyncHttpClient:
    """Async HTTP client — requires httpx."""

    def __init__(self, *, api_key: str, base_url: str, timeout: float, max_retries: int) -> None:
        if not _HTTPX_AVAILABLE:
            raise ImportError("AsyncAgentDyne requires httpx. Install with: pip install agentdyne[async]")
        self._api_key     = api_key
        self._base_url    = base_url.rstrip("/")
        self._timeout     = timeout
        self._max_retries = max_retries
        self._client: Any = _httpx.AsyncClient(timeout=timeout)

    def _headers(self) -> Dict[str, str]:
        return {**_DEFAULT_HEADERS, "X-API-Key": self._api_key}

    def _url(self, path: str, params: Optional[Dict[str, Any]] = None) -> str:
        url = f"{self._base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        return url

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        body:   Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = self._url(path, params)
        for attempt in range(self._max_retries + 1):
            try:
                resp = await self._client.request(
                    method, url,
                    headers=self._headers(),
                    json=body,
                )
                if resp.status_code in _RETRY_STATUS and attempt < self._max_retries:
                    await _httpx.sleep(2 ** attempt)  # type: ignore
                    continue
                _raise_for_status(resp.status_code, resp.content, url)
                return resp.json() if resp.content else {}
            except _httpx.RequestError as exc:
                if attempt < self._max_retries:
                    continue
                raise AgentDyneError(f"Request failed: {exc}") from exc

    async def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        return await self._request("GET", path, params=params)

    async def post(self, path: str, body: Dict[str, Any]) -> Any:
        return await self._request("POST", path, body=body)

    async def patch(self, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        return await self._request("PATCH", path, body=body or {})

    async def delete(self, path: str) -> Any:
        return await self._request("DELETE", path)

    async def stream(self, path: str, body: Dict[str, Any]) -> AsyncIterator[str]:
        url = self._url(path)
        async with self._client.stream("POST", url, headers={**self._headers(), "Accept": "text/event-stream"}, json=body) as resp:
            async for raw_line in resp.aiter_lines():
                line = raw_line.strip()
                if line.startswith("data: "):
                    text = line[6:]
                    if text == "[DONE]":
                        return
                    yield text

    async def aclose(self) -> None:
        await self._client.aclose()
