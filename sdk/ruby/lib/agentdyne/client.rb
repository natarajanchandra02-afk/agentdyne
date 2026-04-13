# frozen_string_literal: true

require "json"
require "openssl"
require "ostruct"

module AgentDyne
  # The main AgentDyne Ruby client.
  #
  # @example
  #   client = AgentDyne::Client.new(api_key: "agd_...")
  #   result = client.execute("agent_id", "Summarize this...")
  #   puts result.output
  #
  class Client
    TERMINAL_STATUSES = %w[success failed timeout].freeze

    # @param api_key [String] Your AgentDyne API key. Falls back to
    #   the AGENTDYNE_API_KEY environment variable.
    # @param base_url [String] API base URL (default: https://api.agentdyne.com).
    # @param max_retries [Integer] Retries on 429/5xx (default: 3).
    # @param timeout [Integer] Request timeout in seconds (default: 60).
    def initialize(
      api_key: nil,
      base_url: "https://api.agentdyne.com",
      max_retries: 3,
      timeout: 60
    )
      resolved_key = api_key || ENV["AGENTDYNE_API_KEY"]
      raise ArgumentError, "AgentDyne API key is required. Pass api_key: or set AGENTDYNE_API_KEY." if resolved_key.nil? || resolved_key.empty?

      @http = HttpClient.new(
        api_key:     resolved_key,
        base_url:    base_url,
        timeout:     timeout,
        max_retries: max_retries,
      )
    end

    # ── Agents ──────────────────────────────────────────────────────────────

    # List agents with optional filters.
    #
    # @param q [String, nil] Full-text search query.
    # @param category [String, nil] Agent category.
    # @param pricing [String, nil] Pricing model filter.
    # @param sort [String, nil] Sort order ("popular", "rating", "newest").
    # @param page [Integer] Page number (default: 1).
    # @param limit [Integer] Results per page (default: 24, max: 100).
    # @return [OpenStruct] with .data (Array) and .pagination.
    #
    # @example
    #   page = client.list_agents(category: "coding", sort: "rating")
    #   page.data.each { |a| puts "#{a['name']} ★#{a['average_rating']}" }
    def list_agents(q: nil, category: nil, pricing: nil, sort: nil, page: 1, limit: 24)
      params = { page: page, limit: limit }
      params[:q]        = q        if q
      params[:category] = category if category
      params[:pricing]  = pricing  if pricing
      params[:sort]     = sort     if sort
      raw = @http.get("/v1/agents", params)
      to_ostruct(raw)
    end

    # Get a single agent by ID.
    #
    # @return [OpenStruct]
    def get_agent(agent_id)
      to_ostruct(@http.get("/v1/agents/#{agent_id}"))
    end

    # Search agents by keyword.
    def search_agents(query, **kwargs)
      list_agents(q: query, **kwargs)
    end

    # Iterate through ALL matching agents across pages automatically.
    #
    # @example
    #   client.paginate_agents(category: "finance").each { |a| puts a.name }
    def paginate_agents(**kwargs)
      Enumerator.new do |y|
        p = 1
        loop do
          page = list_agents(page: p, **kwargs)
          page.data.each { |item| y << to_ostruct(item) }
          break unless page.pagination.has_next
          p += 1
        end
      end
    end

    # ── Execution ────────────────────────────────────────────────────────────

    # Execute an agent synchronously and return the output.
    #
    # @param agent_id [String]
    # @param input [String, Hash, Array] Input to the agent.
    # @param idempotency_key [String, nil] Optional UUID for safe retries.
    # @return [OpenStruct] with .output, .latency_ms, .cost, .tokens, .execution_id
    #
    # @example
    #   result = client.execute("code-review-agent", { code: "def f(): pass", language: "python" })
    #   puts result.output
    def execute(agent_id, input, idempotency_key: nil)
      body = { input: input }
      body[:idempotencyKey] = idempotency_key if idempotency_key
      raw = @http.post("/v1/agents/#{agent_id}/execute", body)
      to_ostruct(raw)
    end

    # Stream an agent's output.
    # Yields StreamChunk-like OpenStructs with .type, .delta, .execution_id.
    #
    # @example
    #   client.stream("content-writer", "Write a haiku about Ruby") do |chunk|
    #     print chunk.delta if chunk.type == "delta"
    #   end
    def stream(agent_id, input, &block)
      @http.stream("/v1/agents/#{agent_id}/execute", { input: input, stream: true }) do |raw_line|
        begin
          data  = JSON.parse(raw_line)
          chunk = OpenStruct.new(
            type:         data["type"] || "delta",
            delta:        data["delta"],
            execution_id: data["executionId"],
            error:        data["error"],
          )
        rescue JSON::ParserError
          chunk = OpenStruct.new(type: "delta", delta: raw_line)
        end
        block.call(chunk)
        return if chunk.type == "done"
      end
    end

    # ── Executions ───────────────────────────────────────────────────────────

    # Get a single execution by ID.
    def get_execution(execution_id)
      to_ostruct(@http.get("/v1/executions/#{execution_id}"))
    end

    # List execution history.
    def list_executions(agent_id: nil, status: nil, page: 1, limit: 20)
      params = { page: page, limit: limit }
      params[:agentId] = agent_id if agent_id
      params[:status]  = status   if status
      to_ostruct(@http.get("/v1/executions", params))
    end

    # Poll until an execution reaches a terminal state.
    #
    # @param interval [Float] Seconds between polls (default: 1.0).
    # @param timeout [Float] Maximum seconds to wait (default: 120.0).
    # @raise [AgentDyneError] if the execution does not complete in time.
    #
    # @example
    #   exec = client.poll_execution("exec_id", interval: 0.5)
    def poll_execution(execution_id, interval: 1.0, timeout: 120.0)
      deadline = Time.now + timeout
      loop do
        ex = get_execution(execution_id)
        return ex if TERMINAL_STATUSES.include?(ex.status)
        raise AgentDyneError, "Execution \"#{execution_id}\" did not complete within #{timeout}s" if Time.now > deadline
        sleep(interval)
      end
    end

    # ── User ─────────────────────────────────────────────────────────────────

    # Return the authenticated user's profile.
    def me
      to_ostruct(@http.get("/v1/user/me"))
    end

    # Return quota usage for the current billing period.
    def my_quota
      to_ostruct(@http.get("/v1/user/quota"))
    end

    # Update profile fields.
    def update_profile(**updates)
      to_ostruct(@http.patch("/v1/user/me", updates))
    end

    # ── Reviews ──────────────────────────────────────────────────────────────

    # List approved reviews for an agent.
    def list_reviews(agent_id, page: 1, limit: 20)
      to_ostruct(@http.get("/v1/agents/#{agent_id}/reviews", { page: page, limit: limit }))
    end

    # Post a review for an agent.
    def create_review(agent_id, rating:, title: nil, body: nil)
      payload = { rating: rating }
      payload[:title] = title if title
      payload[:body]  = body  if body
      to_ostruct(@http.post("/v1/agents/#{agent_id}/reviews", payload))
    end

    # ── Notifications ────────────────────────────────────────────────────────

    # List your notifications.
    def list_notifications
      @http.get("/v1/notifications").fetch("notifications", []).map { |n| to_ostruct(n) }
    end

    # Mark all notifications as read.
    def mark_notifications_read
      @http.patch("/v1/notifications").fetch("ok", false)
    end

    # ── Webhooks ─────────────────────────────────────────────────────────────

    # Verify and parse an incoming AgentDyne webhook.
    #
    # Raises WebhookSignatureError if the signature is invalid.
    #
    # @param payload [String] Raw request body.
    # @param signature [String] Value of X-AgentDyne-Signature header.
    # @param secret [String] Your webhook signing secret.
    # @return [OpenStruct] Parsed event with .type and .data.
    #
    # @example (Sinatra)
    #   post "/webhook" do
    #     event = client.construct_webhook_event(
    #       request.body.read,
    #       request.env["HTTP_X_AGENTDYNE_SIGNATURE"],
    #       ENV["WEBHOOK_SECRET"]
    #     )
    #     case event.type
    #     when "execution.completed" then process_execution(event.data)
    #     end
    #     "OK"
    #   end
    def construct_webhook_event(payload, signature, secret)
      sig_clean = signature.to_s.sub(/^sha256=/, "")
      expected  = OpenSSL::HMAC.hexdigest("SHA256", secret, payload)

      unless Rack::Utils.secure_compare(expected, sig_clean) rescue (expected == sig_clean)
        raise WebhookSignatureError
      end

      begin
        to_ostruct(JSON.parse(payload))
      rescue JSON::ParserError
        raise WebhookSignatureError, "Webhook payload is not valid JSON"
      end
    end

    private

    def to_ostruct(obj)
      case obj
      when Hash  then OpenStruct.new(obj.transform_values { |v| to_ostruct(v) })
      when Array then obj.map { |item| to_ostruct(item) }
      else            obj
      end
    end
  end
end
