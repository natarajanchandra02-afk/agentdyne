import type { OpenNextConfig } from "@opennextjs/cloudflare"

const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: "cloudflare-node",
      converter: "edge",
      // Use Cloudflare KV for incremental cache (optional but recommended)
      // incrementalCache: "dummy",
      // tagCache: "dummy",
      // queue: "dummy",
    },
  },

  middleware: {
    external: true,
    override: {
      wrapper: "cloudflare-edge",
      converter: "edge",
      proxyExternalRequest: "fetch",
    },
  },
}

export default config
