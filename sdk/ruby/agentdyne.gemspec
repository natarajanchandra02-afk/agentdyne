Gem::Specification.new do |spec|
  spec.name          = "agentdyne"
  spec.version       = "1.0.0"
  spec.authors       = ["AgentDyne, Inc."]
  spec.email         = ["sdk@agentdyne.com"]
  spec.summary       = "Official Ruby SDK for AgentDyne — The Global Microagent Marketplace"
  spec.description   = "Discover, execute, and monetise AI agents with the AgentDyne Ruby SDK. Zero required dependencies."
  spec.homepage      = "https://agentdyne.com"
  spec.license       = "MIT"

  spec.metadata = {
    "homepage_uri"    => "https://agentdyne.com",
    "source_code_uri" => "https://github.com/agentdyne/sdk-ruby",
    "bug_tracker_uri" => "https://github.com/agentdyne/sdk-ruby/issues",
    "documentation_uri" => "https://agentdyne.com/docs",
  }

  spec.required_ruby_version = ">= 3.1"
  spec.files         = Dir["lib/**/*.rb", "README.md", "LICENSE", "agentdyne.gemspec"]
  spec.require_paths = ["lib"]

  # Zero required dependencies — uses Ruby's stdlib (net/http, openssl, json).
  # Optional: rack for webhook secure_compare
  spec.add_runtime_dependency "rack", ">= 2.0"

  spec.add_development_dependency "rspec",     "~> 3.13"
  spec.add_development_dependency "webmock",   "~> 3.23"
  spec.add_development_dependency "rake",      "~> 13.2"
end
