# Changelog

## [Unreleased]

### Added

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
