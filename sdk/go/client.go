// Package agentdyne provides a Go client for the AgentDyne API.
//
// Quick start:
//
//	client := agentdyne.New("agd_your_key_here")
//	result, err := client.Execute(ctx, "agent_id", "Summarize this...")
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Println(result.Output)
package agentdyne

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL    = "https://api.agentdyne.com"
	defaultTimeout    = 60 * time.Second
	defaultMaxRetries = 3
	sdkVersion        = "1.0.0"
)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Config holds client configuration.
type Config struct {
	// APIKey is your AgentDyne API key (starts with agd_).
	// Falls back to the AGENTDYNE_API_KEY environment variable.
	APIKey string

	// BaseURL overrides the API endpoint (useful for local development).
	// Default: https://api.agentdyne.com
	BaseURL string

	// MaxRetries controls how many times to retry on 429/5xx responses.
	// Default: 3
	MaxRetries int

	// Timeout is the per-request timeout.
	// Default: 60s
	Timeout time.Duration

	// HTTPClient allows injection of a custom *http.Client.
	HTTPClient *http.Client
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

// Client is the AgentDyne API client.
// Create one with New() or NewWithConfig().
type Client struct {
	apiKey     string
	baseURL    string
	maxRetries int
	http       *http.Client
}

// New creates a client from an API key.
// If apiKey is empty, it falls back to the AGENTDYNE_API_KEY env var.
func New(apiKey string) *Client {
	return NewWithConfig(Config{APIKey: apiKey})
}

// NewWithConfig creates a client from a Config struct.
func NewWithConfig(cfg Config) *Client {
	key := cfg.APIKey
	if key == "" {
		key = os.Getenv("AGENTDYNE_API_KEY")
	}
	if key == "" {
		panic("agentdyne: API key is required. Pass it to New() or set AGENTDYNE_API_KEY")
	}

	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	maxRetries := cfg.MaxRetries
	if maxRetries == 0 {
		maxRetries = defaultMaxRetries
	}

	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: timeout}
	}

	return &Client{
		apiKey:     key,
		baseURL:    baseURL,
		maxRetries: maxRetries,
		http:       httpClient,
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Agent represents a published AI agent on the AgentDyne marketplace.
type Agent struct {
	ID                        string   `json:"id"`
	SellerID                  string   `json:"seller_id"`
	Name                      string   `json:"name"`
	Slug                      string   `json:"slug"`
	Description               string   `json:"description"`
	LongDescription           string   `json:"long_description,omitempty"`
	Category                  string   `json:"category"`
	Tags                      []string `json:"tags"`
	Status                    string   `json:"status"`
	IsFeatured                bool     `json:"is_featured"`
	IsVerified                bool     `json:"is_verified"`
	PricingModel              string   `json:"pricing_model"`
	PricePerCall              float64  `json:"price_per_call"`
	SubscriptionPriceMonthly  float64  `json:"subscription_price_monthly"`
	FreeCallsPerMonth         int      `json:"free_calls_per_month"`
	ModelName                 string   `json:"model_name"`
	AverageRating             float64  `json:"average_rating"`
	TotalReviews              int      `json:"total_reviews"`
	TotalExecutions           int      `json:"total_executions"`
	AverageLatencyMs          int      `json:"average_latency_ms"`
	Version                   string   `json:"version"`
	CreatedAt                 string   `json:"created_at"`
	UpdatedAt                 string   `json:"updated_at"`
	Profiles                  *SellerProfile `json:"profiles,omitempty"`
}

// SellerProfile contains public seller information.
type SellerProfile struct {
	ID         string `json:"id"`
	FullName   string `json:"full_name"`
	Username   string `json:"username,omitempty"`
	AvatarURL  string `json:"avatar_url,omitempty"`
	IsVerified bool   `json:"is_verified"`
}

// Execution represents a single agent run.
type Execution struct {
	ID           string      `json:"id"`
	AgentID      string      `json:"agent_id"`
	UserID       string      `json:"user_id"`
	Status       string      `json:"status"`
	Input        interface{} `json:"input"`
	Output       interface{} `json:"output,omitempty"`
	ErrorMessage string      `json:"error_message,omitempty"`
	TokensInput  int         `json:"tokens_input,omitempty"`
	TokensOutput int         `json:"tokens_output,omitempty"`
	LatencyMs    int         `json:"latency_ms,omitempty"`
	Cost         float64     `json:"cost,omitempty"`
	CreatedAt    string      `json:"created_at"`
	CompletedAt  string      `json:"completed_at,omitempty"`
}

// ExecuteRequest is the payload for an agent execution.
type ExecuteRequest struct {
	Input          interface{} `json:"input"`
	Stream         bool        `json:"stream,omitempty"`
	IdempotencyKey string      `json:"idempotencyKey,omitempty"`
}

// ExecuteResponse is returned by Execute().
type ExecuteResponse struct {
	ExecutionID string      `json:"executionId"`
	Output      interface{} `json:"output"`
	LatencyMs   int         `json:"latencyMs"`
	Tokens      struct {
		Input  int `json:"input"`
		Output int `json:"output"`
	} `json:"tokens"`
	Cost float64 `json:"cost"`
}

// StreamChunk is a single SSE chunk from a streaming execution.
type StreamChunk struct {
	Type        string `json:"type"`  // "delta" | "done" | "error"
	Delta       string `json:"delta,omitempty"`
	ExecutionID string `json:"executionId,omitempty"`
	Error       string `json:"error,omitempty"`
}

// Pagination holds page metadata.
type Pagination struct {
	Total   int  `json:"total"`
	Page    int  `json:"page"`
	Limit   int  `json:"limit"`
	Pages   int  `json:"pages"`
	HasNext bool `json:"hasNext"`
	HasPrev bool `json:"hasPrev"`
}

// Page is a generic paginated result.
type Page[T any] struct {
	Data       []T        `json:"data"`
	Pagination Pagination `json:"pagination"`
}

// ListAgentsParams are the query parameters for ListAgents.
type ListAgentsParams struct {
	Q        string
	Category string
	Pricing  string
	Sort     string
	Page     int
	Limit    int
}

// UserProfile contains the authenticated user's data.
type UserProfile struct {
	ID                       string  `json:"id"`
	Email                    string  `json:"email"`
	FullName                 string  `json:"full_name,omitempty"`
	Username                 string  `json:"username,omitempty"`
	Role                     string  `json:"role"`
	SubscriptionPlan         string  `json:"subscription_plan"`
	MonthlyExecutionQuota    int     `json:"monthly_execution_quota"`
	ExecutionsUsedThisMonth  int     `json:"executions_used_this_month"`
	TotalEarned              float64 `json:"total_earned"`
	CreatedAt                string  `json:"created_at"`
}

// UserQuota holds the current quota usage.
type UserQuota struct {
	Plan        string  `json:"plan"`
	Quota       int     `json:"quota"`
	Used        int     `json:"used"`
	Remaining   int     `json:"remaining"`
	PercentUsed float64 `json:"percentUsed"`
	ResetsAt    string  `json:"resetsAt"`
}

// Review is a user review on a marketplace agent.
type Review struct {
	ID        string `json:"id"`
	AgentID   string `json:"agent_id"`
	Rating    int    `json:"rating"`
	Title     string `json:"title,omitempty"`
	Body      string `json:"body,omitempty"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

// WebhookEvent is a verified incoming webhook payload.
type WebhookEvent struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Timestamp string                 `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

// ListAgents returns a paginated list of marketplace agents.
//
//	page, err := client.ListAgents(ctx, &agentdyne.ListAgentsParams{
//	    Category: "coding",
//	    Sort:     "rating",
//	    Limit:    10,
//	})
func (c *Client) ListAgents(ctx context.Context, params *ListAgentsParams) (*Page[Agent], error) {
	q := url.Values{}
	if params != nil {
		if params.Q != ""        { q.Set("q", params.Q) }
		if params.Category != "" { q.Set("category", params.Category) }
		if params.Pricing != ""  { q.Set("pricing", params.Pricing) }
		if params.Sort != ""     { q.Set("sort", params.Sort) }
		if params.Page > 0       { q.Set("page", strconv.Itoa(params.Page)) }
		if params.Limit > 0      { q.Set("limit", strconv.Itoa(params.Limit)) }
	}
	path := "/v1/agents"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var result Page[Agent]
	if err := c.get(ctx, path, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetAgent retrieves a single agent by ID.
func (c *Client) GetAgent(ctx context.Context, agentID string) (*Agent, error) {
	var result Agent
	if err := c.get(ctx, "/v1/agents/"+agentID, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// SearchAgents searches agents by keyword — convenience wrapper around ListAgents.
func (c *Client) SearchAgents(ctx context.Context, query string, params *ListAgentsParams) (*Page[Agent], error) {
	if params == nil {
		params = &ListAgentsParams{}
	}
	params.Q = query
	return c.ListAgents(ctx, params)
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

// Execute runs an agent and returns the full output.
//
//	result, err := client.Execute(ctx, "agent_id", "Summarize this...")
//	// or with a structured input
//	result, err := client.Execute(ctx, "agent_id", map[string]any{"text": "..."})
func (c *Client) Execute(ctx context.Context, agentID string, input interface{}) (*ExecuteResponse, error) {
	return c.ExecuteWithOptions(ctx, agentID, &ExecuteRequest{Input: input})
}

// ExecuteWithOptions is Execute with full request control.
func (c *Client) ExecuteWithOptions(ctx context.Context, agentID string, req *ExecuteRequest) (*ExecuteResponse, error) {
	var result ExecuteResponse
	if err := c.post(ctx, "/v1/agents/"+agentID+"/execute", req, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Stream runs an agent and sends chunks to the provided channel.
// The channel is closed when streaming is complete or an error occurs.
//
//	ch := make(chan agentdyne.StreamChunk, 32)
//	go func() {
//	    if err := client.Stream(ctx, "agent_id", "Hello", ch); err != nil {
//	        log.Println("stream error:", err)
//	    }
//	}()
//	for chunk := range ch {
//	    if chunk.Type == "delta" { fmt.Print(chunk.Delta) }
//	}
func (c *Client) Stream(ctx context.Context, agentID string, input interface{}, ch chan<- StreamChunk) error {
	defer close(ch)

	body, err := json.Marshal(ExecuteRequest{Input: input, Stream: true})
	if err != nil {
		return fmt.Errorf("agentdyne: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		"POST",
		c.baseURL+"/v1/agents/"+agentID+"/execute",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	c.addHeaders(req, true)

	resp, err := c.http.Do(req)
	if err != nil {
		return &NetworkError{Cause: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return parseErrorResponse(resp)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			return nil
		}
		var chunk StreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			ch <- StreamChunk{Type: "delta", Delta: data}
		} else {
			ch <- chunk
			if chunk.Type == "done" {
				return nil
			}
		}
	}
	return scanner.Err()
}

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------

// GetExecution retrieves a single execution by ID.
func (c *Client) GetExecution(ctx context.Context, executionID string) (*Execution, error) {
	var result Execution
	if err := c.get(ctx, "/v1/executions/"+executionID, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// PollExecution polls until the execution reaches a terminal state.
//
//	exec, err := client.PollExecution(ctx, "exec_id",
//	    agentdyne.WithInterval(500*time.Millisecond),
//	    agentdyne.WithPollTimeout(60*time.Second),
//	)
func (c *Client) PollExecution(ctx context.Context, executionID string, opts ...PollOption) (*Execution, error) {
	cfg := pollConfig{interval: time.Second, timeout: 120 * time.Second}
	for _, o := range opts {
		o(&cfg)
	}
	deadline := time.Now().Add(cfg.timeout)
	terminal := map[string]bool{"success": true, "failed": true, "timeout": true}

	for time.Now().Before(deadline) {
		exec, err := c.GetExecution(ctx, executionID)
		if err != nil {
			return nil, err
		}
		if terminal[exec.Status] {
			return exec, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(cfg.interval):
		}
	}
	return nil, fmt.Errorf("agentdyne: execution %q did not complete within %s", executionID, cfg.timeout)
}

type pollConfig struct {
	interval time.Duration
	timeout  time.Duration
}

// PollOption configures PollExecution behaviour.
type PollOption func(*pollConfig)

// WithInterval sets the polling interval.
func WithInterval(d time.Duration) PollOption {
	return func(c *pollConfig) { c.interval = d }
}

// WithPollTimeout sets the maximum time to wait.
func WithPollTimeout(d time.Duration) PollOption {
	return func(c *pollConfig) { c.timeout = d }
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

// Me returns the authenticated user's profile.
func (c *Client) Me(ctx context.Context) (*UserProfile, error) {
	var result UserProfile
	if err := c.get(ctx, "/v1/user/me", &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// MyQuota returns quota usage for the current billing period.
func (c *Client) MyQuota(ctx context.Context) (*UserQuota, error) {
	var result UserQuota
	if err := c.get(ctx, "/v1/user/quota", &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

// ConstructWebhookEvent verifies and parses an incoming AgentDyne webhook.
// Returns WebhookSignatureError if the HMAC-SHA256 signature is invalid.
func (c *Client) ConstructWebhookEvent(payload []byte, signature, secret string) (*WebhookEvent, error) {
	return VerifyWebhookSignature(payload, signature, secret)
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func (c *Client) get(ctx context.Context, path string, out interface{}) error {
	return c.doWithRetry(ctx, "GET", path, nil, out)
}

func (c *Client) post(ctx context.Context, path string, body, out interface{}) error {
	return c.doWithRetry(ctx, "POST", path, body, out)
}

func (c *Client) doWithRetry(ctx context.Context, method, path string, body, out interface{}) error {
	var lastErr error
	for attempt := 0; attempt <= c.maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoffDelay(attempt - 1)):
			}
		}

		err := c.do(ctx, method, path, body, out)
		if err == nil {
			return nil
		}

		// Retry on rate limits and server errors only
		switch e := err.(type) {
		case *RateLimitError:
			if attempt < c.maxRetries {
				time.Sleep(time.Duration(e.RetryAfterSeconds * float64(time.Second)))
				lastErr = err
				continue
			}
		case *AgentDyneAPIError:
			if e.StatusCode >= 500 && attempt < c.maxRetries {
				lastErr = err
				continue
			}
			return err
		case *NetworkError:
			if attempt < c.maxRetries {
				lastErr = err
				continue
			}
		}
		return err
	}
	return lastErr
}

func (c *Client) do(ctx context.Context, method, path string, body, out interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("agentdyne: marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("agentdyne: create request: %w", err)
	}
	c.addHeaders(req, false)

	resp, err := c.http.Do(req)
	if err != nil {
		return &NetworkError{Cause: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return parseErrorResponse(resp)
	}

	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("agentdyne: decode response: %w", err)
		}
	}
	return nil
}

func (c *Client) addHeaders(req *http.Request, stream bool) {
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "agentdyne-go/"+sdkVersion)
	req.Header.Set("X-SDK-Language", "go")
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	} else {
		req.Header.Set("Accept", "application/json")
	}
}

// backoffDelay returns a full-jitter exponential backoff duration.
func backoffDelay(attempt int) time.Duration {
	base := 500.0 // ms
	cap_  := 30_000.0
	ceiling := math.Min(cap_, base*math.Pow(2, float64(attempt)))
	ms := rand.Float64() * ceiling
	return time.Duration(ms) * time.Millisecond
}

func parseErrorResponse(resp *http.Response) error {
	var body struct {
		Error   string            `json:"error"`
		Message string            `json:"message"`
		Code    string            `json:"code"`
		Fields  map[string]string `json:"fields"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)

	message := body.Error
	if message == "" {
		message = body.Message
	}
	if message == "" {
		message = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}

	switch resp.StatusCode {
	case 401:
		return &AuthError{Message: message}
	case 403:
		if body.Code == "SUBSCRIPTION_REQUIRED" {
			return &SubscriptionRequiredError{}
		}
		return &PermissionError{Message: message}
	case 404:
		return &NotFoundError{Message: message}
	case 429:
		if body.Code == "QUOTA_EXCEEDED" {
			return &QuotaExceededError{}
		}
		retryAfter := 60.0
		if v := resp.Header.Get("Retry-After"); v != "" {
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				retryAfter = f
			}
		}
		return &RateLimitError{RetryAfterSeconds: retryAfter}
	default:
		if resp.StatusCode >= 500 {
			return &AgentDyneAPIError{StatusCode: resp.StatusCode, Message: message, Code: body.Code}
		}
		return &AgentDyneAPIError{StatusCode: resp.StatusCode, Message: message, Code: body.Code}
	}
}
