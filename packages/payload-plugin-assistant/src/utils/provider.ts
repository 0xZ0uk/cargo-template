/**
 * OpenRouter provider routing, applied to every request: drafts reach the model, so providers
 * that log or train on prompts are excluded and the model's parameters must be honoured.
 *
 * The keys MUST be camelCase. The SDK serialises them to `require_parameters` and
 * `data_collection`; the snake_case spelling is silently dropped by its schema, which would
 * send drafts to any provider. `tests/turn.test.ts` asserts the serialised request body.
 */
export const OPENROUTER_PROVIDER = {
  requireParameters: true,
  dataCollection: "deny",
} as const;
