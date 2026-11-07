import type { PayloadRequest } from "payload";
import { type DocumentReference, type DocumentReferenceInput, type MessageReferences, isDocumentId, referenceKey } from "../references";
import type { McpDispatch } from "../tools/payloadToolSource";
import { payloadToolSourceForRequest } from "../tools/inProcess";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";
import { reachableEntities } from "../utils/reachable";
import { globalTitle, type UserReader } from "./reader";

/**
 * Server side of document references (#69): resolving what a message is about, as the user, and
 * the `@` search. Neither returns document content: an address and a title.
 */

const hasDrafts = (entity: PayloadRequest["payload"]["config"]["collections"][number]) =>
  Boolean((entity.versions as { drafts?: unknown } | undefined)?.drafts);

export type ResolveFailure = { ok: false; status: number; code: string; error: string };
export type Resolved<T> = { ok: true; value: T } | ResolveFailure;

const fail = (status: number, code: string, error: string): ResolveFailure => ({ ok: false, status, code, error });

/**
 * One reference, read as the user ({@link UserReader}: access-checked, the latest draft, only the
 * title field): 400 `invalid_reference` for a collection or global the assistant can't reach, 404
 * `reference_not_found` for a document that doesn't exist **or that the user can't read** (the
 * two are indistinguishable, as with conversations).
 */
export async function resolveReference(reader: UserReader, input: DocumentReferenceInput): Promise<Resolved<DocumentReference>> {
  const config = reader.req.payload.config;
  const reachable = reachableEntities(config);
  const notFound = fail(404, "reference_not_found", `${input.kind === "global" ? `global "${input.slug}"` : `"${input.slug}" ${input.id}`} was not found, or you can't read it`);

  if (input.kind === "global") {
    const global = config.globals.find((g) => g.slug === input.slug);
    if (!global || !reachable.globals.has(input.slug)) return fail(400, "invalid_reference", `the assistant can't reach global "${input.slug}"`);
    if (!(await reader.findGlobal(input.slug, { existsOnly: true }))) return notFound;
    return { ok: true, value: { kind: "global", slug: input.slug, title: globalTitle(global) } };
  }

  if (!reader.titleField(input.slug) || !reachable.collections.has(input.slug) || !input.id) {
    return fail(400, "invalid_reference", `the assistant can't reach collection "${input.slug}"`);
  }
  const doc = await reader.findByID(input.slug, input.id, { titleOnly: true });
  if (!doc) return notFound;
  return { ok: true, value: { kind: "collection", slug: input.slug, id: input.id, title: reader.title(input.slug, doc, input.id) } };
}

/** The context and the mentions of a message, resolved (duplicates dropped); the first failure wins. */
export async function resolveMessageReferences(
  reader: UserReader,
  inputs: { context?: DocumentReferenceInput; references?: DocumentReferenceInput[] }
): Promise<Resolved<MessageReferences>> {
  const out: MessageReferences = {};
  if (inputs.context) {
    const resolved = await resolveReference(reader, inputs.context);
    if (!resolved.ok) return resolved;
    out.context = resolved.value;
  }
  const seen = new Set<string>();
  const refs: DocumentReference[] = [];
  for (const input of inputs.references ?? []) {
    const key = referenceKey(input);
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = await resolveReference(reader, input);
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
 * user can't read answers with an error and is skipped. Returns addresses and titles only, named
 * by {@link UserReader.title}.
 */
export async function searchDocuments(
  reader: UserReader,
  options: Pick<NormalizedAssistantOptions, "toolFilter">,
  query: string,
  deps: { dispatch?: McpDispatch } = {}
): Promise<DocumentReference[]> {
  const { req } = reader;
  const q = query.trim().slice(0, MAX_SEARCH_CHARS);
  const config = req.payload.config;
  const reachable = reachableEntities(config);
  const needle = q.toLowerCase();
  // A collection is searched by its title field; one whose title is redacted (users, by email) is
  // searched by its label ("user") or an id (`#12`) and listed as `User #12`, never by the hidden value.
  const collections = config.collections.filter((c) => reachable.collections.has(c.slug) && reader.titleField(c.slug)?.field !== "id");
  const hiddenTitles = reader.redactedTitles();
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
        const { field, hidden } = reader.titleField(collection.slug)!;
        let where: Record<string, unknown> | undefined;
        if (hidden) {
          const byLabel = !needle || (hiddenTitles[collection.slug] ?? "").toLowerCase().includes(needle) || collection.slug.toLowerCase().includes(needle);
          const id = q.replace(/^#/, "");
          if (!byLabel) {
            if (!isDocumentId(id)) return [];
            where = { id: { equals: id } };
          }
        } else if (q) {
          where = { [field]: { like: q } };
        }
        const result = await call("findDocuments", {
          slug: collection.slug,
          ...(where ? { where } : {}),
          select: hidden ? { updatedAt: true } : { [field]: true },
          limit: perCollection,
          depth: 0,
          sort: "-updatedAt",
          ...(hasDrafts(collection) ? { draft: true } : {}),
          ...locale,
        });
        return documentsInToolResult(result).flatMap((doc) => {
          const id = typeof doc.id === "number" ? String(doc.id) : typeof doc.id === "string" ? doc.id : undefined;
          return id ? [{ kind: "collection" as const, slug: collection.slug, id, title: reader.title(collection.slug, doc, id) }] : [];
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
