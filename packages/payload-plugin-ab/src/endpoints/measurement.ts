import type { CollectionSlug, PayloadHandler, PayloadRequest } from "payload";
import type { AbMeasurementConfig, AbResults, AbTestingPluginConfig } from "../types/config";
import { AB_EXPERIMENTS_SLUG, AB_VARIANT_OF_FIELD } from "../constants";
import { DEFAULT_VISITOR_ID_COOKIE_NAME } from "../cookie/constants";
import { bucketCookieName } from "../cookie/utils/bucketCookieName";
import { parseCookieHeader, serializeAbCookie } from "../middleware/utils/cookies";

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
 * still be live in the manifest. A visitor counts once per experiment and bucket: the first
 * conversion sets an HttpOnly marker cookie, and later ones are acknowledged but not
 * recorded. The cookies are `SameSite=Lax`, so a cross-site form post carries none of them
 * and can't convert on a visitor's behalf.
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

  return async (req) => {
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
    if (cookies.get(markerName) === bucket) return json({ recorded: false, reason: "duplicate" });

    try {
      await measurement.recordConversion({ experiment, bucket, goal, visitorId }, req);
    } catch (err) {
      req.payload.logger.error({ err, msg: "[payload-plugin-ab] recordConversion failed" });
      return json({ error: "Failed to record the conversion" }, 500);
    }

    const marker = serializeAbCookie({
      name: markerName,
      value: bucket,
      options: { path: "/", sameSite: "lax", maxAge: conversionCookieMaxAge, httpOnly: true },
    });
    return json({ recorded: true }, 200, { "Set-Cookie": marker });
  };
}

/**
 * True for a user of the admin panel's auth collection. `req.user` alone isn't enough: a
 * user of any other auth collection (members, customers…) is "signed in" too. The same gate
 * as the SEO analyzer's, without its role layer (Cargo's `users` have no roles).
 */
export function isAdminPanelUser(req: PayloadRequest): boolean {
  const user = req.user as { collection?: unknown } | null | undefined;
  if (!user) return false;
  const adminCollection = req.payload.config.admin?.user;
  return !adminCollection || user.collection === adminCollection;
}

export interface AbResultsResponse {
  /** The experiment on this page and locale, or null before a variant has been published. */
  experiment: { key: string; startedAt: string } | null;
  results: AbResults | null;
}

/**
 * `GET /api/_ab/results?collection=<slug>&id=<id>[&locale=<code>]` — counts per bucket for
 * the experiment on one original document, since the experiment started. Admin-panel users
 * only, who must also be able to read the document. The manifest key is computed here with
 * the collection's `generatePath`, so the client never names an arbitrary key.
 */
export function buildResultsHandler<TVariantData extends object>(
  pluginConfig: AbTestingPluginConfig<TVariantData>,
  measurement: AbMeasurementConfig<TVariantData>
): PayloadHandler {
  const experimentsSlug = (pluginConfig.experimentsCollectionSlug ??
    AB_EXPERIMENTS_SLUG) as CollectionSlug;

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

    const key = abConfig.generatePath({ doc, locale });
    const empty: AbResultsResponse = { experiment: null, results: null };
    if (!key) return json(empty);

    const { docs } = await req.payload.find({
      collection: experimentsSlug,
      where: {
        and: [{ manifestKey: { equals: key } }, { parentCollection: { equals: collection } }],
      },
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true,
      req,
    });
    const row = docs[0] as { startedAt?: string } | undefined;
    if (!row?.startedAt) return json(empty);

    const experiment = { key, startedAt: row.startedAt };
    try {
      const results = await measurement.getResults({
        experiment: key,
        startedAt: row.startedAt,
        req,
      });
      return json({ experiment, results } satisfies AbResultsResponse);
    } catch (err) {
      req.payload.logger.error({ err, msg: "[payload-plugin-ab] getResults failed" });
      const message = err instanceof Error ? err.message : "Failed to read results";
      return json({ error: message, experiment }, 502);
    }
  };
}
