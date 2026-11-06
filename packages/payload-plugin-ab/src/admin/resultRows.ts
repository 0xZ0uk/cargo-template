import type { AbBucketResult } from "../types/config";

export interface ResultRow extends AbBucketResult {
  label: string;
  /** A bucket with data whose variant no longer exists. */
  deleted?: boolean;
}

/**
 * The Variants panel's results rows: the original first, then the current variants in panel
 * order (a variant's bucket is its slug, the default variant data), then buckets with data
 * whose variant was deleted. Buckets without data show zeros.
 */
export function buildResultRows(
  buckets: AbBucketResult[],
  variants: { slug?: string; title?: string }[]
): ResultRow[] {
  const byBucket = new Map(buckets.map((b) => [b.bucket, b]));
  const counts = (bucket: string) => ({
    bucket,
    impressions: byBucket.get(bucket)?.impressions ?? 0,
    conversions: byBucket.get(bucket)?.conversions ?? 0,
  });
  const current = variants.filter((v): v is { slug: string; title?: string } => Boolean(v.slug));
  const known = new Set(["original", ...current.map((v) => v.slug)]);

  return [
    { ...counts("original"), label: "Original" },
    ...current.map((v) => ({ ...counts(v.slug), label: v.title ?? v.slug })),
    ...buckets
      .filter((b) => !known.has(b.bucket))
      .map((b) => ({ ...b, label: `Deleted variant (${b.bucket})`, deleted: true })),
  ];
}

/** Conversions per impression, as a percentage with one decimal; a dash with no impressions. */
export function conversionRate(impressions: number, conversions: number): string {
  return impressions > 0 ? `${((conversions / impressions) * 100).toFixed(1)}%` : "–";
}
