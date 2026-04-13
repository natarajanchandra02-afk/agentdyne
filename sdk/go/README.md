# agentdyne-go

Official Go client for [AgentDyne](https://agentdyne.com) — The Global Microagent Marketplace.

[![Go Reference](https://pkg.go.dev/badge/github.com/agentdyne/go.svg)](https://pkg.go.dev/github.com/agentdyne/go)
[![Go Report Card](https://goreportcard.com/badge/github.com/agentdyne/go)](https://goreportcard.com/report/github.com/agentdyne/go)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Installation

```bash
go get github.com/agentdyne/go
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    agentdyne "github.com/agentdyne/go"
)

func main() {
    client := agentdyne.New("agd_your_key_here")
    // or: agentdyne.New("") to use AGENTDYNE_API_KEY env var

    ctx := context.Background()

    result, err := client.Execute(ctx, "agent_id", "Summarize this email...")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Output: %v\n", result.Output)
    fmt.Printf("Latency: %dms  Cost: $%.6f\n", result.LatencyMs, result.Cost)
}
```

## Usage

### List Agents

```go
page, err := client.ListAgents(ctx, &agentdyne.ListAgentsParams{
    Category: "coding",
    Sort:     "rating",
    Limit:    10,
})
if err != nil {
    log.Fatal(err)
}
for _, agent := range page.Data {
    fmt.Printf("%-40s  ★%.1f  %s\n", agent.Name, agent.AverageRating, agent.PricingModel)
}
fmt.Printf("Total: %d agents\n", page.Pagination.Total)
```

### Execute an Agent

```go
// String input
result, err := client.Execute(ctx, "email-summarizer-pro", "Hi team, see the Q4 report...")

// Structured input
result, err := client.Execute(ctx, "code-review-agent", map[string]any{
    "code":     "def add(a, b): return a + b",
    "language": "python",
})

// Full control with options
result, err := client.ExecuteWithOptions(ctx, "agent_id", &agentdyne.ExecuteRequest{
    Input:          "Hello",
    IdempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
})
```

### Streaming

```go
ch := make(chan agentdyne.StreamChunk, 64)
errCh := make(chan error, 1)

go func() {
    errCh <- client.Stream(ctx, "content-writer", "Write a blog post about Go", ch)
}()

for chunk := range ch {
    switch chunk.Type {
    case "delta":
        fmt.Print(chunk.Delta)
    case "done":
        fmt.Println("\n✓ Done:", chunk.ExecutionID)
    case "error":
        fmt.Println("Error:", chunk.Error)
    }
}

if err := <-errCh; err != nil {
    log.Fatal(err)
}
```

### Poll Execution

```go
exec, err := client.PollExecution(
    ctx,
    "exec_id",
    agentdyne.WithInterval(500*time.Millisecond),
    agentdyne.WithPollTimeout(60*time.Second),
)
if err != nil {
    log.Fatal(err)
}
fmt.Println(exec.Status, exec.Output)
```

### User & Quota

```go
me, _ := client.Me(ctx)
fmt.Println(me.SubscriptionPlan)

quota, _ := client.MyQuota(ctx)
fmt.Printf("%d/%d calls used (%.1f%%)\n", quota.Used, quota.Quota, quota.PercentUsed)
```

### Error Handling

```go
import (
    agentdyne "github.com/agentdyne/go"
    "errors"
    "time"
)

result, err := client.Execute(ctx, "agent_id", "Hello")
if err != nil {
    var rateLimitErr *agentdyne.RateLimitError
    var quotaErr     *agentdyne.QuotaExceededError
    var notFoundErr  *agentdyne.NotFoundError
    var authErr      *agentdyne.AuthError

    switch {
    case errors.As(err, &rateLimitErr):
        time.Sleep(time.Duration(rateLimitErr.RetryAfterSeconds) * time.Second)
    case errors.As(err, &quotaErr):
        fmt.Println("Upgrade at agentdyne.com/billing")
    case errors.As(err, &notFoundErr):
        fmt.Println("Agent not found")
    case errors.As(err, &authErr):
        fmt.Println("Check your API key")
    default:
        log.Fatal(err)
    }
}
```

### Webhook Verification

```go
// In a net/http handler:
func webhookHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    sig := r.Header.Get("X-AgentDyne-Signature")

    event, err := agentdyne.VerifyWebhookSignature(body, sig, os.Getenv("WEBHOOK_SECRET"))
    if err != nil {
        http.Error(w, "Invalid signature", 400)
        return
    }

    switch event.Type {
    case "execution.completed":
        fmt.Println("Execution done:", event.Data)
    }
    w.WriteHeader(200)
}
```

## Configuration

```go
client := agentdyne.NewWithConfig(agentdyne.Config{
    APIKey:     "agd_...",
    BaseURL:    "http://localhost:3000",  // local dev override
    MaxRetries: 3,
    Timeout:    30 * time.Second,
    HTTPClient: &http.Client{},           // custom HTTP client
})
```

## Requirements

- Go 1.22+
- Zero required dependencies (pure stdlib)

## License

MIT © 2026 AgentDyne, Inc.
