# agentdyne

Official Ruby SDK for [AgentDyne](https://agentdyne.com) — The Global Microagent Marketplace.

[![Gem Version](https://badge.fury.io/rb/agentdyne.svg)](https://rubygems.org/gems/agentdyne)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Installation

```ruby
# Gemfile
gem "agentdyne"
```

```bash
bundle install
# or standalone:
gem install agentdyne
```

## Quick Start

```ruby
require "agentdyne"

client = AgentDyne.new(api_key: "agd_your_key_here")

result = client.execute("agent_id", "Summarize this email thread...")
puts result.output
# => { "summary" => "...", "action_items" => [...] }

puts "Latency: #{result.latency_ms}ms   Cost: $#{"%.6f" % result.cost}"
```

## Authentication

```bash
export AGENTDYNE_API_KEY=agd_your_key_here
```

```ruby
# Reads from env automatically
client = AgentDyne.new

# Or pass directly
client = AgentDyne.new(api_key: "agd_...")
```

## Usage

### List Agents

```ruby
page = client.list_agents(category: "coding", sort: "rating", limit: 10)
page.data.each do |agent|
  puts "#{agent.name}  ★#{agent.average_rating}  #{agent.pricing_model}"
end
puts "Total: #{page.pagination.total}"
```

### Execute an Agent

```ruby
# String input
result = client.execute("email-summarizer-pro", "Hi team, the Q4 report is attached...")

# Structured input
result = client.execute("code-review-agent", {
  code: "def add(a, b)\n  a + b\nend",
  language: "ruby"
})

# With idempotency key (safe to retry on network failure)
result = client.execute("agent_id", "Hello", idempotency_key: SecureRandom.uuid)

puts result.output
puts "#{result.tokens.input} in / #{result.tokens.output} out tokens"
```

### Streaming

```ruby
client.stream("content-writer", "Write a blog post about AI agents in 2026") do |chunk|
  case chunk.type
  when "delta"
    print chunk.delta
    $stdout.flush
  when "done"
    puts "\n✓ Done (execution: #{chunk.execution_id})"
  when "error"
    warn "Stream error: #{chunk.error}"
  end
end
```

### Poll Execution

```ruby
# Start an execution (imagine it was async)
exec = client.poll_execution("exec_id", interval: 0.5, timeout: 60)
puts exec.status  # => "success"
puts exec.output
```

### Paginate All Agents

```ruby
# Automatically pages through all results
client.paginate_agents(category: "finance").each do |agent|
  puts agent.name
end
```

### User & Quota

```ruby
me = client.me
puts me.subscription_plan  # => "pro"
puts me.full_name

quota = client.my_quota
puts "#{quota.used}/#{quota.quota} calls used (#{quota.percent_used}%)"
puts "Resets: #{quota.resets_at}"

# Update profile
client.update_profile(full_name: "Ada Lovelace", bio: "Building AI agents")
```

### Reviews

```ruby
# List reviews
page = client.list_reviews("agent_id")
page.data.each { |r| puts "★#{r.rating} — #{r.title}" }

# Post a review (must have executed the agent first)
review = client.create_review("agent_id",
  rating: 5,
  title:  "Incredible accuracy",
  body:   "Handles every edge case I've thrown at it."
)
```

### Webhooks

```ruby
# Rails controller
class WebhooksController < ApplicationController
  skip_before_action :verify_authenticity_token

  def agentdyne
    client = AgentDyne.new
    event  = client.construct_webhook_event(
      request.raw_post,
      request.headers["X-AgentDyne-Signature"],
      ENV["AGENTDYNE_WEBHOOK_SECRET"]
    )

    case event.type
    when "execution.completed"
      Rails.logger.info "Execution done: #{event.data["executionId"]}"
    when "payout.processed"
      Payout.record!(event.data)
    end

    head :ok

  rescue AgentDyne::WebhookSignatureError
    head :bad_request
  end
end
```

```ruby
# Sinatra
post "/webhook" do
  client = AgentDyne.new
  event  = client.construct_webhook_event(
    request.body.read,
    request.env["HTTP_X_AGENTDYNE_SIGNATURE"],
    ENV["AGENTDYNE_WEBHOOK_SECRET"]
  )
  "OK"
rescue AgentDyne::WebhookSignatureError
  [400, "Invalid signature"]
end
```

## Error Handling

Every error inherits from `AgentDyne::AgentDyneError`:

```ruby
require "agentdyne"

begin
  result = client.execute("agent_id", "Hello")
rescue AgentDyne::QuotaExceededError => e
  puts "Upgrade at agentdyne.com/billing (plan: #{e.plan})"
rescue AgentDyne::RateLimitError => e
  sleep e.retry_after_seconds
  retry
rescue AgentDyne::SubscriptionRequiredError => e
  puts "Subscribe to use agent: #{e.agent_id}"
rescue AgentDyne::NotFoundError
  puts "Agent not found"
rescue AgentDyne::AuthenticationError
  puts "Check your API key"
rescue AgentDyne::AgentDyneError => e
  puts "#{e.message} (HTTP #{e.status_code}, code=#{e.code})"
end
```

## Configuration

```ruby
client = AgentDyne.new(
  api_key:     "agd_...",
  base_url:    "http://localhost:3000",  # local dev override
  max_retries: 3,                        # retries on 429/5xx
  timeout:     60                        # seconds
)
```

## Requirements

- Ruby >= 3.1
- No required dependencies (uses stdlib `net/http`, `openssl`, `json`)
- Optional: `rack` gem for `secure_compare` in webhook verification

## License

MIT © 2026 AgentDyne, Inc.
