# frozen_string_literal: true

require "json"
require "net/http"
require "openssl"

module AgentDyne
  # Internal HTTP client. Not intended for direct use.
  class HttpClient # :nodoc:
    SDK_VERSION    = AgentDyne::VERSION
    DEFAULT_TIMEOUT  = 60
    NON_RETRYABLE   = [400, 401, 403, 404, 422].freeze

    def initialize(api_key:, base_url:, timeout:, max_retries:)
      @api_key     = api_key
      @base_url    = URI(base_url.chomp("/"))
      @timeout     = timeout
      @max_retries = max_retries
    end

    def get(path, params = {})
      request_with_retry(:get, path, params: params)
    end

    def post(path, body = nil)
      request_with_retry(:post, path, body: body)
    end

    def patch(path, body = nil)
      request_with_retry(:patch, path, body: body)
    end

    def delete(path)
      request_with_retry(:delete, path)
    end

    # Yields raw SSE data lines.
    def stream(path, body, &block)
      uri = build_uri(path)
      http = build_http(uri)

      req = Net::HTTP::Post.new(uri)
      apply_headers(req, stream: true)
      req.body = JSON.generate(body)

      http.request(req) do |resp|
        raise_for_status(resp) unless resp.is_a?(Net::HTTPSuccess)
        resp.read_body do |chunk|
          chunk.each_line do |line|
            line = line.strip
            next unless line.start_with?("data: ")
            data = line[6..]
            return if data == "[DONE]"
            block.call(data)
          end
        end
      end
    rescue Errno::ECONNREFUSED, Errno::ETIMEDOUT, SocketError => e
      raise NetworkError.new(e.message, cause: e)
    end

    private

    def request_with_retry(method, path, params: {}, body: nil)
      last_error = nil

      (@max_retries + 1).times do |attempt|
        if attempt > 0
          sleep(backoff_delay(attempt - 1))
        end

        begin
          result = execute_request(method, path, params: params, body: body)
          return result
        rescue RateLimitError => e
          sleep(e.retry_after_seconds) if attempt < @max_retries
          last_error = e
        rescue AgentDyneError => e
          raise if NON_RETRYABLE.include?(e.status_code)
          raise if e.status_code && e.status_code < 500
          last_error = e
        rescue NetworkError => e
          last_error = e
        end
      end

      raise last_error
    end

    def execute_request(method, path, params: {}, body: nil)
      uri  = build_uri(path, params)
      http = build_http(uri)
      req  = build_request(method, uri, body)

      resp = http.request(req)
      raise_for_status(resp)

      body_str = resp.body
      return nil if body_str.nil? || body_str.empty?
      JSON.parse(body_str)
    rescue Errno::ECONNREFUSED, Errno::ETIMEDOUT, SocketError => e
      raise NetworkError.new(e.message, cause: e)
    end

    def build_uri(path, params = {})
      uri = URI.join(@base_url.to_s + "/", path.delete_prefix("/"))
      unless params.empty?
        uri.query = URI.encode_www_form(params.compact)
      end
      uri
    end

    def build_http(uri)
      http              = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl      = uri.scheme == "https"
      http.read_timeout = @timeout
      http.open_timeout = @timeout
      http
    end

    def build_request(method, uri, body)
      klass = {
        get:    Net::HTTP::Get,
        post:   Net::HTTP::Post,
        patch:  Net::HTTP::Patch,
        delete: Net::HTTP::Delete,
      }[method]
      req = klass.new(uri)
      apply_headers(req)
      req.body = JSON.generate(body) if body
      req
    end

    def apply_headers(req, stream: false)
      req["Authorization"] = "Bearer #{@api_key}"
      req["Content-Type"]  = "application/json"
      req["Accept"]        = stream ? "text/event-stream" : "application/json"
      req["User-Agent"]    = "agentdyne-ruby/#{SDK_VERSION}"
      req["X-SDK-Language"]= "ruby"
    end

    def raise_for_status(resp)
      return if resp.is_a?(Net::HTTPSuccess)

      status   = resp.code.to_i
      raw_body = resp.body.to_s
      body     = begin; JSON.parse(raw_body); rescue JSON::ParserError; {}; end

      message = body["error"] || body["message"] || "HTTP #{status}"
      code    = body["code"]

      case status
      when 400 then raise ValidationError.new(message, fields: body["fields"], raw: body)
      when 401 then raise AuthenticationError.new(message, raw: body)
      when 403
        if code == "SUBSCRIPTION_REQUIRED"
          raise SubscriptionRequiredError.new(nil, raw: body)
        end
        raise PermissionDeniedError.new(message, raw: body)
      when 404 then raise NotFoundError.new(message, raw: body)
      when 429
        if code == "QUOTA_EXCEEDED"
          raise QuotaExceededError.new(nil, raw: body)
        end
        retry_after = (resp["Retry-After"] || "60").to_f
        raise RateLimitError.new(retry_after, raw: body)
      else
        if status >= 500
          raise InternalServerError.new(message, raw: body)
        end
        raise AgentDyneError.new(message, status_code: status, code: code, raw: body)
      end
    end

    def backoff_delay(attempt)
      base    = 0.5
      cap     = 30.0
      ceiling = [cap, base * (2**attempt)].min
      rand * ceiling
    end
  end
end
