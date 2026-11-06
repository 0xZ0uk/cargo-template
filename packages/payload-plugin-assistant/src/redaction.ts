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
 * What every auth collection hides by default: the email (personal data), API keys (and their
 * last four characters), sessions and the auth bookkeeping Payload keeps on the user (password
 * hash and salt, reset and verification tokens, lockout state). Payload already strips some of these from API responses (`hash`,
 * `salt`, the tokens); they are listed anyway, so a custom read or a future Payload change can't
 * leak them.
 */
export const DEFAULT_AUTH_REDACTIONS = [
  "email",
  "apiKey",
  "apiKeyIndex",
  "apiKeyLast4",
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

/** A relationship, upload or join field: where documents of `relationTo` appear in another collection's documents. */
export interface RelationField {
  /** Dotted data path (groups, named tabs, arrays and blocks by name, as in a {@link RedactionMap}). */
  path: string;
  /** The target collection; several for a polymorphic field (values `{ relationTo, value }`). */
  relationTo: string | string[];
  /** A join field: its value is `{ docs: [...] }`. */
  join?: boolean;
}

/** Collection or global slug → its relation fields that can lead to redacted fields (`relationMapOf`). */
export type RelationMap = Record<string, RelationField[]>;

/**
 * What to hide: the redacted paths per slug and where documents of one collection appear inside
 * another's (`relations`). Populated relationships (Payload 4's `createdBy` / `updatedBy` on every
 * collection, uploads, joins, the app's own relationships) are redacted with the paths of the
 * collection they point to, recursively.
 */
export interface RedactionPolicy {
  paths: RedactionMap;
  relations?: RelationMap;
}

/** How deep populated documents are followed. Deeper populated documents are cut down to their id. */
const MAX_NESTING = 8;
/** How deep the scan for polymorphic `{ relationTo, value }` values goes (rich text nests deeply). */
const MAX_SCAN_DEPTH = 48;

export const isEmptyPolicy = (policy: RedactionPolicy | undefined): boolean =>
  !policy || !Object.values(policy.paths).some((paths) => paths.length);

const splitPath = (path: string) => path.split(".").filter(Boolean);

/** Replace the value at `segments` with `fn(value)`, walking arrays (array and blocks rows) implicitly; copies only what changes. */
function mapPath(node: Json, segments: readonly string[], fn: (value: Json) => Json): Json {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const result = mapPath(item, segments, fn);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : node;
  }
  if (!isRecord(node) || segments.length === 0) return node;
  const [head, ...rest] = segments as [string, ...string[]];
  if (!(head in node)) return node;
  const child = node[head];
  const result = rest.length === 0 ? fn(child) : mapPath(child, rest, fn);
  return result === child ? node : { ...node, [head]: result };
}

const knownSlug = (policy: RedactionPolicy, slug: unknown): slug is string =>
  typeof slug === "string" && (Boolean(policy.paths[slug]?.length) || Boolean(policy.relations?.[slug]?.length));

/** A populated document past {@link MAX_NESTING}: only its id is kept. */
const cut = (doc: Record<string, unknown>): Json => ("id" in doc ? doc.id : null);

/** One document of `slug` without its redacted paths, its populated relations redacted by their own collection. */
function redactEntity(node: Json, slug: string, policy: RedactionPolicy, depth: number): Json {
  if (!isRecord(node)) return node;
  let current: Json = node;
  for (const path of policy.paths[slug] ?? []) current = dropPath(current, splitPath(path));
  for (const field of policy.relations?.[slug] ?? []) {
    current = mapPath(current, splitPath(field.path), (value) => redactRelationValue(value, field, policy, depth + 1));
  }
  return current;
}

/** A relationship, upload or join value: ids stay, populated documents are redacted as documents of their collection. */
function redactRelationValue(value: Json, field: RelationField, policy: RedactionPolicy, depth: number): Json {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = redactRelationValue(item, field, policy, depth);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : value;
  }
  if (!isRecord(value)) return value;
  if (field.join && Array.isArray(value.docs)) {
    const docs = redactRelationValue(value.docs, { ...field, join: false }, policy, depth);
    return docs === value.docs ? value : { ...value, docs };
  }
  if (typeof value.relationTo === "string" && "value" in value) {
    // Polymorphic: `{ relationTo, value }`.
    const inner = value.value;
    if (!isRecord(inner)) return value;
    const redacted = depth > MAX_NESTING ? cut(inner) : redactEntity(inner, value.relationTo, policy, depth);
    return redacted === inner ? value : { ...value, value: redacted };
  }
  if (depth > MAX_NESTING) return cut(value);
  // A populated document. Polymorphic fields always answer `{ relationTo, value }`; should one not,
  // every target's paths apply (hiding too much is the safe side).
  let current: Json = value;
  for (const target of Array.isArray(field.relationTo) ? field.relationTo : [field.relationTo]) {
    current = redactEntity(current, target, policy, depth);
  }
  return current;
}

/**
 * Any `{ relationTo, value: {…} }` of a collection with redacted fields, anywhere in `node`: the
 * polymorphic shape Payload uses for relationships and Lexical for relationship and upload nodes.
 * Catches populated documents no schema path names (rich text, custom tools, tools without a slug).
 */
function redactPolymorphic(node: Json, policy: RedactionPolicy, depth: number): Json {
  if (depth > MAX_SCAN_DEPTH || node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const result = redactPolymorphic(item, policy, depth + 1);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : node;
  }
  let current = node as Record<string, unknown>;
  if (knownSlug(policy, current.relationTo) && isRecord(current.value)) {
    const inner = redactEntity(current.value, current.relationTo, policy, 1);
    if (inner !== current.value) current = { ...current, value: inner };
  }
  let copy: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(current)) {
    if (child === null || typeof child !== "object") continue;
    const result = redactPolymorphic(child, policy, depth + 1);
    if (result !== child) (copy ??= { ...current })[key] = result;
  }
  return copy ?? current;
}

/** Wrappers around documents of the call's collection: pages, `{ doc }`, versions and their `parent`, `{ result }`. */
const WRAPPERS = ["docs", "doc", "version", "parent", "result"] as const;

/**
 * `findDistinct` rows: `{ values: [{ [field]: value }] }`, keyed by the literal (possibly dotted)
 * field path. A redacted field is refused before the call ({@link redactedReference}); a
 * relationship's populated values are redacted by their collection.
 */
function redactDistinctRows(rows: unknown[], slug: string, policy: RedactionPolicy): unknown[] {
  let changed = false;
  const next = rows.map((row) => {
    if (!isRecord(row)) return row;
    let current: Record<string, unknown> = row;
    for (const key of Object.keys(row)) {
      if ((policy.paths[slug] ?? []).some((path) => key === path || key.startsWith(`${path}.`))) {
        const { [key]: _dropped, ...kept } = current;
        current = kept;
        continue;
      }
      const field = policy.relations?.[slug]?.find((candidate) => candidate.path === key);
      if (field) {
        const value = redactRelationValue(current[key], field, policy, 1);
        if (value !== current[key]) current = { ...current, [key]: value };
      }
    }
    if (current !== row) changed = true;
    return current;
  });
  return changed ? next : rows;
}

/**
 * A value about the collection or global `slug` (a document, a list, a page, a version, a
 * `findDistinct` answer…) without redacted fields: the slug's paths are dropped, populated
 * relations are redacted with their own collection's paths, and any polymorphic
 * `{ relationTo, value }` anywhere is redacted by its `relationTo`. Without a slug, only the last
 * applies. Copies; returns the same value when nothing changes.
 */
export function redactFor<T = Json>(value: T, slug: string | undefined, policy: RedactionPolicy | undefined): T {
  if (!policy || isEmptyPolicy(policy)) return value;
  const visit = (node: Json, depth: number): Json => {
    if (depth > 4 || slug === undefined) return node;
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
    const current = redactEntity(node, slug, policy, 0) as Record<string, unknown>;
    let copy: Record<string, unknown> | undefined;
    for (const key of WRAPPERS) {
      const child = current[key];
      if (child === undefined || child === null || typeof child !== "object") continue;
      const result = visit(child, depth + 1);
      if (result !== child) (copy ??= { ...current })[key] = result;
    }
    if (Array.isArray(current.values)) {
      const values = redactDistinctRows(current.values, slug, policy);
      if (values !== current.values) (copy ??= { ...current }).values = values;
    }
    return copy ?? current;
  };
  return redactPolymorphic(visit(value, 0), policy, 0) as T;
}

const SINGLE = "\u0000";
const single = (paths: readonly string[] | undefined): RedactionPolicy => ({ paths: { [SINGLE]: paths ?? [] } });

/**
 * One document without the redacted paths (no relations). Also walks the wrappers Payload and
 * plugin-mcp put around documents: a list (`[doc, …]`), a page (`{ docs: [...] }`), `{ doc }`, a
 * version (`{ version: doc }`, as the versions tools return them) and `{ result }`.
 */
export function redactDocument<T = Json>(value: T, paths: readonly string[] | undefined): T {
  if (!paths?.length) return value;
  return redactFor(value, SINGLE, single(paths));
}

/** The leaf names of every redacted path: a cheap "could this text contain one?" check before parsing. */
const leavesOf = (policy: RedactionPolicy) => [
  ...new Set(
    Object.values(policy.paths)
      .flat()
      .map((path) => splitPath(path).at(-1))
      .filter(Boolean) as string[]
  ),
];

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

/** Every JSON object or array in `text` (fenced or not), parsed, in order. */
export function jsonValuesIn(text: string): unknown[] {
  const values: unknown[] = [];
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
    try {
      values.push(JSON.parse(text.slice(i, end)));
      i = end;
    } catch {
      i++;
    }
  }
  return values;
}

/**
 * A tool result's text without redacted fields ({@link redactFor}). plugin-mcp answers in text
 * with the data as JSON, fenced or not ("Document from collection …:\n{…}", "Collection: …\n```json\n{…}\n```",
 * `findDocuments` with rich text as Markdown): every JSON object or array in the text is parsed,
 * redacted and written back (in its own indentation style); text around it, and JSON that holds
 * nothing to redact, are kept byte for byte.
 */
export function redactTextFor(text: string, slug: string | undefined, policy: RedactionPolicy | undefined): string {
  if (!policy || isEmptyPolicy(policy) || !leavesOf(policy).some((leaf) => text.includes(`"${leaf}"`))) return text;
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
    const redacted = redactFor(parsed, slug, policy);
    if (redacted !== parsed) {
      out += text.slice(cursor, i) + (span.includes("\n") ? JSON.stringify(redacted, null, 2) : JSON.stringify(redacted));
      cursor = end;
    }
    i = end;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

/** {@link redactTextFor} with one collection's paths. */
export function redactText(text: string, paths: readonly string[] | undefined): string {
  return paths?.length ? redactTextFor(text, SINGLE, single(paths)) : text;
}

/**
 * A tool result (what `chat()` hands the model) without redacted fields: a string (plugin-mcp's
 * text), content parts (`{ type: "text", content }`), or structured data.
 */
export function redactResultFor<T = Json>(result: T, slug: string | undefined, policy: RedactionPolicy | undefined): T {
  if (!policy || isEmptyPolicy(policy) || result === null || result === undefined) return result;
  if (typeof result === "string") return redactTextFor(result, slug, policy) as T;
  if (Array.isArray(result) && result.every((part) => isRecord(part) && typeof part.type === "string")) {
    let changed = false;
    const parts = result.map((part: Record<string, unknown>) => {
      if (part.type !== "text" || typeof part.content !== "string") return part;
      const content = redactTextFor(part.content, slug, policy);
      if (content === part.content) return part;
      changed = true;
      return { ...part, content };
    });
    return (changed ? parts : result) as T;
  }
  return redactFor(result, slug, policy);
}

/** {@link redactResultFor} with one collection's paths. */
export function redactToolResult<T = Json>(result: T, paths: readonly string[] | undefined): T {
  return paths?.length ? redactResultFor(result, SINGLE, single(paths)) : result;
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
 * A transcript without redacted fields in its tool results: each `tool` message is redacted as a
 * result about the slug its call named ({@link redactResultFor}). What the conversation stores
 * goes through this, so a value that reached the transcript some other way (an older message, a
 * custom runner) never stays there.
 */
export function redactTranscript(messages: ModelMessage[], policy: RedactionPolicy | undefined): ModelMessage[] {
  if (!policy || isEmptyPolicy(policy)) return messages;
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
    const content = redactResultFor(message.content, slugOfCall.get(message.toolCallId), policy);
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

/** Whether the dotted query `path` on `slug` reaches a redacted field, directly or through a relation (`createdBy.email`). */
function reachesRedacted(policy: RedactionPolicy, slug: string, segments: readonly string[], depth = 0): boolean {
  if (depth > MAX_NESTING || segments.length === 0) return false;
  for (const path of policy.paths[slug] ?? []) {
    const redacted = splitPath(path);
    if (redacted.length <= segments.length && redacted.every((segment, index) => segments[index] === segment)) return true;
  }
  for (const field of policy.relations?.[slug] ?? []) {
    const relation = splitPath(field.path);
    if (relation.length >= segments.length || !relation.every((segment, index) => segments[index] === segment)) continue;
    let rest = segments.slice(relation.length);
    const polymorphic = Array.isArray(field.relationTo);
    if (polymorphic && rest[0] === "value") rest = rest.slice(1);
    for (const target of polymorphic ? field.relationTo : [field.relationTo as string]) {
      if (reachesRedacted(policy, target, rest, depth + 1)) return true;
    }
  }
  return false;
}

/** The field paths a `where` names: its keys, through `and` / `or`. */
function wherePaths(where: unknown, depth = 0): string[] {
  if (depth > 16) return [];
  if (Array.isArray(where)) return where.flatMap((item) => wherePaths(item, depth + 1));
  if (!isRecord(where)) return [];
  return Object.entries(where).flatMap(([key, value]) =>
    key === "and" || key === "or" || key === "AND" || key === "OR" ? wherePaths(value, depth + 1) : [key]
  );
}

/** The field paths a `select` turns on (`{ group: { field: true } }` → `group.field`). */
function selectPaths(select: unknown, prefix = "", depth = 0): string[] {
  if (!isRecord(select) || depth > 16) return [];
  return Object.entries(select).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value)) return selectPaths(value, path, depth + 1);
    return value ? [path] : [];
  });
}

const sortPaths = (sort: unknown): string[] =>
  (Array.isArray(sort) ? sort : typeof sort === "string" ? sort.split(",") : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/^[-+]/, ""));

/**
 * Document paths the way the versions tools (`findVersions`, `countVersions`, `findVersionByID`
 * and the globals' equivalents) take them: the document's fields sit under `version.`, and
 * `parent` is the collection document the version belongs to, so `version.createdBy.email` and
 * `parent.email` are the document's `createdBy.email` and `email`. Only for tools whose name says
 * "version": elsewhere a field may well be called `version`.
 */
const VERSION_ROOTS = new Set(["version", "parent"]);
const isVersionsTool = (toolName: string | undefined) => toolName !== undefined && /version/i.test(toolName);

/**
 * The first redacted field a tool call's arguments query, or `undefined`: a `where` (filtering by
 * a hidden field would let the model guess its values), a `sort` (ordering reveals them too), a
 * `select` that asks for one, or `findDistinct`'s `field`. Paths through relations count
 * (`createdBy.email`). Array indexes in paths (`layout.0.secret`) are ignored. For the versions
 * tools (`toolName` names a version) a leading `version.` (or `parent.`) is the document's root, so
 * `version.email` is refused like `email`; the returned path is the one the call used.
 */
export function redactedReference(policy: RedactionPolicy | undefined, args: unknown, toolName?: string): string | undefined {
  if (!policy || isEmptyPolicy(policy) || !isRecord(args)) return undefined;
  const slug = typeof args.slug === "string" ? args.slug : undefined;
  if (!slug) return undefined;
  const versions = isVersionsTool(toolName);
  const candidates = [
    ...wherePaths(args.where),
    ...sortPaths(args.sort),
    ...selectPaths(args.select),
    ...(typeof args.field === "string" ? [args.field] : []),
  ];
  return candidates.find((path) => {
    const segments = splitPath(path).filter((segment) => !/^\d+$/.test(segment));
    if (reachesRedacted(policy, slug, segments)) return true;
    // A versions tool: the same path with its leading `version` / `parent` dropped.
    let rest = segments;
    while (versions && rest.length > 0 && VERSION_ROOTS.has(rest[0]!)) {
      rest = rest.slice(1);
      if (reachesRedacted(policy, slug, rest)) return true;
    }
    return false;
  });
}
