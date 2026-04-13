# frozen_string_literal: true

# lib/agentdyne.rb — AgentDyne Ruby SDK main entry point.
#
# Quick start:
#
#   require "agentdyne"
#
#   client = AgentDyne::Client.new(api_key: "agd_...")
#   result = client.execute("agent_id", "Summarize this email...")
#   puts result.output
#

require_relative "agentdyne/version"
require_relative "agentdyne/errors"
require_relative "agentdyne/types"
require_relative "agentdyne/http"
require_relative "agentdyne/client"

module AgentDyne
  # Convenience constructor — mirrors Python and Node patterns.
  #
  #   client = AgentDyne.new(api_key: "agd_...")
  #
  def self.new(**kwargs)
    Client.new(**kwargs)
  end
end
