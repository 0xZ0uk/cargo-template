# @cargo/payload-plugin-assistant

An admin assistant for Payload 4 on Cloudflare Workers: chat with your content through the
[`@payloadcms/plugin-mcp`](https://payloadcms.com/docs) tools, using TanStack AI and OpenRouter,
with one Durable Object per conversation. Plan: [#58](https://github.com/0xZ0uk/cargo-template/issues/58).

> **Status: the chat works end to end in the admin.** The Payload tool source (#61), conversations
> in Durable Objects (#62), the chat turn on OpenRouter with its endpoints (#63, see
> [Endpoints](#endpoints-the-contract-for-the-admin-ui)) and the chat view (#64, see
> [Admin UI](#admin-ui)) are in. Approvals use a minimal approve/reject control until the diff
> cards (#65). Not registered in the app yet (#66).

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
| `/api/assistant/*` | The chat turn, rejoin, stop and the conversation list: see [Endpoints](#endpoints-the-contract-for-the-admin-ui). Every endpoint: signed in (401), `access` (403). |
| `/admin/assistant` | The chat view, registered through `admin.components.views`. Anonymous visitors go to login, users `access` refuses to `admin.routes.unauthorized`. |
| Nav link | "Assistant › Chat" in the admin sidebar (`admin.components.afterNavLinks`), shown only to users `access` admits. |

No collections, globals or injected fields. With `enabled: false` the config is returned untouched.

## Options

| Option | |
| --- | --- |
| `enabled` | `false` disables the plugin silently. Default `true`. |
| `access({ user, req })` | Who may use the assistant: the chat endpoint (403) and the admin view (redirect to `admin.routes.unauthorized`) both ask it. Default: users of the admin auth collection (`user.collection === config.admin.user`, Payload's own admin gate), so a session on another auth collection can neither chat nor see the admin shell. Payload's own access applies to every tool call, as that user. |
| `models` | Allowlist of `{ id, label }`. At least one, unique ids; throws otherwise. |
| `defaultModel` | One of `models`. Default: the first. Throws if unknown. |
| `apiKey` | OpenRouter key. A missing key **warns and leaves the assistant unconfigured**: the endpoints (a turn answers 503 `not_configured`) and the view (a notice) are still registered, so the schema, import map and admin shape never depend on a secret. |
| `instructions` | Added to the system prompt (what the site is, house style…), or `({ req }) => string`. See [System prompt](#system-prompt). |
| `maxSteps` | Most model calls per run (each tool round trip is one): `maxIterations(maxSteps)`. Positive integer, default 10. |
| `maxContextTokens` | Compaction budget, in estimated tokens of what is sent to the model: past it, old tool results are cleared, then the oldest turns dropped (the stored transcript is untouched). Default 64,000. |
| `appTitle` | OpenRouter attribution (`X-OpenRouter-Title`). Default "Payload admin assistant". `HTTP-Referer` is the site's URL. |
| `toolFilter(tool)` | Which MCP tools the model sees, after the built-in filter (auth tools and `getUploadInstructions` are always dropped). Gets the raw MCP tool (`name`, `description`, `annotations`). Default: all the rest. By name only: to hide deletes for one collection, use plugin-mcp's own `collections.<slug>.tools`. |
| `conversations` | `{ namespace, index, retentionDays, caps }`. `namespace` (`AssistantConversation`) and `index` (`AssistantConversationIndex`) go together; omit both for the in-memory fallback (Node dev, tests). `retentionDays`: delete a conversation idle this long, default 30. `caps`: size limits, see [Size caps](#size-caps). The namespace types are structural (no `@cloudflare/workers-types`). |
| `rateLimit(req)` | Return `false` for 429. Called for each chat turn (a send or an approval resume), after `access`, before any model call; reads, rejoins, stop and the conversation endpoints aren't limited. Key it per user (`req.user.collection` + `id`); the app connects it to a Workers Rate Limiting binding (#66). |

OpenRouter provider routing is fixed (`src/utils/provider.ts`): `{ requireParameters: true,
dataCollection: 'deny' }`. **The keys must be camelCase**: the SDK serialises them to
`require_parameters` / `data_collection`, and the snake_case spelling is silently dropped, which
would send drafts to providers that log or train on prompts. `tests/turn.test.ts` asserts the
serialised request body, not the options object.

## Exports

| Entry | |
| --- | --- |
| `.` | The plugin and option types (server). |
| `./admin/AssistantView` | The admin view (a server component wrapped in `DefaultTemplate`; the import-map target). |
| `./admin/AssistantNavLink` | The nav link (a server component that asks `access`; the import-map target). |
| `./client` | The chat UI, client components only (`"use client"`): `AssistantChat`, `AssistantNavLinkClient`, `ApprovalControl`, `pendingApprovalFrom` and the `PendingApproval` / `ApprovalRenderer` types. Its CSS is `./client.css`, imported by `client.js`. |
| `./do` | The Durable Object classes `AssistantConversation` and `AssistantConversationIndex`, plus their stores. Workerd-only (`cloudflare:workers`): re-export them from the Worker entry, never import this entry from `payload.config.ts` or the admin bundle. |

The endpoints load the AI runtime with `await import('./server/chat')`, and tsup code-splits it
into its own chunk, so `@tanstack/ai` and friends stay out of the config's import graph. The `./do`
bundle has the turn runner inlined and never imports `payload`.

## Conversations (Durable Objects)

One `AssistantConversation` Durable Object per conversation (`idFromName(threadId)`) holds
everything about it in its SQLite, and **runs the chat turn itself**: `chat()` runs in the object,
not in the Worker request, so a run outlives a closed tab and a reconnect is a log read (the
owner's decision after the spike, #58). One `AssistantConversationIndex` per user lists them.
Nothing goes to D1.

```
browser ──POST /api/assistant/chat──▶ Worker endpoint                  AssistantConversation (per thread)
                                       auth · access · rate limit       ├─ owner, last_active, retention, caps
                                       validate · model allowlist       ├─ messages · runs · interrupts · metadata
                                       system prompt · settings         ├─ stream log (StreamDurability)
                                       backend.startTurn(input) ───────▶└─ createTurnRunner(): chat() → OpenRouter
          ◀──────── SSE (proxied as is) ───────────────────────────────     tools → MCP via ASSISTANT_SELF
browser ──GET  …?runId (Last-Event-ID)▶ backend.join(...) ─────────────▶ log replay, never a model call
browser ──POST …/chat/stop ──────────▶ backend.stop(...) ─────────────▶ abort chat() → RUN_ERROR "stopped"
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
its data and its index entry. A run still live at that moment is aborted and fenced off: the
object bumps an epoch the run captured at its start, and the run's store writes, log appends,
activity and alarm only go through while that epoch is current. Readers tailing it end. So the
aborted run's last events never land in the deleted (or a re-claimed) conversation.

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

### The backend interface

`ConversationBackend` (`src/conversations/types.ts`), from `conversationBackend(options)` in the
endpoints' lazy chunk: Durable Objects when `conversations.namespace`/`index` are set, otherwise
`memoryConversations()`. Called per request: the memory backend is rebuilt with each call's
options (`turnRunner`, `mcpFetch`) over one process-wide set of conversations
(`createMemoryConversationState()`), so one caller's options never stick for the next.

```ts
const backend = conversationBackend(options, { turnRunner, mcpFetch }) // memory options: Node only
const userKey = userKeyOf(req.user)                                     // "<collection>:<id>"

backend.startTurn({ userKey, threadId, runId, body, auth: { cookie, origin }, title }) // → SSE Response
backend.join(userKey, threadId, request)       // rejoin from the log; no MCP client, no model call
backend.stop(userKey, threadId, runId)         // abort a live run → RUN_ERROR "stopped"
backend.hydrate(userKey, threadId, request)    // reconstructChat body (what useChat's hydrate() reads)
backend.transcript(userKey, threadId)          // model messages, pending approvals, active run; null if not owned
backend.list(userKey) / rename(userKey, threadId, title) / remove(userKey, threadId)
```

Inside the object, `startTurn` calls `turnRunner()` (by default `createTurnRunner()`; a subclass
can override it, as the workerd tests do with `fakeText()`) with a `TurnContext`: `input` (thread,
run, user, body, auth), `persistence` (the four stores, messages capped, fenced against a delete),
`mcpFetch` (`ASSISTANT_SELF` with the admin's Cookie and Origin) and the stop `signal`. A run id is
used once (409 `run_id_used`) for the conversation's lifetime: the object keeps every accepted id
in `assistant_run_ids`, which outlives the stream logs pruned an hour after a run. A resume is a
new run id with `resume` in the body.

`RunControl` keeps the two early endings apart: **stop** aborts the runner's signal, so `chat()`
winds down and the stream ends with a logged `RUN_ERROR` (`code: "stopped"`), cut anyway after 10 s
if a custom runner ignores the signal; **delete** aborts the signal and cuts the stream at once
(then the epoch fence drops whatever the run still tries to write). A closed tab is neither.

## The chat turn

### Turn flow

1. **Worker endpoint** (`POST /api/assistant/chat`, `src/server/chat.ts`): signed in (401),
   `access` (403), configured (503), `rateLimit(req)` (429), body (400 `invalid_body`), model in the
   allowlist (400 `model_not_allowed`). Then it resolves the turn's **settings**, plain data because
   the turn runs in another object that has neither the plugin's options nor `req`
   (`TurnSettings`): model, API key, the system prompt, `maxSteps`, `maxContextTokens`,
   `${serverURL or origin}/api/mcp`, the OpenRouter attribution and, when the app has a
   `toolFilter`, the tool names it admits (one in-process tool discovery on the Worker, where the
   function lives). The key travels to the object in the internal request and stays in memory for
   the run; it is never stored or logged.
2. **Backend** `startTurn`: claims the conversation for the user (404 if someone else owns it;
   a new one is titled from its first message), then the object answers with the run's SSE, which
   the endpoint returns with `X-Run-Id` / `X-Thread-Id` headers.
3. **In the object** (`createTurnRunner`, `src/server/turn.ts`):
   `chat({ adapter: createOpenRouterText(model, apiKey, { appTitle, httpReferer }), threadId, runId,
   messages: [the new user message] or [], resume, systemPrompts: [prompt], mcp:
   payloadToolsMcpOptions(source), modelOptions: { provider: { requireParameters: true,
   dataCollection: 'deny' } }, promptCache: { retention: 'short', key: threadId },
   agentLoopStrategy: maxIterations(maxSteps), abortController, middleware: [withPersistence(stores),
   withCompaction({ maxTokens, strategy: composeStrategies(clearToolResults(), evictOldest()) })] })`.
   `withPersistence` loads the stored transcript and appends the new message; the stream goes
   through the durable log; every `RUN_ERROR` is rewritten with an assistant code
   (`withAssistantErrors`, `src/server/errors.ts`).
4. **A write tool** pauses the run: `RUN_FINISHED` with `outcome: { type: "interrupt", interrupts }`,
   the interrupt stored. The UI sends a **resume** (a new turn with `resume`, no message): approved,
   the tool runs as the user and the model continues; rejected, nothing is written and the model is
   told so.

Prompt caching: OpenRouter gets `session_id` = the thread (sticky routing, so the provider's cache
is reused across turns) and, for `anthropic/*` models, cache markers on the system prompt, the last
tool and the last message (`addPromptCacheMarkers`, applied by the adapter). The system prompt and
the tool list are fixed per site, so they stay the cached prefix.

### System prompt

Built on the Worker per turn (`buildSystemPrompt`, `src/server/instructions.ts`):

1. Who and where: the content assistant in the Payload admin of the site at `serverURL` (or the request's origin).
2. The collections and globals (not `payload-*`), each with the description given to plugin-mcp
   (`mcpPlugin({ collections: { pages: { description } } })`), falling back to the collection's own
   `admin.description`, and `(drafts)` for versioned ones.
3. Conventions: save drafts, never publish unless asked in so many words; `getCollectionSchema` /
   `getGlobalSchema` before writing; small targeted updates (only the changed fields); after a change
   say what changed with a link to `<admin>/collections/<slug>/<id>` or `<admin>/globals/<slug>`;
   ask when ambiguous.
4. The app's `instructions`.
5. `payloadToolsSystemPrompt`: `getConfigInfo` for slugs, `select` + small `limit` + `depth: 0`, `_status`, approvals, access errors.

## Endpoints: the contract for the admin UI

All under Payload's API route (`/api`), authenticated by the admin session cookie (the UI's
`fetch` sends it with `credentials: "same-origin"`). JSON errors are `{ error, code }`.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `unauthorized` | Not signed in (every endpoint). |
| 403 | `forbidden` | `access` refused (every endpoint). |
| 503 | `not_configured` | No API key (`POST /chat` only). |
| 429 | `rate_limited` | `rateLimit(req)` returned `false` (`POST /chat` only). |
| 400 | `invalid_body` / `invalid_query` / `model_not_allowed` | Bad request; `model_not_allowed` also lists `models`. |
| 404 | `not_found` | The conversation (or run) doesn't exist **or isn't the caller's**: the two are indistinguishable. |
| 409 | `run_id_used` | A turn reused a run id: rejoin it instead. |
| 502 | `tools_unavailable` | Only with a `toolFilter`: the Worker could not list the tools. |

### `GET /api/assistant/config`

`{ configured, models: [{ id, label }], defaultModel, maxSteps }`: for the model picker and the
"not configured" notice.

### `POST /api/assistant/chat`: send a turn, or resume after approvals

Body: what `useChat`'s `fetchServerSentEvents(url)` sends (AG-UI `RunAgentInput`), or a short form:

```jsonc
{
  "threadId": "thread_…",           // required; [A-Za-z0-9][A-Za-z0-9_.:-]{0,127}; the client makes it
  "runId": "run_…",                 // optional (or the X-Run-Id header); minted when absent
  "model": "deepseek/deepseek-v4.1-flash", // optional (or forwardedProps.model); default: defaultModel
  "messages": [/* …, */ { "id": "msg_…", "role": "user", "content": "Which pages have no meta description?" }],
  // or "message": "Which pages…" (scripts, curl)
  // or, to answer approvals (no message):
  "resume": [{ "interruptId": "approval_call_…", "status": "resolved", "payload": { "approved": true } }]
}
```

- **Server-authoritative history**: only the last element of `messages` is used, and it must be
  the user's (text, or `[{ type: "text", text }]` parts; at most 32,000 characters). Earlier
  messages, assistant messages and tool results from the client are ignored: the stored transcript
  is the history. A message without an `id` gets one, so hydration ids are stable.
- **Resume**: one entry per pending interrupt, `status: "resolved"` with `payload: { approved: true | false }`
  (or `status: "cancelled"`). A resume takes no message; it is a new run (new `runId`).
- Response: `200 text/event-stream`, headers `X-Run-Id`, `X-Thread-Id`. Each event is
  `id: <opaque offset>` + `data: <AG-UI chunk JSON>`; keep the last `id` to rejoin. The first event
  is TanStack's `CUSTOM run.accepted`.

SSE events (AG-UI, as `@tanstack/ai` emits them; the ones the UI cares about):

| `type` | |
| --- | --- |
| `RUN_STARTED` | `{ threadId, runId }`. |
| `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` | The answer, `delta` by `delta`, per `messageId`. |
| `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` | A tool call (`toolCallName`, streamed args). |
| `TOOL_CALL_RESULT` | `{ toolCallId, content }`. An access denial is a result whose content is an error, not a failed run: an approved write can still come back denied. |
| `RUN_FINISHED` | One after **every model call**: `metadata.tanstack.finishReason` is `tool_calls` while the run goes on (tools run, the model is called again), `stop` on the last. The run is over when the stream ends. With `outcome: { type: "interrupt", interrupts: [{ id, toolCallId, reason: "tool_call", metadata: { kind: "approval", toolName, input } }] }` the run is **waiting for approval**: show a card per interrupt (#65) and send a resume. `metadata.input` is what the tool would write. |
| `RUN_ERROR` | The run ended in error, `{ code, message, error: { code, message } }`; `message` is ready to show. Codes below. |
| `CUSTOM` | `compaction:*` (old context was compacted), `run.accepted`. Safe to ignore. |

`RUN_ERROR` codes (`ASSISTANT_ERROR_CODES`, `src/server/errors.ts`). The provider's own error body
stays in `rawEvent`.

| `code` | Cause | Suggested UI |
| --- | --- | --- |
| `stopped` | The user pressed Stop. | Mark the answer as stopped. |
| `openrouter_invalid_key` | OpenRouter 401. | "Ask an administrator" (not the user's fault). |
| `openrouter_out_of_credits` | OpenRouter 402. | Same. |
| `openrouter_rate_limited` | OpenRouter 429 (`retryAfterMs` when known). | Retry later. |
| `model_unavailable` | 404/502/503, "no endpoints found…" (no provider serves it with tools and `data_collection: deny`). | Offer another model. |
| `context_overflow` | Too long even after compaction. | Start a new conversation. |
| `not_signed_in` | `/api/mcp` refused the forwarded session. | Sign in again. |
| `tools_unavailable` | Payload's tools could not be listed. | Retry. |
| `run_failed` | Anything else. | Retry. |

### `GET /api/assistant/chat?threadId=…`: rejoin a run, or load a conversation

- **Rejoin** (a reload, a dropped connection, another tab): add `runId` (or `X-Run-Id`) and an
  offset: `Last-Event-ID: <last id seen>` or `?offset=-1` from the start. Replays the run's log
  from there and tails it live until it ends; never calls the model. This is `useChat`'s
  `joinRun()` and its reconnect, if the adapter URL carries `?threadId=`:
  `` fetchServerSentEvents(() => `/api/assistant/chat?threadId=${threadId}`) ``.
  404 for an unknown run or someone else's conversation. Logs are kept an hour after a run.
- **Load** (no run, no offset): `reconstructChat`'s body, what `useChat`'s `hydrate()` expects:
  `{ messages: UIMessage[], activeRun: { runId } | null, interrupts: { runId, pending: [...] } | null,
  runs: [{ runId, status: "completed" | "aborted" | "failed", startedAt, finishedAt }], page? }`.
  `activeRun` set: rejoin it. `interrupts` set: show the approval cards again (they come from the
  server, so a reload or another device re-prompts). `?limit=` / `?before=` page the messages.
  A conversation that doesn't exist yet, or isn't the caller's, gives the empty body
  (`{ messages: [], activeRun: null, interrupts: null }`), like a new chat.

### `POST /api/assistant/chat/stop`

Body `{ threadId, runId }` (what `fetchServerSentEvents`' `cancelUrl` sends) → `{ stopped: boolean }`.
`true`: the run's `chat()` is aborted; its stream (and log) ends with `RUN_ERROR { code: "stopped" }`
and the run is recorded `aborted`. `false`: not live (finished already) or not the caller's.
Closing the tab or aborting the `fetch` does **not** stop a run; only this does.

### Conversations

| | |
| --- | --- |
| `GET /api/assistant/conversations?limit=50&cursor=&search=` | `{ conversations: [{ threadId, title, createdAt, updatedAt }], nextCursor }`, newest first, the caller's only. `limit` ≤ 100. |
| `GET /api/assistant/conversations/:threadId` | The same body as the load above, or 404 when it doesn't exist or isn't the caller's. |
| `PATCH /api/assistant/conversations/:threadId` | `{ title }` (1–200 characters) → `{ threadId, title }`. |
| `DELETE /api/assistant/conversations/:threadId` | → `{ deleted: true }`. Transcript, runs, approvals, logs and the list entry; a live run is aborted. |

Checked live (#63) under workerd (`vite preview`, local D1, a temporary registration with the
app wiring below): "Which pages exist on the site?" → `findDocuments` with `select` →
an answer with the admin link, streamed over SSE from the object; 3 model calls on
`deepseek/deepseek-v4.1-flash`, the last one with 10,368 of 10,700 input tokens cached; a rejoin
from `offset=-1` replayed all 109 events.

New conversations: the client makes a `threadId` and sends the first turn; the conversation is
created (and listed, titled from that first message) by that turn.

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

## Payload tools (`src/tools/payloadToolSource.ts`, `src/tools/inProcess.ts`)

The model's tools are plugin-mcp's, called **as the signed-in admin user**. An MCP client from
`@tanstack/ai-mcp` speaks to plugin-mcp's `POST /api/mcp` with the admin request's `Cookie`,
`Authorization` (when set) and `Origin`, so every MCP request re-authenticates through
`payload.auth()` and Payload's access control applies to every call. Internal for now: the
chat turn (#63) and the conversation's Durable Object (#62) import it from inside the package.

```ts
import { createPayloadToolSource, payloadToolsMcpOptions, payloadToolsSystemPrompt } from './tools/payloadToolSource'
import { payloadToolSourceForRequest } from './tools/inProcess' // needs payload: Worker / Node only

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
| `inProcessDispatch(config, { payloadInstanceCacheKey? })` (`inProcess.ts`) | The dispatcher where Payload lives: `handleEndpoints({ config, path: '/api/mcp', request })`, no network hop. |
| `authHeadersFrom(request)` | `cookie`, `authorization` and `origin` from the admin request; `origin` falls back to the request's own (Payload's CSRF check needs it once `serverURL`/`csrf` is set, and an internal request has no `Sec-Fetch-Site`). |
| `payloadToolSourceForRequest(req, { toolFilter?, dispatch? })` (`inProcess.ts`) | The three above wired for a `PayloadRequest`; the endpoint is `${serverURL or the request's origin}${routes.api}/mcp`. |
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

`/admin/assistant`: the conversation list on the left (a toggle above the chat on narrow screens),
the open conversation on the right. Styling follows
[`packages/payload-seo-analyzer/src/ui/README.md`](../payload-seo-analyzer/src/ui/README.md):
`@payloadcms/ui` components (`Banner`, `Button`, `Collapsible`, `Pill`, `ConfirmationModal`,
`Link`, `NavGroup`, `ShimmerEffect`), Payload 4 tokens only (`src/ui/assistant.css`), so light and
dark mode follow the admin theme.

### Entries and the client boundary

| File | Runs | |
| --- | --- | --- |
| `src/admin/AssistantView.tsx` | Server (RSC) | `access` gate (redirects), `DefaultTemplate`, then `<AssistantChat configured />`. |
| `src/admin/AssistantNavLink.tsx` | Server (RSC) | Asks `access`; renders `AssistantNavLinkClient` or nothing. |
| `src/client.ts` → `dist/client.js` | Browser | Everything under `src/ui/`. tsup prepends `"use client"` and the CSS import (`addClientBanner`, as in `payload-plugin-ab`). |

The server components import the client entry **by package path**
(`@cargo/payload-plugin-assistant/client`, external in tsup, mapped to the source by `tsconfig`
`paths` and the vitest alias), so the host bundler sees a client boundary. The client bundle
imports only `@payloadcms/ui`, `payload/shared`, React and `@tanstack/ai-react`: no Payload server
runtime, `@tanstack/ai` server code, stores or `cloudflare:workers`.

**The nav link and `access`.** Payload renders `afterNavLinks` as server components with `payload`,
`user`, `i18n` and `locale`, but no request. The link calls `access({ user, req })` with a request
built from those (no headers, cookies or URL). The default `access` only reads
`req.payload.config`, so it gives the same answer as on the view; a custom `access` that reads
headers must cope with their absence. If it throws, the link is hidden (fails closed); the view and
the endpoints always ask with the real request.

### How it talks to the endpoints

One `useChat` (`@tanstack/ai-react` 1.0.2) per open conversation (`ChatPanel`, mounted with
`key={threadId}`):

```ts
useChat({
  threadId,                       // minted in the browser: thread_<uuid>; in the URL as ?thread=
  persistence: true,              // hydrate on mount, restore approvals, rejoin a live run
  connection: fetchServerSentEvents(`/api/assistant/chat?threadId=${threadId}`, () => ({
    body: { model },              // → forwardedProps.model
    fetchClient: recordingFetch,  // keeps the { error, code } body of a refused request
    cancelUrl: '/api/assistant/chat/stop',
  })),
  onChunk,                        // RUN_STARTED / RUN_ERROR → notices, list refresh
})
```

| User action | Request |
| --- | --- |
| Open the view or a conversation | `GET /api/assistant/config` (models, configured), `GET /api/assistant/conversations`, then `useChat`'s hydrate: `GET /api/assistant/chat?threadId=` |
| Reload mid-reply | Hydrate says `activeRun` → `useChat` joins it: `GET /api/assistant/chat?threadId=&runId=&offset=-1` (then `Last-Event-ID` on reconnects) |
| Send | `POST /api/assistant/chat?threadId=` (AG-UI body; the server uses only the last user message) |
| Stop | `POST /api/assistant/chat/stop` `{ threadId, runId }` (closing the tab does not stop a run) |
| Approve / reject | A resume: `POST /api/assistant/chat` with `resume: [{ interruptId, status: "resolved", payload: { approved } }]` |
| Rename / delete | `PATCH` / `DELETE /api/assistant/conversations/:threadId` |

The reply is over when the stream ends (`isLoading`), not at a `RUN_FINISHED` (one per model call).

### What it shows

- **Text**: Markdown via `TextPart` from `@tanstack/ai-react/ui`, i.e. `@tanstack/markdown`
  0.0.13, which `ai-react` already depends on (no new package): raw HTML is escaped, executable
  URLs (`javascript:`, `data:`…) are dropped. Links to admin paths, or to admin URLs on this origin,
  navigate in place (Payload's `Link`); others open in a new tab with `rel="noopener noreferrer"`.
  Plain text is never turned into links. The user's own messages render as plain text.
- **Reasoning**: a closed `Collapsible`.
- **Tool calls**: one row each: tool, collection (`input.slug`), status (`Running`, `Waiting for
  approval`, `Done`, `Failed`, `Rejected`, `Cancelled`); the result in a closed `Collapsible`,
  pretty-printed and cut at 4,000 characters. Documents the call returned or touched (plugin-mcp's
  fenced JSON, `docs`, `doc`, or `input.id`) link to their edit view, at most 10, and only for a
  collection or global in the admin config.
- **Approvals**: `ApprovalControl` per pending interrupt (tool, target, id, the input collapsed,
  Approve / Reject); sending is disabled until they are answered. The browser has no definitions of
  the server's MCP tools, so `@tanstack/ai-client` binds the server's `tool-approval` interrupt as
  `generic`, answered with its response schema's `{ approved }`; `pendingApprovalFrom` handles both
  kinds. #65 replaces the control: `<AssistantChat ApprovalComponent={DiffCard} />`, where the card
  gets a `PendingApproval` (`toolName`, `target`, `input` = what the tool would write, `approve()`,
  `reject()`, `canAnswer`). Expect an approved call that then fails on access: it shows as `Failed`.
- **Errors** (`src/ui/errors.ts`), inline as `Banner`s: `RUN_ERROR` codes and HTTP `{ code }`
  bodies map to not configured (warning, names `OPENROUTER_API_KEY`), invalid key, out of credits,
  rate limited, model unavailable (also `model_not_allowed`), context overflow, signed out,
  forbidden, tools unavailable, not found, stopped. A send refused before the run started puts the
  text back in the composer.

## Development

```bash
pnpm --filter @cargo/payload-plugin-assistant build
pnpm --filter @cargo/payload-plugin-assistant test       # Node suite, then the workerd suite
pnpm --filter @cargo/payload-plugin-assistant typecheck  # tsconfig.json + tsconfig.do.json (Workers types)
```

`vitest.config.ts` is the Node suite (`tests/ui/`: the chat UI under jsdom with `@payloadcms/ui`
stubbed, Markdown safety, tool rows, composer keys, approvals, the conversation list, and the
error/result/link helpers; options, boot (the view's redirects and the nav link's `access` gate
against real Payload), caps, the in-memory fallback and its
conformance; `tests/integration/chat.test.ts`: every endpoint through Payload's router against real
Payload + plugin-mcp, turns with `fakeText()`; `tests/turn.test.ts`: the real OpenRouter adapter with
its `httpClient` replaced, asserting the serialised request and the error mapping). `vitest.workerd.config.ts` runs `tests/workerd/` under workerd with
`@cloudflare/vitest-plugin` 1.4.11 (its Miniflare and Wrangler match the app's), against the test
Worker in `tests/workerd/` (same bindings as the app wiring above): conformance of both objects,
ownership, retention (alarm), reconnect after a mid-run disconnect, restart mid-run, and the MCP
transport prototype, and the real turn in the object (`tests/workerd/chat.test.ts`: tools,
approval resume, disconnect + rejoin, stop). Storage is shared between the tests of a file there, so each test uses its own
ids.
