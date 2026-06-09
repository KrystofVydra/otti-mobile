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

### Devices & readings

- `GET /devices` — list the user's devices, each with its latest reading.
- `GET /devices/{id}` — a single device.
- `GET /devices/{id}/readings/latest` — most recent reading for a device.
- `GET /devices/{id}/readings?from=...&to=...&bucket=1m|5m|15m|1h|6h|1d&limit=N`
  — historical readings. The `bucket` param triggers server-side TimescaleDB
  time-bucket aggregation. Planned chart ranges: **1h, 6h, 24h, 7d, 30d.**

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
