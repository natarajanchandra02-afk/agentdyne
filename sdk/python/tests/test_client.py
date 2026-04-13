"""
Tests for the AgentDyne Python SDK.

Run: pytest sdk/python/tests/ -v
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import pytest

from agentdyne import AgentDyne, AsyncAgentDyne
from agentdyne.errors import (
    AgentDyneError,
    AuthenticationError,
    NotFoundError,
    QuotaExceededError,
    RateLimitError,
    SubscriptionRequiredError,
    ValidationError,
    WebhookSignatureError,
)
from agentdyne.types import (
    Agent,
    Execution,
    ExecuteResponse,
    Page,
    Pagination,
    Tokens,
    UserProfile,
    UserQuota,
    WebhookEvent,
)

API_KEY = "agd_test_key_12345678901234567890"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_client() -> AgentDyne:
    return AgentDyne(api_key=API_KEY, base_url="https://api.agentdyne.com")


def _sign(payload: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _make_webhook_payload(event_type: str = "execution.completed") -> str:
    return json.dumps({
        "id": "evt_test_001",
        "type": event_type,
        "timestamp": "2026-04-01T00:00:00Z",
        "data": {"executionId": "exec_abc123", "agentId": "agent_xyz", "status": "success"},
    })


# ---------------------------------------------------------------------------
# Client initialisation
# ---------------------------------------------------------------------------

class TestClientInit:
    def test_raises_without_api_key(self, monkeypatch):
        monkeypatch.delenv("AGENTDYNE_API_KEY", raising=False)
        with pytest.raises(ValueError, match="API key is required"):
            AgentDyne()

    def test_reads_from_env(self, monkeypatch):
        monkeypatch.setenv("AGENTDYNE_API_KEY", API_KEY)
        client = AgentDyne()  # should not raise
        assert client is not None

    def test_direct_key_accepted(self):
        client = make_client()
        assert client is not None

    def test_custom_base_url(self):
        client = AgentDyne(api_key=API_KEY, base_url="http://localhost:3000")
        assert client is not None


# ---------------------------------------------------------------------------
# Error classes
# ---------------------------------------------------------------------------

class TestErrors:
    def test_quota_exceeded_plan(self):
        e = QuotaExceededError("pro")
        assert e.plan == "pro"
        assert e.status_code == 429
        assert e.code == "QUOTA_EXCEEDED"
        assert "pro" in str(e)

    def test_quota_exceeded_no_plan(self):
        e = QuotaExceededError()
        assert e.plan is None
        assert e.status_code == 429

    def test_rate_limit_retry_after(self):
        e = RateLimitError(retry_after_seconds=45.0)
        assert e.retry_after_seconds == 45.0
        assert e.status_code == 429
        assert e.code == "RATE_LIMIT_EXCEEDED"
        assert "45" in str(e)

    def test_auth_error(self):
        e = AuthenticationError()
        assert e.status_code == 401
        assert e.code == "AUTHENTICATION_ERROR"

    def test_not_found_with_resource(self):
        e = NotFoundError("Agent", "agent_abc")
        assert e.resource_type == "Agent"
        assert e.resource_id == "agent_abc"
        assert "agent_abc" in str(e)
        assert e.status_code == 404

    def test_not_found_no_args(self):
        e = NotFoundError()
        assert "not found" in str(e).lower()

    def test_validation_error_fields(self):
        e = ValidationError("Bad input", fields={"rating": "must be 1-5"})
        assert e.fields["rating"] == "must be 1-5"
        assert e.status_code == 400

    def test_subscription_required_with_agent(self):
        e = SubscriptionRequiredError("agent_xyz")
        assert e.agent_id == "agent_xyz"
        assert "agent_xyz" in str(e)
        assert e.status_code == 403
        assert e.code == "SUBSCRIPTION_REQUIRED"

    def test_error_to_dict(self):
        e = QuotaExceededError("starter")
        d = e.to_dict()
        assert d["error"] == "QuotaExceededError"
        assert d["status_code"] == 429
        assert d["code"] == "QUOTA_EXCEEDED"

    def test_inheritance(self):
        e = RateLimitError()
        assert isinstance(e, AgentDyneError)
        assert isinstance(e, Exception)


# ---------------------------------------------------------------------------
# Webhook verification
# ---------------------------------------------------------------------------

class TestWebhooks:
    SECRET = "whsec_test_secret_abc123"

    def test_valid_signature(self):
        client  = make_client()
        payload = _make_webhook_payload()
        sig     = _sign(payload, self.SECRET)
        event   = client.construct_webhook_event(payload, sig, self.SECRET)
        assert event.type == "execution.completed"
        assert event.data["executionId"] == "exec_abc123"

    def test_sha256_prefix_stripped(self):
        client  = make_client()
        payload = _make_webhook_payload("payout.processed")
        sig     = "sha256=" + _sign(payload, self.SECRET)
        event   = client.construct_webhook_event(payload, sig, self.SECRET)
        assert event.type == "payout.processed"

    def test_bytes_payload(self):
        client  = make_client()
        payload = _make_webhook_payload()
        sig     = _sign(payload, self.SECRET)
        event   = client.construct_webhook_event(payload.encode(), sig, self.SECRET)
        assert event.type == "execution.completed"

    def test_invalid_signature_raises(self):
        client = make_client()
        with pytest.raises(WebhookSignatureError):
            client.construct_webhook_event(
                _make_webhook_payload(), "bad_sig", self.SECRET
            )

    def test_wrong_secret_raises(self):
        client  = make_client()
        payload = _make_webhook_payload()
        sig     = _sign(payload, "wrong_secret")
        with pytest.raises(WebhookSignatureError):
            client.construct_webhook_event(payload, sig, self.SECRET)

    def test_invalid_json_raises(self):
        client = make_client()
        secret = self.SECRET
        bad    = "not json at all"
        sig    = _sign(bad, secret)
        with pytest.raises(WebhookSignatureError):
            client.construct_webhook_event(bad, sig, secret)


# ---------------------------------------------------------------------------
# Type dataclasses
# ---------------------------------------------------------------------------

class TestTypes:
    def test_execute_response_from_dict(self):
        r = ExecuteResponse.from_dict({
            "executionId": "exec_123",
            "output": {"summary": "Q3 revenue grew 40%", "items": [1, 2]},
            "latencyMs": 842,
            "tokens": {"input": 120, "output": 88},
            "cost": 0.001476,
        })
        assert r.execution_id == "exec_123"
        assert r.latency_ms == 842
        assert r.tokens.input == 120
        assert r.tokens.output == 88
        assert r.cost == pytest.approx(0.001476)
        assert isinstance(r.output, dict)

    def test_tokens_from_dict(self):
        t = Tokens.from_dict({"input": 50, "output": 30})
        assert t.input == 50
        assert t.output == 30

    def test_tokens_missing_keys(self):
        t = Tokens.from_dict({})
        assert t.input == 0
        assert t.output == 0

    def test_agent_from_dict_minimal(self):
        a = Agent.from_dict({
            "id": "a1", "seller_id": "s1", "name": "Email Summariser",
            "slug": "email-summariser", "description": "Summarises emails",
            "category": "productivity", "tags": ["email", "ai"],
            "status": "active", "is_featured": True, "is_verified": False,
            "pricing_model": "per_call", "price_per_call": 0.01,
            "subscription_price_monthly": 0, "free_calls_per_month": 0,
            "model_name": "claude-sonnet-4-20250514",
            "temperature": 0.7, "max_tokens": 4096, "timeout_seconds": 30,
            "average_rating": 4.9, "total_reviews": 24, "total_executions": 5000,
            "successful_executions": 4950, "average_latency_ms": 650,
            "total_revenue": 50.0, "version": "1.0.0",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-03-01T00:00:00Z",
        })
        assert a.name == "Email Summariser"
        assert a.is_featured is True
        assert a.average_rating == 4.9
        assert a.total_executions == 5000
        assert a.profiles is None

    def test_agent_with_seller_profile(self):
        a = Agent.from_dict({
            "id": "a2", "seller_id": "s2", "name": "Code Reviewer",
            "slug": "code-reviewer", "description": "Reviews code",
            "category": "coding", "tags": [], "status": "active",
            "is_featured": False, "is_verified": True, "pricing_model": "free",
            "price_per_call": 0, "subscription_price_monthly": 0,
            "free_calls_per_month": 100, "model_name": "claude-sonnet-4-20250514",
            "temperature": 0.5, "max_tokens": 8192, "timeout_seconds": 60,
            "average_rating": 4.5, "total_reviews": 10, "total_executions": 200,
            "successful_executions": 198, "average_latency_ms": 800,
            "total_revenue": 0, "version": "2.1.0",
            "created_at": "2026-02-01T00:00:00Z",
            "updated_at": "2026-04-01T00:00:00Z",
            "profiles": {
                "id": "s2", "full_name": "Ravi Kumar",
                "username": "ravikumar", "is_verified": True,
            },
        })
        assert a.profiles is not None
        assert a.profiles.full_name == "Ravi Kumar"
        assert a.profiles.is_verified is True

    def test_user_quota_from_dict(self):
        q = UserQuota.from_dict({
            "plan": "pro", "quota": 10000, "used": 3752,
            "remaining": 6248, "percentUsed": 37.52,
            "resetsAt": "2026-05-01T00:00:00Z",
        })
        assert q.plan == "pro"
        assert q.quota == 10000
        assert q.used == 3752
        assert q.remaining == 6248
        assert q.percent_used == 37.52
        assert "2026-05-01" in q.resets_at

    def test_user_profile_from_dict(self):
        p = UserProfile.from_dict({
            "id": "u1", "email": "test@example.com",
            "full_name": "Ada Lovelace", "role": "seller",
            "is_verified": True, "subscription_plan": "pro",
            "stripe_connect_onboarded": True,
            "monthly_execution_quota": 10000,
            "executions_used_this_month": 1234,
            "total_earned": 890.50,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-04-01T00:00:00Z",
        })
        assert p.full_name == "Ada Lovelace"
        assert p.subscription_plan == "pro"
        assert p.total_earned == 890.50
        assert p.stripe_connect_onboarded is True

    def test_webhook_event_from_dict(self):
        e = WebhookEvent.from_dict({
            "id": "evt_001", "type": "execution.completed",
            "timestamp": "2026-04-01T12:00:00Z",
            "data": {"executionId": "exec_xyz", "status": "success"},
        })
        assert e.type == "execution.completed"
        assert e.data["executionId"] == "exec_xyz"

    def test_pagination_from_dict(self):
        p = Pagination.from_dict({
            "total": 150, "page": 2, "limit": 24,
            "pages": 7, "hasNext": True, "hasPrev": True,
        })
        assert p.total == 150
        assert p.has_next is True
        assert p.has_prev is True

    def test_execution_from_dict(self):
        e = Execution.from_dict({
            "id": "exec_001", "agent_id": "agent_001",
            "user_id": "user_001", "status": "success",
            "input": "Hello", "output": {"reply": "Hi there!"},
            "tokens_input": 10, "tokens_output": 20,
            "latency_ms": 500, "cost": 0.0005,
            "created_at": "2026-04-01T00:00:00Z",
        })
        assert e.status == "success"
        assert e.latency_ms == 500
        assert e.output == {"reply": "Hi there!"}
