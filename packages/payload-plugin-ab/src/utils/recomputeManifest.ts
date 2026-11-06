import type { CollectionSlug, TypedLocale, Where } from "payload";
import { hasDraftsEnabled } from "payload/shared";
import type { AbTestingPluginConfig, CollectionABConfig } from "../types/config";
import { AB_PASS_PERCENTAGE_FIELD, AB_VARIANT_OF_FIELD, DEFAULT_SLUG_FIELD } from "../constants";
import { getLocales } from "./getLocales";
import { endExperimentRun, startExperimentRun } from "./experimentRuns";

/**
 * Rewrites the manifest entries of one original document (one per locale) from its published
 * variants, and keeps the experiment's run in step: a key that gets published variants starts
 * a run (an `ab-experiments` row with `startedAt`), and a key that loses them (its last
 * variant unpublished or deleted, or the original unpublished) ends it. The default variant
 * data carries the run's `startedAt`, so a resolver knows the run from the manifest alone.
 */
export async function recomputeManifestForParent<TVariantData extends object>(
  parentId: string | number,
  parentCollectionSlug: string,
  abConfig: CollectionABConfig<TVariantData>,
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  options?: { excludeId?: string | number }
): Promise<void> {
  const { payload } = req;
  const locales = getLocales(payload);
  const slugField = abConfig.slugField ?? DEFAULT_SLUG_FIELD;
  const drafts = hasDraftsEnabled(payload.collections?.[parentCollectionSlug]?.config);

  for (const locale of locales) {
    const parentDoc = await payload.findByID({
      collection: parentCollectionSlug as CollectionSlug,
      id: parentId,
      depth: 1,
      locale: locale as TypedLocale,
      overrideAccess: true,
      req,
    });
    if (!parentDoc) continue;

    const manifestKey = abConfig.generatePath({ doc: parentDoc, locale });
    if (!manifestKey) continue;

    // An unpublished original serves nothing in this locale, so neither do its variants.
    const run = { manifestKey, parentId, parentCollection: parentCollectionSlug, locale };
    if (drafts && parentDoc._status !== "published") {
      await pluginConfig.storage.clear(manifestKey, payload);
      await endExperimentRun(run, pluginConfig, req);
      continue;
    }

    const conditions: Where[] = [{ [AB_VARIANT_OF_FIELD]: { equals: parentId } }];

    if (options?.excludeId !== undefined) {
      conditions.push({ id: { not_equals: options.excludeId } });
    }

    if (drafts) {
      conditions.push({ _status: { equals: "published" } });
    }

    const whereClause: Where = conditions.length === 1 ? conditions[0]! : { and: conditions };

    const { docs: variantDocs } = await payload.find({
      collection: parentCollectionSlug as CollectionSlug,
      where: whereClause,
      depth: 1,
      draft: false,
      locale: locale as TypedLocale,
      overrideAccess: true,
      limit: 100,
      req,
    });

    if (variantDocs.length === 0) {
      await pluginConfig.storage.clear(manifestKey, payload);
      await endExperimentRun(run, pluginConfig, req);
      continue;
    }

    const startedAt = await startExperimentRun(run, pluginConfig, req);
    const variantData = variantDocs.map((variantDoc: Record<string, unknown>) => {
      if (abConfig.generateVariantData) {
        return abConfig.generateVariantData({ doc: parentDoc, variantDoc, locale, startedAt });
      }
      // Default: derive bucket from slug, rewritePath from generatePath on variant doc
      const variantPath = abConfig.generatePath({ doc: variantDoc, locale });
      return {
        bucket: (variantDoc[slugField] as string) ?? String(variantDoc.id),
        rewritePath: variantPath ?? "",
        passPercentage: (variantDoc[AB_PASS_PERCENTAGE_FIELD] as number) ?? 0,
        startedAt,
      } as unknown as TVariantData;
    });

    // The adapter skips an unchanged entry (autosaves recompute too). Not compared here: a
    // cached read could be stale and wrongly skip the write.
    await pluginConfig.storage.write(manifestKey, variantData, payload);
  }
}
