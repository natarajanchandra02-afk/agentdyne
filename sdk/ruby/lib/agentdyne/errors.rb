# frozen_string_literal: true

module AgentDyne
  # Base error for all AgentDyne SDK exceptions.
  class AgentDyneError < StandardError
    attr_reader :status_code, :code, :raw

    def initialize(message, status_code: nil, code: nil, raw: nil)
      super(message)
      @status_code = status_code
      @code        = code
      @raw         = raw
    end

    def to_h
      { error: self.class.name, message: message, status_code: status_code, code: code }
    end
  end

  # HTTP 401 — API key missing, invalid, or revoked.
  class AuthenticationError < AgentDyneError
    def initialize(message = "Invalid or missing API key", raw: nil)
      super(message, status_code: 401, code: "AUTHENTICATION_ERROR", raw: raw)
    end
  end

  # HTTP 403 — insufficient permissions.
  class PermissionDeniedError < AgentDyneError
    def initialize(message = "Permission denied", raw: nil)
      super(message, status_code: 403, code: "PERMISSION_DENIED", raw: raw)
    end
  end

  # HTTP 403 / SUBSCRIPTION_REQUIRED — agent requires subscription.
  class SubscriptionRequiredError < AgentDyneError
    attr_reader :agent_id

    def initialize(agent_id = nil, raw: nil)
      msg = agent_id ? "Agent \"#{agent_id}\" requires an active subscription" : "Subscription required"
      super(msg, status_code: 403, code: "SUBSCRIPTION_REQUIRED", raw: raw)
      @agent_id = agent_id
    end
  end

  # HTTP 404 — resource not found.
  class NotFoundError < AgentDyneError
    def initialize(message = "Resource not found", raw: nil)
      super(message, status_code: 404, code: "NOT_FOUND", raw: raw)
    end
  end

  # HTTP 400 — malformed request or missing required fields.
  class ValidationError < AgentDyneError
    attr_reader :fields

    def initialize(message, fields: nil, raw: nil)
      super(message, status_code: 400, code: "VALIDATION_ERROR", raw: raw)
      @fields = fields || {}
    end
  end

  # HTTP 429 — per-minute rate limit exceeded.
  class RateLimitError < AgentDyneError
    attr_reader :retry_after_seconds

    def initialize(retry_after_seconds = 60.0, raw: nil)
      super("Rate limit exceeded. Retry after #{retry_after_seconds.to_i}s",
            status_code: 429, code: "RATE_LIMIT_EXCEEDED", raw: raw)
      @retry_after_seconds = retry_after_seconds
    end
  end

  # HTTP 429 / QUOTA_EXCEEDED — monthly execution quota exhausted.
  class QuotaExceededError < AgentDyneError
    attr_reader :plan

    def initialize(plan = nil, raw: nil)
      msg = plan ? "Monthly quota exceeded on \"#{plan}\" plan. Please upgrade." : "Monthly quota exceeded."
      super(msg, status_code: 429, code: "QUOTA_EXCEEDED", raw: raw)
      @plan = plan
    end
  end

  # 5xx — unrecoverable server error.
  class InternalServerError < AgentDyneError
    def initialize(message = "Internal server error", raw: nil)
      super(message, status_code: 500, code: "INTERNAL_SERVER_ERROR", raw: raw)
    end
  end

  # Network-level failure (connection refused, DNS, TLS).
  class NetworkError < AgentDyneError
    def initialize(message, cause: nil)
      super(message, code: "NETWORK_ERROR")
      set_backtrace(cause&.backtrace)
    end
  end

  # Webhook HMAC-SHA256 signature verification failed.
  class WebhookSignatureError < AgentDyneError
    def initialize(message = "Webhook signature verification failed")
      super(message, code: "WEBHOOK_SIGNATURE_INVALID")
    end
  end
end
