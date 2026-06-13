/**
 * BLE service layer for provisioning an otti ESP32-S3 sensor.
 *
 * UI-agnostic (no React). Wraps react-native-ble-plx and implements the GATT
 * provisioning contract: scan by service UUID → connect → MTU 512 → discover →
 * subscribe to status → write wifi/mqtt credentials → write commit → watch
 * status notifications for a terminal result.
 *
 * IMPORTANT: react-native-ble-plx reads/writes characteristic values as Base64.
 * Every write here is Base64-encoded; every status notification is Base64-decoded.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type BleError, type Subscription } from 'react-native-ble-plx';

/* ---- GATT contract ---- */

export const SERVICE_UUID = '510f7001-0b77-43c9-836b-6ec86a1b36ef';
export const CHAR_WIFI_SSID = '510f7002-0b77-43c9-836b-6ec86a1b36ef';
export const CHAR_WIFI_PASSWORD = '510f7003-0b77-43c9-836b-6ec86a1b36ef';
export const CHAR_MQTT_TOKEN = '510f7004-0b77-43c9-836b-6ec86a1b36ef';
export const CHAR_COMMIT = '510f7005-0b77-43c9-836b-6ec86a1b36ef';
export const CHAR_STATUS = '510f7006-0b77-43c9-836b-6ec86a1b36ef';

export type ProvisioningStatus =
  | 'IDLE'
  | 'RECEIVED'
  | 'WIFI_CONNECTING'
  | 'WIFI_FAILED'
  | 'WIFI_OK'
  | 'MQTT_CONNECTING'
  | 'MQTT_FAILED'
  | 'PROVISIONED'
  | 'ERROR';

const ALL_STATUSES: readonly ProvisioningStatus[] = [
  'IDLE',
  'RECEIVED',
  'WIFI_CONNECTING',
  'WIFI_FAILED',
  'WIFI_OK',
  'MQTT_CONNECTING',
  'MQTT_FAILED',
  'PROVISIONED',
  'ERROR',
];

function isProvisioningStatus(value: string): value is ProvisioningStatus {
  return (ALL_STATUSES as readonly string[]).includes(value);
}

export interface Credentials {
  wifiSsid: string;
  wifiPassword: string;
  mqttToken: string;
}

export interface ScannedDevice {
  id: string;
  /** Advertised name (display-only) — e.g. "OTTI-TEST". */
  name: string;
}

/** Returned from connectAndProvision so callers can disconnect / clean up. */
export interface ProvisionController {
  cancel: () => Promise<void>;
}

/** Structured reason accompanying a terminal failure, for the result screen. */
export type ProvisionFailureReason = 'wifi_failed' | 'mqtt_failed' | 'error';

/** After commit, give the device this long to reach a terminal status. */
const PROVISION_TIMEOUT_MS = 60_000;

/* ---- Base64 <-> UTF-8 codec (self-contained; RN has no global Buffer) ---- */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8ToBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — combine with the following low surrogate.
      const low = str.charCodeAt(++i);
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function bytesToBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const e0 = B64_ALPHABET.indexOf(clean[i]);
    const e1 = B64_ALPHABET.indexOf(clean[i + 1]);
    const e2 = i + 2 < clean.length ? B64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const e3 = i + 3 < clean.length ? B64_ALPHABET.indexOf(clean[i + 3]) : -1;
    bytes.push((e0 << 2) | (e1 >> 4));
    if (e2 !== -1) bytes.push(((e1 & 0x0f) << 4) | (e2 >> 2));
    if (e3 !== -1) bytes.push(((e2 & 0x03) << 6) | e3);
  }
  return bytes;
}

function bytesToUtf8(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
      );
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}

/** UTF-8 string → Base64 (for characteristic writes). */
export function encodeBase64(str: string): string {
  return bytesToBase64(utf8ToBytes(str));
}

/** Base64 → UTF-8 string (for decoding status notifications). */
export function decodeBase64(b64: string): string {
  return bytesToUtf8(base64ToBytes(b64));
}

/** commit value: a single 0x01 byte, Base64-encoded ("AQ=="). */
const COMMIT_VALUE_BASE64 = bytesToBase64([0x01]);

/* ---- Manager singleton ---- */

let manager: BleManager | null = null;

/** Lazily create the single BleManager (constructing it touches native code). */
export function getManager(): BleManager {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

function describeBleError(error: BleError): string {
  return error?.message || 'A Bluetooth error occurred.';
}

/* ---- Permissions ---- */

/**
 * iOS: no-op (the OS prompts on first scan using the Info.plist usage string).
 * Android: request runtime BLE permissions (12+ scan/connect; older: location).
 */
export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const apiLevel =
    typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);

  if (apiLevel >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return (
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
        PermissionsAndroid.RESULTS.GRANTED
    );
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/* ---- Bluetooth state ---- */

/** Resolve once the adapter is powered on; reject if off/unavailable. */
function waitForPoweredOn(timeoutMs = 8000): Promise<void> {
  const m = getManager();
  return new Promise((resolve, reject) => {
    let sub: Subscription | null = null;
    const timer = setTimeout(() => {
      sub?.remove();
      reject(new Error('Bluetooth is not on. Turn on Bluetooth and try again.'));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      clearTimeout(timer);
      sub?.remove();
      fn();
    };

    // emitCurrentState=true → fires immediately with the current state.
    sub = m.onStateChange((state) => {
      if (state === State.PoweredOn) {
        finish(resolve);
      } else if (state === State.Unsupported) {
        finish(() => reject(new Error('Bluetooth is not supported on this device.')));
      } else if (state === State.Unauthorized) {
        finish(() => reject(new Error('Bluetooth permission was denied. Enable it in Settings.')));
      } else if (state === State.PoweredOff) {
        finish(() => reject(new Error('Bluetooth is off. Turn on Bluetooth and try again.')));
      }
    }, true);
  });
}

/* ---- Scanning ---- */

/**
 * Scan for peripherals advertising the otti service UUID. Calls onDevice for
 * each newly-seen device (de-duplicated by id). Returns a stop function.
 * Discovery is by SERVICE UUID only — never by name.
 */
export function scanForDevices(
  onDevice: (device: ScannedDevice) => void,
  onError?: (message: string) => void,
): () => void {
  const m = getManager();
  const seen = new Set<string>();
  let stopped = false;

  const begin = () => {
    if (stopped) return;
    m.startDeviceScan([SERVICE_UUID], null, (error, device) => {
      if (error) {
        onError?.(describeBleError(error));
        return;
      }
      if (!device || seen.has(device.id)) return;
      seen.add(device.id);
      onDevice({
        id: device.id,
        name: device.localName ?? device.name ?? 'otti sensor',
      });
    });
  };

  waitForPoweredOn()
    .then(begin)
    .catch((e: unknown) => onError?.(e instanceof Error ? e.message : 'Bluetooth error.'));

  return () => {
    stopped = true;
    m.stopDeviceScan();
  };
}

/* ---- Provisioning ---- */

/**
 * Run the full provisioning sequence against a device.
 *
 * onStatus fires for every status update (including terminals). onError fires
 * for BLE failures, the device's terminal failure statuses, premature
 * disconnects, and the post-commit timeout — with a structured `reason` so the
 * caller can show the right result screen without re-deriving it from status.
 * Returns a controller whose cancel() disconnects and removes all subscriptions.
 */
export async function connectAndProvision(
  deviceId: string,
  creds: Credentials,
  onStatus: (status: ProvisioningStatus) => void,
  onError: (message: string, reason: ProvisionFailureReason) => void,
): Promise<ProvisionController> {
  const m = getManager();
  let statusSub: Subscription | null = null;
  let disconnectSub: Subscription | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let finished = false; // a terminal outcome (success OR failure) has been delivered
  let provisioned = false;

  const clearTimer = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const removeSubscriptions = () => {
    statusSub?.remove();
    statusSub = null;
    disconnectSub?.remove();
    disconnectSub = null;
  };

  const cleanup = async () => {
    clearTimer();
    removeSubscriptions();
    try {
      await m.cancelDeviceConnection(deviceId);
    } catch {
      // already disconnected — ignore
    }
  };

  const fail = (message: string, reason: ProvisionFailureReason = 'error') => {
    if (finished) return;
    finished = true;
    clearTimer();
    onError(message, reason);
    void cleanup();
  };

  const handleStatus = (status: ProvisioningStatus) => {
    onStatus(status);

    if (status === 'PROVISIONED') {
      // Success. Keep the connection until the caller cancel()s (Done button),
      // but stop the timeout and the status subscription.
      provisioned = true;
      finished = true;
      clearTimer();
      statusSub?.remove();
      statusSub = null;
    } else if (status === 'WIFI_FAILED') {
      fail('Couldn’t connect to wifi — check the network name and password.', 'wifi_failed');
    } else if (status === 'MQTT_FAILED') {
      fail('Connected to wifi but couldn’t reach the server.', 'mqtt_failed');
    } else if (status === 'ERROR') {
      fail('The device reported an error during setup.', 'error');
    }
  };

  try {
    let device = await m.connectToDevice(deviceId);

    // Step 4: request a large MTU so each credential fits one write. On iOS the
    // MTU is auto-negotiated and this may be a no-op — treat failure as non-fatal.
    try {
      device = await device.requestMTU(512);
    } catch {
      // ignore — continue with whatever MTU was negotiated
    }

    // Step 5: discover services + characteristics.
    device = await device.discoverAllServicesAndCharacteristics();

    // Detect a disconnect that happens before we reach a terminal status.
    disconnectSub = device.onDisconnected(() => {
      if (provisioned || finished) return;
      fail('The device disconnected before setup finished.');
    });

    // Step 6: subscribe to status notifications BEFORE writing.
    statusSub = device.monitorCharacteristicForService(
      SERVICE_UUID,
      CHAR_STATUS,
      (error, characteristic) => {
        if (error) {
          if (finished) return; // expected cancellation error after we finish
          fail(describeBleError(error));
          return;
        }
        const value = characteristic?.value;
        if (!value) return;
        const decoded = decodeBase64(value).trim();
        if (isProvisioningStatus(decoded)) {
          handleStatus(decoded);
        }
      },
    );

    // Optionally read the current status once.
    try {
      const initial = await device.readCharacteristicForService(SERVICE_UUID, CHAR_STATUS);
      if (initial.value) {
        const decoded = decodeBase64(initial.value).trim();
        if (isProvisioningStatus(decoded)) onStatus(decoded);
      }
    } catch {
      // non-fatal — notifications will drive the UI
    }

    if (finished) {
      // A disconnect/terminal arrived during setup; don't write.
      return { cancel: cleanup };
    }

    // Step 7: write the three credentials (UTF-8 → Base64, Write With Response).
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHAR_WIFI_SSID,
      encodeBase64(creds.wifiSsid),
    );
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHAR_WIFI_PASSWORD,
      encodeBase64(creds.wifiPassword),
    );
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHAR_MQTT_TOKEN,
      encodeBase64(creds.mqttToken),
    );

    // Step 8: commit (single 0x01 byte, Write With Response).
    await device.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHAR_COMMIT,
      COMMIT_VALUE_BASE64,
    );

    // Step 9: arm the post-commit timeout if no terminal status arrives.
    if (!finished) {
      timeoutHandle = setTimeout(() => {
        fail('Setup timed out. Make sure the device is powered and in range, then try again.');
      }, PROVISION_TIMEOUT_MS);
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : 'Bluetooth connection failed.');
  }

  return {
    cancel: async () => {
      finished = true;
      await cleanup();
    },
  };
}
