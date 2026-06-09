/**
 * TanStack Query hooks for server state. All data fetching goes through here so
 * components stay declarative and caching/refetch policy lives in one place.
 */
import { useQuery } from '@tanstack/react-query';

import { getDevices, getReadings } from '@/lib/api';
import { getRange, type RangeKey } from '@/lib/ranges';

/**
 * The user's devices with their latest readings.
 *
 * Telemetry arrives ~once a minute, so we treat data as fresh for 30s and
 * background-refetch every 60s to keep the dashboard near-live.
 */
export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: getDevices,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Historical readings for one device over the selected range. The from/to/bucket
 * are derived from the range at fetch time (to = now), so the query key stays
 * stable per (device, range) and the window slides forward on each refetch.
 */
export function useReadings(deviceId: number, range: RangeKey) {
  return useQuery({
    queryKey: ['readings', deviceId, range],
    queryFn: () => {
      const { windowMs, bucket } = getRange(range);
      const to = new Date();
      const from = new Date(to.getTime() - windowMs);
      return getReadings(deviceId, {
        from: from.toISOString(),
        to: to.toISOString(),
        bucket,
      });
    },
    staleTime: 60_000,
    enabled: Number.isFinite(deviceId) && deviceId > 0,
  });
}
