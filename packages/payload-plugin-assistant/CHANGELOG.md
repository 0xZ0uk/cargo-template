# Changelog

## [Unreleased]

### Added

- Payload tools (#61), `src/tools/payloadToolSource.ts`: `createPayloadToolSource({ endpoint, headers, dispatch, toolFilter })` gives `chat({ mcp })` plugin-mcp's tools as the signed-in user, through an MCP client that forwards the admin's `Cookie`/`Authorization`/`Origin` to `POST /api/mcp`. The dispatcher is injectable (`McpDispatch`): `inProcessDispatch(config)` runs the request through `handleEndpoints` in the same isolate; a Durable Object can pass a service-binding fetch instead. `payloadToolSourceForRequest(req)` wires it for a `PayloadRequest`.
- Tool rules: plugin-mcp's auth tools and `getUploadInstructions` (the model can't upload bytes) are never offered; `toolFilter` applies on top. Tools not annotated `readOnlyHint: true` need approval. Access denials reach the model as tool errors, not retries.
- Discovery fails loudly: `AssistantNotSignedInError` when `/api/mcp` doesn't accept the session (`-32601` from `tools/list`), `AssistantToolDiscoveryError` otherwise; `payloadToolsMcpOptions(source)` rethrows them from `onDiscoveryError`, so a run never goes ahead with no tools.
- `payloadToolsSystemPrompt(instructions)`: tool guidance for the system prompt, chiefly `select` + `limit` + `depth: 0` on `findDocuments`.

- Package scaffold (#60): `assistantPlugin(options)` registers `POST /api/assistant/chat` and the `/admin/assistant` view. The endpoint checks sign-in (401), `access` (403), configuration (503), `rateLimit` (429), then answers `501 { error: "not implemented" }`; the view is a placeholder. No collections, globals or fields, so no migration and no import-map change beyond the view.
- Options: `enabled`, `access`, `models`, `defaultModel`, `apiKey`, `instructions`, `maxSteps`, `toolFilter`, `conversations: { namespace }`, `rateLimit`. A missing `apiKey` warns and leaves the assistant unconfigured: the endpoint and view are registered either way and report "not configured".
- Access: `access({ user, req })` guards both the endpoint (403) and the admin view (redirect to `admin.routes.unauthorized`; anonymous visitors go to login). The default admits only users of the admin auth collection (`config.admin.user`), not any signed-in user, so a session on another auth collection can't spend OpenRouter credit or reach the admin shell. The function reaches the view through `serverProps` only, never the client config.
- OpenRouter provider routing defaults (`requireParameters`, `dataCollection: 'deny'`), camelCase on purpose.
