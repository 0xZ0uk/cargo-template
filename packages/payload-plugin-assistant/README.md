# @cargo/payload-plugin-assistant

An admin assistant for Payload 4 on Cloudflare Workers: chat with your content through the
[`@payloadcms/plugin-mcp`](https://payloadcms.com/docs) tools, using TanStack AI and OpenRouter,
with one Durable Object per conversation. Plan: [#58](https://github.com/0xZ0uk/cargo-template/issues/58).

> **Status: in progress.** The Payload tool source is in (#61, see [Payload tools](#payload-tools-srctoolspayloadtoolsourcets)).
> The endpoint still answers `501` and the admin view is a placeholder; the rest arrives in
> #62–#66. Not registered in the app yet.

```ts
import { assistantPlugin } from '@cargo/payload-plugin-assistant'

assistantPlugin({
  models: [{ id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
  apiKey: env.OPENROUTER_API_KEY, // passed in: the plugin never reads process.env
  conversations: { namespace: cloudflare.ASSISTANT }, // Durable Object namespace; omit for in-memory
})
```

## What it adds

| | |
| --- | --- |
| `POST /api/assistant/chat` | Signed in (401), `access` (403), configured (503), `rateLimit` (429), then the turn (stub: 501). |
| `/admin/assistant` | Placeholder view, registered through `admin.components.views`. Anonymous visitors go to login, users `access` refuses to `admin.routes.unauthorized`. |

No collections, globals or injected fields. With `enabled: false` the config is returned untouched.

## Options

| Option | |
| --- | --- |
| `enabled` | `false` disables the plugin silently. Default `true`. |
| `access({ user, req })` | Who may use the assistant: the chat endpoint (403) and the admin view (redirect to `admin.routes.unauthorized`) both ask it. Default: users of the admin auth collection (`user.collection === config.admin.user`, Payload's own admin gate), so a session on another auth collection can neither chat nor see the admin shell. Payload's own access applies to every tool call, as that user. |
| `models` | Allowlist of `{ id, label }`. At least one, unique ids; throws otherwise. |
| `defaultModel` | One of `models`. Default: the first. Throws if unknown. |
| `apiKey` | OpenRouter key. A missing key **warns and leaves the assistant unconfigured**: the endpoint (503 `not configured`) and the view (a notice) are still registered, so the schema, import map and admin shape never depend on a secret. |
| `instructions` | System prompt, or `(ctx) => string`. |
| `maxSteps` | Most model/tool round trips per run. Positive integer, default 10. |
| `toolFilter(tool)` | Which MCP tools the model sees, after the built-in filter (auth tools and `getUploadInstructions` are always dropped). Gets the raw MCP tool (`name`, `description`, `annotations`). Default: all the rest. By name only: to hide deletes for one collection, use plugin-mcp's own `collections.<slug>.tools`. |
| `conversations` | `{ namespace }`: the Durable Object namespace. `chat()` will run inside the conversation's Durable Object (#62/#63), so a run survives a closed tab and a reconnect is a log read. The type is structural (no `@cloudflare/workers-types`). Omit for the in-memory fallback (Node dev, tests). |
| `rateLimit(req)` | Return `false` for 429. |

OpenRouter provider routing is fixed in the normalised options: `{ requireParameters: true,
dataCollection: 'deny' }`. **The keys must be camelCase**: the SDK serialises them to
`require_parameters` / `data_collection`, and the snake_case spelling is silently dropped, which
would send drafts to providers that log or train on prompts.

## Exports

| Entry | |
| --- | --- |
| `.` | The plugin and option types (server). |
| `./admin/AssistantView` | The admin view (a server component wrapped in `DefaultTemplate`; the import-map target). |
| `./do` | Reserved for the Durable Object class (#62): workerd-only code, never imported by the config or the admin bundle. |

The endpoint loads the AI runtime with `await import('./server/chat')`, and tsup code-splits it
into its own chunk, so `@tanstack/ai` and friends stay out of the config's import graph.

## Dependencies

The AI packages are exact `dependencies` here (not in the pnpm catalog until the app imports them):
`@tanstack/ai` 1.2.0, `ai-mcp` 1.1.0, `ai-openrouter` 1.1.1, `ai-persistence` 1.0.1: the versions
the spike (#59) validated on workerd; `ai-react` 1.0.2 and `ai-compaction` 1.0.0 from the plan.
`@openrouter/sdk` is not allowed to run its `prepare` script (`allowBuilds` in
`pnpm-workspace.yaml`); the install fails without that.

## Payload tools (`src/tools/payloadToolSource.ts`)

The model's tools are plugin-mcp's, called **as the signed-in admin user**. An MCP client from
`@tanstack/ai-mcp` speaks to plugin-mcp's `POST /api/mcp` with the admin request's `Cookie`,
`Authorization` (when set) and `Origin`, so every MCP request re-authenticates through
`payload.auth()` and Payload's access control applies to every call. Internal for now: the
chat turn (#63) and the conversation's Durable Object (#62) import it from inside the package.

```ts
import {
  createPayloadToolSource,
  payloadToolSourceForRequest,
  payloadToolsMcpOptions,
  payloadToolsSystemPrompt,
} from './tools/payloadToolSource'

// On the Worker that serves the admin request (has a Payload instance):
const source = payloadToolSourceForRequest(req, { toolFilter: options.toolFilter })

// Anywhere else, e.g. inside the Durable Object: the same credentials, any fetch that reaches
// the Worker. The headers come from the admin request (authHeadersFrom(req)), passed along.
const source = createPayloadToolSource({
  endpoint: 'https://cms.example/api/mcp',
  headers,                                     // { cookie, origin, authorization? }
  dispatch: (request) => env.SELF.fetch(request),
  toolFilter: options.toolFilter,
})

chat({
  adapter, threadId, messages,
  systemPrompts: [payloadToolsSystemPrompt(instructions)],
  mcp: payloadToolsMcpOptions(source),         // { clients: [source], connection: 'close', onDiscoveryError }
})
```

| Export | |
| --- | --- |
| `createPayloadToolSource({ endpoint, headers, dispatch, toolFilter?, logger? })` | The source `chat({ mcp })` takes (`tools()` + `close()`). Connects lazily on the first `tools()`. Holds the user's credentials: one per run, never in module state. |
| `McpDispatch` | `(request: Request) => Promise<Response>`: how an MCP request reaches `/api/mcp`. The request already carries the auth headers; a dispatcher must not add or drop any. |
| `inProcessDispatch(config, { payloadInstanceCacheKey? })` | The dispatcher where Payload lives: `handleEndpoints({ config, path: '/api/mcp', request })`, no network hop. |
| `authHeadersFrom(request)` | `cookie`, `authorization` and `origin` from the admin request; `origin` falls back to the request's own (Payload's CSRF check needs it once `serverURL`/`csrf` is set, and an internal request has no `Sec-Fetch-Site`). |
| `payloadToolSourceForRequest(req, { toolFilter?, dispatch? })` | The three above wired for a `PayloadRequest`; the endpoint is `${serverURL or the request's origin}${routes.api}/mcp`. |
| `payloadToolsMcpOptions(source)` | The `mcp` option for `chat()`: closes the connection when the run ends, and rethrows a discovery failure as one of the errors below. |
| `payloadToolsSystemPrompt(instructions?)` / `PAYLOAD_TOOLS_SYSTEM_PROMPT` | Tool guidance for the system prompt: `getConfigInfo` for slugs, **`select` + small `limit` + `depth: 0` on `findDocuments`** (without them the spike measured whole documents flooding the context), `_status`, drafts, approvals, don't retry access errors. |
| `needsApproval`, `AUTH_TOOL_NAMES`, `UNSUPPORTED_TOOL_NAMES` | The rules below, for the UI and tests. |

**Which tools.** Everything plugin-mcp lists for the user, minus its auth tools (`auth`, `login`,
`forgotPassword`, `resetPassword`, `unlock`, `verify`: off by default in plugin-mcp, dropped
anyway since the assistant already runs as the user), minus `getUploadInstructions`, minus the
plugin's `toolFilter`. plugin-mcp lists **one tool per operation for all collections** (the
collection is the `slug` argument), so the list is not per collection: a user who can't write
pages still sees `updateDocument`, and the access check happens when it's called.

**`getUploadInstructions` is dropped.** It only prepares an upload: it returns a presigned
request (or an endpoint) that a client must then send the file's bytes to. The model has no
bytes and no way to send them, so the tool can't be used here; it would cost prompt tokens on
every call, and since plugin-mcp annotates it `readOnlyHint: false` it would raise an approval
card for an instruction-only call. Dropping it beats exempting it from approval by name.

**Approval.** `needsApproval: (tool) => tool.annotations?.readOnlyHint !== true`: only tools the
server declares read-only run without asking; no annotations means approval. With plugin-mcp's
annotations: find/count/schema/config/versions tools run, create/update/delete/duplicate/restore
pause with an approval interrupt (`metadata: { kind: 'approval', toolName, input }`).

**Access denials** come back to the model as an ordinary tool error, e.g. `{ error: 'MCP tool
"updateDocument" returned an error: MCP access to "updateDocument" is not enabled for collection
"pages"' }`, and nothing changes. `chat()` doesn't retry it; the system prompt tells the model to
report it. The approval card (#65) must expect an approved call that then fails this way.

**Discovery fails loudly.** No session, an expired one, or one plugin-mcp refuses →
`AssistantNotSignedInError` ("The assistant is not signed in…"): plugin-mcp advertises no `tools`
capability to an anonymous caller, so `tools/list` answers JSON-RPC `-32601 Method not found`.
Anything else (endpoint down, 500, unreachable) → `AssistantToolDiscoveryError`. With
`payloadToolsMcpOptions` either one fails the run before the model is called; never a run with
no tools.

**Cost.** Each run connects once (`server/discover`, `subscriptions/listen`, `tools/list`: ~75 ms
warm on workerd in the spike), and each tool call is another in-process POST that
re-authenticates. plugin-mcp refuses the client's `subscriptions/listen` and logs an error for
it on every connection; harmless, upstream noise.

## Admin UI

Follow [`packages/payload-seo-analyzer/src/ui/README.md`](../payload-seo-analyzer/src/ui/README.md):
Payload 4 tokens, `@payloadcms/ui` components first.

## Development

```bash
pnpm --filter @cargo/payload-plugin-assistant build
pnpm --filter @cargo/payload-plugin-assistant test
```
