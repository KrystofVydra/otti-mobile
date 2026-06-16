@AGENTS.md

# otti-mobile

## Overview

Mobile companion app for **otti**, an IoT fridge-temperature monitoring platform
(ESP32-S3 temperature sensors reporting to a cloud backend). The app lets users
log in, view their devices and live/historical temperature readings, and
provision/configure sensors over Bluetooth Low Energy.

**iOS-first development; Android comes later.**

Built with React Native + Expo (SDK 56), TypeScript, and Expo Router.

## Backend API

- **Base URL:** `https://api.otti.cz`
- **Swagger docs:** `https://api.otti.cz/docs`

### Auth (bearer token)

- Auth is **bearer-token** based.
- **Login:** `POST /auth/login` with body `{ email, password }` **and** request
  header `X-Client: mobile`. The `X-Client: mobile` header makes the backend
  return the session token in the **response body** (web clients omit it and get
  an HTTP-only cookie instead — mobile must use the token).
- Put the returned token in `Authorization: Bearer <token>` on **all**
  subsequent requests.
- Sessions are **server-side, stateful, 30-day TTL.**
- **On ANY `401` response**, the app must clear the stored token and return to
  the login screen. This is handled globally in the API client.
- `GET /auth/me` — current user info. Used to validate a stored token on app
  launch (decide whether to show login or go straight to the dashboard).
- `POST /auth/logout` — invalidates the session server-side.

### Topology (post-rework)

The old flat "device = sensor" model is **gone**. There is now a three-level
hierarchy, and all `/devices/*` endpoints are replaced by `/controllers/*`:

```
gateway (ESP32, MQTT identity; background infra — user mostly doesn't see it)
  └── controller (1+ per gateway; each a physical fridge/freezer "box")  ← PRIMARY entity
        └── node (1-5 per controller; individual temp/lux sensor inside)
```

**v1 stance:** controllers are the primary user-facing entity (dashboard list +
detail). Nodes are shown inside the controller detail. Gateways are background
metadata only — modeled in types for v2, but **no gateway UI** in v1.

### Controllers, nodes & readings

- `GET /controllers` — dashboard list. Array of controller entries, each with a
  rolled-up `latest` snapshot:
  - controller: `id`, `sn`, `name`, `location` (nullable), `gateway`,
    `node_count`, `last_seen_at` (nullable).
  - `latest` (nullable — null if never reported): `time`,
    `temperature_avg` (nullable; null if no node has a temp yet),
    `battery_pct` (int 0..100, nullable), `door_open` (nullable),
    `any_node_error`.
  - `gateway`: `id`, `device_key`, `name`, `location` (nullable).
- `GET /controllers/{id}` — detail: controller fields + `gateway` + `nodes[]` +
  `latest_telemetry` (nullable).
  - each node: `id`, `node_index`, `name` (nullable → fall back to
    "Node {node_index}"), `has_lux`, `last_seen_at` (nullable), and `latest`
    (nullable): `{ time, temperature (nullable), lux (nullable when no lux/no
    reading), err }` where `err` is `null | 'sensor_temp' | 'sensor_lux' |
    'sensor_both' | 'comms'`.
  - `latest_telemetry` (nullable): `{ time, battery_pct, door_open }`.
- `GET /controllers/{id}/readings?from=...&to=...&bucket=1m|5m|15m|1h|6h|1d&limit=N`
  — averaged temperature time-series. Array of `{ time, temperature_avg }`. The
  `bucket` param triggers server-side TimescaleDB time-bucket aggregation. Chart
  ranges: **1h, 6h, 24h, 7d, 30d.**
- `GET /controllers/{id}/telemetry?from=...&to=...&bucket=...` — battery + door
  time-series. Array of `{ time, battery_pct, door_open }`. (Not charted in v1;
  typed for completeness.)

> Known backend bug (being fixed separately): readings/telemetry currently
> return all points sharing one timestamp. Build against the **intended** shape
> (distinct ascending `time`, one value per bucket) — no client workarounds.

## Token storage

- Use **`expo-secure-store`** (Keychain-backed) for the bearer token.
- **NEVER use AsyncStorage for the token.**

## Stack conventions

- **TypeScript** throughout.
- **Expo Router** for navigation.
- **TanStack Query** (`@tanstack/react-query`) for ALL server-state / data
  fetching.
- A **single central, typed API client** that injects the bearer token from
  secure-store into every request and handles `401` globally (clear token →
  login).

## Native modules in use

- `expo-secure-store` — token storage (Keychain).
- `react-native-ble-plx` — BLE **central** role (phone scans/connects to the
  ESP32 peripheral / GATT server).
- `expo-dev-client` — custom development client.

## Build note

This app requires a **CUSTOM DEV CLIENT** (not Expo Go) because of the native
BLE module (`react-native-ble-plx`).

- The **iOS Simulator** can run everything **EXCEPT BLE** — the simulator has no
  Bluetooth radio. A **physical iPhone** is required to test BLE.
- **Do not assume Expo Go works.**
- Do not run a native build / prebuild unless explicitly asked.

## BLE GATT contract

_TBD — to be defined in a later prompt._
