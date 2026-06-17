/**
 * Shared API/domain types for the otti backend.
 *
 * Topology (post-rework): a gateway (ESP32, background infra) has one or more
 * controllers (each a physical fridge/freezer "box" — the user's PRIMARY
 * entity), and each controller has 1-5 nodes (individual temp/lux sensors).
 * Mobile v1 works with controllers + their nodes; gateways are background
 * metadata (modeled here for v2, no UI yet).
 */

/** A logged-in user as returned by the backend. */
export interface User {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
}

/**
 * Response shape of `POST /auth/login` for mobile clients (X-Client: mobile).
 * It is a FLAT object: the user fields plus a top-level bearer `token`.
 */
export interface LoginResponse extends User {
  token: string;
}

/* ---- Controller hierarchy ---- */

/** Gateway (ESP32 MQTT identity). Background metadata in v1 — no dedicated UI. */
export interface Gateway {
  id: number;
  device_key: string;
  name: string;
  location: string | null;
}

/** Rolled-up latest snapshot for a controller (the `latest` of GET /controllers). */
export interface ControllerLatest {
  time: string;
  /** Average temperature across nodes (°C). Null if no node has reported yet. */
  temperature_avg: number | null;
  /** Battery percentage 0..100. Null if no telemetry yet. */
  battery_pct: number | null;
  /** Null if no telemetry yet. */
  door_open: boolean | null;
  any_node_error: boolean;
}

/** One entry of `GET /controllers` — the dashboard list source. */
export interface ControllerListEntry {
  id: number;
  sn: string;
  name: string;
  location: string | null;
  gateway: Gateway;
  node_count: number;
  last_seen_at: string | null;
  /** Null if the controller has never reported. */
  latest: ControllerLatest | null;
}

/** Per-node error code reported by a sensor. */
export type NodeError = 'sensor_temp' | 'sensor_lux' | 'sensor_both' | 'comms';

/** A single node's most recent reading. */
export interface NodeReading {
  time: string;
  /** °C. Null if no temp reading. */
  temperature: number | null;
  /** Lux. Null when has_lux is false or no reading. */
  lux: number | null;
  err: NodeError | null;
}

/** An individual sensor node inside a controller. */
export interface Node {
  id: number;
  node_index: number;
  /** Null → fall back to "Node {node_index}" in the UI. */
  name: string | null;
  has_lux: boolean;
  last_seen_at: string | null;
  /** Null if the node has never reported. */
  latest: NodeReading | null;
}

/** A telemetry sample over time (battery + door) — GET /controllers/{id}/telemetry. */
export interface Telemetry {
  time: string;
  battery_pct: number;
  door_open: boolean;
}

/** The controller's most recent telemetry snapshot (detail `latest_telemetry`). */
export interface ControllerTelemetry {
  time: string;
  battery_pct: number;
  door_open: boolean;
}

/** Full controller detail — GET /controllers/{id}. */
export interface ControllerDetail {
  id: number;
  sn: string;
  name: string;
  location: string | null;
  gateway: Gateway;
  nodes: Node[];
  /** Null if no telemetry yet. */
  latest_telemetry: ControllerTelemetry | null;
}

/** One point of the averaged temperature series — GET /controllers/{id}/readings. */
export interface TempReading {
  time: string;
  temperature_avg: number;
}

/* ---- Notifications ---- */

/** The 11 notification kinds the backend can emit. */
export type NotificationKind =
  | 'temp_safe'
  | 'temp_preferred'
  | 'temp_drift'
  | 'door_open'
  | 'controller_offline'
  | 'gateway_offline'
  | 'multi_controller_offline'
  | 'battery_critical'
  | 'battery_low'
  | 'node_error_single'
  | 'node_error_cumulative';

export type NotificationSeverity = 'critical' | 'alert';
export type NotificationScope = 'gateway' | 'controller' | 'node';

/** Filter passed to GET /me/notifications?status=... */
export type NotificationStatus = 'active' | 'all' | 'resolved';

/**
 * A single in-app notification. `summary` is a PRE-RENDERED display string —
 * use it for the body text. `read_at == null` → unread; `resolved_at != null` →
 * resolved. `details?.is_test === true` marks a test notification.
 */
export interface AppNotification {
  id: number;
  kind: NotificationKind;
  severity: NotificationSeverity;
  scope: NotificationScope;
  gateway_id: number | null;
  controller_id: number | null;
  node_id: number | null;
  subject_name: string;
  details: Record<string, unknown> | null;
  opened_at: string;
  resolved_at: string | null;
  read_at: string | null;
  summary: string;
}

/** Envelope returned by GET /me/notifications. */
export interface NotificationsResponse {
  notifications: AppNotification[];
  total: number;
  unread: number;
  active: number;
}

/** True if the notification is a test notification (details.is_test === true). */
export function isTestNotification(n: AppNotification): boolean {
  return n.details?.is_test === true;
}

/**
 * One per-kind notification setting (GET /me/notifications/settings returns an
 * array of these). `thresholds` keys vary by kind and may be empty (toggle-only).
 */
export interface NotificationSettingEntry {
  kind: NotificationKind;
  severity: NotificationSeverity;
  scope: NotificationScope;
  enabled: boolean;
  thresholds: Record<string, number>;
  description: string;
}
