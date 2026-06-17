/**
 * TanStack Query hooks for server state. All data fetching goes through here so
 * components stay declarative and caching/refetch policy lives in one place.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getController,
  getControllerReadings,
  getControllerTelemetry,
  getControllers,
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api';
import { getRange, type RangeKey } from '@/lib/ranges';
import type { NotificationStatus } from '@/lib/types';

/**
 * The user's controllers with their rolled-up latest snapshots.
 *
 * Telemetry arrives ~once a minute, so we treat data as fresh for 30s and
 * background-refetch every 60s to keep the dashboard near-live.
 */
export function useControllers() {
  return useQuery({
    queryKey: ['controllers'],
    queryFn: getControllers,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** A single controller's detail (nodes + latest telemetry). */
export function useController(id: number) {
  return useQuery({
    queryKey: ['controller', id],
    queryFn: () => getController(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

/**
 * Averaged temperature series for one controller over the selected range. The
 * from/to/bucket are derived from the range at fetch time (to = now), so the
 * query key stays stable per (controller, range) and the window slides forward.
 */
export function useControllerReadings(id: number, range: RangeKey) {
  return useQuery({
    queryKey: ['controllerReadings', id, range],
    queryFn: () => {
      const { windowMs, bucket } = getRange(range);
      const to = new Date();
      const from = new Date(to.getTime() - windowMs);
      return getControllerReadings(id, {
        from: from.toISOString(),
        to: to.toISOString(),
        bucket,
      });
    },
    staleTime: 60_000,
    enabled: Number.isFinite(id) && id > 0,
  });
}

/**
 * Battery + door telemetry series for one controller over the selected range.
 * Not charted in v1 — provided for completeness; a later prompt uses it.
 */
export function useControllerTelemetry(id: number, range: RangeKey) {
  return useQuery({
    queryKey: ['controllerTelemetry', id, range],
    queryFn: () => {
      const { windowMs, bucket } = getRange(range);
      const to = new Date();
      const from = new Date(to.getTime() - windowMs);
      return getControllerTelemetry(id, {
        from: from.toISOString(),
        to: to.toISOString(),
        bucket,
      });
    },
    staleTime: 60_000,
    enabled: Number.isFinite(id) && id > 0,
  });
}

/* ---- Notifications ---- */

/** Unread notification count — polled every 30s to keep the tab badge live. */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['unreadCount'],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
  });
}

/** Notification list for the given filter (active | all | resolved). */
export function useNotifications(status: NotificationStatus) {
  return useQuery({
    queryKey: ['notifications', status],
    queryFn: () => getNotifications(status),
    staleTime: 15_000,
  });
}

/** Invalidate every notifications list + the unread count after a mutation. */
function useNotificationInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['unreadCount'] });
  };
}

/** Mark a single notification read. */
export function useMarkRead() {
  const invalidate = useNotificationInvalidation();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: invalidate,
  });
}

/** Mark all notifications read. */
export function useMarkAllRead() {
  const invalidate = useNotificationInvalidation();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: invalidate,
  });
}
