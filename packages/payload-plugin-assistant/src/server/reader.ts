import type { CollectionSlug, GlobalSlug, PayloadRequest, Where } from "payload";
import { parseDocumentID } from "payload";
import { labelText, neutralTitle } from "../references";
import { redactFor, redactedReference, type RedactionPolicy } from "../redaction";
import { redactionPolicyOf, type ConfigLike } from "../redactionSchema";
import { describeCall, type ToolCall } from "../toolCalls";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";
import { reachableEntities } from "../utils/reachable";

/**
 * Reading and naming documents as the request's user (#133). Everything on the Worker that reads
 * Payload for the assistant (approval cards, references, the config endpoint) goes through one
 * {@link UserReader}, so a caller can't get an unredacted document or title by forgetting a step:
 *
 * - Every read is `overrideAccess: false` with the request's user, `depth: 0` unless asked, the
 *   latest draft when the collection or global has drafts, and comes back without the redacted
 *   fields (#68), populated relations redacted by their own collection.
 * - {@link UserReader.title} is the only way to name a document: a redacted title field
 *   (`admin.useAsTitle` hidden by the auth defaults or `redact`) is never read or used, the document
 *   is `User #12`.
 * - {@link UserReader.find} refuses a `where` that names a hidden field (filtering by it would leak
 *   its values); {@link UserReader.hiddenField} says so before a call is made.
 * - {@link UserReader.policy} is the one serialisable form of the policy: the endpoint sends it to
 *   the turn as `settings.redaction`, and the turn (in the conversation's Durable Object) uses it
 *   as is.
 */

type Doc = Record<string, unknown>;
type CollectionConfig = PayloadRequest["payload"]["config"]["collections"][number];
type GlobalConfig = PayloadRequest["payload"]["config"]["globals"][number];

/** A read's options. `locale` as Payload takes it; `depth` 0 unless the caller needs populated relations. */
export interface ReadOptions {
  locale?: string;
  depth?: number;
}

/** A `find` that would query a redacted field: refused before Payload is asked. */
export class HiddenFieldError extends Error {
  constructor(
    readonly slug: string,
    readonly field: string
  ) {
    super(`"${field}" is a hidden field of "${slug}"`);
    this.name = "HiddenFieldError";
  }
}

export interface UserReader {
  readonly req: PayloadRequest;
  /** The redaction policy (paths, auth defaults, relations to them): plain JSON, for the turn settings. */
  readonly policy: RedactionPolicy;
  /** One document, or `null` when it doesn't exist or the user can't read it. `titleOnly` reads just what {@link title} needs. */
  findByID(slug: string, id: string, options?: ReadOptions & { titleOnly?: boolean }): Promise<Doc | null>;
  /**
   * The documents a `where` matches (at most `limit`, in `sort` order) and how many match in all,
   * or `null` when they can't be read. Throws {@link HiddenFieldError} when the `where` names a hidden field.
   */
  find(slug: string, where: Where, options?: ReadOptions & { limit?: number; sort?: string }): Promise<{ docs: Doc[]; total: number } | null>;
  /** A global, or `null` when the user can't read it. `existsOnly` reads nothing but `updatedAt`. */
  findGlobal(slug: string, options?: ReadOptions & { existsOnly?: boolean }): Promise<Doc | null>;
  /** One version (its document under `version`, the parent's id), or `null`. */
  findVersion(slug: string, versionId: string, options?: { global?: boolean }): Promise<{ parent?: string; version: Doc } | null>;
  /** A collection document's title: its title field, `User #12` when that field is hidden, else its id. */
  title(slug: string, doc: Doc | null | undefined, id: string): string;
  /** The field a collection is named and searched by (`id` when none), and whether it is hidden. `undefined` for an unknown collection. */
  titleField(slug: string): { field: string; hidden: boolean } | undefined;
  /** Collection slug → singular label, for the reachable collections whose title field is hidden (the client names them `User #12` too). */
  redactedTitles(): Record<string, string>;
  /** The first hidden field a tool call queries (`where`, `sort`, `select`, `field`), else `undefined`. */
  hiddenField(call: ToolCall): string | undefined;
}

const isRecord = (value: unknown): value is Doc => typeof value === "object" && value !== null && !Array.isArray(value);
const hasDrafts = (entity: CollectionConfig | GlobalConfig) => Boolean((entity.versions as { drafts?: unknown } | undefined)?.drafts);
const idOf = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;

/** A collection's singular label as text, its slug when it has none. */
const singularLabelOf = (collection: CollectionConfig): string =>
  labelText((collection.labels as { singular?: unknown } | undefined)?.singular, collection.slug);

/** A global's title: its label. */
export const globalTitle = (global: GlobalConfig): string => labelText(global.label, global.slug);

/** The reader of this request's user, with the policy of this Payload and the assistant's options. */
export function readerFor(req: PayloadRequest, options: Pick<NormalizedAssistantOptions, "redact">): UserReader {
  const config = req.payload.config;
  const policy = redactionPolicyOf(config as unknown as ConfigLike, options.redact);
  const collectionOf = (slug: string) => config.collections.find((c) => c.slug === slug);
  const globalOf = (slug: string) => config.globals.find((g) => g.slug === slug);
  const asUser = { overrideAccess: false, req, user: req.user } as const;
  const localeOf = (o: ReadOptions | undefined) => (o?.locale ? { locale: o.locale } : {});

  const titleField = (slug: string) => {
    const collection = collectionOf(slug);
    if (!collection) return undefined;
    const field = collection.admin?.useAsTitle || "id";
    const hidden = field !== "id" && (policy.paths[slug] ?? []).some((path) => field === path || field.startsWith(`${path}.`));
    return { field, hidden };
  };

  const hiddenField = (call: ToolCall) => redactedReference(policy, call);

  return {
    req,
    policy,
    titleField,
    hiddenField,

    async findByID(slug, id, o = {}) {
      const collection = collectionOf(slug);
      if (!collection) return null;
      const title = o.titleOnly ? titleField(slug) : undefined;
      try {
        const doc = await req.payload.findByID({
          collection: slug as CollectionSlug,
          id: parseDocumentID({ id, collectionSlug: slug as CollectionSlug, payload: req.payload }),
          depth: o.depth ?? 0,
          disableErrors: true,
          ...asUser,
          ...(hasDrafts(collection) ? { draft: true } : {}),
          ...localeOf(o),
          // A hidden title field is not even read: the document is named by label and id.
          ...(title ? { select: (title.hidden || title.field === "id" ? { updatedAt: true } : { [title.field]: true }) as never } : {}),
        } as Parameters<typeof req.payload.findByID>[0]);
        return isRecord(doc) ? redactFor(doc, slug, policy) : null;
      } catch {
        return null;
      }
    },

    async find(slug, where, o = {}) {
      const collection = collectionOf(slug);
      if (!collection || !isRecord(where)) return null;
      const hidden = hiddenField(describeCall("findDocuments", { slug, where }));
      if (hidden) throw new HiddenFieldError(slug, hidden);
      try {
        const result = await req.payload.find({
          collection: slug as CollectionSlug,
          where,
          depth: o.depth ?? 0,
          ...(o.limit !== undefined ? { limit: o.limit } : {}),
          ...(o.sort ? { sort: o.sort } : {}),
          ...asUser,
          ...(hasDrafts(collection) ? { draft: true } : {}),
          ...localeOf(o),
        } as Parameters<typeof req.payload.find>[0]);
        return { docs: redactFor(result.docs as Doc[], slug, policy), total: result.totalDocs };
      } catch {
        return null;
      }
    },

    async findGlobal(slug, o = {}) {
      const global = globalOf(slug);
      if (!global) return null;
      try {
        const doc = await req.payload.findGlobal({
          slug: slug as GlobalSlug,
          depth: o.depth ?? 0,
          ...asUser,
          ...(hasDrafts(global) ? { draft: true } : {}),
          ...localeOf(o),
          ...(o.existsOnly ? { select: { updatedAt: true } as never } : {}),
        } as Parameters<typeof req.payload.findGlobal>[0]);
        return isRecord(doc) ? redactFor(doc, slug, policy) : null;
      } catch {
        return null;
      }
    },

    async findVersion(slug, versionId, o = {}) {
      if (!(o.global ? globalOf(slug) : collectionOf(slug))) return null;
      const args = { id: versionId, depth: 0, disableErrors: true, ...asUser };
      try {
        const found = o.global
          ? await req.payload.findGlobalVersionByID({ slug: slug as GlobalSlug, ...args } as Parameters<typeof req.payload.findGlobalVersionByID>[0])
          : await req.payload.findVersionByID({ collection: slug as CollectionSlug, ...args } as Parameters<typeof req.payload.findVersionByID>[0]);
        if (!isRecord(found) || !isRecord(found.version)) return null;
        const parent = idOf(found.parent);
        return { ...(parent ? { parent } : {}), version: redactFor(found.version, slug, policy) };
      } catch {
        return null;
      }
    },

    title(slug, doc, id) {
      const collection = collectionOf(slug);
      const title = titleField(slug);
      if (!collection || !title || title.field === "id") return id;
      if (title.hidden) return neutralTitle(singularLabelOf(collection), id);
      const value = doc?.[title.field];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
      if (typeof value === "number") return String(value);
      return id;
    },

    redactedTitles() {
      const reachable = reachableEntities(config);
      return Object.fromEntries(
        config.collections
          .filter((collection) => reachable.collections.has(collection.slug) && titleField(collection.slug)?.hidden)
          .map((collection) => [collection.slug, singularLabelOf(collection)])
      );
    },
  };
}
