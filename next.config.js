/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloudflare Pages via @cloudflare/next-on-pages — no static export
  // output: "export" removed; API routes require a server runtime

  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig
