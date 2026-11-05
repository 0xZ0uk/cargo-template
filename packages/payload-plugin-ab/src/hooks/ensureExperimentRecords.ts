import type { CollectionSlug, Where } from "payload";
import { hasDraftsEnabled } from "payload/shared";
import type { AbTestingPluginConfig, CollectionABConfig } from "../types/config";
import { AB_EXPERIMENTS_SLUG, AB_VARIANT_OF_FIELD } from "../constants";
import { getLocales } from "../utils/getLocales";

export async function ensureExperimentRecords<TVariantData extends object>(
  parentId: string | number,
  parentCollectionSlug: string,
  abConfig: CollectionABConfig<TVariantData>,
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any
): Promise<void> {
  const { payload } = req;
  if (!payload) return;

  const experimentsSlug = pluginConfig.experimentsCollectionSlug ?? AB_EXPERIMENTS_SLUG;
  const locales = getLocales(payload);
  // A draft-only variant (never published) is a row with `_status: 'draft'`, which a
  // `draft: false` find still returns. It takes no traffic, so it doesn't start the experiment.
  const collectionConfig = payload.collections?.[parentCollectionSlug]?.config;
  const variantWhere: Where =
    collectionConfig && hasDraftsEnabled(collectionConfig)
      ? { and: [{ [AB_VARIANT_OF_FIELD]: { equals: parentId } }, { _status: { equals: "published" } }] }
      : { [AB_VARIANT_OF_FIELD]: { equals: parentId } };

  for (const locale of locales) {
    const parentDoc = await payload.findByID({
      collection: parentCollectionSlug as CollectionSlug,
      id: parentId,
      depth: 0,
      locale,
      overrideAccess: true,
      req,
    });
    if (!parentDoc) continue;

    const manifestKey = abConfig.generatePath({ doc: parentDoc, locale });
    if (!manifestKey) continue;

    const { docs: variantDocs } = await payload.find({
      collection: parentCollectionSlug as CollectionSlug,
      where: variantWhere,
      draft: false,
      locale,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    });
    if (variantDocs.length === 0) continue;

    const { docs: existing } = await payload.find({
      collection: experimentsSlug as CollectionSlug,
      where: {
        and: [
          { manifestKey: { equals: manifestKey } },
          { parentCollection: { equals: parentCollectionSlug } },
        ],
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    });
    if (existing.length > 0) continue;

    await payload.create({
      collection: experimentsSlug as CollectionSlug,
      data: {
        manifestKey,
        parentDocId: String(parentId),
        parentCollection: parentCollectionSlug,
        locale: locale ?? null,
        startedAt: new Date().toISOString(),
      },
      overrideAccess: true,
      req,
    });
  }
}
