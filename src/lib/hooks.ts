/**
 * TanStack Query hooks for server state. All data fetching goes through here so
 * components stay declarative and caching/refetch policy lives in one place.
 */
import { useQuery } from '@tanstack/react-query';

import { getDevices } from '@/lib/api';

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
