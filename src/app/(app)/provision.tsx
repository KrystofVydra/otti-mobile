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

type Step = 'scan' | 'form' | 'progress' | 'result';
type Outcome = 'success' | 'wifi_failed' | 'mqtt_failed' | 'error';

/** Friendly progress label for a status update. */
function progressLabel(status: ProvisioningStatus | null): string {
  switch (status) {
    case 'RECEIVED':
      return 'Device received the settings…';
    case 'WIFI_CONNECTING':
      return 'Connecting to wifi…';
    case 'WIFI_OK':
      return 'Wifi connected…';
    case 'MQTT_CONNECTING':
      return 'Connecting to the server…';
    case 'PROVISIONED':
      return 'All set!';
    default:
      return 'Connecting to device…';
  }
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

  // Provisioning
  const [status, setStatus] = useState<ProvisioningStatus | null>(null);
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
        setDevices((prev) =>
          prev.some((d) => d.id === device.id) ? prev : [...prev, device],
        );
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
    setStatus(null);
    setOutcome(null);
    setErrorMessage(null);
    setStep('progress');

    // Tear down any previous session before starting a new one (retry case).
    await controllerRef.current?.cancel();
    controllerRef.current = null;

    controllerRef.current = await connectAndProvision(
      selected.id,
      { wifiSsid: ssid.trim(), wifiPassword: password, mqttToken: token.trim() },
      (s) => {
        setStatus(s);
        if (s === 'PROVISIONED') {
          setOutcome('success');
          setStep('result');
        }
      },
      (message) => {
        // Map the message back to an outcome where we can; default to generic error.
        setErrorMessage(message);
        setOutcome((prev) => prev ?? 'error');
        setStep('result');
      },
    );
  }, [selected, ssid, password, token]);

  // Refine the outcome for the result screen from the latest failure status.
  useEffect(() => {
    if (step !== 'result') return;
    if (status === 'WIFI_FAILED') setOutcome('wifi_failed');
    else if (status === 'MQTT_FAILED') setOutcome('mqtt_failed');
  }, [step, status]);

  const closeAndExit = useCallback(async () => {
    stopScan();
    await controllerRef.current?.cancel();
    controllerRef.current = null;
    router.back();
  }, [router, stopScan]);

  const retry = useCallback(async () => {
    await controllerRef.current?.cancel();
    controllerRef.current = null;
    setStatus(null);
    setOutcome(null);
    setErrorMessage(null);
    setStep('form'); // values retained
  }, []);

  const canSubmit = ssid.trim().length > 0 && password.length > 0 && token.trim().length > 0;

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
        ) : step === 'progress' ? (
          <ProgressStep label={progressLabel(status)} onCancel={closeAndExit} />
        ) : (
          <ResultStep
            outcome={outcome}
            errorMessage={errorMessage}
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
      <Text style={styles.subtitle}>Sending settings to {deviceName}.</Text>

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

        <Text style={styles.label}>MQTT token</Text>
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

/* ---------- Step C: Progress ---------- */

function ProgressStep({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" />
      <Text style={styles.progressLabel}>{label}</Text>
      <Text style={styles.subtitle}>This can take up to a minute.</Text>
      <View style={styles.spacer} />
      <Pressable style={styles.linkButton} onPress={onCancel}>
        <Text style={styles.linkButtonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/* ---------- Step D: Result ---------- */

function ResultStep({
  outcome,
  errorMessage,
  onDone,
  onRetry,
}: {
  outcome: Outcome | null;
  errorMessage: string | null;
  onDone: () => void;
  onRetry: () => void;
}) {
  if (outcome === 'success') {
    return (
      <View style={styles.centered}>
        <View style={[styles.resultBadge, { backgroundColor: '#E6F6EE' }]}>
          <Text style={[styles.resultBadgeMark, { color: '#1FA463' }]}>✓</Text>
        </View>
        <Text style={styles.title}>Device is set up</Text>
        <Text style={styles.subtitle}>Your sensor is connected and reporting.</Text>
        <View style={styles.spacer} />
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={onDone}>
          <Text style={styles.primaryButtonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const heading =
    outcome === 'wifi_failed'
      ? 'Couldn’t connect to wifi'
      : outcome === 'mqtt_failed'
        ? 'Couldn’t reach the server'
        : 'Setup didn’t finish';

  const detail =
    outcome === 'wifi_failed'
      ? 'Check the network name and password and try again.'
      : outcome === 'mqtt_failed'
        ? 'The sensor joined wifi but couldn’t reach the server. Check the MQTT token and try again.'
        : errorMessage ?? 'Something went wrong. Please try again.';

  return (
    <View style={styles.centered}>
      <View style={[styles.resultBadge, { backgroundColor: '#FCE8EC' }]}>
        <Text style={[styles.resultBadgeMark, { color: '#D7263D' }]}>!</Text>
      </View>
      <Text style={styles.title}>{heading}</Text>
      <Text style={styles.subtitle}>{detail}</Text>
      <View style={styles.spacer} />
      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        onPress={onRetry}>
        <Text style={styles.primaryButtonText}>Retry</Text>
      </Pressable>
      <Pressable style={styles.linkButton} onPress={onDone}>
        <Text style={styles.linkButtonText}>Cancel</Text>
      </Pressable>
    </View>
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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
  progressLabel: {
    fontSize: 18,
    fontWeight: '600',
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
