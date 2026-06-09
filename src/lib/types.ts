/**
 * Shared API/domain types for the otti backend.
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

/** A device's metadata (the `device` field of a GET /devices entry). */
export interface DeviceInfo {
  id: number;
  device_key: string;
  name: string;
  location: string;
  /** ISO timestamp of the last report. May be null if it has never reported. */
  last_seen_at: string | null;
}

/** A single telemetry sample. `temperature` is °C, `battery_v` is volts. */
export interface Reading {
  time: string;
  temperature: number;
  lux: number;
  battery_raw: number;
  battery_v: number;
  rssi: number | null;
}

/**
 * One entry of `GET /devices`: a device plus its most recent reading.
 * `latest` is null for a device that has never reported.
 */
export interface DeviceListEntry {
  device: DeviceInfo;
  latest: Reading | null;
}
