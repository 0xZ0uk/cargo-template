# Changelog

## [Unreleased]

### Added

- The chat turn (#63), `createTurnRunner()` in `src/server/turn.ts`: `chat()` on OpenRouter (`createOpenRouterText(model, apiKey, { appTitle, httpReferer })`, SDK retries off) with plugin-mcp's tools as the admin, the conversation's stores (`withPersistence`), compaction past `maxContextTokens` (old tool results first, then the oldest turns), `maxIterations(maxSteps)`, prompt caching (`session_id` = thread, Anthropic cache markers) and the camelCase provider routing. Tests assert the serialised request body (`provider: { require_parameters, data_collection: "deny" }`).
- `AssistantConversation` runs that turn by default (the 501 stub is gone). The Worker endpoint authenticates, validates, resolves the turn's settings (model, key, system prompt, limits, `toolFilter` names) and hands the turn to the object, proxying its SSE. A closed tab doesn't stop a run.
- Stop: `POST /api/assistant/chat/stop` / `ConversationBackend.stop()`. The run's `chat()` is aborted, the stream ends with `RUN_ERROR { code: "stopped" }` (in the log too, so a rejoin sees it) and the run is `aborted`. Deleting a conversation still cuts its run at once (`RunControl`).
- Endpoints for the admin UI (#64), contract in the README: `POST /api/assistant/chat` (turn or approval resume, `useChat`-compatible body), `GET /api/assistant/chat` (rejoin with `Last-Event-ID`/`?offset`, or the `hydrate()` transcript), `POST /api/assistant/chat/stop`, `GET|PATCH|DELETE /api/assistant/conversations[/:threadId]`, `GET /api/assistant/config`. JSON errors carry a `code`.
- System prompt built on the Worker: the site, its collections and globals with the descriptions given to plugin-mcp, drafts-first and never publish unless asked, `getCollectionSchema` before writing, small targeted updates, a link to the admin page after a change, then the app's `instructions` and `payloadToolsSystemPrompt`.
- OpenRouter errors mapped to `RUN_ERROR` codes with user-facing messages: `openrouter_invalid_key` (401), `openrouter_out_of_credits` (402), `openrouter_rate_limited` (429), `model_unavailable` (404/502/503, "no endpoints"), plus `context_overflow`, `not_signed_in`, `tools_unavailable`, `stopped`, `run_failed`.
- The transcript is server-authoritative: only the request's newest user message is used (text only, 32,000 characters at most, given a stable id); earlier or non-user messages from the client are ignored. A new conversation is titled from its first message. Hydration includes `runs` (`completed` / `aborted` / `failed`).
- Options: `maxContextTokens` (default 64,000) and `appTitle` (OpenRouter attribution).

### Changed

- `inProcessDispatch`, `mcpEndpointFor` and `payloadToolSourceForRequest` moved to `src/tools/inProcess.ts`, so the Durable Object bundle never imports `payload`.
- `rateLimit(req)` is called for chat turns (send and resume) only; reads, rejoins, stop and the conversation endpoints aren't rate limited.

- Payload tools (#61), `src/tools/payloadToolSource.ts`: `createPayloadToolSource({ endpoint, headers, dispatch, toolFilter })` gives `chat({ mcp })` plugin-mcp's tools as the signed-in user, through an MCP client that forwards the admin's `Cookie`/`Authorization`/`Origin` to `POST /api/mcp`. The dispatcher is injectable (`McpDispatch`): `inProcessDispatch(config)` runs the request through `handleEndpoints` in the same isolate; a Durable Object can pass a service-binding fetch instead. `payloadToolSourceForRequest(req)` wires it for a `PayloadRequest`.
- Tool rules: plugin-mcp's auth tools and `getUploadInstructions` (the model can't upload bytes) are never offered; `toolFilter` applies on top. Tools not annotated `readOnlyHint: true` need approval. Access denials reach the model as tool errors, not retries.
- Discovery fails loudly: `AssistantNotSignedInError` when `/api/mcp` doesn't accept the session (`-32601` from `tools/list`), `AssistantToolDiscoveryError` otherwise; `payloadToolsMcpOptions(source)` rethrows them from `onDiscoveryError`, so a run never goes ahead with no tools.
- `payloadToolsSystemPrompt(instructions)`: tool guidance for the system prompt, chiefly `select` + `limit` + `depth: 0` on `findDocuments`.
- Conversations in Durable Objects (#62), exported from `./do` (workerd-only): `AssistantConversation` (one per conversation: messages, runs, interrupts, metadata and a `StreamDurability` log over its SQLite; runs the chat turn so a run outlives its request) and `AssistantConversationIndex` (one per user: `SessionIndexStore` for list/rename/delete). Both pass `runPersistenceConformance` under workerd.
- Ownership: the first `claim` owns a conversation; reads, rejoins, new turns, renames and deletes by anyone else answer like a missing conversation. The object re-checks the owner on its own routes.
- Retention: an alarm deletes conversations idle for `conversations.retentionDays` (default 30) with their index entry. Size caps (`conversations.caps`): tool results cut to 16 KiB, oldest whole turns dropped past 400 messages or 1 MiB, stream-log events shrunk below 256 KiB.
- `ConversationBackend` for the endpoint (#63): Durable Objects, or `memoryConversations()` in Node. Turns run through a `TurnRunner` with the capped persistence, an MCP `fetch` and a stop signal.
- MCP from inside the object: `serviceBindingMcpFetch` over a service binding to the same Worker (`ASSISTANT_SELF`), forwarding the admin's Cookie and Origin; prototyped under workerd against a real MCP server.
- Options: `conversations: { namespace, index, retentionDays, caps }` (`namespace` and `index` go together).
- Deleting a conversation during a live run aborts the run and fences it off (an epoch per purge): its last events, rows, activity and alarm never land in the deleted conversation, and readers tailing it end.
- A run id is rejected (409) for the conversation's whole lifetime, also after its stream log was pruned (`assistant_run_ids`, plus the runs table).
- `conversationBackend()` rebuilds the memory backend on every call with that call's options, over one process-wide set of conversations (`createMemoryConversationState()`, `memoryConversations({ state })`); the first caller's options no longer stick.
- Tests: a workerd suite (`vitest.workerd.config.ts`, `@cloudflare/vitest-plugin` 1.4.11) run by `pnpm test` after the Node suite.

- Package scaffold (#60): `assistantPlugin(options)` registers `POST /api/assistant/chat` and the `/admin/assistant` view. The endpoint checks sign-in (401), `access` (403), configuration (503), `rateLimit` (429), then answers `501 { error: "not implemented" }`; the view is a placeholder. No collections, globals or fields, so no migration and no import-map change beyond the view.
- Options: `enabled`, `access`, `models`, `defaultModel`, `apiKey`, `instructions`, `maxSteps`, `toolFilter`, `conversations: { namespace }`, `rateLimit`. A missing `apiKey` warns and leaves the assistant unconfigured: the endpoint and view are registered either way and report "not configured".
- Access: `access({ user, req })` guards both the endpoint (403) and the admin view (redirect to `admin.routes.unauthorized`; anonymous visitors go to login). The default admits only users of the admin auth collection (`config.admin.user`), not any signed-in user, so a session on another auth collection can't spend OpenRouter credit or reach the admin shell. The function reaches the view through `serverProps` only, never the client config.
- OpenRouter provider routing defaults (`requireParameters`, `dataCollection: 'deny'`), camelCase on purpose.
