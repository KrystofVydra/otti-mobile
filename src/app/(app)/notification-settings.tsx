import { Stack, useNavigation } from 'expo-router';
// usePreventRemove is the native-stack-correct unsaved-changes guard. Expo Router
// (SDK 56) vendors React Navigation internally — @react-navigation/native is NOT
// an installed package here — so we import the hook from the vendored core
// (no new dependency).
import { usePreventRemove } from 'expo-router/build/react-navigation/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNotificationSettings, useUpdateNotificationSetting } from '@/lib/hooks';
import type { NotificationSettingEntry, NotificationSeverity } from '@/lib/types';

const ACCENT = '#208AEF';
const CRITICAL = '#D7263D';
const ALERT = '#E8833A';
// Approximates the iOS keyboard curve (RN has no Easing.keyboard).
const KEYBOARD_EASING = Easing.out(Easing.ease);
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
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const cardOffsets = useRef<Record<string, number>>({});
  const scrollY = useRef(0); // live scroll offset (from onScroll)
  const restoreY = useRef(0); // scroll offset captured at the start of editing
  const keyboardVisibleRef = useRef(false); // synchronous read inside onFocus
  const dismissedByDragRef = useRef(false); // did this dismiss come from a scroll-drag?

  // ONE keyboard-synced value (current keyboard height; 0 when hidden) drives
  // the content bottom spacer (so fields can scroll above the keyboard) in
  // lockstep with the keyboard — no competing animators on different clocks.
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  // Hide the Save footer while editing (keyboard up); show it when keyboard down.
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Bottom spacer height: the keyboard height PLUS most of a screen of trailing
  // room (only while the keyboard is up), so even the LAST card can be scrolled
  // to the top of the keyboard-shrunk viewport. Driven by keyboardOffset.
  const spacerHeight = useMemo(
    () =>
      Animated.add(
        keyboardOffset,
        keyboardOffset.interpolate({
          inputRange: [0, 1],
          outputRange: [0, windowHeight],
          extrapolate: 'clamp',
        }),
      ),
    [keyboardOffset, windowHeight],
  );

  // Initialize the local working copy once settings have loaded.
  useEffect(() => {
    if (data && working === null) {
      setWorking(buildWorking(data));
    }
  }, [data, working]);

  // Animate keyboardOffset with a SINGLE timing per keyboard event, matched to
  // the keyboard's own duration + easing. On iOS use the *Will* events (they
  // fire before the keyboard moves and carry the duration). On hide, also ease
  // the scroll back to the pre-edit position so it returns in sync.
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const showEvt = ios ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = ios ? 'keyboardWillHide' : 'keyboardDidHide';

    const animateTo = (toValue: number, duration?: number) => {
      Animated.timing(keyboardOffset, {
        toValue,
        duration: duration && duration > 0 ? duration : 250,
        easing: KEYBOARD_EASING,
        useNativeDriver: false, // animating layout (height) — JS driver required
      }).start();
    };

    const showSub = Keyboard.addListener(showEvt, (e) => {
      keyboardVisibleRef.current = true;
      setKeyboardVisible(true);
      // Fresh editing session — a stray drag before the keyboard came up must
      // not suppress the restore on this dismiss.
      dismissedByDragRef.current = false;
      animateTo(e.endCoordinates?.height ?? 0, e.duration);
    });
    const hideSub = Keyboard.addListener(hideEvt, (e) => {
      keyboardVisibleRef.current = false;
      setKeyboardVisible(false);
      animateTo(0, e.duration);

      // Only restore for Done / tap-outside dismissals. A drag-dismiss means the
      // user deliberately scrolled somewhere — yanking them back would be jarring.
      if (dismissedByDragRef.current) {
        dismissedByDragRef.current = false;
        return;
      }

      // Defer the restore until AFTER the bottom spacer has collapsed (content
      // back to its keyboard-down height). Restoring mid-collapse applies an
      // offset that's out of range for the shrinking content, so bottom tiles
      // over-scroll to the very top. Waiting for the collapse means restoreY —
      // captured while the keyboard was down — is valid for the final layout.
      const delay = (e.duration && e.duration > 0 ? e.duration : 250) + 30;
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: restoreY.current, animated: true });
      }, delay);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffset]);

  // On focus: remember the pre-edit scroll position (only on the first focus that
  // raises the keyboard, not when switching fields), then pin the card to the top.
  const handleFieldFocus = (kind: string) => {
    if (!keyboardVisibleRef.current) {
      restoreY.current = scrollY.current;
    }
    const y = cardOffsets.current[kind];
    if (y == null) return;
    // Defer so the spacer/keyboard layout settles before we scroll the card up.
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
  // programmatic). usePreventRemove is native-stack-correct: it blocks the
  // removal BEFORE it happens (no "leave then popup" / native-JS desync).
  // Only the Save button saves — the dialog just discards or stays.
  usePreventRemove(anyDirty, ({ data }) => {
    Alert.alert('Unsaved changes', 'You have unsaved changes. Discard them?', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

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
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // dismissMode "none" + manual dismiss on drag start routes scroll-to-
        // dismiss through keyboardWillHide → the SAME single Animated timing as
        // Done/tap-away, so every dismiss route stays in lockstep.
        keyboardDismissMode="none"
        onScrollBeginDrag={() => {
          // Mark this as a drag-dismiss (only if the keyboard is actually up) so
          // keyboardWillHide skips the scroll-restore and leaves the user where
          // they dragged to.
          if (keyboardVisibleRef.current) dismissedByDragRef.current = true;
          Keyboard.dismiss();
        }}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}>
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
                          onFocus={() => handleFieldFocus(entry.kind)}
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

          {/* Animated spacer: trailing scroll room (keyboard height + a screen),
              so even the last card can scroll to the top while editing. Driven
              by the same keyboardOffset, so it grows/shrinks with the keyboard. */}
          <Animated.View style={{ height: spacerHeight }} />
        </ScrollView>

        {/* Save footer — hidden while the keyboard is up (editing), shown when
            the keyboard is down. No animated lift needed since it's not on
            screen during editing. */}
        {keyboardVisible ? null : (
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
        )}
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
