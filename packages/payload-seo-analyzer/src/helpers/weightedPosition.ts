/**
 * Impression-weighted average SERP position, like Search Console.
 *
 *   Σ(position × impressions) / Σ(impressions)   over rows with position > 0
 *
 * In SQL, fallback included (see below), with `WHERE position > 0`:
 *
 *   COALESCE(SUM(position * impressions) / NULLIF(SUM(impressions), 0), AVG(position), 0)
 *
 * (a `SUM` happily adds zeros, so the `position > 0` filter must be explicit; `AVG` is the
 * plain-average fallback, and the final `0` covers a group with no positive position).
 *
 * Rows with a position but no impressions are ignored. If NO row in a group has impressions
 * (e.g. JSON/CSV imports without an impressions column), it falls back to the plain average of the
 * positive positions so the group still shows something. Rounded to one decimal; 0 when there is
 * no positive position at all.
 *
 * Built as an accumulator so callers can aggregate groups in a single pass.
 */

export interface PositionAccumulator {
  /** Σ position × impressions (rows with position > 0 and impressions > 0). */
  weighted: number
  /** Σ impressions (same rows). */
  impressions: number
  /** Σ position over every row with position > 0 (fallback). */
  plainSum: number
  /** Count of rows with position > 0 (fallback). */
  plainCount: number
}

export function createPositionAccumulator(): PositionAccumulator {
  return { weighted: 0, impressions: 0, plainSum: 0, plainCount: 0 }
}

export function addPosition(acc: PositionAccumulator, position: number, impressions: number): void {
  if (!(position > 0)) return
  acc.plainSum += position
  acc.plainCount++
  if (impressions > 0) {
    acc.weighted += position * impressions
    acc.impressions += impressions
  }
}

export function resolvePosition(acc: PositionAccumulator): number {
  if (acc.impressions > 0) return Math.round((acc.weighted / acc.impressions) * 10) / 10
  if (acc.plainCount > 0) return Math.round((acc.plainSum / acc.plainCount) * 10) / 10
  return 0
}

/** Convenience over a list of rows. */
export function weightedPosition(rows: Array<{ position: number; impressions: number }>): number {
  const acc = createPositionAccumulator()
  for (const r of rows) addPosition(acc, r.position || 0, r.impressions || 0)
  return resolvePosition(acc)
}
