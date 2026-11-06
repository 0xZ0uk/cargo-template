import type { CollectionSlug, PayloadHandler, TypedLocale } from "payload";
import { docAccessOperation } from "payload";
import type { AbTestingPluginConfig } from "../types/config";
import { AB_VARIANT_OF_FIELD, DEFAULT_SLUG_FIELD } from "../constants";
import { buildPromoteData, DEFAULT_PROMOTE_SKIP_FIELDS } from "../utils/buildPromoteData";
import { getLocales } from "../utils/getLocales";
import { isAdminPanelUser } from "../utils/isAdminPanelUser";
import { resolveId } from "../utils/resolveId";

type Id = number | string;

/** What `POST /api/_ab/promote` answers with on success. */
export interface AbPromoteResponse {
  originalId: Id;
  promotedId: Id;
  /** The locales whose content was copied onto the original's draft (`[null]` without localization). */
  locales: (string | null)[];
  /** The variants deleted to end the experiment, the promoted one included. */
  deleted: Id[];
}

/**
 * Answered when the promotion stopped part-way. `step: 'copy'`: the original's draft may hold
 * the copy for `copiedLocales` only, and no variant was deleted. `step: 'delete'`: the copy is
 * complete (the original's draft), and only the variants in `deleted` are gone.
 */
export interface AbPromoteFailure {
  error: string;
  step: "copy" | "delete";
  copiedLocales: (string | null)[];
  deleted: Id[];
  failed?: Id[];
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

const statusOf = (err: unknown) =>
  typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;

const messageOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/**
 * `POST /api/_ab/promote`, body `{ collectionSlug, docId, variantId }`: promotes a variant to
 * its original (`docId`) and ends the experiment.
 *
 * 1. Copies the variant's content (its **published** version, depth 0: what visitors were tested
 *    on, not later unpublished edits) onto the original as a **draft**,
 *    once per locale, with the user's own access: nothing goes live until an editor publishes
 *    the original. The slug, the A/B fields, ids, timestamps, `_status` and the collection's
 *    `promoteSkipFields` are not copied, so the original keeps its own values for them.
 * 2. Deletes every variant of the original, one at a time, the promoted one last. The deletes'
 *    manifest recompute clears the page's entry and ends the run (`endedAt`), which stays
 *    listed with its results as a past experiment.
 *
 * Admin-panel users only, with update access on the original. A failure in step 1 deletes
 * nothing; the original's previous content stays in its version history either way.
 */
export function buildPromoteVariantHandler<TVariantData extends object>(
  pluginConfig: AbTestingPluginConfig<TVariantData>
): PayloadHandler {
  return async (req) => {
    if (!req.user) return json({ error: "Unauthorized" }, 401);
    if (!isAdminPanelUser(req)) return json({ error: "Forbidden" }, 403);

    let body: { collectionSlug?: unknown; docId?: unknown; variantId?: unknown };
    try {
      body = req.json ? await req.json() : {};
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const { collectionSlug, docId, variantId } = body ?? {};
    const isId = (v: unknown): v is Id => typeof v === "string" || typeof v === "number";
    if (typeof collectionSlug !== "string" || !isId(docId) || !isId(variantId)) {
      return json({ error: "collectionSlug, docId and variantId are required" }, 400);
    }

    const abConfig = Object.hasOwn(pluginConfig.collections, collectionSlug)
      ? pluginConfig.collections[collectionSlug]
      : undefined;
    const collection = req.payload.collections[collectionSlug as CollectionSlug];
    if (!abConfig || !collection) {
      return json({ error: `A/B testing is not enabled for "${collectionSlug}"` }, 400);
    }
    const slug = collectionSlug as CollectionSlug;

    const find = async (id: Id) => {
      try {
        return (await req.payload.findByID({
          collection: slug,
          id,
          depth: 0,
          draft: true,
          overrideAccess: false,
          req,
        })) as Record<string, unknown> | null;
      } catch {
        return null;
      }
    };

    const original = await find(docId);
    if (!original) return json({ error: "Original document not found" }, 404);
    if (original[AB_VARIANT_OF_FIELD]) return json({ error: "docId must be the original" }, 400);

    const permissions = await docAccessOperation({ collection, id: original.id as Id, req });
    if (!permissions.update) {
      return json({ error: "You can't update the original document" }, 403);
    }

    const variant = await find(variantId);
    if (!variant) return json({ error: "Variant not found" }, 404);
    if (String(resolveId(variant[AB_VARIANT_OF_FIELD]) ?? "") !== String(original.id)) {
      return json({ error: "That document isn't a variant of this original" }, 400);
    }

    // Visitors were tested on the variant's published version, so that's what is promoted. A
    // variant that was never published took no traffic and has nothing to promote.
    if (variant._status !== "published") {
      const published = (await req.payload
        .findByID({ collection: slug, id: variant.id as Id, depth: 0, draft: false, overrideAccess: false, req })
        .catch(() => null)) as Record<string, unknown> | null;
      if (published?._status !== "published") {
        return json({ error: "This variant was never published, so it has no tested content to promote" }, 400);
      }
    }

    const originalId = original.id as Id;
    const promotedId = variant.id as Id;
    const skip = [
      ...DEFAULT_PROMOTE_SKIP_FIELDS,
      abConfig.slugField ?? DEFAULT_SLUG_FIELD,
      ...(abConfig.promoteSkipFields ?? []),
    ];
    const fields = collection.config.flattenedFields;
    const blocks = (req.payload.blocks ?? {}) as NonNullable<Parameters<typeof buildPromoteData>[3]>["blocks"];
    // One map for all locales: a row keeps the same new id in each, so its localized fields
    // (stored per row id) line up.
    const rowIds = new Map<string, string>();

    // 1. The copy, as a draft of the original, locale by locale (each write merges onto the
    // draft the previous one left). The variant is read without fallback, so a locale it
    // never filled doesn't receive another locale's text.
    const copiedLocales: (string | null)[] = [];
    for (const locale of getLocales(req.payload)) {
      const localeArgs = locale
        ? { locale: locale as TypedLocale, fallbackLocale: false as const }
        : {};
      try {
        const source = (await req.payload.findByID({
          collection: slug,
          id: promotedId,
          depth: 0,
          // The published version, not the latest draft (see above).
          draft: false,
          ...localeArgs,
          overrideAccess: false,
          req,
        })) as Record<string, unknown>;
        await req.payload.update({
          collection: slug,
          id: originalId,
          data: buildPromoteData(source, fields, skip, { blocks, rowIds }) as never,
          draft: true,
          depth: 0,
          ...localeArgs,
          overrideAccess: false,
          req,
        });
        copiedLocales.push(locale ?? null);
      } catch (err) {
        req.payload.logger.error({ err, msg: "[payload-plugin-ab] promote: copy failed" });
        const failure: AbPromoteFailure = {
          error: `Copying the variant${locale ? ` (${locale})` : ""} failed: ${messageOf(err, "unknown error")}. No variant was deleted.`,
          step: "copy",
          copiedLocales,
          deleted: [],
        };
        return json(failure, statusOf(err));
      }
    }

    // 2. End the experiment: delete the variants one at a time (each delete recomputes the
    // page's manifest entry, and parallel ones would race on it), the promoted one last so a
    // failure leaves it in place. Access was checked on the original above.
    const { docs: variants } = await req.payload.find({
      collection: slug,
      where: { [AB_VARIANT_OF_FIELD]: { equals: originalId } },
      depth: 0,
      limit: 100,
      pagination: false,
      overrideAccess: true,
      req,
    });
    const ids = (variants as { id: Id }[])
      .map((v) => v.id)
      .sort((a, b) => Number(String(a) === String(promotedId)) - Number(String(b) === String(promotedId)));
    const deleted: Id[] = [];
    const failed: Id[] = [];
    let lastError: unknown;
    for (const id of ids) {
      try {
        await req.payload.delete({ collection: slug, id, overrideAccess: true, req });
        deleted.push(id);
      } catch (err) {
        req.payload.logger.error({ err, msg: `[payload-plugin-ab] promote: deleting variant ${id} failed` });
        failed.push(id);
        lastError = err;
      }
    }
    if (failed.length > 0) {
      const failure: AbPromoteFailure = {
        error: `The content was copied onto the original's draft, but ${failed.length} variant(s) could not be deleted (${messageOf(lastError, "unknown error")}). Delete them from the Variants panel to end the experiment.`,
        step: "delete",
        copiedLocales,
        deleted,
        failed,
      };
      return json(failure, 500);
    }

    return json({ originalId, promotedId, locales: copiedLocales, deleted } satisfies AbPromoteResponse);
  };
}
