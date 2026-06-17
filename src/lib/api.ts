/**
 * Central, typed API client for the otti backend.
 *
 * Every backend request goes through `apiFetch`, which:
 *  - injects the bearer token from secure-store (when present),
 *  - sets Content-Type + X-Client: mobile on every request,
 *  - serializes/parses JSON,
 *  - throws a typed `ApiError` on non-2xx,
 *  - handles 401 globally (clear token + fire onUnauthorized) — but ONLY when a
 *    token was actually sent, so a failed login (bad credentials) does not get
 *    mistaken for an expired session.
 */
import { clearToken, getToken } from '@/lib/tokenStore';
import type {
  ControllerDetail,
  ControllerListEntry,
  LoginResponse,
  NotificationSettingEntry,
  NotificationsResponse,
  NotificationStatus,
  Telemetry,
  TempReading,
  User,
} from '@/lib/types';

/** Base URL for the backend. Change here to point at another environment. */
export const API_BASE_URL = 'https://api.otti.cz';

/** Error thrown for any non-2xx response. Carries status + parsed body. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Global "session expired" handler. The auth layer registers this so a 401
 * anywhere flips the app back to the login screen. api.ts never imports
 * navigation directly — it just invokes this callback.
 */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * When true (default) the stored bearer token is attached if present, and a
   * 401 triggers the global logout. Set false for unauthenticated calls such as
   * login, where a 401 means "bad credentials", not "session expired".
   */
  auth?: boolean;
}

function extractMessage(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const detail = (parsed as Record<string, unknown>).detail;
    if (typeof detail === 'string') return detail;
    const message = (parsed as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client': 'mobile',
  };

  const token = auth ? await getToken() : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Parse the response body once (it may be empty, e.g. logout).
  const raw = await response.text();
  let parsed: unknown;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (response.status === 401) {
    // Only treat as an expired session — and clear/redirect — if we actually
    // sent a token. A 401 on an unauthenticated call (login) is just bad creds.
    if (token) {
      await clearToken();
      onUnauthorized?.();
    }
    throw new ApiError(401, extractMessage(parsed, 'Unauthorized'), parsed);
  }

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(parsed, `Request failed (${response.status})`), parsed);
  }

  return parsed as T;
}

/* ---- Auth endpoints ---- */

/** POST /auth/login — unauthenticated; returns the flat login response. */
export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

/** GET /auth/me — validate the stored token / fetch current user. */
export function getMe(): Promise<User> {
  return apiFetch<User>('/auth/me');
}

/** POST /auth/logout — invalidate the session server-side. */
export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' });
}

/* ---- Controllers ---- */

/** Build a URL-encoded readings/telemetry query string. */
function timeSeriesQuery(params: { from: string; to: string; bucket: string; limit?: number }): string {
  const query = [
    `from=${encodeURIComponent(params.from)}`,
    `to=${encodeURIComponent(params.to)}`,
    `bucket=${encodeURIComponent(params.bucket)}`,
  ];
  if (params.limit !== undefined) {
    query.push(`limit=${encodeURIComponent(String(params.limit))}`);
  }
  return query.join('&');
}

/** GET /controllers — the user's controllers, each with a rolled-up latest snapshot. */
export function getControllers(): Promise<ControllerListEntry[]> {
  return apiFetch<ControllerListEntry[]>('/controllers');
}

/** GET /controllers/{id} — a single controller with its nodes + latest telemetry. */
export function getController(id: number): Promise<ControllerDetail> {
  return apiFetch<ControllerDetail>(`/controllers/${id}`);
}

/**
 * GET /controllers/{id}/readings — averaged temperature time-series,
 * server-side bucketed. Empty buckets are omitted, so gaps are possible.
 */
export function getControllerReadings(
  id: number,
  params: { from: string; to: string; bucket: string; limit?: number },
): Promise<TempReading[]> {
  return apiFetch<TempReading[]>(`/controllers/${id}/readings?${timeSeriesQuery(params)}`);
}

/**
 * GET /controllers/{id}/telemetry — battery + door time-series, server-side
 * bucketed. (Not charted in v1; provided for completeness.)
 */
export function getControllerTelemetry(
  id: number,
  params: { from: string; to: string; bucket: string; limit?: number },
): Promise<Telemetry[]> {
  return apiFetch<Telemetry[]>(`/controllers/${id}/telemetry?${timeSeriesQuery(params)}`);
}

/* ---- Notifications ---- */

/** GET /me/notifications/unread-count — drives the tab badge. */
export function getUnreadCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/me/notifications/unread-count');
}

/** GET /me/notifications — envelope with the list + unread/active/total counts. */
export function getNotifications(
  status: NotificationStatus,
  limit = 50,
): Promise<NotificationsResponse> {
  const query = `status=${encodeURIComponent(status)}&limit=${encodeURIComponent(String(limit))}`;
  return apiFetch<NotificationsResponse>(`/me/notifications?${query}`);
}

/** POST /me/notifications/{id}/read — mark one notification read. */
export function markNotificationRead(id: number): Promise<void> {
  return apiFetch<void>(`/me/notifications/${id}/read`, { method: 'POST' });
}

/** POST /me/notifications/mark-all-read — mark every notification read. */
export function markAllNotificationsRead(): Promise<void> {
  return apiFetch<void>('/me/notifications/mark-all-read', { method: 'POST' });
}

/** GET /me/notifications/settings — per-kind enable + threshold config. */
export function getNotificationSettings(): Promise<NotificationSettingEntry[]> {
  return apiFetch<NotificationSettingEntry[]>('/me/notifications/settings');
}

/**
 * PATCH /me/notifications/settings/{kind} — partial update; `{ enabled }` alone
 * preserves thresholds and vice-versa. Returns the full updated entry.
 * For a threshold edit, send the COMPLETE thresholds object for that kind.
 */
export function updateNotificationSetting(
  kind: string,
  body: { enabled?: boolean; thresholds?: Record<string, number> },
): Promise<NotificationSettingEntry> {
  return apiFetch<NotificationSettingEntry>(`/me/notifications/settings/${kind}`, {
    method: 'PATCH',
    body,
  });
}
