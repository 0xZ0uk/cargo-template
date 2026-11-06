import type { CollectionSlug, GlobalSlug, PayloadRequest } from "payload";
import { parseDocumentID } from "payload";
import {
  type DocumentReference,
  type DocumentReferenceInput,
  type MessageReferences,
  referenceKey,
} from "../references";
import type { McpDispatch } from "../tools/payloadToolSource";
import { payloadToolSourceForRequest } from "../tools/inProcess";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";
import { reachableEntities } from "../utils/reachable";

/**
 * Server side of document references (#69): resolving what a message is about, as the user, and
 * the `@` search. Neither returns document content: an address and a title.
 */

export type ResolveFailure = { ok: false; status: number; code: string; error: string };
export type Resolved<T> = { ok: true; value: T } | ResolveFailure;

const fail = (status: number, code: string, error: string): ResolveFailure => ({ ok: false, status, code, error });

type CollectionConfig = PayloadRequest["payload"]["config"]["collections"][number];
type GlobalConfig = PayloadRequest["payload"]["config"]["globals"][number];

/** The field a collection's documents are named by (`admin.useAsTitle`), `id` when none. */
export const titleFieldOf = (collection: CollectionConfig): string => collection.admin?.useAsTitle || "id";

/** A label as text: a string, or the English (or first) entry of a localized one. */
function labelText(label: unknown, fallback: string): string {
  if (typeof label === "string" && label.trim()) return label.trim();
  if (label && typeof label === "object") {
    const record = label as Record<string, unknown>;
    const value = record.en ?? Object.values(record)[0];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export const globalTitle = (global: GlobalConfig): string => labelText(global.label, global.slug);

/** A document's title from its title field, falling back to its id. */
export function documentTitle(doc: Record<string, unknown> | null | undefined, field: string, id: string): string {
  const value = doc?.[field];
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  if (typeof value === "number") return String(value);
  return id;
}

const hasDrafts = (entity: CollectionConfig | GlobalConfig) =>
  Boolean((entity.versions as { drafts?: unknown } | undefined)?.drafts);

/**
 * One reference, read as the user (`overrideAccess: false`, `depth: 0`, the latest draft, only
 * the title field): 400 `invalid_reference` for a collection or global the assistant can't reach,
 * 404 `reference_not_found` for a document that doesn't exist **or that the user can't read** (the
 * two are indistinguishable, as with conversations).
 */
export async function resolveReference(req: PayloadRequest, input: DocumentReferenceInput): Promise<Resolved<DocumentReference>> {
  const config = req.payload.config;
  const reachable = reachableEntities(config);
  const notFound = fail(404, "reference_not_found", `${input.kind === "global" ? `global "${input.slug}"` : `"${input.slug}" ${input.id}`} was not found, or you can't read it`);

  if (input.kind === "global") {
    const global = config.globals.find((g) => g.slug === input.slug);
    if (!global || !reachable.globals.has(input.slug)) return fail(400, "invalid_reference", `the assistant can't reach global "${input.slug}"`);
    try {
      await req.payload.findGlobal({
        slug: input.slug as GlobalSlug,
        depth: 0,
        overrideAccess: false,
        req,
        user: req.user,
        ...(hasDrafts(global) ? { draft: true } : {}),
        select: { updatedAt: true } as never,
      });
    } catch {
      return notFound;
    }
    return { ok: true, value: { kind: "global", slug: input.slug, title: globalTitle(global) } };
  }

  const collection = config.collections.find((c) => c.slug === input.slug);
  if (!collection || !reachable.collections.has(input.slug) || !input.id) {
    return fail(400, "invalid_reference", `the assistant can't reach collection "${input.slug}"`);
  }
  const field = titleFieldOf(collection);
  let doc: Record<string, unknown> | null = null;
  try {
    doc = (await req.payload.findByID({
      collection: input.slug as CollectionSlug,
      id: parseDocumentID({ id: input.id, collectionSlug: input.slug as CollectionSlug, payload: req.payload }),
      depth: 0,
      overrideAccess: false,
      req,
      user: req.user,
      disableErrors: true,
      ...(hasDrafts(collection) ? { draft: true } : {}),
      select: (field === "id" ? {} : { [field]: true }) as never,
    })) as Record<string, unknown> | null;
  } catch {
    doc = null;
  }
  if (!doc) return notFound;
  return { ok: true, value: { kind: "collection", slug: input.slug, id: input.id, title: documentTitle(doc, field, input.id) } };
}

/** The context and the mentions of a message, resolved (duplicates dropped); the first failure wins. */
export async function resolveMessageReferences(
  req: PayloadRequest,
  inputs: { context?: DocumentReferenceInput; references?: DocumentReferenceInput[] }
): Promise<Resolved<MessageReferences>> {
  const out: MessageReferences = {};
  if (inputs.context) {
    const resolved = await resolveReference(req, inputs.context);
    if (!resolved.ok) return resolved;
    out.context = resolved.value;
  }
  const seen = new Set<string>();
  const refs: DocumentReference[] = [];
  for (const input of inputs.references ?? []) {
    const key = referenceKey(input);
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = await resolveReference(req, input);
    if (!resolved.ok) return resolved;
    refs.push(resolved.value);
  }
  if (refs.length) out.references = refs;
  return { ok: true, value: out };
}

/** Most results of one `@` search. */
export const MAX_SEARCH_RESULTS = 8;
/** Longest search text. */
export const MAX_SEARCH_CHARS = 100;

/** The JSON documents in a plugin-mcp result: one fenced block per document (`findDocuments`), or one (`findGlobal`). */
export function documentsInToolResult(result: unknown): Record<string, unknown>[] {
  const text =
    typeof result === "string"
      ? result
      : Array.isArray(result)
        ? result.map((part) => (part && typeof part === "object" ? String((part as { text?: unknown; content?: unknown }).text ?? (part as { content?: unknown }).content ?? "") : "")).join("\n")
        : "";
  const docs: Record<string, unknown>[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)) {
    try {
      const value: unknown = JSON.parse(match[1]!);
      if (value && typeof value === "object" && !Array.isArray(value)) docs.push(value as Record<string, unknown>);
    } catch {
      // Not JSON: skip it.
    }
  }
  return docs;
}

type ExecutableTool = { name: string; execute?: (args: unknown, context: never) => Promise<unknown> };

/**
 * The `@` search (`GET /api/assistant/documents?q=`): documents whose title contains `q`, in every
 * collection the assistant reaches that has a title field, and globals whose label or slug does.
 * Every read goes through plugin-mcp's `findDocuments` / `findGlobal` as the user (one in-process
 * MCP session), so access, drafts and locales behave as they do for the model; a collection the
 * user can't read answers with an error and is skipped. Returns addresses and titles only.
 */
export async function searchDocuments(
  req: PayloadRequest,
  options: NormalizedAssistantOptions,
  query: string,
  deps: { dispatch?: McpDispatch } = {}
): Promise<DocumentReference[]> {
  const q = query.trim().slice(0, MAX_SEARCH_CHARS);
  const config = req.payload.config;
  const reachable = reachableEntities(config);
  const needle = q.toLowerCase();
  const collections = config.collections.filter((c) => reachable.collections.has(c.slug) && titleFieldOf(c) !== "id");
  const globals = config.globals.filter(
    (g) => reachable.globals.has(g.slug) && (!needle || globalTitle(g).toLowerCase().includes(needle) || g.slug.toLowerCase().includes(needle))
  );
  if (!collections.length && !globals.length) return [];

  const source = payloadToolSourceForRequest(req, {
    ...(options.toolFilter ? { toolFilter: options.toolFilter } : {}),
    ...(deps.dispatch ? { dispatch: deps.dispatch } : {}),
  });
  try {
    const tools = new Map(((await source.tools()) as unknown as ExecutableTool[]).map((tool) => [tool.name, tool]));
    const call = async (name: string, args: Record<string, unknown>) => {
      const tool = tools.get(name);
      if (!tool?.execute) return undefined;
      try {
        return await tool.execute(args, undefined as never);
      } catch {
        return undefined; // No access to this collection or global, or an error: nothing from it.
      }
    };
    const locale = typeof req.locale === "string" && req.locale !== "all" ? { locale: req.locale } : {};
    const perCollection = Math.max(2, Math.ceil(MAX_SEARCH_RESULTS / Math.max(1, collections.length)) + 1);

    const found = await Promise.all([
      ...collections.map(async (collection): Promise<DocumentReference[]> => {
        const field = titleFieldOf(collection);
        const result = await call("findDocuments", {
          slug: collection.slug,
          ...(q ? { where: { [field]: { like: q } } } : {}),
          select: { [field]: true },
          limit: perCollection,
          depth: 0,
          sort: "-updatedAt",
          ...(hasDrafts(collection) ? { draft: true } : {}),
          ...locale,
        });
        return documentsInToolResult(result).flatMap((doc) => {
          const id = typeof doc.id === "number" ? String(doc.id) : typeof doc.id === "string" ? doc.id : undefined;
          return id ? [{ kind: "collection" as const, slug: collection.slug, id, title: documentTitle(doc, field, id) }] : [];
        });
      }),
      ...globals.map(async (global): Promise<DocumentReference[]> => {
        const result = await call("findGlobal", { slug: global.slug, depth: 0, select: { updatedAt: true }, ...locale });
        return result === undefined ? [] : [{ kind: "global" as const, slug: global.slug, title: globalTitle(global) }];
      }),
    ]);

    // Interleave the collections' results so one busy collection doesn't crowd out the rest.
    const lists = found.filter((list) => list.length);
    const out: DocumentReference[] = [];
    for (let i = 0; out.length < MAX_SEARCH_RESULTS && lists.some((list) => i < list.length); i += 1) {
      for (const list of lists) if (i < list.length && out.length < MAX_SEARCH_RESULTS) out.push(list[i]!);
    }
    return out;
  } finally {
    await source.close();
  }
}
