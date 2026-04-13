"""
types.py — AgentDyne Python SDK type definitions.

All types use dataclasses for zero-overhead construction and
`__slots__` for memory efficiency in high-throughput scenarios.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Literal, Optional

# ---------------------------------------------------------------------------
# Enumerations (Literal types — no enum import overhead)
# ---------------------------------------------------------------------------

AgentCategory = Literal[
    "productivity", "coding", "marketing", "finance", "legal",
    "customer_support", "data_analysis", "content", "research",
    "hr", "sales", "devops", "security", "other",
]

PricingModel = Literal["free", "per_call", "subscription", "freemium"]

AgentStatus = Literal["draft", "pending_review", "active", "suspended", "archived"]

ExecutionStatus = Literal["queued", "running", "success", "failed", "timeout"]

SubscriptionPlan = Literal["free", "starter", "pro", "enterprise"]

WebhookEventType = Literal[
    "execution.completed", "execution.failed",
    "agent.approved", "agent.rejected",
    "subscription.created", "subscription.updated", "subscription.canceled",
    "payout.processed", "review.posted",
]

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class SellerProfile:
    id: str
    full_name: str
    is_verified: bool
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    total_earned: Optional[float] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SellerProfile":
        return cls(
            id=d["id"],
            full_name=d["full_name"],
            is_verified=d.get("is_verified", False),
            username=d.get("username"),
            avatar_url=d.get("avatar_url"),
            bio=d.get("bio"),
            total_earned=d.get("total_earned"),
        )


@dataclass
class Agent:
    id: str
    seller_id: str
    name: str
    slug: str
    description: str
    category: str
    tags: List[str]
    status: str
    is_featured: bool
    is_verified: bool
    pricing_model: str
    price_per_call: float
    subscription_price_monthly: float
    free_calls_per_month: int
    model_name: str
    system_prompt: str
    temperature: float
    max_tokens: int
    timeout_seconds: int
    average_rating: float
    total_reviews: int
    total_executions: int
    successful_executions: int
    average_latency_ms: int
    total_revenue: float
    version: str
    created_at: str
    updated_at: str
    long_description: Optional[str] = None
    model_provider: Optional[str] = None
    icon_url: Optional[str] = None
    documentation: Optional[str] = None
    profiles: Optional[SellerProfile] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Agent":
        profiles = None
        if d.get("profiles"):
            profiles = SellerProfile.from_dict(d["profiles"])
        return cls(
            id=d["id"],
            seller_id=d["seller_id"],
            name=d["name"],
            slug=d["slug"],
            description=d["description"],
            category=d["category"],
            tags=d.get("tags", []),
            status=d["status"],
            is_featured=d.get("is_featured", False),
            is_verified=d.get("is_verified", False),
            pricing_model=d["pricing_model"],
            price_per_call=d.get("price_per_call", 0.0),
            subscription_price_monthly=d.get("subscription_price_monthly", 0.0),
            free_calls_per_month=d.get("free_calls_per_month", 0),
            model_name=d.get("model_name", "claude-sonnet-4-20250514"),
            system_prompt=d.get("system_prompt", ""),
            temperature=d.get("temperature", 0.7),
            max_tokens=d.get("max_tokens", 4096),
            timeout_seconds=d.get("timeout_seconds", 30),
            average_rating=d.get("average_rating", 0.0),
            total_reviews=d.get("total_reviews", 0),
            total_executions=d.get("total_executions", 0),
            successful_executions=d.get("successful_executions", 0),
            average_latency_ms=d.get("average_latency_ms", 0),
            total_revenue=d.get("total_revenue", 0.0),
            version=d.get("version", "1.0.0"),
            created_at=d["created_at"],
            updated_at=d["updated_at"],
            long_description=d.get("long_description"),
            model_provider=d.get("model_provider"),
            icon_url=d.get("icon_url"),
            documentation=d.get("documentation"),
            profiles=profiles,
        )


@dataclass
class Tokens:
    input: int
    output: int

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Tokens":
        return cls(input=d.get("input", 0), output=d.get("output", 0))


@dataclass
class ExecuteResponse:
    execution_id: str
    output: Any
    latency_ms: int
    tokens: Tokens
    cost: float

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ExecuteResponse":
        return cls(
            execution_id=d["executionId"],
            output=d["output"],
            latency_ms=d["latencyMs"],
            tokens=Tokens.from_dict(d.get("tokens", {})),
            cost=d.get("cost", 0.0),
        )


@dataclass
class Execution:
    id: str
    agent_id: str
    user_id: str
    status: str
    input: Any
    output: Optional[Any] = None
    error_message: Optional[str] = None
    tokens_input: Optional[int] = None
    tokens_output: Optional[int] = None
    latency_ms: Optional[int] = None
    cost: Optional[float] = None
    created_at: str = ""
    completed_at: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Execution":
        return cls(
            id=d["id"],
            agent_id=d["agent_id"],
            user_id=d["user_id"],
            status=d["status"],
            input=d.get("input"),
            output=d.get("output"),
            error_message=d.get("error_message"),
            tokens_input=d.get("tokens_input"),
            tokens_output=d.get("tokens_output"),
            latency_ms=d.get("latency_ms"),
            cost=d.get("cost"),
            created_at=d.get("created_at", ""),
            completed_at=d.get("completed_at"),
        )


@dataclass
class Pagination:
    total: int
    page: int
    limit: int
    pages: int
    has_next: bool
    has_prev: bool

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Pagination":
        return cls(
            total=d.get("total", 0),
            page=d.get("page", 1),
            limit=d.get("limit", 24),
            pages=d.get("pages", 1),
            has_next=d.get("hasNext", False),
            has_prev=d.get("hasPrev", False),
        )


@dataclass
class Page:
    """A paginated list of items."""
    data: List[Any]
    pagination: Pagination

    @classmethod
    def from_dict(cls, d: Dict[str, Any], item_cls: Any) -> "Page":
        return cls(
            data=[item_cls.from_dict(item) for item in d.get("data", [])],
            pagination=Pagination.from_dict(d.get("pagination", {})),
        )


@dataclass
class UserProfile:
    id: str
    email: str
    role: str
    is_verified: bool
    subscription_plan: str
    stripe_connect_onboarded: bool
    monthly_execution_quota: int
    executions_used_this_month: int
    total_earned: float
    created_at: str
    updated_at: str
    full_name: Optional[str] = None
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    website: Optional[str] = None
    company: Optional[str] = None
    subscription_status: Optional[str] = None
    quota_reset_date: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "UserProfile":
        return cls(
            id=d["id"],
            email=d["email"],
            role=d.get("role", "user"),
            is_verified=d.get("is_verified", False),
            subscription_plan=d.get("subscription_plan", "free"),
            stripe_connect_onboarded=d.get("stripe_connect_onboarded", False),
            monthly_execution_quota=d.get("monthly_execution_quota", 100),
            executions_used_this_month=d.get("executions_used_this_month", 0),
            total_earned=d.get("total_earned", 0.0),
            created_at=d["created_at"],
            updated_at=d["updated_at"],
            full_name=d.get("full_name"),
            username=d.get("username"),
            avatar_url=d.get("avatar_url"),
            bio=d.get("bio"),
            website=d.get("website"),
            company=d.get("company"),
            subscription_status=d.get("subscription_status"),
            quota_reset_date=d.get("quota_reset_date"),
        )


@dataclass
class UserQuota:
    plan: str
    quota: int
    used: int
    remaining: int
    percent_used: float
    resets_at: str

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "UserQuota":
        return cls(
            plan=d.get("plan", "free"),
            quota=d.get("quota", 100),
            used=d.get("used", 0),
            remaining=d.get("remaining", 100),
            percent_used=d.get("percentUsed", 0.0),
            resets_at=d.get("resetsAt", ""),
        )


@dataclass
class Review:
    id: str
    agent_id: str
    user_id: str
    rating: int
    status: str
    created_at: str
    title: Optional[str] = None
    body: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Review":
        return cls(
            id=d["id"],
            agent_id=d["agent_id"],
            user_id=d["user_id"],
            rating=d["rating"],
            status=d.get("status", "pending"),
            created_at=d["created_at"],
            title=d.get("title"),
            body=d.get("body"),
        )


@dataclass
class Notification:
    id: str
    user_id: str
    title: str
    body: str
    type: str
    is_read: bool
    created_at: str
    action_url: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Notification":
        return cls(
            id=d["id"],
            user_id=d["user_id"],
            title=d["title"],
            body=d["body"],
            type=d["type"],
            is_read=d.get("is_read", False),
            created_at=d["created_at"],
            action_url=d.get("action_url"),
        )


@dataclass
class WebhookEvent:
    id: str
    type: str
    timestamp: str
    data: Dict[str, Any]

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "WebhookEvent":
        return cls(
            id=d.get("id", ""),
            type=d["type"],
            timestamp=d.get("timestamp", ""),
            data=d.get("data", {}),
        )


@dataclass
class StreamChunk:
    type: str
    delta: Optional[str] = None
    execution_id: Optional[str] = None
    error: Optional[str] = None
