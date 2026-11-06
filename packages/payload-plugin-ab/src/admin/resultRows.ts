import type { AbBucketResult } from "../types/config";

export interface ResultRow extends AbBucketResult {
  label: string;
  /** A bucket with data whose variant no longer exists. */
  deleted?: boolean;
}

/**
 * The Variants panel's results rows: the original first, then the current variants in panel
 * order (a variant's bucket is its slug, the default variant data), then buckets with data
 * whose variant was deleted. Variants without data show zeros, unless `onlyWithData` (a past
 * run, which today's variants may not have taken part in); the original always shows.
 */
export function buildResultRows(
  buckets: AbBucketResult[],
  variants: { slug?: string; title?: string }[],
  { onlyWithData = false }: { onlyWithData?: boolean } = {}
): ResultRow[] {
  const byBucket = new Map(buckets.map((b) => [b.bucket, b]));
  const counts = (bucket: string) => ({
    bucket,
    impressions: byBucket.get(bucket)?.impressions ?? 0,
    conversions: byBucket.get(bucket)?.conversions ?? 0,
  });
  const current = variants.filter(
    (v): v is { slug: string; title?: string } =>
      Boolean(v.slug) && (!onlyWithData || byBucket.has(v.slug!))
  );
  const known = new Set(["original", ...variants.map((v) => v.slug)]);

  return [
    { ...counts("original"), label: "Original" },
    ...current.map((v) => ({ ...counts(v.slug), label: v.title ?? v.slug })),
    ...buckets
      .filter((b) => !known.has(b.bucket))
      .map((b) => ({ ...b, label: `Deleted variant (${b.bucket})`, deleted: true })),
  ];
}

/** Impressions and conversions summed over the rows. */
export function totalOf(rows: AbBucketResult[]): { impressions: number; conversions: number } {
  return rows.reduce(
    (sum, r) => ({
      impressions: sum.impressions + r.impressions,
      conversions: sum.conversions + r.conversions,
    }),
    { impressions: 0, conversions: 0 }
  );
}

/** Conversions per impression, as a percentage with one decimal; a dash with no impressions. */
export function conversionRate(impressions: number, conversions: number): string {
  return impressions > 0 ? `${((conversions / impressions) * 100).toFixed(1)}%` : "–";
}
