/**
 * Online-status + last-seen helpers.
 *
 * The backend has no explicit online/offline flag, so we derive it from
 * `last_seen_at`. Sensors report roughly every 1 minute, so ~5 minutes of
 * silence is a safe "offline" threshold (allows a couple of missed reports
 * before we flag a device as down).
 */

export const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** True if the device reported within OFFLINE_THRESHOLD_MS; false if null/old. */
export function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return false;
  return Date.now() - seen < OFFLINE_THRESHOLD_MS;
}

/**
 * Format a "last seen" timestamp as a short relative string, e.g.
 * "Just now", "2 minutes ago", "3 hours ago", "5 days ago", "Never".
 * Dependency-free.
 */
export function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Never';
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return 'Never';

  const diffMs = Date.now() - seen;
  if (diffMs < 0) return 'Just now'; // clock skew / future timestamp

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
