import { defineConfig, type Options } from "tsup";

const shared: Partial<Options> = {
  format: ["esm"],
  dts: true,
  sourcemap: false,
  treeshake: true,
  target: "es2022",
  // Payload, its UI and React come from the host (one copy each). The admin view is an
  // import-map path the host resolves, so the server bundle never imports it.
  external: [
    "payload",
    /^payload\//,
    "@payloadcms/ui",
    /^@payloadcms\/ui\//,
    "react",
    "react-dom",
    "react/jsx-runtime",
  ],
};

export default defineConfig([
  // Server: the plugin. Code splitting keeps `await import("./server/chat")` a real lazy
  // chunk, so the AI runtime is not in the config's import graph.
  { ...shared, entry: { index: "src/index.ts" }, splitting: true, clean: false },
  // Admin view: a server component (it wraps itself in DefaultTemplate), so no "use client"
  // banner. The chat UI (#64) will be a client entry and needs ab's `addClientBanner` helper:
  // esbuild drops module-level directives.
  { ...shared, entry: { "admin/AssistantView": "src/admin/AssistantView.tsx" }, splitting: false, clean: false },
  // Durable Object (#62) will be a third entry, `./do`: workerd-only code, never imported by
  // the config or the admin bundle.
]);
