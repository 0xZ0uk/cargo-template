import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * esbuild drops module-level "use client" and moves CSS imports into a sibling .css file: put
 * both back (same helper as `@cargo/payload-plugin-ab`).
 */
function addClientBanner(file: string) {
  const css = file.replace(/\.js$/, ".css");
  const cssImport = existsSync(css) ? `import "./${css.split("/").pop()}";\n` : "";
  writeFileSync(file, `"use client";\n${cssImport}${readFileSync(file, "utf8")}`);
}

export default defineConfig([
  // Server: the plugin. Code splitting keeps `await import("./server/chat")` a real lazy
  // chunk, so the AI runtime is not in the config's import graph.
  { ...shared, entry: { index: "src/index.ts" }, splitting: true, clean: false },
  // plugin-mcp items (rich text as Markdown, #67): their own entry, so the plugin never imports
  // `@payloadcms/plugin-mcp` (an optional peer, external like every peer).
  { ...shared, entry: { mcp: "src/mcp.ts" }, splitting: false, clean: false },
  // Admin server components (the view wraps itself in DefaultTemplate; the nav link asks
  // `access`). No "use client": they import the client entry by package path, which stays
  // external, so the bundler sees the client boundary and none of this reaches the browser.
  {
    ...shared,
    entry: {
      "admin/AssistantView": "src/admin/AssistantView.tsx",
      "admin/AssistantNavLink": "src/admin/AssistantNavLink.tsx",
      "admin/AssistantDocumentControls": "src/admin/AssistantDocumentControls.tsx",
    },
    splitting: false,
    clean: false,
    external: [...(shared.external ?? []), "@cargo/payload-plugin-assistant/client"],
  },
  // Client: the chat UI. Browser-only code: `@tanstack/ai-react` (a dependency, so external),
  // `@payloadcms/ui`, `payload/shared`. Never the server runtime, the stores or the DOs.
  {
    ...shared,
    entry: { client: "src/client.ts" },
    splitting: false,
    clean: false,
    onSuccess: async () => addClientBanner("dist/client.js"),
  },
  // Durable Objects: workerd-only (`cloudflare:workers` stays an import the Worker bundler
  // resolves), never imported by the config or the admin bundle. Types come from
  // tsconfig.do.json (Workers types, no DOM).
  {
    ...shared,
    entry: { "do/index": "src/do/index.ts" },
    splitting: false,
    clean: false,
    external: [...(shared.external ?? []), "cloudflare:workers"],
    tsconfig: "tsconfig.do.json",
  },
]);
