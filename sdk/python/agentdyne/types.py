"""
types.py — Typed data classes for the AgentDyne Python SDK.
All objects are immutable (frozen dataclasses) and serialisable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Generic, List, Optional, Type, TypeVar

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PaginationMeta:
    page:       int
    limit:      int
    total:      int
    has_next:   bool
    has_prev:   bool

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "PaginationMeta":
        p = d.get("pagination", d)
        return cls(
            page     = p.get("page", 1),
            limit    = p.get("limit", 24),
            total    = p.get("total", 0),
            has_next = p.get("hasNext", p.get("has_next", False)),
            has_prev = p.get("hasPrev", p.get("has_prev", False)),
        )


@dataclass(frozen=True)
class Page(Generic[T]):
    data:       List[T]
    pagination: PaginationMeta

    @classmethod
    def from_dict(cls, raw: Dict[str, Any], item_cls: Type[T]) -> "Page[T]":
        items  = raw.get("agents") or raw.get("data") or raw.get("executions") or raw.get("reviews") or []
        parsed = [item_cls.from_dict(i) for i in items]  # type: ignore[attr-defined]
        return cls(data=parsed, pagination=PaginationMeta.from_dict(raw))


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Agent:
    id:             str
    name:           str
    description:    Optional[str]
    category:       Optional[str]
    tags:           List[str]
    pricing_model:  str                   # "free" | "per_call" | "subscription"
    price_per_call: Optional[float]
    model_name:     Optional[str]
    average_rating: Optional[float]
    total_reviews:  int
    total_runs:     int
    status:         str
    created_at:     str
    seller_id:      Optional[str]
    agent_type:     str                   # "standard" | "browser" | "swarm" | "rag"

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Agent":
        return cls(
            id             = d.get("id", ""),
            name           = d.get("name", ""),
            description    = d.get("description"),
            category       = d.get("category"),
            tags           = d.get("tags") or [],
            pricing_model  = d.get("pricing_model") or d.get("pricingModel") or "free",
            price_per_call = d.get("price_per_call") or d.get("pricePerCall"),
            model_name     = d.get("model_name") or d.get("modelName"),
            average_rating = d.get("average_rating") or d.get("averageRating"),
            total_reviews  = d.get("total_reviews") or d.get("totalReviews") or 0,
            total_runs     = d.get("total_runs")    or d.get("totalRuns")    or 0,
            status         = d.get("status", "active"),
            created_at     = d.get("created_at") or d.get("createdAt") or "",
            seller_id      = d.get("seller_id") or d.get("sellerId"),
            agent_type     = d.get("agent_type") or d.get("agentType") or "standard",
        )


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Execution:
    id:              str
    agent_id:        str
    status:          str          # "running" | "success" | "failed" | "timeout"
    input:           Optional[Any]
    output:          Optional[Any]
    latency_ms:      Optional[int]
    cost_usd:        Optional[float]
    tokens_input:    Optional[int]
    tokens_output:   Optional[int]
    correction_attempts: int
    model:           Optional[str]
    created_at:      str
    completed_at:    Optional[str]

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Execution":
        return cls(
            id                  = d.get("id", ""),
            agent_id            = d.get("agent_id") or d.get("agentId") or "",
            status              = d.get("status", "running"),
            input               = d.get("input"),
            output              = d.get("output"),
            latency_ms          = d.get("latency_ms") or d.get("latencyMs"),
            cost_usd            = d.get("cost_usd") or d.get("costUsd"),
            tokens_input        = d.get("tokens_input") or d.get("tokensInput"),
            tokens_output       = d.get("tokens_output") or d.get("tokensOutput"),
            correction_attempts = d.get("correction_attempts") or d.get("correctionAttempts") or 0,
            model               = d.get("model"),
            created_at          = d.get("created_at") or d.get("createdAt") or "",
            completed_at        = d.get("completed_at") or d.get("completedAt"),
        )


@dataclass(frozen=True)
class ExecuteResponse:
    execution_id: str
    output:       Any
    status:       str
    latency_ms:   Optional[int]
    cost:         Optional[float]
    tokens:       Optional[Dict[str, int]]
    model:        Optional[str]
    correction_attempts: int

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ExecuteResponse":
        # Handle both direct output and nested execution response
        output = d.get("output") or d.get("text") or d
        if isinstance(output, dict):
            output = output.get("text") or output
        return cls(
            execution_id        = d.get("executionId") or d.get("execution_id") or "",
            output              = output,
            status              = d.get("status", "success"),
            latency_ms          = d.get("latencyMs") or d.get("latency_ms"),
            cost                = d.get("cost") or d.get("cost_usd"),
            tokens              = d.get("tokens"),
            model               = d.get("model"),
            correction_attempts = d.get("correctionAttempts") or d.get("correction_attempts") or 0,
        )


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StreamChunk:
    type:         str           # "token" | "start" | "correction" | "done" | "error"
    delta:        Optional[str] = None   # incremental text (type == "token")
    execution_id: Optional[str] = None
    error:        Optional[str] = None
    confidence:   Optional[float] = None
    metadata:     Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class UserProfile:
    id:                str
    email:             Optional[str]
    full_name:         Optional[str]
    username:          Optional[str]
    avatar_url:        Optional[str]
    subscription_plan: str
    is_seller:         bool
    created_at:        str

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "UserProfile":
        p = d.get("profile") or d
        return cls(
            id                = p.get("id", ""),
            email             = p.get("email"),
            full_name         = p.get("full_name") or p.get("fullName"),
            username          = p.get("username"),
            avatar_url        = p.get("avatar_url") or p.get("avatarUrl"),
            subscription_plan = p.get("subscription_plan") or p.get("subscriptionPlan") or "free",
            is_seller         = bool(p.get("is_seller") or p.get("isSeller") or False),
            created_at        = p.get("created_at") or p.get("createdAt") or "",
        )


@dataclass(frozen=True)
class UserQuota:
    plan:                        str
    executions_used_this_month:  int
    monthly_execution_quota:     int
    executions_remaining:        int
    compute_cap_usd:             Optional[float]
    compute_used_usd:            Optional[float]
    reset_date:                  Optional[str]

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "UserQuota":
        q = d.get("quota") or d
        used  = q.get("executionsUsedThisMonth") or q.get("executions_used_this_month") or 0
        quota = q.get("monthlyExecutionQuota")   or q.get("monthly_execution_quota")    or 0
        return cls(
            plan                       = q.get("plan", "free"),
            executions_used_this_month = used,
            monthly_execution_quota    = quota,
            executions_remaining       = max(0, quota - used) if quota >= 0 else -1,
            compute_cap_usd            = q.get("computeCapUsd"),
            compute_used_usd           = q.get("computeUsedUsd"),
            reset_date                 = q.get("resetDate"),
        )


# ---------------------------------------------------------------------------
# Review
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Review:
    id:         str
    agent_id:   str
    rating:     int
    title:      Optional[str]
    body:       Optional[str]
    is_verified: bool
    created_at: str

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Review":
        return cls(
            id          = d.get("id", ""),
            agent_id    = d.get("agent_id") or d.get("agentId") or "",
            rating      = d.get("rating", 0),
            title       = d.get("title"),
            body        = d.get("body"),
            is_verified = bool(d.get("is_verified") or d.get("isVerified") or False),
            created_at  = d.get("created_at") or d.get("createdAt") or "",
        )


# ---------------------------------------------------------------------------
# Notification
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Notification:
    id:         str
    type:       str
    title:      str
    body:       Optional[str]
    is_read:    bool
    action_url: Optional[str]
    created_at: str

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Notification":
        return cls(
            id         = d.get("id", ""),
            type       = d.get("type", ""),
            title      = d.get("title", ""),
            body       = d.get("body"),
            is_read    = bool(d.get("is_read") or d.get("isRead") or False),
            action_url = d.get("action_url") or d.get("actionUrl"),
            created_at = d.get("created_at") or d.get("createdAt") or "",
        )


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class WebhookEvent:
    event:     str
    timestamp: str
    data:      Dict[str, Any]

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "WebhookEvent":
        return cls(
            event     = d.get("event", ""),
            timestamp = d.get("timestamp", ""),
            data      = d.get("data") or {},
        )
