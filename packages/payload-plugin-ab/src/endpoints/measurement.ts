import type { CollectionSlug, PayloadHandler, PayloadRequest } from "payload";
import type { AbMeasurementConfig, AbResults, AbTestingPluginConfig } from "../types/config";
import { AB_MAX_PAST_RUNS, AB_VARIANT_OF_FIELD } from "../constants";
import { DEFAULT_VISITOR_ID_COOKIE_NAME } from "../cookie/constants";
import { bucketCookieName } from "../cookie/utils/bucketCookieName";
import { parseCookieHeader, serializeAbCookie } from "../middleware/utils/cookies";
import { abRunMarker } from "../middleware/utils/runMarker";
import { isAdminPanelUser } from "../utils/isAdminPanelUser";
import {
  type ExperimentRunRow,
  experimentsSlugOf,
  retentionCutoff,
  whereOpenRun,
} from "../utils/experimentRuns";

export const DEFAULT_GOALS = ["cta"];
export const DEFAULT_CONVERSION_COOKIE_PREFIX = "payload_ab_cv";
const DEFAULT_CONVERSION_MAX_AGE = 60 * 60 * 24 * 90;
/** A conversion body is two short strings; anything bigger isn't one. */
const MAX_BODY_BYTES = 2048;
const MAX_KEY_LENGTH = 1024;

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers });

const defaultGetBucket = (variant: object) => (variant as { bucket?: unknown }).bucket as string;

/**
 * `POST /api/_ab/convert` — records a conversion for the visitor making the request.
 *
 * The body names only the experiment (its manifest key) and the goal: `{ experiment, goal }`,
 * as JSON (`fetch`, or `navigator.sendBeacon`, which sends `text/plain`). The bucket and the
 * visitor id come from the request's own cookies, never from the body, and the bucket must
 * still be live in the manifest. A visitor counts once per experiment run and bucket: the
 * first conversion sets an HttpOnly marker cookie (`<bucket>:<run>`, see `abRunMarker`), and
 * later ones are acknowledged but not recorded. The cookies are `SameSite=Lax`, so a
 * cross-site form post carries none of them and can't convert on a visitor's behalf. The
 * marker is the client's own cookie, so `measurement.rateLimit` bounds what a client that
 * drops it can add.
 */
export function buildConvertHandler<TVariantData extends object>(
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  measurement: AbMeasurementConfig<TVariantData>
): PayloadHandler {
  const goals = measurement.goals ?? DEFAULT_GOALS;
  const getBucket = measurement.getBucket ?? defaultGetBucket;
  const {
    bucketCookiePrefix,
    visitorIdCookieName = DEFAULT_VISITOR_ID_COOKIE_NAME,
    conversionCookiePrefix = DEFAULT_CONVERSION_COOKIE_PREFIX,
    conversionCookieMaxAge = DEFAULT_CONVERSION_MAX_AGE,
  } = measurement.cookies ?? {};

  const experimentsSlug = experimentsSlugOf(pluginConfig);

  /** The run's start: from the manifest (the default variant data carries it), else its row. */
  const runStartedAt = async (
    experiment: string,
    variants: TVariantData[],
    req: PayloadRequest
  ): Promise<string | null> => {
    for (const variant of variants) {
      const startedAt = (variant as { startedAt?: unknown }).startedAt;
      if (typeof startedAt === "string") return startedAt;
    }
    const { docs } = await req.payload.find({
      collection: experimentsSlug,
      where: whereOpenRun(experiment),
      sort: "-startedAt",
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true,
      req,
    });
    return (docs[0] as { startedAt?: string } | undefined)?.startedAt ?? null;
  };

  return async (req) => {
    if (measurement.rateLimit) {
      let allowed = true;
      try {
        allowed = await measurement.rateLimit(req);
      } catch (err) {
        // A broken limiter shouldn't stop measurement: let the request through, and say so.
        req.payload.logger.error({ err, msg: "[payload-plugin-ab] rateLimit failed" });
      }
      if (!allowed) return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
    }

    let body: unknown;
    try {
      const text = req.text ? await req.text() : "";
      if (text.length > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { experiment, goal } = (body ?? {}) as { experiment?: unknown; goal?: unknown };
    if (
      typeof experiment !== "string" ||
      !experiment.startsWith("/") ||
      experiment.length > MAX_KEY_LENGTH
    ) {
      return json({ error: "experiment must be a manifest key (a path)" }, 400);
    }
    if (typeof goal !== "string" || !goals.includes(goal)) {
      return json({ error: `goal must be one of: ${goals.join(", ")}` }, 400);
    }

    let variants: TVariantData[] | null;
    try {
      variants = await pluginConfig.storage.read(experiment, req.payload);
    } catch {
      return json({ error: "Manifest unavailable" }, 503);
    }
    if (!variants?.length) return json({ error: "No experiment runs on this page" }, 404);

    const cookies = parseCookieHeader(req.headers.get("cookie"));
    const bucket = cookies.get(bucketCookieName(experiment, bucketCookiePrefix));
    const visitorId = cookies.get(visitorIdCookieName);
    const live = bucket === "original" || variants.some((v) => getBucket(v) === bucket);
    if (!bucket || !visitorId || !live) {
      return json({ error: "The visitor isn't assigned to this experiment" }, 409);
    }

    const markerName = bucketCookieName(experiment, conversionCookiePrefix);
    const markerValue = abRunMarker(bucket, await runStartedAt(experiment, variants, req));
    if (cookies.get(markerName) === markerValue) {
      return json({ recorded: false, reason: "duplicate" });
    }

    try {
      await measurement.recordConversion({ experiment, bucket, goal, visitorId }, req);
    } catch (err) {
      req.payload.logger.error({ err, msg: "[payload-plugin-ab] recordConversion failed" });
      return json({ error: "Failed to record the conversion" }, 500);
    }

    const marker = serializeAbCookie({
      name: markerName,
      value: markerValue,
      options: { path: "/", sameSite: "lax", maxAge: conversionCookieMaxAge, httpOnly: true },
    });
    return json({ recorded: true }, 200, { "Set-Cookie": marker });
  };
}

/** A run of the experiment that ended, as `GET /api/_ab/results` lists it. */
export interface AbPastRun {
  /** The manifest key the run was on (the page's path then). */
  key: string;
  startedAt: string;
  endedAt: string;
  /** Its counts from `startedAt` to `endedAt`, or null when reading them failed (`error`). */
  results: AbResults | null;
  error?: string;
}

export interface AbResultsResponse {
  /** The current run on this page and locale, or null while no variant is published. */
  experiment: { key: string; startedAt: string } | null;
  results: AbResults | null;
  /**
   * Runs on this page and locale that ended in the last 90 days, most recent first (at most
   * 10), each with its own results.
   */
  pastRuns: AbPastRun[];
}

/**
 * `GET /api/_ab/results?collection=<slug>&id=<id>[&locale=<code>]` — counts per bucket for
 * the experiment on one original document: its current run (since it started) and the runs
 * that ended in the last 90 days (each from its start to its end). Admin-panel users only,
 * who must also be able to read the document. The current run's manifest key is computed here
 * with the collection's `generatePath`, and past runs are found by the document's id, so the
 * client never names an arbitrary key.
 */
export function buildResultsHandler<TVariantData extends object>(
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  measurement: AbMeasurementConfig<TVariantData>
): PayloadHandler {
  const experimentsSlug = experimentsSlugOf(pluginConfig);

  return async (req) => {
    if (!req.user) return json({ error: "Unauthorized" }, 401);
    if (!isAdminPanelUser(req)) return json({ error: "Forbidden" }, 403);

    const params = new URL(req.url ?? "http://localhost").searchParams;
    const collection = params.get("collection") ?? "";
    const id = params.get("id") ?? "";
    const localeParam = params.get("locale");

    const abConfig = Object.hasOwn(pluginConfig.collections, collection)
      ? pluginConfig.collections[collection]
      : undefined;
    if (!abConfig) return json({ error: `A/B testing is not enabled for "${collection}"` }, 400);
    if (!id) return json({ error: "id is required" }, 400);

    const localization = req.payload.config.localization;
    const locale =
      localization && localeParam && localization.localeCodes.includes(localeParam)
        ? localeParam
        : localization
          ? localization.defaultLocale
          : undefined;

    let doc: Record<string, unknown>;
    try {
      doc = (await req.payload.findByID({
        collection: collection as CollectionSlug,
        id,
        depth: 0,
        ...(locale ? { locale: locale as never } : {}),
        overrideAccess: false,
        req,
      })) as Record<string, unknown>;
    } catch {
      return json({ error: "Document not found" }, 404);
    }
    if (!doc) return json({ error: "Document not found" }, 404);
    if (doc[AB_VARIANT_OF_FIELD]) return json({ error: "Results belong to the original" }, 400);

    const readResults = (args: { experiment: string; startedAt: string; endedAt?: string }) =>
      measurement.getResults({ ...args, req });

    // Past runs: by the document (its path may have changed since), in this locale, ended
    // within the retention window (older rows may not be pruned yet).
    const { docs: pastRows } = await req.payload.find({
      collection: experimentsSlug,
      where: {
        and: [
          { parentDocId: { equals: String(doc.id ?? id) } },
          { parentCollection: { equals: collection } },
          locale ? { locale: { equals: locale } } : { locale: { exists: false } },
          { endedAt: { greater_than_equal: retentionCutoff(new Date()) } },
        ],
      },
      sort: "-endedAt",
      depth: 0,
      limit: AB_MAX_PAST_RUNS,
      pagination: false,
      overrideAccess: true,
      req,
    });
    const pastRuns: Promise<AbPastRun[]> = Promise.all(
      (pastRows as unknown as ExperimentRunRow[]).map(async (row): Promise<AbPastRun> => {
        const run = { key: row.manifestKey, startedAt: row.startedAt, endedAt: row.endedAt! };
        try {
          const results = await readResults({
            experiment: run.key,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
          });
          return { ...run, results };
        } catch (err) {
          req.payload.logger.error({ err, msg: "[payload-plugin-ab] getResults failed" });
          const error = err instanceof Error ? err.message : "Failed to read results";
          return { ...run, results: null, error };
        }
      })
    );

    const key = abConfig.generatePath({ doc, locale });
    const row = key
      ? ((
          await req.payload.find({
            collection: experimentsSlug,
            where: whereOpenRun(key, collection),
            sort: "-startedAt",
            depth: 0,
            limit: 1,
            pagination: false,
            overrideAccess: true,
            req,
          })
        ).docs[0] as { startedAt?: string } | undefined)
      : undefined;
    if (!key || !row?.startedAt) {
      return json({
        experiment: null,
        results: null,
        pastRuns: await pastRuns,
      } satisfies AbResultsResponse);
    }

    const experiment = { key, startedAt: row.startedAt };
    try {
      const [results, past] = await Promise.all([
        readResults({ experiment: key, startedAt: row.startedAt }),
        pastRuns,
      ]);
      return json({ experiment, results, pastRuns: past } satisfies AbResultsResponse);
    } catch (err) {
      req.payload.logger.error({ err, msg: "[payload-plugin-ab] getResults failed" });
      const message = err instanceof Error ? err.message : "Failed to read results";
      return json({ error: message, experiment }, 502);
    }
  };
}
