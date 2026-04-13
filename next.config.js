/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
  /**
   * Rewrite /v1/* → /api/* so the AgentDyne SDK works when baseUrl is set
   * to the platform domain (e.g. https://agentdyne.com).
   * SDK default baseUrl is https://api.agentdyne.com (production CDN), but
   * for local dev or self-hosted: new AgentDyne({ baseUrl: "http://localhost:3000" })
   * will route correctly through these rewrites.
   */
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: "/api/:path*" },
    ]
  },
  serverExternalPackages: [],
}

module.exports = nextConfig
