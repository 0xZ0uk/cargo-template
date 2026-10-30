/** Reads `?draft=true`, which the admin's preview and live preview links add. */
export const validateDraftSearch = (search: Record<string, unknown>): { draft?: boolean } =>
  search.draft === true || search.draft === 'true' ? { draft: true } : {}
