# @cargo/payload-plugin-assistant

An admin assistant for Payload 4 on Cloudflare Workers: chat with your content through the
[`@cargo/payload-plugin-mcp`](../payload-plugin-mcp) (our fork of `@payloadcms/plugin-mcp`) tools, using TanStack AI and OpenRouter,
with one Durable Object per conversation. Plan: [#58](https://github.com/0xZ0uk/cargo-template/issues/58).

> **Status: the chat works end to end in the admin.** The Payload tool source (#61), conversations
> in Durable Objects (#62), the chat turn on OpenRouter with its endpoints (#63, see
> [Endpoints](#endpoints-the-contract-for-the-admin-ui)) and the chat view (#64, see
> [Admin UI](#admin-ui)) are in, with approval cards that show a diff before any write (#65, see
> [Approvals](#approvals-diff-cards)). Registered in `apps/web` (#66, see [App wiring](#app-wiring-66));
> the deployed-Worker checks of #66 are still to do. Per-user daily budgets, the audit log and field
> redaction are in (#68, see [Budgets, audit log and redaction](#budgets-audit-log-and-redaction-68)).
> Asking from a document's edit view and `@` mentions (#69): see
> [From an edit view](#from-an-edit-view-and-mentions-69).

```ts
import { assistantPlugin } from '@cargo/payload-plugin-assistant'

assistantPlugin({
  models: [{ id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }],
  apiKey: env.OPENROUTER_API_KEY, // passed in: the plugin never reads process.env
  // Durable Object namespaces (see "App wiring"); omit both for the in-memory fallback.
  conversations: { namespace: cloudflare.ASSISTANT_CONVERSATIONS, index: cloudflare.ASSISTANT_INDEX },
  budget: { dailyCostUsd: 5 },                                    // the default
  audit: analyticsEngineAuditSink(cloudflare.ASSISTANT_AUDIT),     // + the DO's factory, see "Audit log"
})
```

## What it adds

| | |
| --- | --- |
| `/api/assistant/*` | The chat turn, rejoin, stop, the conversation list and the usage: see [Endpoints](#endpoints-the-contract-for-the-admin-ui). Every endpoint: signed in (401), `access` (403). |
| `/admin/assistant` | The chat view, registered through `admin.components.views`. Anonymous visitors go to login, users `access` refuses to `admin.routes.unauthorized`. |
| Nav link | "Assistant › Chat" in the admin sidebar (`admin.components.afterNavLinks`), shown only to users `access` admits. |
| "Ask the assistant" | In the edit view of every collection and global plugin-mcp exposes (`admin.components.edit.beforeDocumentControls`), shown only to users `access` admits and only once a collection document is saved. Opens the chat in a drawer. See [From an edit view](#from-an-edit-view-and-mentions-69). |

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
| `maxToolCalls` | Most tool calls per run, parallel calls included. Default 20, at most 25 (throws otherwise): each one is a Worker invocation, and Cloudflare allows 32 per request. See [Worker invocation limit](#worker-invocation-limit-116). |
| `maxContextTokens` | Compaction budget, in estimated tokens of what is sent to the model: past it, old tool results are cleared, then the oldest turns dropped (the stored transcript is untouched). Default 64,000. |
| `appTitle` | OpenRouter attribution (`X-OpenRouter-Title`). Default "Payload admin assistant". `HTTP-Referer` is the site's URL. |
| `toolFilter(tool)` | Which MCP tools the model sees, after the built-in filter (auth tools and `getUploadInstructions` are always dropped). Gets the raw MCP tool (`name`, `description`, `annotations`). Default: all the rest. By name only: to hide deletes for one collection, use plugin-mcp's own `collections.<slug>.tools`. |
| `conversations` | `{ namespace, index, retentionDays, caps }`. `namespace` (`AssistantConversation`) and `index` (`AssistantConversationIndex`) go together; omit both for the in-memory fallback (Node dev, tests). `retentionDays`: delete a conversation idle this long, default 30. `caps`: size limits, see [Size caps](#size-caps). The namespace types are structural (no `@cloudflare/workers-types`). |
| `testModel` | **Tests only.** Answer turns with a scripted model instead of OpenRouter; see [Test model](#test-model). Only requests to a loopback host use it. Default `false`. |
| `budget` | Daily allowance per user (#68): `{ dailyCostUsd?, dailyTokens? }`, at least one; default `{ dailyCostUsd: 5 }`; `false` turns budgets off. Counted from the cost OpenRouter reports per model call, reset at midnight UTC. Past a cap a send or an approval gets 402 `budget_exceeded` before the model is called; a rejection still goes through. See [Budgets](#budgets). |
| `redact` | Fields the model never sees (#68): `{ [slug]: dotted paths }`, e.g. `{ customers: ['phone', 'address.street'] }`. **Added to** the defaults: every auth collection hides `DEFAULT_AUTH_REDACTIONS`. Throws on a path that isn't dotted field names. See [Redaction](#redaction). |
| `audit(event)` | Where applied writes are reported (#68), one `AssistantAuditEvent` each, no content. Used where turns run in this process (the in-memory backend); the conversation Durable Object takes its sink from the factory the app passes to `assistantConversation()`. See [Audit log](#audit-log). |
| `rateLimit(req)` | Return `false` for 429. Called for each chat turn (a send or an approval resume), after `access`, before any model call; reads, rejoins, stop and the conversation endpoints aren't limited. Key it per user (`req.user.collection` + `id`); the app connects it to a Workers Rate Limiting binding (#66). |

OpenRouter provider routing is fixed (`src/utils/provider.ts`): `{ requireParameters: true,
dataCollection: 'deny' }`. **The keys must be camelCase**: the SDK serialises them to
`require_parameters` / `data_collection`, and the snake_case spelling is silently dropped, which
would send drafts to providers that log or train on prompts. `tests/turn.test.ts` asserts the
serialised request body, not the options object.

## Exports

| Entry | |
| --- | --- |
| `.` | The plugin and option types (server), plus the pure #68 helpers: `analyticsEngineAuditSink`, `DEFAULT_AUTH_REDACTIONS`, `DEFAULT_BUDGET` and their types (`AssistantAuditEvent`, `AssistantAuditSink`, `AssistantBudget`, `RedactionMap`, `UsageResponse`…). |
| `./admin/AssistantView` | The admin view (a server component wrapped in `DefaultTemplate`; the import-map target). |
| `./admin/AssistantNavLink` | The nav link (a server component that asks `access`; the import-map target). |
| `./admin/AssistantDocumentControls` | "Ask the assistant" in edit views (a server component that asks `access`; the import-map target). |
| `./client` | The chat UI, client components only (`"use client"`): `AssistantChat`, `AssistantNavLinkClient`, `ApprovalCard` (the default), `ApprovalControl` (minimal), `AskAssistant` (the edit view's button and drawer), `useDocumentRefresh`, `ReferenceChips`, `pendingApprovalFrom`, `answerInterrupt`, the `PendingApproval` / `ApprovalRenderer` / `ApprovalDecision` types and the proposal types (`ApprovalProposal`, `FieldChange`…). Its CSS is `./client.css`, imported by `client.js`. |
| `./mcp` | plugin-mcp items for rich text as Markdown (#67): `withMarkdownRichText`, `setRichTextFromMarkdownTool`, `richTextAsMarkdown` (`findDocuments`), `richTextResultsAsMarkdown` (other results) and `richTextSchemaAsMarkdown` / `describeRichTextAsMarkdown` (`getCollectionSchema`, #116), `SET_RICH_TEXT_TOOL_NAME`, `markdownLosses`, `unsupportedMarkdown`, `RichTextPathError`, `internalLinkUrl` / `parseInternalLinkUrl` / `INTERNAL_LINK_SCHEME` (`payload://<collection>/<id>`). Needs `@cargo/payload-plugin-mcp` (our fork of `@payloadcms/plugin-mcp`; an optional peer: only this entry imports it). See [Rich text as Markdown](#rich-text-as-markdown-67). |
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
| `sessions` | In the index object (below), not the conversation. The index also keeps the user's daily usage and each conversation's cost (#68, see [Budgets](#budgets)). |

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
conversation bumps an epoch the run captured at its start, and the run's store writes, log
appends, activity, alarm and usage on the conversation only go through while that epoch is
current (its spend still counts for the user's day). Readers tailing it end. So the aborted run's
last events never land in the deleted (or a re-claimed) conversation. The fence is part of the
shared lifecycle, so the in-memory backend has it too.

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
| **Service binding to the same Worker** (`ASSISTANT_SELF`) — recommended | Same path as an external MCP client: every POST re-authenticates from the forwarded `Cookie` (plugin-mcp runs `payload.auth()` per request) and Payload's CSRF check sees the admin's `Origin`. The cookie lives in the object's memory for the run only, never in storage. | No network hop and no public URL; a service-binding call is a subrequest and isn't billed as a request, but it is a **Worker invocation, and a request may make 32**: see [Worker invocation limit](#worker-invocation-limit-116). Runs in a Worker isolate that usually has Payload warm already. | Unaffected: the run lives in the object. |
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

### Worker invocation limit (#116)

Cloudflare: "A single request has a maximum of 32 Worker invocations, and each call to a Service
binding counts towards this limit. Subsequent calls will throw an exception."
([Service bindings › Limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#limits)).
Every MCP request of a run goes through `ASSISTANT_SELF`, so it is one. The docs don't say whether
the request into a Durable Object starts a new count, so the plugin assumes the whole chain shares
one: the Worker that took the turn (1), the conversation object (1), then the run's MCP requests.

**What a run sends**, measured (`tests/integration/tools.test.ts`): one MCP session per run, opened
on the first `tools()` and closed when the run ends. Connecting is 3 requests (`server/discover`,
`subscriptions/listen`, `tools/list`); each tool call is 1 more; closing sends none. Tool calls
never reconnect. So a run makes 2 + 3 + its tool calls invocations, and each POST to
`/api/assistant/chat` (a turn, or an approval resume) is a new request with a new count.

**The cap**, per run, in the tool source (`createPayloadToolSource`):

- `maxToolCalls` (default 20, at most 25): parallel calls in one step count one each. Past it a call
  sends nothing and returns a tool error: "Tool call limit reached: this turn already made 20 tool
  calls… Do not call any more tools in this turn: answer with what you have, say what is left to
  do, and tell the editor to send another message to continue." The model answers; the editor's
  next message is a new run with a fresh count. The system prompt asks for few, broad reads.
- `maxRequests` (`MCP_REQUESTS_PER_RUN`, 28 = 32 − the Worker and the object − 2 spare): every MCP
  request, connecting included, so a reconnect or anything unexpected fails with a clear tool error
  instead of the platform's exception.

At the defaults a run stays at 2 + 3 + 20 = 25 invocations. `maxSteps` (10) bounds model calls,
not tool calls: before the cap, 10 steps of 3 parallel calls were 2 + 3 + 30 = 35 invocations.

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

### One lifecycle, two storages

The lifecycle is written once, in `Conversation` (`src/conversations/conversation.ts`), and both
backends run it; the seam is one conversation's storage below it (#135):

```
ConversationBackend ── backendOver() ── claim then start · list · rename · usage   (src/conversations/backendOver.ts)
        │ one handle per conversation
        ▼
Conversation ── ownership · run ids (409) · RunControl · caps · TurnContext · usage · audit
        │       epoch fence · kill runs on delete · retention (expire) · cleanup on close
        ▼
ConversationStorage + ConversationIndex                                             (src/conversations/storage.ts)
   ├─ sqliteConversationStorage: the object's SQLite, stream log + StreamHub, alarm  (src/do/sqlConversation.ts)
   │  + durableConversationIndex: the owner's AssistantConversationIndex
   └─ memoryConversationStorage: memoryPersistence(), memoryStream, the run-id ledger (src/conversations/memory.ts)
      + memoryConversationIndex: the process's session list and daily usage
```

On Workers the `Conversation` lives in the `AssistantConversation` object, which is only its RPC
surface (`claim`, `transcript`, `stop`, `destroy`, the `/turn`, `/join`, `/hydrate` routes) and its
alarm (`expire()`); in Node it lives in the process, one per thread, swept lazily before each call.
A storage provides the record (owner, activity, retention, caps; insert-if-absent), the four chat
stores, the run-id ledger, a producer log and readers, pruning, `clear()` (which ends readers) and
`schedule()`; an index provides the list entry (create, touch, remove) and `addUsage`.
`tests/lifecycle/suite.ts` is one suite that runs against both (`tests/lifecycle.test.ts`,
`tests/workerd/lifecycle.test.ts`).

`startTurn` calls the turn runner with a `TurnContext`: `input` (thread, run, user, body, auth),
`persistence` (the four stores, messages capped, fenced against a delete), `mcpFetch` (in the
object: `ASSISTANT_SELF` with the admin's Cookie and Origin), the stop `signal`, `recordUsage`
and `audit`. What isn't plain JSON comes from `TurnDependencies`: the plugin's options in Node
(`turnRunner`, `mcpFetch`, `audit`), and in the object the factory the app passes to
`assistantConversation(factory)` (`audit`, and `turnRunner`, by default `createTurnRunner()`; the
workerd tests pass one with `fakeText()`). A run id is used once (409 `run_id_used`) for the
conversation's lifetime: the storage keeps every accepted id (the object in `assistant_run_ids`,
which outlives the stream logs pruned an hour after a run). A resume is a new run id with
`resume` in the body.

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
4. Rich text rules, when a plugin-mcp collection entry has `setRichTextFromMarkdown` (see
   [Rich text as Markdown](#rich-text-as-markdown-67)): rich text reads as Markdown, is written only
   with that tool (never Lexical JSON in create/update data), and what Markdown loses. Plus, among the
   conventions: read with `draft: true` when discussing or editing a draft (#116).
5. The app's `instructions`.
6. `payloadToolsSystemPrompt`: `getConfigInfo` for slugs, `select` + small `limit` + `depth: 0`, few tool calls per turn (the cap), `_status`, approvals, access errors.

## Endpoints: the contract for the admin UI

All under Payload's API route (`/api`), authenticated by the admin session cookie (the UI's
`fetch` sends it with `credentials: "same-origin"`). JSON errors are `{ error, code }`.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `unauthorized` | Not signed in (every endpoint). |
| 403 | `forbidden` | `access` refused (every endpoint). |
| 503 | `not_configured` | No API key (`POST /chat` only). |
| 429 | `rate_limited` | `rateLimit(req)` returned `false` (`POST /chat` only). |
| 402 | `budget_exceeded` | The user's daily budget is used up (`POST /chat` only: sends, and resumes that approve anything; checked after the body and model, before anything that costs). A resume that only rejects or cancels is not refused. The body adds `usage` (the `GET /usage` body). |
| 400 | `invalid_body` / `invalid_query` / `model_not_allowed` | Bad request; `model_not_allowed` also lists `models`. |
| 400 | `invalid_reference` | `POST /chat`: a `context` or `references` entry names a collection or global the assistant doesn't reach. |
| 404 | `reference_not_found` | `POST /chat`: a referenced document doesn't exist **or the caller can't read it**. |
| 404 | `not_found` | The conversation (or run) doesn't exist **or isn't the caller's**: the two are indistinguishable. |
| 409 | `run_id_used` | A turn reused a run id: rejoin it instead. |
| 502 | `tools_unavailable` | Only with a `toolFilter`: the Worker could not list the tools. |

### `GET /api/assistant/usage?threadId=…`

The caller's usage today (UTC) and the budget (#68), for the chat header: `{ day, costUsd, tokens,
budget: { dailyCostUsd?, dailyTokens? } | null, remaining: { costUsd, tokens } (null per cap not set),
exceeded, resetsAt (next midnight UTC), conversation: { costUsd, tokens } | null }`. `conversation` is
only there with `threadId`, and `null` when the conversation is someone else's or hasn't used
anything yet.

### `GET /api/assistant/config`

`{ configured, models: [{ id, label }], defaultModel, maxSteps, redactedTitles }`: for the model
picker and the "not configured" notice. `redactedTitles` (`{ [slug]: singular label }`) lists the
collections whose title field is redacted, so the edit view names their documents `User #12`, as
the server does.

### `POST /api/assistant/chat`: send a turn, or resume after approvals

Body: what `useChat`'s `fetchServerSentEvents(url)` sends (AG-UI `RunAgentInput`), or a short form:

```jsonc
{
  "threadId": "thread_…",           // required; [A-Za-z0-9][A-Za-z0-9_.:-]{0,127}; the client makes it
  "runId": "run_…",                 // optional (or the X-Run-Id header); minted when absent
  "model": "deepseek/deepseek-v4.1-flash", // optional (or forwardedProps.model); default: defaultModel
  "messages": [/* …, */ { "id": "msg_…", "role": "user", "content": "Which pages have no meta description?" }],
  // or "message": "Which pages…" (scripts, curl)
  // Optional, with a message (#69), in forwardedProps (what useChat sends) or at the top level:
  "forwardedProps": {
    "context": { "kind": "collection", "slug": "pages", "id": "12" },      // the document the conversation is about
    "references": [{ "kind": "global", "slug": "header" }]                 // @ mentions, at most 10
  },
  // or, to answer approvals (no message):
  "resume": [
    { "interruptId": "approval_call_a", "status": "resolved", "payload": { "approved": true, "seenUpdatedAt": "2026-11-06T…" } },
    { "interruptId": "approval_call_b", "status": "resolved", "payload": { "approved": false, "reason": "Keep the old title" } }
  ]
}
```

- **Server-authoritative history**: only the last element of `messages` is used, and it must be
  the user's (text, or `[{ type: "text", text }]` parts; at most 32,000 characters). Earlier
  messages, assistant messages and tool results from the client are ignored: the stored transcript
  is the history. A message without an `id` gets one, so hydration ids are stable.
- **Document references** (#69): `context` (the edit view's document, sent with a drawer
  conversation's first message) and `references` (`@` mentions) are addresses only. The endpoint
  resolves each as the caller (`overrideAccess: false`, `depth: 0`, the latest draft, only the
  title field) before anything runs, refuses the turn with 400 `invalid_reference` / 404
  `reference_not_found`, and stores the result on the user message as `metadata.assistant`
  (`{ context?, references? }`, each `{ kind, slug, id?, title }` with the server's title; for a
  collection whose title field is redacted, `User #12`, see [Redaction](#redaction)). AG-UI's
  own top-level `context` array is not this and is ignored. Not allowed with `resume`.
- **Resume**: one entry **per pending interrupt of the run** (TanStack validates the whole batch
  before any tool runs; a partial batch ends in `RUN_ERROR` and nothing is written),
  `status: "resolved"` with `payload: { approved: true, seenUpdatedAt? }` or
  `{ approved: false, reason? }` (or a bare boolean, or `status: "cancelled"`). A resume takes no
  message; it is a new run (new `runId`). The server owns what reaches the tools:
  - approved → `{ approved: true }` (edited arguments are not accepted: the user approves what the
    card showed);
  - rejected → `{ approved: false, payload: { error: "The user rejected this change. Nothing was
    written.", reason? } }`, the reject branch of every approval tool's `approvalSchema`
    (`REJECT_APPROVAL_SCHEMA`). That payload is the denied call's tool result: the model reads that
    the user said no, and why. `reason` is at most 2,000 characters (400 otherwise).
  - `seenUpdatedAt` (the `updatedAt` the card's diff was built from): if that document's
    `updatedAt` is different now, the **whole resume is refused** with
    `409 { code: "stale", interruptIds }` and nothing runs. The card reloads and asks again.
- Response: `200 text/event-stream`, headers `X-Run-Id`, `X-Thread-Id`. Each event is
  `id: <opaque offset>` + `data: <AG-UI chunk JSON>`; keep the last `id` to rejoin. The first event
  is TanStack's `CUSTOM run.accepted`.
- **The run id** (#116): the body's `runId`, or one the server mints. It is `X-Run-Id`, and every
  `RUN_STARTED` and `RUN_FINISHED` carries it (`withAssistantErrors` rewrites the provider's own
  per-call id, which OpenRouter's adapter puts there), so a script can take it from the first
  event as well as from the header. Stop (`POST /chat/stop`) and rejoin (`GET /chat?runId=`) take
  that id. `RUN_ERROR` has no `runId` (AG-UI). `useChat` is unaffected either way: it attributes
  chunks to its own request's run id.

SSE events (AG-UI, as `@tanstack/ai` emits them; the ones the UI cares about):

| `type` | |
| --- | --- |
| `RUN_STARTED` | `{ threadId, runId }`. `runId` is the server's run id, the same as `X-Run-Id`: stop and rejoin take it (#116). |
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

### `GET /api/assistant/approvals?threadId=…`: what each pending approval would change

`{ approvals: ApprovalProposal[] }` (types in `src/approvals/types.ts`), oldest first, built from
the stored interrupts and read **as the caller** (`overrideAccess: false`, `depth: 0`, drafts).
404 when the conversation isn't the caller's. See [Approvals](#approvals-diff-cards).

### `GET /api/assistant/documents?q=…`: the `@` search (#69)

`{ documents: [{ kind: "collection", slug, id, title } | { kind: "global", slug, title }] }`, at
most 8: documents whose title field (`admin.useAsTitle`; collections without one are skipped)
contains `q` (`like`), in every collection the assistant reaches, newest first and interleaved
across collections, plus readable globals whose label or slug contains it. An empty `q` lists
recent ones. A collection whose title field is redacted (`users`, named by email) is never read by
that field: its documents are listed as `User #12` and found by the collection's label (`user`)
or an id (`#12`). Every read goes through plugin-mcp's `findDocuments` / `findGlobal` as the caller (one
in-process MCP session, the app's `toolFilter` applied), so a collection or global the caller can't
read gives nothing, and drafts and `?locale=` behave as they do for the model. Never returns field
values other than the title. `q` is at most 100 characters (400 `invalid_query`). Not rate limited
(a read); the composer debounces it.

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
| `GET /api/assistant/conversations?limit=50&cursor=&search=` | `{ conversations: [{ threadId, title, createdAt, updatedAt, costUsd?, tokens? }], nextCursor }`, newest first, the caller's only. `limit` ≤ 100. `costUsd`/`tokens`: the conversation's running total, once it used any (#68). |
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

As `apps/web` does it:

1. **`apps/web/wrangler.jsonc`**: the two classes, their lifecycle, and the service binding to the
   Worker itself (its own `name`):

   ```jsonc
   "durable_objects": {
     "bindings": [
       { "name": "ASSISTANT_CONVERSATIONS", "class_name": "AssistantConversation" },
       { "name": "ASSISTANT_INDEX", "class_name": "AssistantConversationIndex" }
     ]
   },
   // Declarative class lifecycle (apps/web pins Wrangler 4.156; mutually exclusive with `migrations`).
   // A Worker that already uses `migrations` adds `{ "tag": "…", "new_sqlite_classes": [...] }` instead.
   "exports": {
     "AssistantConversation": { "type": "durable-object", "storage": "sqlite" },
     "AssistantConversationIndex": { "type": "durable-object", "storage": "sqlite" }
   },
   "services": [{ "binding": "ASSISTANT_SELF", "service": "cargo-template" }]
   ```

   The binding names `ASSISTANT_INDEX` and `ASSISTANT_SELF` are fixed: the conversation object reads
   them from its `env` (retention/delete of the index entry, the MCP transport).
   `ASSISTANT_CONVERSATIONS` is only passed to the plugin, so its name is free. Only `wrangler
   deploy` creates the classes (`wrangler versions upload` refuses `exports`), so a Worker with them
   has no gradual deployments or version preview URLs.

2. **`apps/web/src/server.ts`**: export both classes by name next to the default TanStack Start
   entry (the Worker entry must export every Durable Object class):

   ```ts
   export { AssistantConversation, AssistantConversationIndex } from '@cargo/payload-plugin-assistant/do'
   ```

   A Node dev server that loads the Worker entry (TanStack Start's `vite dev`) can't import `./do`
   (`cloudflare:workers`): alias it to a stub there (`apps/web/vite.config.ts`,
   `src/runtime/assistantDurableObjects.node.ts`).

3. **`pnpm web cf-typegen`**, then pass the namespaces from `#cloudflare-runtime` on Workers only:
   `conversations: { namespace: cloudflare.ASSISTANT_CONVERSATIONS, index: cloudflare.ASSISTANT_INDEX }`.
   Under Node, Wrangler's `getPlatformProxy` can't run Durable Objects the Worker defines itself
   (nor the self service binding), so the app omits `conversations` there and gets the in-memory
   backend (`apps/web/src/plugins/assistant.ts`).

4. **`rateLimit`** from a Workers Rate Limiting binding, keyed by `<collection>:<id>`
   (`apps/web/src/plugins/assistantRateLimit.ts`).

5. **The audit log** (#68): an Analytics Engine dataset, `{ "binding": "ASSISTANT_AUDIT", "dataset":
   "cargo_assistant_audit" }` in `analytics_engine_datasets` (and a `_staging` one in the staging
   env), then `audit: analyticsEngineAuditSink(cloudflare.ASSISTANT_AUDIT)` in the plugin options and,
   because turns run in the conversation object, the conversation class built with the app's
   dependencies, exported from the Worker entry under the binding's class name instead of the
   plain class:

   ```ts
   import { analyticsEngineAuditSink } from '@cargo/payload-plugin-assistant'
   import { assistantConversation } from '@cargo/payload-plugin-assistant/do'

   export const AssistantConversation = assistantConversation<Cloudflare.Env>((env) => ({
     audit: analyticsEngineAuditSink(env.ASSISTANT_AUDIT),
   }))
   export type AssistantConversation = InstanceType<typeof AssistantConversation>
   ```

   The factory runs once per object instance. `apps/web` keeps it in `src/plugins/assistant.ts`
   (`assistantConversationDependencies`), next to the sink its `audit` option uses.

No D1 migration: nothing here touches D1.

## Test model

`testModel: true` replaces OpenRouter with a scripted `fakeText()` adapter (`src/server/testModel.ts`),
so end-to-end tests run real turns (the endpoint, the Durable Object, plugin-mcp's tools as the
user, approvals, the UI) with no key and no network. It reads the conversation, not a queue, so it
survives a restarted object:

| The last message | The answer |
| --- | --- |
| `/tool <name> <JSON arguments>` | Calls that tool, e.g. `/tool findDocuments {"slug":"pages","limit":5}`. A write pauses for approval as usual. |
| A tool result | `Tool <name> finished: <the result, cut at 300 characters>` |
| A rejected approval | `The change was rejected. Nothing was written.` |
| Anything else | `Test model: you said "<message>".` |

Every call reports a cost of $1 per million (estimated) tokens on its `RUN_FINISHED`, as OpenRouter's
`usage.cost` does (`withFakeCost`), so budgets and conversation costs show in end-to-end tests.

**Safeguard.** The endpoint uses it only when the request was made to a loopback host
(`localhost`, `*.localhost`, 127.0.0.1, ::1; `usesTestModel`) and then tells the turn through
`settings.testModel`. Any other request still needs `apiKey` (503 `not_configured` without one), so
a `testModel` left on can't swap the model of a deployed Worker. `apps/web` also turns it on only
with `ASSISTANT_TEST_MODEL=1` outside `APP_ENV=production` and `staging`. `GET /api/assistant/config` answers
`testModel: true` when it applies.

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
| `createPayloadToolSource({ endpoint, headers, dispatch, toolFilter?, maxToolCalls?, maxRequests?, logger? })` | The source `chat({ mcp })` takes (`tools()` + `close()`). Connects lazily on the first `tools()`. Holds the user's credentials: one per run, never in module state. `maxToolCalls` / `maxRequests` cap the run (`AssistantToolCallLimitError`, `AssistantRequestLimitError`, read by the model as tool errors). |
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
warm on workerd in the spike), and each tool call is another POST that re-authenticates. On
Workers each one is a Worker invocation; `maxToolCalls` and `maxRequests` keep a run under
Cloudflare's 32 ([Worker invocation limit](#worker-invocation-limit-116)). plugin-mcp refuses the client's `subscriptions/listen` and logs an error for
it on every connection; harmless, upstream noise.

## Rich text as Markdown (#67)

plugin-mcp's create and update tools take raw field data, i.e. Lexical JSON for rich text: models
get it wrong, it costs tokens, and nobody can read it on a card. The `./mcp` entry adds Markdown in
both directions, as plugin-mcp items (one tool layer for the assistant and external MCP clients, #58):

```ts
import { withMarkdownRichText } from '@cargo/payload-plugin-assistant/mcp'

mcpPlugin({
  collections: {
    pages: withMarkdownRichText('pages', { description: '…' }), // keeps the entry's own tools
    media: withMarkdownRichText('media'),
  },
})
```

Give it to every collection with a rich text field (`apps/web` has a test for that).

**Converters.** Payload's sanitizer binds `converters.fromMarkdown` / `toMarkdown` to each Lexical
field's own editor config (`field.editor.converters`), so every field converts with its own features
(heading levels, lists…). A field whose editor has no converters (not Lexical) is refused.

**`setRichTextFromMarkdown`** (`src/richText/tool.ts`, `defineCollectionTool`): `{ slug, id, path,
markdown, draft?, locale?, allowFormattingLoss? }`.

- `path` is a **data path**: field names and row numbers, `caption`, `hero.richText`,
  `layout.3.columns.0.content.1.richText`. Blocks rows resolve by their `blockType`, so the same field
  name in two blocks is never ambiguous; `layout[3]` is accepted. Unknown field, a row that doesn't
  exist, a non-rich-text field, a missing document: an error (`isError`) that lists the document's
  rich text paths. An unknown collection lists the collections with rich text (plugin-mcp answers
  first for a collection without the tool).
- It reads the document as the user (`depth: 0`, the latest draft), sets the converted state at the
  path, and updates **the path's top-level field** with the document's current value: block and array
  rows keep their ids and siblings (a dot-path patch would recreate rows). Draft by default;
  `draft: false` publishes (`_status: "published"`). Runs with the user's access
  (`overrideAccess: authorizedMCP.overrideAccess`); listed for users with `update` on some collection
  that has it, refused for the others.
- Annotated `readOnlyHint: false`, so the assistant asks for approval. Returns a short confirmation,
  never Lexical JSON.

**Reads.** `richTextAsMarkdown(slug)` is the `overrideResponse` of `findDocuments` (by id and by
`where`): every rich text value becomes Markdown with its field's converters (by schema, through
groups, tabs, arrays and blocks; Lexical found elsewhere, e.g. in populated relationships, with the
root editor's), and the response text is rebuilt in plugin-mcp's format, since `findDocuments`
prints the documents itself. A line tells the model to write rich text with the tool. **This changes
the output for external MCP clients too**, on purpose (one tool layer, #58).

**Other results and the schema (#116).** Every plugin-mcp built-in tool takes an `overrideResponse`
per collection, so `withMarkdownRichText` sets one on each tool that prints documents:
`richTextResultsAsMarkdown(slug)` on `updateDocument` (whose result is only `{ id }` unless
`returning: true`), `createDocuments`, `duplicateDocument`, `deleteDocuments`, `findVersions`,
`findVersionByID` and `restoreVersion`. It converts the documents in each fenced JSON block (a page's
`docs`, a create result's `{ doc, index }` rows, a version's `version`), leaves the rest of the text
and any "use this schema" block alone, and converts the internal `doc` and `structuredContent` too.
`getCollectionSchema` gets `richTextSchemaAsMarkdown()`: each rich text field's Lexical JSON Schema
(the `{ root: { type: "root", … } }` node and the `$defs` only it used) becomes
`{ description: "Rich text, read as Markdown (findDocuments). Write it only with
setRichTextFromMarkdown …, never in createDocuments or updateDocument data." }`. The field stays
listed, so the model knows it exists; the schema shrinks (the Lexical node definitions were most of
it). The system prompt keeps its rule as well. An entry's own `overrideResponse` on those tools is
replaced; a tool disabled with `false` stays disabled. Globals aren't covered (`withMarkdownRichText`
is per collection, and `apps/web` has no global with rich text).

**Fidelity.** Markdown keeps paragraphs, headings, bold, italic, links to URLs, internal links (below)
and, where the field's editor has them, lists, quotes, strikethrough and inline code. It can't keep
underline, sub/superscript, highlight, text styles, alignment, indentation, links opening in a new
tab, internal links with no target document, or upload/relationship/block nodes (`markdownLosses`).

**Decision: refuse, not warn.** If the field holds any of them, the tool writes nothing and says
what would be lost; the system prompt tells the model to tell the editor and call again with
`allowFormattingLoss: true` only once they agree, and the card repeats it. A warning alone would only
reach the model after the loss. The other direction: Markdown the field's editor doesn't support (a
heading level, lists) is kept as literal text by Lexical; `unsupportedMarkdown` finds it in the
converted state, and both the tool result and the card say so. Blocks embedded in rich text
(`BlocksFeature`) are out of scope: no editor in `apps/web` enables it.

**Internal links (#116)** read and write as `[text](payload://<collection>/<id>)`, e.g.
`[About us](payload://pages/12)`. Payload's link transformer exports an internal link through the
LinkFeature's `internalDocToHref` (an empty href without one: the target was lost) and sanitises
any other URL it doesn't know to `https://`, while its import keeps a URL as written. So
`convertersOf` wraps each field's converters: before export, every internal link with a target
becomes a custom link to a placeholder anchor (`#payload-internal-link-<n>`, which the sanitiser
accepts), replaced in the Markdown by its `payload://` URL; after import, a link to
`payload://<collection>/<id>` becomes `{ linkType: "internal", doc: { relationTo, value } }` again
(digits become a number id, as D1 ids are). Why a pseudo-URL rather than the document's site path:
it's stable, needs no per-collection URL scheme, and maps back without a lookup. Every conversion
goes through it (reads, the write tool, the approval card), so an edit keeps the links it didn't
touch, and the model can add one. `setRichTextFromMarkdown` refuses (writes nothing) when a link
names a collection that doesn't exist or a document the user can't read, and says which. In the
chat, a `payload://` link the model writes in an answer opens that document's edit view.

**Approval card.** `buildProposal` special-cases the tool: one `richText` change at the path's label
(`Layout › 3 · Rich text › Rich Text`), before = the current value as Markdown, after = the proposed
Markdown as the field will store it (converted and back), plus a notice for formatting that would be
lost or Markdown the field doesn't support. Stale checks work as for `updateDocument`.

Document references (#69) are not in the system prompt (it stays the cached prefix): a user
message with `metadata.assistant` gets a short note after its text in what the model receives
(`withReferenceNotes`, the last middleware, on `providerMessages` only), e.g.

```
<document-references>
The editor opened this conversation from the edit view of `pages` id 12 "Home": "this document", "this page" and the like mean it. Read it with findDocuments (slug `pages`, id 12, draft: true) before you answer about it or change it. The editor's unsaved changes in the form are not included: you see the saved version.
The editor mentioned: `pages` id 13 "About us"; global `header` "Header". Read the ones you need with findDocuments (by id, draft: true) or findGlobal before you answer about them.
</document-references>
```

Titles are JSON-quoted. The stored transcript keeps the user's own words, and the note stays with
its message in later turns. The test model reads a message without its note and, for plain text,
answers `Test model: you said "…". Documents: <the note>`.

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

- **A new conversation** (`EmptyConversation`): "What can I help with?", what the assistant does,
  and three example prompts (Payload `Button`s) that fill the composer without sending. Shown at
  once for a thread the view just created: `ShimmerEffect` placeholders only while an existing
  conversation loads (`chatBodyState`, #116), since a fresh id has nothing stored. No examples while
  the assistant isn't configured.
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
  collection or global in the admin config. A delete's documents are never linked (they are gone).
- **Approvals**: a diff card in place of the write's tool row; see below. Sending is disabled
  until every pending approval has an answer.
- **Errors** (`src/ui/errors.ts`), inline as `Banner`s: `RUN_ERROR` codes and HTTP `{ code }`
  bodies map to not configured (warning, names `OPENROUTER_API_KEY`), invalid key, out of credits,
  rate limited, model unavailable (also `model_not_allowed`), context overflow, signed out,
  forbidden, tools unavailable, not found, stopped. A send refused before the run started puts the
  text back in the composer and takes its bubble out of the transcript (the server never stored it).
- **Narrow screens**: under 600px the composer puts the model picker and Send on one row and the
  hint under them.

### From an edit view, and mentions (#69)

**The button.** `AssistantDocumentControls` (server) asks `access` like the nav link, then renders
`AskAssistant` (client), which hides itself on a collection's create view (`useDocumentInfo().id`
is empty). It opens a Payload `Drawer` (`assistant-<kind>-<slug>-<editDepth>`) with **the same
`ChatPanel`** as `/admin/assistant` (the shared setup, routes, links, config and model choice, is
`useAssistantAdminContext`), on a new thread about the document; closing and reopening the drawer
keeps that conversation until "New conversation", and "Open in the assistant" moves to the full
view. The drawer is portalled out of the document's `<form>`, but React events still bubble to it,
so the drawer body stops `submit` (the composer's Send must not save the document).

**Context.** `ChatPanel`'s `context` prop (`{ kind, slug, id, title }`) goes with the first
message only (`sendMessage({ content, metadata }, { body: { context } })`), and is shown as an
"About" chip on it. The server resolves and stores it (above); unsaved form state is never sent.

**Mentions.** In any chat, `@` at the start or after a space opens a list above the composer
(debounced 200 ms, `GET /documents?q=`). The textarea is an ARIA combobox (`aria-expanded`,
`aria-controls`, `aria-activedescendant`): Up/Down move, Enter or Tab pick, Escape closes the list, and the mouse picks on `mousedown` so focus stays. Picking replaces `@query`
with the title and adds a chip (Payload `Pill`, removable); a mentioned document isn't offered
again; at most 10. On send the chips go as `references`, and a refused send puts them back. Stored
messages show "About" and "Mentioned" chips linking to the edit views.

**Keeping the form in step.** `ChatPanel`'s `onAppliedWrite(call, result)` reports each write
tool call whose result arrived and succeeded, once (calls already in the transcript when it loaded
are not reported). `writeTouches` matches the open document: the same global, or the same
collection with its id in the input or in the documents the result returned (an update by
`where`); a delete doesn't count. Then `useDocumentRefresh`:

- **No unsaved edits** (`useFormModified()` false): fetch the saved document as the edit view loads
  it (`GET /api/<slug>/<id>?depth=0&draft=true&fallback-locale=none&locale=`), set it as the
  document info's `data` (so the edit view's stale-data check takes the new `updatedAt` and doesn't
  show "Document modified"), then `useForm().reset(doc)`, which rebuilds the form state on the
  server (`getFormState`) and clears `modified`; rich text fields re-render from the new initial
  value. A toast says so.
- **Unsaved edits**: Payload's `ConfirmationModal`: "Reload and lose my edits" or "Keep editing".
  The reload runs after the dialog has closed (run while it was still open, the form came back
  with the values the page was first rendered with). Keeping the edits (or closing the dialog)
  shows a danger `Banner`, fixed at the bottom of the edit view and in the drawer: saving will
  overwrite the assistant's change (Payload has no optimistic concurrency for saves). It offers
  the reload again and goes away once the form is saved.

Collections with **autosave** (`apps/web`'s pages) save edits within a second, so the form is
rarely modified when a change lands; an autosave that fires after the assistant's write still
overwrites it with the form's values, as any later save would.

### Approvals: diff cards

`ApprovalCard` (`src/ui/approvals/`), the default `ApprovalComponent`, replaces a write's tool row.

- **What it shows** comes from `GET /api/assistant/approvals` (`src/server/approvals.ts`): the
  action, the collection or global, the document (title linked to its edit view, status), and the
  change as `FieldChange`s, field by field (`src/approvals/diff.ts`, pure, driven by the field
  config: groups, tabs, rows, arrays and blocks, selects by label, relationships by id).
  Array and block rows pair by row `id` (rows without one, as an assistant writes them, pair by
  position, after the ids have claimed theirs). A row that was removed is labelled
  `Layout › 2 (removed) · Hero`, one that was added shows as added, and a row that changed place
  gets a `Position` change (`before: "1"`, `after: "3"`): only rows outside the longest run that
  kept their order count as moved, so inserting or removing a row doesn't flag the ones after it.) Per action:
  - **update**: the current document, read as the user, against the proposed `data`, only the
    fields `data` sets; by `where`: the matching documents (first 10) and the count;
  - **create**: every proposed field (each document of `createDocuments`);
  - **delete**: every value that will be lost; **restore version**: the version against the
    current document; **duplicate**: the copy's values; any other write tool: its arguments.
  - **Rich text** is converted from Lexical to readable text with light Markdown
    (`src/approvals/lexical.ts`, headings, lists, quotes, links' text, uploads/blocks as
    `[media: 4]`), detected by field type or by shape: never Lexical JSON.
  - Values are shown **whole and scrollable**; only past 10,000 characters is one cut, and the
    card says so (as it does for more than 150 changed fields). If the proposal can't be built,
    the card shows the tool's full input. An unreadable document (deleted, no access) gives a
    notice instead of a diff.
- **Answers**: Approve, or Reject with an optional reason (sent to the model). TanStack resumes an
  interrupt batch **all or nothing**, so with several pending approvals each card keeps its answer
  ("sent with the other answers once N more changes have one", with Undo) and the batch is sent
  once, when the last one is answered. "Approve all" / "Reject all" answer the rest.
- **Nothing is approved unseen.** Approve (and Approve all) stay disabled until the change's diff
  has loaded; every approval then carries the `updatedAt` that diff was built from. If the diff
  couldn't be loaded, the card shows the tool's input and Approve asks "Approve anyway?" first (no
  `updatedAt`, so no stale check); Approve all is disabled while any unanswered change needs that,
  or needs a re-review after the document changed. Reject and Reject all are never blocked.
- **Stale proposals**: the proposal flags `changedSinceProposal` when the document's `updatedAt` is
  after the interrupt; the card warns and Approve becomes "Approve anyway" (and "Approve all" waits
  for that review). Approving sends `seenUpdatedAt`; if the document changed after the card showed
  it, the server answers 409 `stale`: those answers are dropped, the diffs reloaded and asked again,
  the other answers kept. Note that `updatedAt` moves on any save, autosaves included.
- **Outcome**: once sent, the card stays in the transcript and shows Applied (saved as a draft),
  Rejected (with the reason), or Failed with the error from the tool result, including an access
  error at apply time: tools run as the user and plugin-mcp lists one tool per operation for every
  collection, so an approved write can still be denied. After a reload the tool row shows the
  status instead.
- **Ownership**: the proposals endpoint and every resume check the conversation's owner; another
  user's conversation answers 404 and nothing runs.
- `ApprovalControl` (the minimal #64 control) is still exported; a custom renderer gets a
  `PendingApproval` with `proposal`, `status`, `decision`, `outcomeMessage`, `staleReview`,
  `waitingFor`, `approve()`, `reject(reason?)`, `undo()` and `documentHref(id)`.

## Budgets, audit log and redaction (#68)

All three hook into the turn as one `chat()` middleware (`turnPolicyMiddleware`,
`src/server/policy.ts`), where every model call and every tool result passes, inside the
conversation's Durable Object (or the Node process with the in-memory backend).

### Budgets

- **What counts.** `onUsage` fires once per model call (failed calls included) with TanStack's
  usage: `promptTokens`, `completionTokens`, `totalTokens` and, from the OpenRouter adapter
  (`@tanstack/ai-openrouter` 1.1.1), `cost`: the adapter asks for usage in the stream
  (`stream_options: { include_usage: true }`) and copies OpenRouter's `usage.cost` (USD) onto each
  call's `RUN_FINISHED` (`tests/turn.test.ts` checks it against the real adapter). A model call
  without a reported cost counts its tokens and $0.
- **Where it is stored.** In the user's `AssistantConversationIndex` object (single writer):
  `addUsage(tenant, thread, day, amount)` adds to `assistant_usage (tenant_id, day)` and to the
  conversation's index entry (`metadata.costUsd` / `metadata.tokens`) in one SQLite transaction,
  never a read-modify-write in a Worker. Daily rows are kept 35 days. The entry write bumps its
  revision, so a rename racing it retries. A deleted conversation's spend still counts for the
  day. The in-memory backend keeps the same in process memory.
- **Recorded after a disconnect.** The conversation object calls `addUsage` from inside the run
  (`TurnContext.recordUsage`), so a closed tab changes nothing.
- **The check.** `POST /chat` reads today's usage (`backend.usage`) before tool discovery and the
  turn, and answers 402 `budget_exceeded` ("You have used today's assistant budget ($5.00). It
  resets at midnight UTC.") once `costUsd ≥ dailyCostUsd` or `tokens ≥ dailyTokens`. Resumes are
  checked too: approving applies a write and lets the run go on, so it waits for the next day.
- **Rejecting still works.** A resume whose decisions all reject (or cancel) goes through over the
  cap: it writes nothing and lets the paused run end. The run still needs the model's closing
  answer, so it runs with `maxSteps` 1: one model call, whose cost is recorded (a rejection can
  overshoot slightly). If that call asks for a tool anyway, a read runs and its result is stored
  without another model call; a write pauses on a new card, which can again only be rejected.
- **Overshoot.** The check is at the start of a turn and usage is recorded as calls finish, so a
  run that starts under the cap finishes, and concurrent turns can each start just under it. One
  run (up to `maxSteps` model calls) per tab can go over. The OpenRouter key's credit limit is the
  hard, account-wide cap.
- **Shown** in the view's header (what is left today, this conversation's cost; a banner once
  used up) from `GET /usage`, refreshed when a run starts and ends, and per conversation in the
  list.

### Redaction

- **Defaults.** Every auth collection of the config hides `DEFAULT_AUTH_REDACTIONS`: `email`,
  `apiKey`, `apiKeyIndex`, `apiKeyLast4`, `enableAPIKey`, `sessions`, `salt`, `hash`,
  `resetPasswordToken`, `resetPasswordExpiration`, `_verificationToken`, `loginAttempts`,
  `lockUntil` (some of which Payload strips already). `redact` adds to them. The policy is resolved
  from the running (sanitized) config, so auth collections added by later plugins count too.
- **One reader on the Worker (#133).** Every read the endpoints make (approval cards, references,
  the config endpoint's `redactedTitles`) goes through the request's `UserReader`
  (`src/server/reader.ts`, `readerFor(req, options)`): `findByID`, `find`, `findGlobal` and
  `findVersion` are always `overrideAccess: false` with the request's user, `depth: 0` unless
  asked, the latest draft when the collection or global has drafts, and return documents already
  redacted; `find` refuses a `where` on a hidden field (`HiddenFieldError`); `title(slug, doc, id)`
  is the only way documents are named; `hiddenField(args, toolName)` is the hidden-field check.
  Its `policy` (`{ paths, relations }`, plain JSON) is what the endpoint sends with the turn
  (`settings.redaction`), and the turn's middleware and message store use it as sent.
- **Titles.** A document is named by `admin.useAsTitle` (its id when there is none) in the
  reference note, the stored message (`metadata.assistant`), the `@` search, the chips and the
  approval cards, all through `UserReader.title`. When that field is redacted (by the defaults or
  `redact`, the same policy the tools use) its value is never read or used: the document is
  `<singular label> #<id>` (`User #12`).
- **Paths.** Dotted field names (`profile.phone`); arrays and blocks rows are walked implicitly
  (`layout.trackingId` drops it from every row). Documents of the call's collection are found at
  the top of a result and inside `docs`, `doc`, `version` and `parent` (the versions tools) and
  `result`. Copies, never mutations.
- **Populated relations.** A relationship, upload or join populated with `depth > 0` is redacted
  with the paths of the collection it points to, not its parent's: Payload 4's `createdBy` /
  `updatedBy` (on every collection, polymorphic `{ relationTo, value }` to the auth collections)
  lose the user's email like a read of `users` would. `relationMapOf` reads every collection's and
  global's relationship, upload and join fields from the sanitized config (through groups, named
  tabs, arrays and blocks, inline or by reference; `relationTo` single, polymorphic or `hasMany`;
  joins' `{ docs }`) and keeps those that lead to a redacted field, directly or through other
  relations (a page's `hero` → `media` → `createdBy` → `users`). Nested documents are followed
  recursively, at most 8 levels deep; a document past that is cut down to its id. Any polymorphic
  `{ relationTo, value: {…} }` elsewhere (a Lexical relationship or upload node, a custom tool's
  result, a tool without a `slug`) is redacted by its `relationTo` too.
- **Queries on hidden fields are refused.** A call whose `where` (through `and` / `or`), `sort`,
  `select` (fields turned on) or `findDistinct` `field` names a redacted field, directly or
  through a relation (`createdBy.email`, `hero.createdBy.email`), doesn't run: `onBeforeToolCall`
  answers with a tool error saying the field is hidden, so the model can't probe a value by
  filtering, counting or ordering on it. `findDistinct` on a redacted field is refused rather
  than answered with empty values, so the model doesn't conclude there are none (and its rows are
  keyed by the literal dotted path, which the document walker wouldn't match). A write is checked
  when it is applied, since `chat()` asks no hook before the approval: its card shows a notice
  that it will be refused, and if approved anyway it is refused (and not audited). The versions
  tools (`findVersions`, `countVersions`, the globals' versions tools: any tool whose name says
  "version") hold the document's fields under `version.` and the collection document under
  `parent`, so for them `version.createdBy.email`, `version.email` and `parent.email` are
  refused like `createdBy.email` and `email`. On other tools a field called `version` is just a field.
- **Tool results → model.** `onAfterToolCall` returns `replaceResult` with the redacted result, so
  the model, the stream (and its log) and the stored transcript all get the same redacted value.
  plugin-mcp answers in text, so every JSON object in the text (fenced or not; `findDocuments`
  with rich text as Markdown included) is parsed, redacted and written back; the text around it
  is untouched. Checked against every plugin-mcp result shape: `findDocuments` (by id and by
  `where`), `updateDocument` and `deleteDocuments` (by id and by `where`), `createDocuments`
  (`{ docs: [{ doc }], errors }`), `duplicateDocument`, `findVersions`, `findVersionByID`,
  `restoreVersion`, `updateGlobal` and `findDistinct` (`{ values }`).
- **Stored messages.** The turn's message store also redacts every tool message on save
  (`redactedMessageStore`), whatever put it there.
- **Approval cards.** The documents read for a diff (the current document, the version to
  restore, the documents a `where` matches, the document of a rich text edit) come from the
  `UserReader`, so they arrive without the redacted fields, populated relations included, and their
  current values never show (a rich text field that is itself redacted can't be shown as "before"). Values the model proposes to write are shown: it
  authored them.
- **Limits.** Free text is not redacted: an error message that quotes a value (a validation error
  echoing what was sent) passes through, and so does a redacted value the user types into the chat.

### Audit log

- **What.** One `AssistantAuditEvent` per document a successful call of a tool that needs approval
  (a write) changed: `userKey`, `userId`, `tool`, `collection` (the call's `slug`), `documentId`,
  `conversationId`, `runId`, `model`, `timestamp`. No content: versions hold the history. Reads
  don't need approval; a rejected approval never runs the tool (`chat()` calls no hook for it); a
  call that failed (an access error at apply time) has `ok: false`; a call refused for a hidden
  field never ran. None of those are logged.
- **Document ids** (`auditDocumentIds`), never a wrong one: the call's `id` argument; for
  `duplicateDocument` and `restoreVersion`, the document written (the copy, the restored
  document), not the `id` argument (the source, the version); for a write by `where` or a create,
  one event per id plugin-mcp lists in its result (`Updated documents:` / `Deleted documents:`, the
  `docs` of `createDocuments`), ignoring its `Errors:` section (documents not changed). A write by
  `where` that changed nothing ("Updated: 0 documents") gives no event. `""` for a global, or a
  custom tool whose result has no ids.
- **Large writes** (`AUDIT_DOCUMENT_EVENT_LIMIT` = 200). Analytics Engine takes at most 250 data
  points per Worker invocation and silently drops the rest, so a `where` update or delete that
  changes hundreds of documents would under-report. A turn emits one event per document until
  it has sent 200 (the count is kept across the turn's tool calls); every document past that is
  covered by one **summary event** per tool call: same user, tool, collection, conversation, run
  and model, `documentId` `"*"` and `documents` = how many documents it stands for. The 50 data
  points left are for the summaries (a run makes at most 25 tool calls). Nothing is lost
  silently: per-document events plus the `documents` of the summaries add up to the documents
  changed. Writes of up to 200 documents are unchanged. A turn is one invocation: a resume after
  an approval starts a new count.
- **Where.** The sink is the app's: the plugin never reads `env`. With the Durable Objects, turns
  run in the conversation object, which has no plugin options, so the object takes it from the
  factory the app passes to `assistantConversation()` (default: none; see
  [App wiring](#app-wiring-66), step 5). With the in-memory backend the plugin's `audit` option is
  used. A failing sink is logged and never fails the run.
- **Analytics Engine.** `analyticsEngineAuditSink(dataset)` writes `indexes: [userKey]`, `blobs:
  [userKey, tool, collection, documentId, conversationId, model, runId]`, `doubles: [1]` (a
  summary event: `[documents]`, so `SUM(double1 * _sample_interval)` counts documents); query
  with the SQL API (`SELECT blob1 AS user, blob2 AS tool … FROM cargo_assistant_audit`). Analytics
  Engine keeps 3 months.

## Development

```bash
pnpm --filter @cargo/payload-plugin-assistant build
pnpm --filter @cargo/payload-plugin-assistant test       # Node suite, then the workerd suite
pnpm --filter @cargo/payload-plugin-assistant typecheck  # tsconfig.json + tsconfig.do.json (Workers types)
```

`vitest.config.ts` is the Node suite (`tests/ui/`: the chat UI under jsdom with `@payloadcms/ui`
stubbed, Markdown safety, tool rows, composer keys, approvals, the conversation list, and the
error/result/link helpers; options, boot (the view's redirects and the nav link's `access` gate
against real Payload), caps, the in-memory fallback's options, the lifecycle suite over process
memory (`tests/lifecycle.test.ts`, the same `tests/lifecycle/suite.ts` the workerd suite runs over
SQLite: ownership, rejoin, run ids, stop, delete during a run and the fence, retention, usage,
audit); `tests/integration/chat.test.ts`: every endpoint through Payload's router against real
Payload + plugin-mcp, turns with `fakeText()`; `tests/turn.test.ts`: the real OpenRouter adapter with
its `httpClient` replaced, asserting the serialised request and the error mapping;
`tests/approvals/diff.test.ts`: the diff and Lexical-to-text helpers; `tests/integration/approvals.test.ts`:
proposals, approve, reject with a reason, batches, stale proposals, an access error at apply
time and ownership end to end; `tests/integration/richText.test.ts`: the Markdown tool and reads
through plugin-mcp on app-shaped editors (block references, columns → content blocks) plus a list
fixture, paths and errors, ids kept, formatting loss, access, the card and the system prompt; `tests/ui/approvals.test.tsx`: the card, and the chat panel's
batch, stale and refused-send handling with a fake `useChat`; `tests/integration/reader.test.ts`
(#133): the `UserReader` on a real Payload: redacted paths through groups, arrays and blocks,
populated relations, drafts, versions, access, refused hidden-field queries (the versions tools'
`version.` / `parent.` paths included), titles, and the policy the turn applies as sent;
`tests/policies.test.ts`: tool results and the stored transcript through the turn's middleware and
message store, relations, hidden-field checks, usage and audit helpers; `tests/integration/policies.test.ts` (#68): budgets recorded, refused with
402 before any model call, per user, reset at midnight UTC, recorded after a disconnect, approving
refused but rejecting let through over the cap with one closing model call; one audit event per
approved write and none for reads, rejections or failures, also past `maxToolCalls` (only the calls
that ran), one per document with its own id for updates and deletes by `where` and multi-document
creates; redacted fields absent from what the model sees, the stream, the stored transcript and
the approval cards, including an `updateDocument` result with rich text as Markdown and a page's
populated `createdBy`; `findDistinct`, `where` and `sort` on a hidden field refused, directly and
through a relation, and a write by such a `where` refused after approval and not audited); `tests/integration/references.test.ts`:
the context and mentions resolved as the user (unreadable, missing and unreachable documents and
globals refused), stored on the message and named to the model without content, the `@` search's
access and fields, and where the edit-view control is added; `tests/references.test.ts`: the note,
the middleware, mentions parsing, which writes touch the open document; `tests/ui/documents.test.tsx`:
the `@` keyboard flow and chips, chips on stored messages, the button's visibility and the reload,
ask and keep-editing paths). `vitest.workerd.config.ts` runs `tests/workerd/` under workerd with
`@cloudflare/vitest-plugin` 1.4.11 (its Miniflare and Wrangler match the app's), against the test
Worker in `tests/workerd/` (same bindings as the app wiring above): conformance of both objects,
the lifecycle suite over the object's SQLite (`tests/workerd/lifecycle.test.ts`), the object's own
owner checks, the alarm's re-arming, a run id kept after its log was pruned, restart mid-run, and
the MCP transport prototype, and the real turn in the object (`tests/workerd/chat.test.ts`: tools,
approval resume, a reject reason reaching the model, disconnect + rejoin, stop;
`tests/workerd/policies.test.ts`: usage in the index object per day and conversation, after a
disconnect, atomic and pruned, the audit sink in the object, redaction in the stream, log and
transcript, populated relations redacted by their collection, a hidden-field query refused; references stored in the object's SQLite and named to
the model). Storage is shared between the tests of a file there, so each test uses its own
ids.
