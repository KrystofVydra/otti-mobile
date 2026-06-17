import { Stack, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNotificationSettings, useUpdateNotificationSetting } from '@/lib/hooks';
import type { NotificationSettingEntry, NotificationSeverity } from '@/lib/types';

const ACCENT = '#208AEF';
const CRITICAL = '#D7263D';
const ALERT = '#E8833A';
const SECONDARY = '#60646C';
const MUTED = '#C0C4CA';

/** Human labels for known threshold keys; unknown keys are humanized. */
const THRESHOLD_LABELS: Record<string, string> = {
  low_pct: 'Low battery (%)',
  critical_pct: 'Critical battery (%)',
  offline_minutes: 'Offline after (min)',
  max_open_minutes: 'Door open for (min)',
  drift_c: 'Drift (°C)',
  drift_minutes: 'Over (min)',
  preferred_max: 'Preferred max (°C)',
  preferred_min: 'Preferred min (°C)',
  safe_max: 'Safe max (°C)',
  safe_min: 'Safe min (°C)',
};

const PERCENT_KEYS = new Set(['low_pct', 'critical_pct']);
const MINUTE_KEYS = new Set(['offline_minutes', 'max_open_minutes', 'drift_minutes']);
const TEMP_KEYS = new Set(['safe_max', 'safe_min', 'preferred_max', 'preferred_min', 'drift_c']);

function thresholdLabel(key: string): string {
  if (THRESHOLD_LABELS[key]) return THRESHOLD_LABELS[key];
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function severityColor(severity: NotificationSeverity): string {
  return severity === 'critical' ? CRITICAL : ALERT;
}

/** Validate a single threshold field. Returns an error message or null. */
function validateField(key: string, raw: string): string | null {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return 'Please enter a valid value';
  if (PERCENT_KEYS.has(key)) return n >= 0 && n <= 100 ? null : 'Must be 0–100';
  if (MINUTE_KEYS.has(key)) return n > 0 ? null : 'Must be greater than 0';
  if (TEMP_KEYS.has(key)) return n >= -99.99 && n <= 99.99 ? null : 'Must be between -99.99 and 99.99';
  return null; // unknown key: any finite number is acceptable
}

type WorkingEntry = { enabled: boolean; thresholds: Record<string, string> };
type WorkingState = Record<string, WorkingEntry>;

function stringifyThresholds(t: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(t)) out[k] = String(t[k]);
  return out;
}

function buildWorking(entries: NotificationSettingEntry[]): WorkingState {
  const out: WorkingState = {};
  for (const e of entries) {
    out[e.kind] = { enabled: e.enabled, thresholds: stringifyThresholds(e.thresholds) };
  }
  return out;
}

/** Per-kind validation (field rules + min<max cross-checks). Returns msg or null. */
function validateKind(entry: NotificationSettingEntry, w: WorkingEntry): string | null {
  const keys = Object.keys(entry.thresholds);
  if (keys.length === 0) return null; // toggle-only kinds are never invalid

  for (const key of keys) {
    const msg = validateField(key, w.thresholds[key] ?? '');
    if (msg) return msg;
  }

  // Cross-field: min must be below max for the two temperature-range kinds.
  if (entry.kind === 'temp_safe' || entry.kind === 'temp_preferred') {
    const minKey = entry.kind === 'temp_safe' ? 'safe_min' : 'preferred_min';
    const maxKey = entry.kind === 'temp_safe' ? 'safe_max' : 'preferred_max';
    const min = Number(w.thresholds[minKey]);
    const max = Number(w.thresholds[maxKey]);
    if (Number.isFinite(min) && Number.isFinite(max) && min >= max) {
      return 'Minimum must be below maximum';
    }
  }
  return null;
}

function isKindDirty(entry: NotificationSettingEntry, w: WorkingEntry): boolean {
  if (w.enabled !== entry.enabled) return true;
  return Object.keys(entry.thresholds).some((k) => w.thresholds[k] !== String(entry.thresholds[k]));
}

type SaveOutcome =
  | { kind: string; ok: true; updated: NotificationSettingEntry }
  | { kind: string; ok: false };

export default function NotificationSettingsScreen() {
  const { data, isLoading, isError, refetch } = useNotificationSettings();
  const update = useUpdateNotificationSetting();

  const [working, setWorking] = useState<WorkingState | null>(null);
  const [saving, setSaving] = useState(false);

  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<string, number>>({});
  // When the user confirms "Discard", we allow the next navigation through.
  const allowLeaveRef = useRef(false);

  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Initialize the local working copy once settings have loaded.
  useEffect(() => {
    if (data && working === null) {
      setWorking(buildWorking(data));
    }
  }, [data, working]);

  // Track keyboard height so the scroll content gets room to lift the focused
  // bottom field above the keyboard + its accessory bar.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) =>
      setKeyboardHeight(e.endCoordinates?.height ?? 0),
    );
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Scroll a focused field's card clear of the keyboard.
  const scrollCardIntoView = (kind: string) => {
    const y = cardOffsets.current[kind];
    if (y == null) return;
    // Defer so the keyboard inset + content padding settle before we scroll.
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }, 80);
  };

  const serverByKind = useMemo(() => {
    const map: Record<string, NotificationSettingEntry> = {};
    for (const e of data ?? []) map[e.kind] = e;
    return map;
  }, [data]);

  const errorsByKind = useMemo(() => {
    const map: Record<string, string | null> = {};
    if (!data || !working) return map;
    for (const entry of data) {
      const w = working[entry.kind];
      map[entry.kind] = w ? validateKind(entry, w) : null;
    }
    return map;
  }, [data, working]);

  const dirtyByKind = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (!data || !working) return map;
    for (const entry of data) {
      const w = working[entry.kind];
      map[entry.kind] = w ? isKindDirty(entry, w) : false;
    }
    return map;
  }, [data, working]);

  const anyDirty = Object.values(dirtyByKind).some(Boolean);
  const anyInvalid = Object.values(errorsByKind).some((e) => e != null);

  // Guard against losing unsaved edits on ANY exit (header back, swipe-back,
  // programmatic). Only the Save button saves — the dialog just discards/stays.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || !anyDirty) return; // nothing to guard
      e.preventDefault();
      Alert.alert('Unsaved changes', 'You have unsaved changes. Discard them?', [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            allowLeaveRef.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, anyDirty]);

  const setEnabled = (kind: string, next: boolean) =>
    setWorking((prev) =>
      prev ? { ...prev, [kind]: { ...prev[kind], enabled: next } } : prev,
    );

  const setThreshold = (kind: string, key: string, text: string) =>
    setWorking((prev) =>
      prev
        ? {
            ...prev,
            [kind]: { ...prev[kind], thresholds: { ...prev[kind].thresholds, [key]: text } },
          }
        : prev,
    );

  const scrollToFirstInvalid = () => {
    if (!data) return;
    const firstInvalid = data.find((e) => errorsByKind[e.kind] != null)?.kind;
    if (firstInvalid != null) {
      const y = cardOffsets.current[firstInvalid] ?? 0;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }
  };

  const handleSave = async () => {
    if (!data || !working || saving) return;
    if (anyInvalid) {
      scrollToFirstInvalid();
      return;
    }
    if (!anyDirty) return;

    const dirtyKinds = data.filter((e) => dirtyByKind[e.kind]).map((e) => e.kind);
    setSaving(true);

    const outcomes = await Promise.all(
      dirtyKinds.map((kind): Promise<SaveOutcome> => {
        const entry = serverByKind[kind];
        const w = working[kind];
        const body: { enabled?: boolean; thresholds?: Record<string, number> } = {};
        if (w.enabled !== entry.enabled) body.enabled = w.enabled;
        const thresholdsChanged = Object.keys(entry.thresholds).some(
          (k) => w.thresholds[k] !== String(entry.thresholds[k]),
        );
        if (thresholdsChanged) {
          const thresholds: Record<string, number> = {};
          for (const k of Object.keys(entry.thresholds)) thresholds[k] = Number(w.thresholds[k]);
          body.thresholds = thresholds;
        }
        return update
          .mutateAsync({ kind, body })
          .then((updated) => ({ kind, ok: true as const, updated }))
          .catch(() => ({ kind, ok: false as const }));
      }),
    );

    // Sync the working copy for every kind that saved (clears its dirty state).
    setWorking((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const o of outcomes) {
        if (o.ok) {
          next[o.kind] = {
            enabled: o.updated.enabled,
            thresholds: stringifyThresholds(o.updated.thresholds),
          };
        }
      }
      return next;
    });

    setSaving(false);

    if (outcomes.some((o) => !o.ok)) {
      Alert.alert('Couldn’t save', 'Error saving notifications, try again later.');
    } else {
      Alert.alert('Saved', 'All saved successfully');
    }
  };

  if (isError || (!isLoading && !data)) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Notification settings', headerBackTitle: 'Settings' }} />
        <View style={styles.centered}>
          <Text style={styles.stateTitle}>Couldn’t load settings</Text>
          <Text style={styles.stateSubtitle}>Check your connection and try again.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading || !working || !data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Notification settings', headerBackTitle: 'Settings' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // Save button mode.
  const mode: 'saving' | 'invalid' | 'disabled' | 'save' = saving
    ? 'saving'
    : anyInvalid
      ? 'invalid'
      : !anyDirty
        ? 'disabled'
        : 'save';

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Notification settings', headerBackTitle: 'Settings' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingBottom: 24 + keyboardHeight }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {data.map((entry) => {
            const w = working[entry.kind];
            const thresholdKeys = Object.keys(entry.thresholds);
            const error = errorsByKind[entry.kind];

            return (
              <View
                key={entry.kind}
                style={[styles.card, error ? styles.cardInvalid : null]}
                onLayout={(e) => {
                  cardOffsets.current[entry.kind] = e.nativeEvent.layout.y;
                }}>
                <View style={styles.cardTop}>
                  <View style={styles.cardInfo}>
                    <View style={styles.titleRow}>
                      <View
                        style={[
                          styles.severityDot,
                          { backgroundColor: severityColor(entry.severity) },
                        ]}
                      />
                      <Text style={styles.title}>{entry.description}</Text>
                    </View>
                    <Text style={styles.scope}>{entry.scope}</Text>
                  </View>
                  <Switch
                    value={w.enabled}
                    onValueChange={(next) => setEnabled(entry.kind, next)}
                    trackColor={{ true: ACCENT, false: '#D5D8DC' }}
                    ios_backgroundColor="#D5D8DC"
                  />
                </View>

                {thresholdKeys.length > 0 ? (
                  <View style={styles.thresholds}>
                    {thresholdKeys.map((key) => (
                      <View key={key} style={styles.thresholdRow}>
                        <Text style={styles.thresholdLabel}>{thresholdLabel(key)}</Text>
                        <TextInput
                          style={styles.thresholdInput}
                          value={w.thresholds[key]}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          selectTextOnFocus
                          onFocus={() => scrollCardIntoView(entry.kind)}
                          onChangeText={(text) => setThreshold(entry.kind, key, text)}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}

                {error ? <Text style={styles.warning}>{error}</Text> : null}
              </View>
            );
          })}
        </ScrollView>

        {/* Sticky save footer */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              mode === 'invalid' && styles.saveButtonInvalid,
              mode === 'disabled' && styles.saveButtonDisabled,
              pressed && mode !== 'disabled' && styles.pressed,
            ]}
            disabled={mode === 'disabled' || mode === 'saving'}
            onPress={handleSave}>
            {mode === 'saving' ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>
                {mode === 'invalid' ? 'Check values' : 'Save'}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6F8',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    padding: 16,
    gap: 12,
  },
  cardInvalid: {
    borderColor: ALERT,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  title: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  scope: {
    fontSize: 13,
    color: SECONDARY,
    marginLeft: 16,
  },
  thresholds: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F1F3',
    paddingTop: 12,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  thresholdLabel: {
    flex: 1,
    fontSize: 14,
    color: '#000000',
  },
  thresholdInput: {
    width: 96,
    height: 40,
    borderWidth: 1,
    borderColor: '#D5D8DC',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#000000',
    backgroundColor: '#ffffff',
    textAlign: 'right',
  },
  warning: {
    fontSize: 13,
    fontWeight: '600',
    color: ALERT,
  },
  footer: {
    padding: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#ECEDEF',
    backgroundColor: '#F5F6F8',
  },
  saveButton: {
    height: 50,
    borderRadius: 10,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonInvalid: {
    backgroundColor: ALERT,
  },
  saveButtonDisabled: {
    backgroundColor: MUTED,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
  },
  stateSubtitle: {
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 28,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});
