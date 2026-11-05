import type { CollectionSlug, PayloadRequest } from "payload";
import { AB_PASS_PERCENTAGE_FIELD } from "../constants";
import type { VariantPercentageEntry } from "./buildPercentagePlan";

export async function applyVariantPercentage({
  collectionSlug,
  entry,
  isPublish,
  req,
}: {
  collectionSlug: string;
  entry: VariantPercentageEntry;
  isPublish: boolean;
  req: PayloadRequest;
}): Promise<void> {
  const { payload } = req;
  const { desired, draftPercentage, isDirty, publishedPercentage, variantId } = entry;
  const collection = collectionSlug as CollectionSlug;

  const shouldPublish =
    isPublish && publishedPercentage !== null && publishedPercentage !== desired;

  if (shouldPublish && !isDirty) {
    await payload.update({
      collection,
      id: variantId,
      data: {
        [AB_PASS_PERCENTAGE_FIELD]: desired,
      },
      overrideAccess: true,
      req,
    });

    return;
  }

  if (desired !== draftPercentage) {
    await payload.update({
      collection,
      id: variantId,
      data: {
        [AB_PASS_PERCENTAGE_FIELD]: desired,
      },
      draft: true,
      overrideAccess: true,
      req,
    });
  }

  if (!shouldPublish) return;

  // Publish only the percentage: write it straight to the published row, without a new
  // version, so the variant's unpublished draft content stays unpublished. Only the field is
  // sent — writing back a whole `db.findOne` row (as upstream did) re-saves every localized
  // field in the request's locale and resets the others.
  await payload.db.updateOne({
    collection: collectionSlug,
    id: variantId,
    data: {
      [AB_PASS_PERCENTAGE_FIELD]: desired,
    },
    req,
  });
}
