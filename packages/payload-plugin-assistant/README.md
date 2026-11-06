# @cargo/payload-plugin-assistant

An admin assistant for Payload 4 on Cloudflare Workers: chat with your content through the
[`@payloadcms/plugin-mcp`](https://payloadcms.com/docs) tools, using TanStack AI and OpenRouter,
with one Durable Object per conversation. Plan: [#58](https://github.com/0xZ0uk/cargo-template/issues/58).

> **Status: scaffold.** The endpoint answers `501` and the admin view is a placeholder. The pieces
> arrive in #61–#66. Not registered in the app yet.

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
| `toolFilter(tool)` | Which MCP tools the model sees. Default: all. |
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

## Admin UI

Follow [`packages/payload-seo-analyzer/src/ui/README.md`](../payload-seo-analyzer/src/ui/README.md):
Payload 4 tokens, `@payloadcms/ui` components first.

## Development

```bash
pnpm --filter @cargo/payload-plugin-assistant build
pnpm --filter @cargo/payload-plugin-assistant test
```
