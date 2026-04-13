package agentdyne

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

// AgentDyneAPIError is the base error for all API responses.
type AgentDyneAPIError struct {
	StatusCode int
	Message    string
	Code       string
}

func (e *AgentDyneAPIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("agentdyne: [%s] %s (HTTP %d)", e.Code, e.Message, e.StatusCode)
	}
	return fmt.Sprintf("agentdyne: %s (HTTP %d)", e.Message, e.StatusCode)
}

// AuthError is returned for HTTP 401.
type AuthError struct{ Message string }
func (e *AuthError) Error() string { return "agentdyne: authentication failed: " + e.Message }

// PermissionError is returned for HTTP 403.
type PermissionError struct{ Message string }
func (e *PermissionError) Error() string { return "agentdyne: permission denied: " + e.Message }

// SubscriptionRequiredError is returned when an agent requires a subscription.
type SubscriptionRequiredError struct{ AgentID string }
func (e *SubscriptionRequiredError) Error() string {
	if e.AgentID != "" {
		return fmt.Sprintf("agentdyne: agent %q requires an active subscription", e.AgentID)
	}
	return "agentdyne: an active subscription is required"
}

// NotFoundError is returned for HTTP 404.
type NotFoundError struct{ Message string }
func (e *NotFoundError) Error() string { return "agentdyne: not found: " + e.Message }

// RateLimitError is returned when the per-minute rate limit is exceeded.
type RateLimitError struct{ RetryAfterSeconds float64 }
func (e *RateLimitError) Error() string {
	return fmt.Sprintf("agentdyne: rate limit exceeded, retry after %.0fs", e.RetryAfterSeconds)
}

// QuotaExceededError is returned when the monthly execution quota is exhausted.
type QuotaExceededError struct{ Plan string }
func (e *QuotaExceededError) Error() string {
	if e.Plan != "" {
		return fmt.Sprintf("agentdyne: monthly quota exceeded on %q plan, please upgrade", e.Plan)
	}
	return "agentdyne: monthly execution quota exceeded"
}

// NetworkError wraps low-level network failures.
type NetworkError struct{ Cause error }
func (e *NetworkError) Error() string  { return "agentdyne: network error: " + e.Cause.Error() }
func (e *NetworkError) Unwrap() error  { return e.Cause }

// WebhookSignatureError is returned when HMAC verification fails.
type WebhookSignatureError struct{ Message string }
func (e *WebhookSignatureError) Error() string {
	if e.Message != "" {
		return "agentdyne: webhook signature: " + e.Message
	}
	return "agentdyne: webhook signature verification failed"
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

// VerifyWebhookSignature verifies an incoming AgentDyne webhook payload.
// The signature should be the value of the X-AgentDyne-Signature header.
//
// Returns a *WebhookEvent on success or *WebhookSignatureError on failure.
func VerifyWebhookSignature(payload []byte, signature, secret string) (*WebhookEvent, error) {
	sig := strings.TrimPrefix(signature, "sha256=")

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(sig)) {
		return nil, &WebhookSignatureError{}
	}

	var event WebhookEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, &WebhookSignatureError{Message: "payload is not valid JSON"}
	}
	return &event, nil
}
