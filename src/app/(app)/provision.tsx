import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  connectAndProvision,
  requestPermissions,
  scanForDevices,
  type ProvisionController,
  type ProvisioningStatus,
  type ScannedDevice,
} from '@/lib/ble';

const ACCENT = '#208AEF';
const SUCCESS = '#1FA463';
const FAILURE = '#D7263D';

type Step = 'scan' | 'form' | 'provisioning';
type Outcome = 'success' | 'wifi_failed' | 'mqtt_failed' | 'error';

/* ---- Fixed four-step checklist (device always runs the full sequence) ---- */

type RowState = 'done' | 'active' | 'failed' | 'pending';

const CHECKLIST_STEPS = [
  'Connecting to device',
  'Data received',
  'Wifi connected',
  'Server connected',
] as const;

/**
 * Per-row state derived ONLY from the statuses actually received this attempt —
 * no inference/backfill. A row greens solely when its own message arrives, so a
 * device that skips a step honestly shows that step un-ticked.
 *
 *  - "Connecting to device": done once ANY message arrived; active while the
 *    received set is empty (post-commit, pre-first-message).
 *  - "Data received":   done iff RECEIVED received.
 *  - "Wifi connected":  done iff WIFI_OK received; active iff WIFI_CONNECTING
 *    received but WIFI_OK not yet.
 *  - "Server connected": done iff PROVISIONED received; active iff
 *    MQTT_CONNECTING received but PROVISIONED not yet.
 */
function rowBaseStates(received: Set<ProvisioningStatus>): RowState[] {
  const has = (s: ProvisioningStatus) => received.has(s);
  return [
    received.size > 0 ? 'done' : 'active',
    has('RECEIVED') ? 'done' : 'pending',
    has('WIFI_OK') ? 'done' : has('WIFI_CONNECTING') ? 'active' : 'pending',
    has('PROVISIONED') ? 'done' : has('MQTT_CONNECTING') ? 'active' : 'pending',
  ];
}

/**
 * Overlay the atomic failure outcome onto the received-derived base states.
 * Failure marks exactly one row 'failed'; rows whose success message arrived
 * stay 'done', un-reached rows stay 'pending' (still no backfill). On success
 * the base states are used as-is (no force-all-green).
 */
function checklistStates(received: Set<ProvisioningStatus>, outcome: Outcome | null): RowState[] {
  const states = rowBaseStates(received);
  if (outcome == null || outcome === 'success') return states;

  if (outcome === 'wifi_failed') {
    states[2] = 'failed';
  } else if (outcome === 'mqtt_failed') {
    states[3] = 'failed';
  } else {
    // Generic error / timeout / BLE error: fail the current frontier (the first
    // not-yet-done row). Earlier rows stay done; later rows keep their base.
    const frontier = states.findIndex((s) => s !== 'done');
    if (frontier >= 0) states[frontier] = 'failed';
  }
  return states;
}

function ChecklistIcon({ state }: { state: RowState }) {
  if (state === 'active') {
    return (
      <View style={styles.iconWrap}>
        <ActivityIndicator size="small" color={ACCENT} />
      </View>
    );
  }
  if (state === 'done') {
    return (
      <View style={[styles.iconWrap, styles.iconDone]}>
        <Text style={styles.iconDoneMark}>✓</Text>
      </View>
    );
  }
  if (state === 'failed') {
    return (
      <View style={[styles.iconWrap, styles.iconFailed]}>
        <Text style={styles.iconFailedMark}>✕</Text>
      </View>
    );
  }
  return <View style={[styles.iconWrap, styles.iconPending]} />;
}

function ProvisionChecklist({
  received,
  outcome,
}: {
  received: Set<ProvisioningStatus>;
  outcome: Outcome | null;
}) {
  const states = checklistStates(received, outcome);
  return (
    <View style={styles.checklistCard}>
      {CHECKLIST_STEPS.map((label, i) => {
        const state = states[i];
        return (
          <View key={label} style={styles.checkRow}>
            <ChecklistIcon state={state} />
            <Text
              style={[
                styles.checkLabel,
                state === 'pending' && styles.checkLabelPending,
                state === 'done' && styles.checkLabelDone,
                state === 'failed' && styles.checkLabelFailed,
              ]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ProvisionScreen() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('scan');

  // Scan state
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScannedDevice | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  // Credentials
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Provisioning progression — records which statuses actually arrived (no inference).
  const [received, setReceived] = useState<Set<ProvisioningStatus>>(new Set());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const controllerRef = useRef<ProvisionController | null>(null);

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
  }, []);

  const startScan = useCallback(async () => {
    stopScan();
    setScanError(null);
    setDevices([]);
    const granted = await requestPermissions();
    if (!granted) {
      setScanError('Bluetooth permission is required to find your device.');
      return;
    }
    stopScanRef.current = scanForDevices(
      (device) => {
        setDevices((prev) => (prev.some((d) => d.id === device.id) ? prev : [...prev, device]));
      },
      (message) => setScanError(message),
    );
  }, [stopScan]);

  // Kick off scanning when entering the scan step.
  useEffect(() => {
    if (step === 'scan') {
      void startScan();
    }
    return () => {
      if (step === 'scan') stopScan();
    };
  }, [step, startScan, stopScan]);

  // Cleanup on unmount: stop scanning and disconnect any active session.
  useEffect(() => {
    return () => {
      stopScanRef.current?.();
      void controllerRef.current?.cancel();
    };
  }, []);

  const handleSelectDevice = useCallback(
    (device: ScannedDevice) => {
      stopScan();
      setSelected(device);
      setStep('form');
    },
    [stopScan],
  );

  const startProvisioning = useCallback(async () => {
    if (!selected) return;

    // Fully tear down any prior session BEFORE touching new state, so a stale
    // notification from the old connection can't leak into this attempt.
    await controllerRef.current?.cancel();
    controllerRef.current = null;

    // Clean slate for THIS attempt — checklist starts from nothing.
    setReceived(new Set());
    setOutcome(null);
    setErrorMessage(null);
    setStep('provisioning');

    // Send only the field groups the user filled in; commit is always sent.
    const wifiPair = ssid.trim().length > 0 && password.length > 0;
    const creds = {
      wifiSsid: wifiPair ? ssid.trim() : undefined,
      wifiPassword: wifiPair ? password : undefined,
      mqttToken: token.trim().length > 0 ? token.trim() : undefined,
    };

    controllerRef.current = await connectAndProvision(
      selected.id,
      creds,
      (s) => {
        // Terminal failures are handled atomically via onError below.
        if (s === 'WIFI_FAILED' || s === 'MQTT_FAILED' || s === 'ERROR') return;
        // Record the actual message received — the checklist greens only from this.
        setReceived((prev) => {
          if (prev.has(s)) return prev;
          const next = new Set(prev);
          next.add(s);
          return next;
        });
        if (s === 'PROVISIONED') setOutcome('success');
      },
      (message, reason) => {
        setErrorMessage(message);
        setOutcome(reason);
      },
    );
  }, [selected, ssid, password, token]);

  const closeAndExit = useCallback(async () => {
    stopScan();
    await controllerRef.current?.cancel();
    controllerRef.current = null;
    router.back();
  }, [router, stopScan]);

  const retry = useCallback(async () => {
    await controllerRef.current?.cancel();
    controllerRef.current = null;
    setReceived(new Set());
    setOutcome(null);
    setErrorMessage(null);
    setStep('form'); // values retained
  }, []);

  // Send is enabled with a complete wifi pair, OR a token, OR both.
  const wifiPairFilled = ssid.trim().length > 0 && password.length > 0;
  const tokenFilled = token.trim().length > 0;
  const canSubmit = wifiPairFilled || tokenFilled;

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{ title: 'Add device', headerBackTitle: 'Devices', headerBackVisible: false }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {step === 'scan' ? (
          <ScanStep
            devices={devices}
            error={scanError}
            onSelect={handleSelectDevice}
            onRescan={startScan}
            onCancel={closeAndExit}
          />
        ) : step === 'form' ? (
          <FormStep
            deviceName={selected?.name ?? 'device'}
            ssid={ssid}
            password={password}
            token={token}
            showPassword={showPassword}
            canSubmit={canSubmit}
            onChangeSsid={setSsid}
            onChangePassword={setPassword}
            onChangeToken={setToken}
            onToggleShowPassword={() => setShowPassword((v) => !v)}
            onSubmit={startProvisioning}
            onCancel={closeAndExit}
          />
        ) : (
          <ProvisioningStep
            received={received}
            outcome={outcome}
            errorMessage={errorMessage}
            onCancel={closeAndExit}
            onDone={closeAndExit}
            onRetry={retry}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------- Step A: Scan ---------- */

function ScanStep({
  devices,
  error,
  onSelect,
  onRescan,
  onCancel,
}: {
  devices: ScannedDevice[];
  error: string | null;
  onSelect: (d: ScannedDevice) => void;
  onRescan: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Find your sensor</Text>
      <Text style={styles.subtitle}>
        Make sure the sensor is powered on and nearby. It will appear below.
      </Text>

      {error ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      ) : devices.length === 0 ? (
        <View style={styles.scanning}>
          <ActivityIndicator size="large" />
          <Text style={styles.subtitle}>Scanning…</Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {devices.map((d) => (
          <Pressable
            key={d.id}
            style={({ pressed }) => [styles.deviceRow, pressed && styles.pressed]}
            onPress={() => onSelect(d)}>
            <View style={styles.deviceRowInfo}>
              <Text style={styles.deviceRowName}>{d.name}</Text>
              <Text style={styles.deviceRowId}>{d.id}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.spacer} />

      <Pressable
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        onPress={onRescan}>
        <Text style={styles.secondaryButtonText}>Rescan</Text>
      </Pressable>
      <Pressable style={styles.linkButton} onPress={onCancel}>
        <Text style={styles.linkButtonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/* ---------- Step B: Credentials ---------- */

function FormStep({
  deviceName,
  ssid,
  password,
  token,
  showPassword,
  canSubmit,
  onChangeSsid,
  onChangePassword,
  onChangeToken,
  onToggleShowPassword,
  onSubmit,
  onCancel,
}: {
  deviceName: string;
  ssid: string;
  password: string;
  token: string;
  showPassword: boolean;
  canSubmit: boolean;
  onChangeSsid: (v: string) => void;
  onChangePassword: (v: string) => void;
  onChangeToken: (v: string) => void;
  onToggleShowPassword: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Wifi & server</Text>
      <Text style={styles.subtitle}>
        Sending settings to {deviceName}. Enter wifi, a token, or both.
      </Text>

      <View style={styles.form}>
        <Text style={styles.label}>Wifi name (SSID)</Text>
        <TextInput
          style={styles.input}
          value={ssid}
          onChangeText={onChangeSsid}
          placeholder="MyNetwork"
          placeholderTextColor="#9AA0A6"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Wifi password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            value={password}
            onChangeText={onChangePassword}
            placeholder="Password"
            placeholderTextColor="#9AA0A6"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable onPress={onToggleShowPassword} hitSlop={8}>
            <Text style={styles.showHide}>{showPassword ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={onChangeToken}
          placeholder="Device token"
          placeholderTextColor="#9AA0A6"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          !canSubmit && styles.primaryButtonDisabled,
          pressed && canSubmit && styles.pressed,
        ]}
        onPress={onSubmit}
        disabled={!canSubmit}>
        <Text style={styles.primaryButtonText}>Send to device</Text>
      </Pressable>
      <Pressable style={styles.linkButton} onPress={onCancel}>
        <Text style={styles.linkButtonText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

/* ---------- Step C/D: Provisioning checklist + merged result ---------- */

function ProvisioningStep({
  received,
  outcome,
  errorMessage,
  onCancel,
  onDone,
  onRetry,
}: {
  received: Set<ProvisioningStatus>;
  outcome: Outcome | null;
  errorMessage: string | null;
  onCancel: () => void;
  onDone: () => void;
  onRetry: () => void;
}) {
  const failed = outcome != null && outcome !== 'success';

  const failHeading =
    outcome === 'wifi_failed'
      ? 'Couldn’t connect to wifi'
      : outcome === 'mqtt_failed'
        ? 'Couldn’t reach the server'
        : 'Setup didn’t finish';

  const failDetail =
    outcome === 'wifi_failed'
      ? 'Check the network name and password and try again.'
      : outcome === 'mqtt_failed'
        ? 'The sensor joined wifi but couldn’t reach the server. Check the token and try again.'
        : errorMessage ?? 'Something went wrong. Please try again.';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Setting up your sensor</Text>

      <ProvisionChecklist received={received} outcome={outcome} />

      {outcome === 'success' ? (
        <View style={styles.footer}>
          <View style={[styles.resultBadge, { backgroundColor: '#E6F6EE' }]}>
            <Text style={[styles.resultBadgeMark, { color: SUCCESS }]}>✓</Text>
          </View>
          <Text style={styles.footerHeading}>Device is set up</Text>
          <Text style={styles.subtitle}>Your sensor is connected and reporting.</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={onDone}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </View>
      ) : failed ? (
        <View style={styles.footer}>
          <View style={[styles.resultBadge, { backgroundColor: '#FCE8EC' }]}>
            <Text style={[styles.resultBadgeMark, { color: FAILURE }]}>!</Text>
          </View>
          <Text style={styles.footerHeading}>{failHeading}</Text>
          <Text style={styles.subtitle}>{failDetail}</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={onRetry}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
          <Pressable style={styles.linkButton} onPress={onCancel}>
            <Text style={styles.linkButtonText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.footer}>
          <Text style={styles.subtitle}>This can take up to a minute.</Text>
          <Pressable style={styles.linkButton} onPress={onCancel}>
            <Text style={styles.linkButtonText}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6F8',
  },
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#60646C',
    textAlign: 'center',
  },
  scanning: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  banner: {
    backgroundColor: '#FCE8EC',
    borderRadius: 10,
    padding: 14,
  },
  bannerText: {
    color: '#B0182F',
    fontSize: 14,
  },
  list: {
    gap: 10,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    padding: 16,
  },
  deviceRowInfo: {
    gap: 2,
    flex: 1,
  },
  deviceRowName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
  deviceRowId: {
    fontSize: 12,
    color: '#9AA0A6',
  },
  chevron: {
    fontSize: 24,
    color: '#C0C4CA',
  },
  spacer: {
    flex: 1,
  },
  form: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#60646C',
    marginTop: 8,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#D5D8DC',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#000000',
    backgroundColor: '#ffffff',
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D5D8DC',
    borderRadius: 10,
    paddingRight: 14,
    backgroundColor: '#ffffff',
  },
  passwordInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#000000',
  },
  showHide: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '600',
  },
  // Checklist
  checklistCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    padding: 16,
    gap: 18,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDone: {
    backgroundColor: SUCCESS,
  },
  iconDoneMark: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  iconFailed: {
    backgroundColor: FAILURE,
  },
  iconFailedMark: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  iconPending: {
    borderWidth: 2,
    borderColor: '#D5D8DC',
  },
  checkLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  checkLabelDone: {
    color: SUCCESS,
  },
  checkLabelFailed: {
    color: FAILURE,
  },
  checkLabelPending: {
    color: '#9AA0A6',
    fontWeight: '500',
  },
  // Footer (result merged below the checklist)
  footer: {
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  footerHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
  },
  resultBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultBadgeMark: {
    fontSize: 32,
    fontWeight: '700',
  },
  primaryButton: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonText: {
    color: '#60646C',
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});
