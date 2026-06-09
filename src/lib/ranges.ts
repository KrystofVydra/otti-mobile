/**
 * Chart time-range definitions. Each range maps a label to a lookback window
 * and the server-side aggregation bucket to request, so the point count stays
 * reasonable across very different time spans.
 */

export type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d';

export interface RangeDef {
  key: RangeKey;
  /** Short label shown in the segmented selector. */
  label: string;
  /** Lookback window in milliseconds (to = now, from = now - windowMs). */
  windowMs: number;
  /** TimescaleDB bucket size passed to the API (1m|5m|15m|1h|6h|1d). */
  bucket: string;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RANGES: readonly RangeDef[] = [
  { key: '1h', label: '1h', windowMs: 1 * HOUR, bucket: '1m' },
  { key: '6h', label: '6h', windowMs: 6 * HOUR, bucket: '5m' },
  { key: '24h', label: '24h', windowMs: 24 * HOUR, bucket: '15m' },
  { key: '7d', label: '7d', windowMs: 7 * DAY, bucket: '1h' },
  { key: '30d', label: '30d', windowMs: 30 * DAY, bucket: '6h' },
] as const;

export const DEFAULT_RANGE: RangeKey = '24h';

/** Look up a range definition by key (falls back to the default range). */
export function getRange(key: RangeKey): RangeDef {
  return RANGES.find((r) => r.key === key) ?? RANGES[2];
}
