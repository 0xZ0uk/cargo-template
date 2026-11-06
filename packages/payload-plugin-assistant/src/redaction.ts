import type { ModelMessage } from "@tanstack/ai";

/**
 * Field redaction (#68): fields the model never sees. Pure and dependency-free (type imports
 * only), so the turn runner (in the conversation's Durable Object), the approvals endpoint and the
 * tests share it.
 *
 * A redaction map is collection or global slug → dotted field paths (`email`, `profile.phone`,
 * `layout.secret`). Paths walk groups by name; arrays and blocks rows are walked implicitly
 * (`layout.secret` drops `secret` from every row of `layout`). Every function returns a copy and
 * never mutates its input (Payload hands hooks and tool results objects it still uses).
 */
export type RedactionMap = Record<string, readonly string[]>;

/**
 * What every auth collection hides by default: the email (personal data), API keys, sessions and
 * the auth bookkeeping Payload keeps on the user (password hash and salt, reset and verification
 * tokens, lockout state). Payload already strips some of these from API responses (`hash`,
 * `salt`, the tokens); they are listed anyway, so a custom read or a future Payload change can't
 * leak them.
 */
export const DEFAULT_AUTH_REDACTIONS = [
  "email",
  "apiKey",
  "apiKeyIndex",
  "enableAPIKey",
  "sessions",
  "salt",
  "hash",
  "resetPasswordToken",
  "resetPasswordExpiration",
  "_verificationToken",
  "loginAttempts",
  "lockUntil",
] as const;

type Json = unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Merge maps, deduplicating paths per slug. Later maps add to earlier ones. */
export function mergeRedactions(...maps: ReadonlyArray<RedactionMap | undefined>): Record<string, string[]> {
  const merged: Record<string, Set<string>> = {};
  for (const map of maps) {
    for (const [slug, paths] of Object.entries(map ?? {})) {
      const set = (merged[slug] ??= new Set());
      for (const path of paths) if (path) set.add(path);
    }
  }
  return Object.fromEntries(Object.entries(merged).map(([slug, set]) => [slug, [...set]]));
}

/** Remove one path (split in segments) from `node`, copying only what changes. */
function dropPath(node: Json, segments: readonly string[]): Json {
  if (segments.length === 0) return node;
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const result = dropPath(item, segments);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : node;
  }
  if (!isRecord(node)) return node;
  const [head, ...rest] = segments as [string, ...string[]];
  if (!(head in node)) return node;
  if (rest.length === 0) {
    const { [head]: _dropped, ...kept } = node;
    return kept;
  }
  const child = node[head];
  const result = dropPath(child, rest);
  return result === child ? node : { ...node, [head]: result };
}

/**
 * One document without the redacted paths. Also walks the wrappers Payload and plugin-mcp put
 * around documents: a list (`[doc, …]`), a page (`{ docs: [...] }`), `{ doc }`, a version
 * (`{ version: doc }`, as the versions tools return them) and `{ result }`.
 */
export function redactDocument<T = Json>(value: T, paths: readonly string[] | undefined): T {
  if (!paths?.length) return value;
  const split = paths.map((path) => path.split(".").filter(Boolean));
  const visit = (node: Json, depth: number): Json => {
    if (depth > 4) return node;
    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const result = visit(item, depth + 1);
        if (result !== item) changed = true;
        return result;
      });
      return changed ? next : node;
    }
    if (!isRecord(node)) return node;
    let current: Json = node;
    for (const segments of split) current = dropPath(current, segments);
    const record = current as Record<string, unknown>;
    let copy: Record<string, unknown> | undefined;
    for (const key of ["docs", "doc", "version", "result"]) {
      const child = record[key];
      if (child === undefined || child === null || typeof child !== "object") continue;
      const result = visit(child, depth + 1);
      if (result !== child) (copy ??= { ...record })[key] = result;
    }
    return copy ?? current;
  };
  return visit(value, 0) as T;
}

/** The leaf names of the paths: a cheap "could this text contain one?" check before parsing. */
const leaves = (paths: readonly string[]) => paths.map((path) => path.split(".").filter(Boolean).at(-1)).filter(Boolean) as string[];

/** The end (exclusive) of the JSON object or array starting at `start`, string-aware; -1 if unbalanced. */
function matchingEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * A tool result's text without the redacted paths. plugin-mcp answers in text with the data as
 * JSON, fenced or not ("Document from collection …:\n{…}", "Collection: …\n```json\n{…}\n```",
 * `findDocuments` with rich text as Markdown): every JSON object or array in the text is parsed,
 * redacted and written back (in its own indentation style); text around it, and JSON that holds
 * nothing to redact, are kept byte for byte.
 */
export function redactText(text: string, paths: readonly string[] | undefined): string {
  if (!paths?.length || !leaves(paths).some((leaf) => text.includes(`"${leaf}"`))) return text;
  let out = "";
  let cursor = 0;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char !== "{" && char !== "[") {
      i++;
      continue;
    }
    const end = matchingEnd(text, i);
    if (end === -1) {
      i++;
      continue;
    }
    const span = text.slice(i, end);
    let parsed: Json;
    try {
      parsed = JSON.parse(span);
    } catch {
      i++;
      continue;
    }
    const redacted = redactDocument(parsed, paths);
    if (redacted !== parsed) {
      out += text.slice(cursor, i) + (span.includes("\n") ? JSON.stringify(redacted, null, 2) : JSON.stringify(redacted));
      cursor = end;
    }
    i = end;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

/**
 * A tool result (what `chat()` hands the model) without the redacted paths: a string (plugin-mcp's
 * text), content parts (`{ type: "text", content }`), or structured data.
 */
export function redactToolResult<T = Json>(result: T, paths: readonly string[] | undefined): T {
  if (!paths?.length || result === null || result === undefined) return result;
  if (typeof result === "string") return redactText(result, paths) as T;
  if (Array.isArray(result) && result.every((part) => isRecord(part) && typeof part.type === "string")) {
    let changed = false;
    const parts = result.map((part: Record<string, unknown>) => {
      if (part.type !== "text" || typeof part.content !== "string") return part;
      const content = redactText(part.content, paths);
      if (content === part.content) return part;
      changed = true;
      return { ...part, content };
    });
    return (changed ? parts : result) as T;
  }
  return redactDocument(result, paths);
}

/** The collection or global a tool call is about: its `slug` argument (plugin-mcp's convention). */
export function toolSlug(input: unknown): string | undefined {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return isRecord(value) && typeof value.slug === "string" ? value.slug : undefined;
}

/**
 * A transcript without redacted fields in its tool results: each `tool` message is redacted with
 * the paths of the slug its call named. What the conversation stores goes through this, so a
 * value that reached the transcript some other way (an older message, a custom runner) never
 * stays there.
 */
export function redactTranscript(messages: ModelMessage[], map: RedactionMap | undefined): ModelMessage[] {
  if (!map || Object.keys(map).length === 0) return messages;
  const slugOfCall = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      const slug = toolSlug(call.function?.arguments);
      if (slug) slugOfCall.set(call.id, slug);
    }
  }
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "tool" || !message.toolCallId) return message;
    const slug = slugOfCall.get(message.toolCallId);
    const paths = slug ? map[slug] : undefined;
    if (!paths?.length) return message;
    const content = redactToolResult(message.content, paths);
    if (content === message.content) return message;
    changed = true;
    return { ...message, content } as ModelMessage;
  });
  return changed ? next : messages;
}

/**
 * `redact` plus {@link DEFAULT_AUTH_REDACTIONS} for every auth collection in `collections`
 * (Payload's `config.collections`: an entry with `auth` set).
 */
export function withAuthRedactions(
  redact: RedactionMap | undefined,
  collections: ReadonlyArray<{ slug: string; auth?: unknown }> | undefined
): Record<string, string[]> {
  const auth: RedactionMap = Object.fromEntries(
    (collections ?? []).filter((collection) => Boolean(collection.auth)).map((collection) => [collection.slug, DEFAULT_AUTH_REDACTIONS])
  );
  return mergeRedactions(auth, redact);
}
