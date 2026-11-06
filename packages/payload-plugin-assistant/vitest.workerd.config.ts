import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Durable Objects under workerd (Miniflare): conformance, ownership, retention, stream
// durability and the MCP transport prototype. The Node suite is vitest.config.ts.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./tests/workerd/worker.ts",
      wrangler: { configPath: "./tests/workerd/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/workerd/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
