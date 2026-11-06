import type { CollectionSlug } from "payload";
import type { AbTestingPluginConfig } from "../types/config";
import { AB_EXPERIMENTS_SLUG } from "../constants";

interface RunScope {
  manifestKey: string;
  parentId: string | number;
  parentCollection: string;
  locale: string | undefined;
}

const experimentsSlugOf = (pluginConfig: Pick<AbTestingPluginConfig, "experimentsCollectionSlug">) =>
  (pluginConfig.experimentsCollectionSlug ?? AB_EXPERIMENTS_SLUG) as CollectionSlug;

const whereRun = ({ manifestKey, parentCollection }: RunScope) => ({
  and: [
    { manifestKey: { equals: manifestKey } },
    { parentCollection: { equals: parentCollection } },
  ],
});

/**
 * The run of the experiment on one manifest key: its `ab-experiments` row, created (with
 * `startedAt` = now) when the key has none. Called whenever the key has published variants,
 * so the first published variant starts a run and later publishes keep it. Returns its
 * `startedAt`.
 */
export async function startExperimentRun<TVariantData extends object>(
  scope: RunScope,
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any
): Promise<string> {
  const { payload } = req;
  const collection = experimentsSlugOf(pluginConfig);
  const { docs } = await payload.find({
    collection,
    where: whereRun(scope),
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    req,
  });
  const existing = (docs[0] as { startedAt?: string } | undefined)?.startedAt;
  if (existing) return existing;

  const startedAt = new Date().toISOString();
  await payload.create({
    collection,
    data: {
      manifestKey: scope.manifestKey,
      parentDocId: String(scope.parentId),
      parentCollection: scope.parentCollection,
      locale: scope.locale ?? null,
      startedAt,
    },
    overrideAccess: true,
    req,
  });
  return startedAt;
}

/**
 * Ends the run on one manifest key (its last published variant went, or the original was
 * unpublished): deletes its `ab-experiments` row, so the next published variant starts a new
 * run with a new `startedAt`, and results and dedupe markers start over.
 */
export async function endExperimentRun<TVariantData extends object>(
  scope: RunScope,
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any
): Promise<void> {
  await req.payload.delete({
    collection: experimentsSlugOf(pluginConfig),
    where: whereRun(scope),
    overrideAccess: true,
    req,
  });
}
