import type { CollectionSlug, PayloadHandler } from "payload";
import { hasDraftsEnabled, hasLocalizeStatusEnabled } from "payload/shared";
import type { AbTestingPluginConfig } from "../types/config";
import { AB_PASS_PERCENTAGE_FIELD, AB_VARIANT_OF_FIELD, DEFAULT_SLUG_FIELD } from "../constants";
import { getNestedValue } from "../utils/getNestedValue";

const HASH_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

// 6-char alphanumeric hash — no external dep needed
function nanoid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => HASH_ALPHABET[b % HASH_ALPHABET.length]).join("");
}

/**
 * `POST /api/_ab/duplicate` — clones an original document into a new variant.
 *
 * Only for a signed-in user, only for collections the plugin is configured on, and the
 * clone is created with the user's own access (reading the original and creating in the
 * collection). The slug field comes from the plugin config, never from the request. With
 * drafts enabled the variant starts as a draft: it takes traffic once it's published.
 */
export function buildDuplicateVariantHandler<TVariantData extends object>(
  pluginConfig: AbTestingPluginConfig<TVariantData>
): PayloadHandler {
  return async (req) => {
    if (!req.payload) {
      return Response.json({ error: "Payload not available" }, { status: 500 });
    }

    if (!req.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { collectionSlug?: unknown; docId?: unknown };
    try {
      if (!req.json) {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { collectionSlug, docId } = body;

    if (typeof collectionSlug !== "string" || (typeof docId !== "string" && typeof docId !== "number")) {
      return Response.json({ error: "collectionSlug and docId are required" }, { status: 400 });
    }

    const abConfig = Object.hasOwn(pluginConfig.collections, collectionSlug)
      ? pluginConfig.collections[collectionSlug]
      : undefined;
    if (!abConfig) {
      return Response.json(
        { error: `A/B testing is not enabled for "${collectionSlug}"` },
        { status: 400 }
      );
    }
    const slugField = abConfig.slugField ?? DEFAULT_SLUG_FIELD;

    let parentDoc: Record<string, unknown>;
    try {
      parentDoc = (await req.payload.findByID({
        collection: collectionSlug as CollectionSlug,
        id: docId,
        depth: 0,
        draft: true,
        overrideAccess: false,
        req,
      })) as Record<string, unknown>;

      if (!parentDoc) {
        return Response.json({ error: "Parent document not found" }, { status: 404 });
      }
    } catch {
      return Response.json({ error: "Parent document not found" }, { status: 404 });
    }

    if (parentDoc[AB_VARIANT_OF_FIELD]) {
      return Response.json({ error: "A variant cannot have variants" }, { status: 400 });
    }

    const originalSlug = getNestedValue(parentDoc, slugField);
    const baseSlug =
      typeof originalSlug === "string" && originalSlug ? originalSlug : String(docId);

    try {
      const collectionConfig = req.payload.collections[collectionSlug as CollectionSlug]?.config;
      const drafts = collectionConfig ? hasDraftsEnabled(collectionConfig) : false;
      const newDoc = (await req.payload.duplicate({
        collection: collectionSlug as CollectionSlug,
        id: docId,
        // A copy of a published original would otherwise be created published, and start
        // taking traffic (and record the experiment's start) before anyone has edited it.
        ...(drafts ? { draft: true } : {}),
        data: {
          [slugField]: `${baseSlug}--${nanoid()}`,
          [AB_VARIANT_OF_FIELD]: docId,
          [AB_PASS_PERCENTAGE_FIELD]: 1,
        },
        overrideAccess: false,
        req,
      })) as Record<string, unknown>;

      // Payload 4 keeps `_status` per locale when the collection localizes it, and a draft
      // duplicate only drafts the request's locale: the copy stays published in the others.
      if (drafts && req.payload.config.localization && hasLocalizeStatusEnabled(collectionConfig!)) {
        await req.payload.update({
          collection: collectionSlug as CollectionSlug,
          id: newDoc.id as number | string,
          data: { _status: "draft" } as never,
          unpublishAllLocales: true,
          overrideAccess: false,
          req,
        });
      }

      return Response.json(
        { id: newDoc.id, slug: getNestedValue(newDoc, slugField), passPercentage: 1 },
        { status: 201 }
      );
    } catch (err) {
      const status =
        typeof (err as { status?: unknown })?.status === "number"
          ? (err as { status: number }).status
          : 500;
      const message = err instanceof Error ? err.message : "Failed to create variant";
      return Response.json({ error: message }, { status });
    }
  };
}
