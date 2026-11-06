# @cargo/payload-plugin-assistant

An admin assistant for Payload 4 on Cloudflare Workers: chat with your content through the
[`@payloadcms/plugin-mcp`](https://payloadcms.com/docs) tools, using TanStack AI and OpenRouter,
with one Durable Object per conversation. Plan: [#58](https://github.com/0xZ0uk/cargo-template/issues/58).

> **Status: storage done, chat turn pending.** Conversations, approvals and stream durability live
> in Durable Objects (#62, below). The endpoint still answers `501` and the admin view is a
> placeholder; the turn, tools and UI arrive in #61, #63–#66. Not registered in the app yet (#66).

```ts
import { assistantPlugin } from '@cargo/payload-plugin-assistant'

assistantPlugin({
  models: [{ id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
  apiKey: env.OPENROUTER_API_KEY, // passed in: the plugin never reads process.env
  // Durable Object namespaces (see "App wiring"); omit both for the in-memory fallback.
  conversations: { namespace: cloudflare.ASSISTANT_CONVERSATIONS, index: cloudflare.ASSISTANT_INDEX },
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
| `conversations` | `{ namespace, index, retentionDays, caps }`. `namespace` (`AssistantConversation`) and `index` (`AssistantConversationIndex`) go together; omit both for the in-memory fallback (Node dev, tests). `retentionDays`: delete a conversation idle this long, default 30. `caps`: size limits, see [Size caps](#size-caps). The namespace types are structural (no `@cloudflare/workers-types`). |
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
| `./do` | The Durable Object classes `AssistantConversation` and `AssistantConversationIndex`, plus their stores. Workerd-only (`cloudflare:workers`): re-export them from the Worker entry, never import this entry from `payload.config.ts` or the admin bundle. |

The endpoint loads the AI runtime with `await import('./server/chat')`, and tsup code-splits it
into its own chunk, so `@tanstack/ai` and friends stay out of the config's import graph.

## Conversations (Durable Objects)

One `AssistantConversation` Durable Object per conversation (`idFromName(threadId)`) holds
everything about it in its SQLite, and **runs the chat turn itself**: `chat()` runs in the object,
not in the Worker request, so a run outlives a closed tab and a reconnect is a log read (the
owner's decision after the spike, #58). One `AssistantConversationIndex` per user lists them.
Nothing goes to D1.

```
browser ──POST /api/assistant/chat──▶ Worker endpoint (#63)            AssistantConversation (per thread)
                                       auth · access · rate limit       ├─ owner, last_active, retention, caps
                                       userKey = "<collection>:<id>"    ├─ messages · runs · interrupts · metadata
                                       backend.startTurn(input) ───────▶├─ stream log (StreamDurability)
          ◀──────── SSE (proxied as is) ─────────────────────────────── └─ chat() → MCP via ASSISTANT_SELF
browser ──GET  …?runId (Last-Event-ID)▶ backend.join(...) ─────────────▶ log replay, never a model call
                                       backend.list/rename/remove ────▶ AssistantConversationIndex (per user)
```

### Stores

`@tanstack/ai-persistence` 1.0.1's contracts, implemented over the object's SQLite
(`src/do/sqlStores.ts`), checked by `runPersistenceConformance` under workerd:

| Store | Notes |
| --- | --- |
| `messages` | One row per message (no value near SQLite's 2 MB cap). `saveThread` is a full replace in one transaction; an unknown thread loads `[]`. |
| `runs` | Required with `interrupts`. `findActiveRun`, `listByThread`, `listByParentRun`, `listReclaimable`. A run still `running` when the object starts lost its producer (restart, deploy): it becomes `failed` with `code: 'producer_lost'`. |
| `interrupts` | Insert-if-absent `create`; `resolve`/`cancel` no-op on unknown ids; lists ordered by `requestedAt`; `commitBatch` in one SQLite transaction, so a resume applies every approval or none. |
| `metadata` | With `getVersioned`/`setIf` (a persisted revision counter: a revision never repeats). |
| `sessions` | In the index object (below), not the conversation. |

There is no lock store in 1.0.1 (locks are `withLocks` from `@tanstack/ai`); the object's single
writer serialises every write to a conversation anyway. The stores are faithful and know nothing
about users or caps: ownership is the object's job, caps wrap the message store
(`withConversationCaps`) for the persistence `chat()` gets.

### Stream durability

`sqlStreamDurability` is a `StreamDurability` over the same SQLite (`src/do/sqlStream.ts`). The
turn is piped through `toServerSentEventsResponse(stream, { durability })`: every event is
appended before it is sent, with an `id:` offset (`do1:<runId>:<seq>`, opaque). Cancelling the
response (closed tab) only detaches the viewer; TanStack keeps draining the run into the log under
its own controller, inside the object. A rejoin (`Last-Event-ID` or `?offset`, plus `X-Run-Id` or
`?runId`) is `resumeServerSentEventsResponse`: it tails the log until the producer closes it, woken
in memory (producer and readers share the object). A log still open when no producer is live in
the object (it restarted mid-run) is sealed with a `RUN_ERROR` (`producer_lost`) on first read, so a
rejoin ends instead of hanging. Finished runs' logs are pruned after an hour. While a run is live,
the object's alarm fires every 30 s as a heartbeat, so it always has an event in flight.

### Ownership

A conversation id is never access. The user key is `<auth collection>:<user id>`, derived from
`req.user` by the endpoint. The first `claim` writes the owner (insert-if-absent: two racing users
can't both get an id). `claim`, `transcript`, `destroy` and the object's own `fetch` routes all
compare the stored owner with the key; another user's conversation answers like a missing one
(404 / `null` / `false`). The object re-checks on `fetch`, so a join can't skip the check even if
the Worker forgot it. The raw store RPC (`store(name, method, args)`) is user-agnostic on purpose:
the conformance suite drives it, and only the Worker can reach a stub.

### The conversation index

**One index Durable Object per user**, exposed as a `SessionIndexStore` routed by `tenantId`
(`durableSessionIndexStore`; the plugin always passes the user key as `tenantId`). Why: the
contract's `list` scans across threads (with `memberId`, `search`, paging), which a per-conversation
object can't answer without a fan-out the interface doesn't allow, and a single global index object
would be a hot spot holding everyone's titles. Per user, list/rename/delete are one small object;
storage grows per user; it passes the conformance suite as one store. Rename is `getVersioned` +
`upsertIf` (full replace). Delete goes through the conversation object (owner check), which drops
its data and its index entry.

### Retention

One alarm per conversation. Each `claim`/turn records `last_active`; the alarm is set for
`last_active + retentionDays` (default 30, `conversations.retentionDays`). When it fires and the
conversation is still idle, the object deletes everything (`deleteAll`) and its index entry;
otherwise it re-arms for the new deadline. The retention travels with each `claim`, so changing
the option applies at the next activity.

### Size caps

`conversations.caps`, applied before anything is stored:

| Cap | Default | |
| --- | --- | --- |
| `maxToolResultBytes` | 16 KiB | Each tool result in the transcript (a `find` returning whole documents) is cut and marked `…[truncated N bytes]`. |
| `maxMessages` | 400 | Oldest whole turns (from a user message) are dropped first, so a tool result never loses its tool call. The newest turn always stays. |
| `maxBytes` | 1 MiB | Same, by UTF-8 JSON size. |
| `maxStreamChunkBytes` | 256 KiB | Each stream-log event is shrunk (longest strings first) below SQLite's 2 MB value limit; only a reconnect sees the cut version. |

### MCP transport from inside the object (recommendation: `ASSISTANT_SELF`)

The tools (#61) reach plugin-mcp's `POST /api/mcp` with the admin's `Cookie` and `Origin`. In the
object there is no Worker `req` and no `handleEndpoints`. Options:

| | Auth / CSRF | Cost | Reconnect |
| --- | --- | --- | --- |
| **Service binding to the same Worker** (`ASSISTANT_SELF`) — recommended | Same path as an external MCP client: every POST re-authenticates from the forwarded `Cookie` (plugin-mcp runs `payload.auth()` per request) and Payload's CSRF check sees the admin's `Origin`. The cookie lives in the object's memory for the run only, never in storage. | No network hop and no public URL; a service-binding call is a subrequest (well within the 1,000 per object event) and isn't billed as a request. Runs in a Worker isolate that usually has Payload warm already. | Unaffected: the run lives in the object. |
| Initialise Payload inside the object | Same auth via `handleEndpoints`, but the plugin would have to import the app's config (a cycle) or have it injected. | A second Payload init (D1, config, every collection) in the object's isolate: seconds of cold start and memory per object isolate. | Unaffected. |
| `chat()` in the Worker, object only for storage + `waitUntil` | Simplest (the spike's in-process fetch). | Cheapest. | Broken for long runs: `waitUntil` ends 30 s after the response; the spike showed a mid-run disconnect killing the producer. Rejected by the owner. |

`serviceBindingMcpFetch({ fetcher: env.ASSISTANT_SELF, cookie, origin })` builds the `fetch`
#61's tool source takes; the object passes it to the turn as `mcpFetch`. It always sets `Cookie`
and `Origin` itself, so nothing upstream can swap the identity. **Prototype:**
`tests/workerd/mcpTransport.test.ts` runs a turn in the object that creates a real
`@tanstack/ai-mcp` client over `mcpFetch` against a real `@modelcontextprotocol/server` 2.4.0 at
the test Worker's `/api/mcp` (gated like plugin-mcp + Payload `csrf`): with the admin's cookie and
origin it lists and calls the tool and both headers arrive intact; without the cookie, or with a
foreign origin, the server advertises no tools (`-32601`, the "not logged in" case #61 maps).

### The interface #63 builds on

`ConversationBackend` (`src/conversations/types.ts`), from `conversationBackend(options)` in the
endpoint's lazy chunk: Durable Objects when `conversations.namespace`/`index` are set, otherwise
one process-wide `memoryConversations()`.

```ts
const backend = conversationBackend(options, { turnRunner, mcpFetch }) // memory options: Node only
const userKey = userKeyOf(req.user)

// POST: a new turn or a resume (approval decisions in the body). The object claims the id for
// this user (404 if someone else owns it) and answers with the run's SSE, which the endpoint
// returns as is.
return backend.startTurn({
  userKey, threadId, runId: req.headers.get('X-Run-Id') ?? crypto.randomUUID(),
  body,                                              // messages / resume / model, as #63 defines
  auth: { cookie: req.headers.get('cookie') ?? '', origin: new URL(req.url).origin },
})

// GET with Last-Event-ID (or ?offset) + X-Run-Id (or ?runId): rejoin. No MCP client, no model call.
return backend.join(userKey, threadId, request)

backend.transcript(userKey, threadId) // messages, pending approvals, the live run to rejoin
backend.list(userKey) / rename(userKey, threadId, title) / remove(userKey, threadId)
```

Inside the object, `startTurn` calls `turnRunner()` (a protected method returning `null`, so 501,
until #63 overrides it in `AssistantConversation`) with a `TurnContext`: `input` (thread, run, user,
body, auth), `persistence` (the four stores, messages capped: pass it to `withPersistence`),
`mcpFetch` and an abort `signal` (only an explicit `stop(userKey, runId)` aborts; a disconnect
doesn't). The runner returns `chat({ ..., threadId, runId, middleware: [withPersistence(persistence)] })`.
A run id is used once (409 on reuse): a resume is a new run id with `resume` in the body.

## App wiring (#66)

Not applied to `apps/web` yet. When registering:

1. **`apps/web/wrangler.jsonc`**: the two classes, the app's first `migrations` entry, and the
   service binding to itself (the Worker's own `name`):

   ```jsonc
   "durable_objects": {
     "bindings": [
       { "name": "ASSISTANT_CONVERSATIONS", "class_name": "AssistantConversation" },
       { "name": "ASSISTANT_INDEX", "class_name": "AssistantConversationIndex" }
     ]
   },
   "migrations": [
     { "tag": "v1", "new_sqlite_classes": ["AssistantConversation", "AssistantConversationIndex"] }
   ],
   "services": [{ "binding": "ASSISTANT_SELF", "service": "cargo-template" }]
   ```

   The binding names `ASSISTANT_INDEX` and `ASSISTANT_SELF` are fixed: the conversation object reads
   them from its `env` (retention/delete of the index entry, the MCP transport).
   `ASSISTANT_CONVERSATIONS` is only passed to the plugin, so its name is free.

2. **`apps/web/src/server.ts`**: export both classes by name next to the default TanStack Start
   entry (the Worker entry must export every Durable Object class):

   ```ts
   export { AssistantConversation, AssistantConversationIndex } from '@cargo/payload-plugin-assistant/do'
   ```

3. **`pnpm web cf-typegen`**, then pass the namespaces from `#cloudflare-runtime`:
   `conversations: { namespace: cloudflare.ASSISTANT_CONVERSATIONS, index: cloudflare.ASSISTANT_INDEX }`.

No D1 migration: nothing here touches D1.

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
pnpm --filter @cargo/payload-plugin-assistant test       # Node suite, then the workerd suite
pnpm --filter @cargo/payload-plugin-assistant typecheck  # tsconfig.json + tsconfig.do.json (Workers types)
```

`vitest.config.ts` is the Node suite (options, boot, caps, the in-memory fallback and its
conformance). `vitest.workerd.config.ts` runs `tests/workerd/` under workerd with
`@cloudflare/vitest-plugin` 1.4.11 (its Miniflare and Wrangler match the app's), against the test
Worker in `tests/workerd/` (same bindings as the app wiring above): conformance of both objects,
ownership, retention (alarm), reconnect after a mid-run disconnect, restart mid-run, and the MCP
transport prototype. Storage is shared between the tests of a file there, so each test uses its own
ids.
