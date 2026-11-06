/**
 * The value of a per-run dedupe marker (the impression and conversion cookies): the bucket
 * plus the run, `<bucket>:<startedAt in base-36 ms>`. A marker from an earlier experiment on
 * the same page doesn't match the new run's, so a returning visitor is counted again there.
 * Without a usable `startedAt` it's the bare bucket.
 */
export function abRunMarker(bucket: string, startedAt?: string | null): string {
  const time = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(time) ? `${bucket}:${time.toString(36)}` : bucket;
}
