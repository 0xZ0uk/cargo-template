import type { CollectionSlug, Payload, Where } from "payload";
import type { AbTestingPluginConfig } from "../types/config";
import { AB_EXPERIMENTS_SLUG, AB_RUN_RETENTION_DAYS } from "../constants";

interface RunScope {
  manifestKey: string;
  parentId: string | number;
  parentCollection: string;
  locale: string | undefined;
}

/** One `ab-experiments` row: a run of the experiment on one manifest key. */
export interface ExperimentRunRow {
  id: string | number;
  manifestKey: string;
  parentDocId: string;
  parentCollection: string;
  locale?: string | null;
  startedAt: string;
  /** Set when the run ended; null or missing while it runs. */
  endedAt?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const experimentsSlugOf = (
  pluginConfig: Pick<AbTestingPluginConfig, "experimentsCollectionSlug">
) => (pluginConfig.experimentsCollectionSlug ?? AB_EXPERIMENTS_SLUG) as CollectionSlug;

/** Rows of a run that hasn't ended. */
export const RUN_IS_OPEN: Where = { endedAt: { exists: false } };

/** The open run on one key of one collection (at most one: see `startExperimentRun`). */
export const whereOpenRun = (manifestKey: string, parentCollection?: string): Where => ({
  and: [
    { manifestKey: { equals: manifestKey } },
    ...(parentCollection ? [{ parentCollection: { equals: parentCollection } }] : []),
    RUN_IS_OPEN,
  ],
});

/** The ISO date `days` before `now`: runs that ended before it are past their retention. */
export const retentionCutoff = (now: Date, days = AB_RUN_RETENTION_DAYS) =>
  new Date(now.getTime() - days * DAY_MS).toISOString();

/**
 * The run of the experiment on one manifest key: its open `ab-experiments` row, created (with
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
    where: whereOpenRun(scope.manifestKey, scope.parentCollection),
    sort: "-startedAt",
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
 * unpublished): sets `endedAt` = now on its open `ab-experiments` row and keeps the row, so
 * its results stay readable until `pruneEndedExperimentRuns` deletes it. The next published
 * variant starts a new run (a new row with a new `startedAt`), so results and dedupe markers
 * start over. A key without an open run is left as it is.
 */
export async function endExperimentRun<TVariantData extends object>(
  scope: RunScope,
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any
): Promise<void> {
  await req.payload.update({
    collection: experimentsSlugOf(pluginConfig),
    where: whereOpenRun(scope.manifestKey, scope.parentCollection),
    data: { endedAt: new Date().toISOString() },
    depth: 0,
    overrideAccess: true,
    req,
  });
}

/**
 * Deletes `ab-experiments` rows of runs that ended more than `retentionDays` (default 90, the
 * Analytics Engine retention) before `now`: their events are gone from the store, so there are
 * no results left to show. Open runs are never deleted. Bypasses access control (it runs from
 * the host's scheduler, without a user). Deletes at most `limit` rows per call; returns how
 * many it deleted.
 */
export async function pruneEndedExperimentRuns(
  payload: Payload,
  {
    experimentsCollectionSlug,
    retentionDays = AB_RUN_RETENTION_DAYS,
    limit = 100,
    now = new Date(),
  }: {
    experimentsCollectionSlug?: string;
    retentionDays?: number;
    limit?: number;
    now?: Date;
  } = {}
): Promise<number> {
  const collection = experimentsSlugOf({ experimentsCollectionSlug });
  const where: Where = { endedAt: { less_than: retentionCutoff(now, retentionDays) } };
  const { docs } = await payload.find({
    collection,
    where,
    depth: 0,
    limit,
    pagination: false,
    overrideAccess: true,
  });
  if (docs.length === 0) return 0;
  const result = await payload.delete({
    collection,
    where: { and: [{ id: { in: docs.map((doc) => doc.id) } }, where] },
    overrideAccess: true,
  });
  return result.docs.length;
}
