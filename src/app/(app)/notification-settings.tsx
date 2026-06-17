import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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

function thresholdLabel(key: string): string {
  if (THRESHOLD_LABELS[key]) return THRESHOLD_LABELS[key];
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function severityColor(severity: NotificationSeverity): string {
  return severity === 'critical' ? CRITICAL : ALERT;
}

export default function NotificationSettingsScreen() {
  const { data, isLoading, isError, refetch } = useNotificationSettings();
  const update = useUpdateNotificationSetting();

  // Per-field in-progress edit text, keyed `${kind}:${key}`. Absent → show saved.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  // Per-kind inline error message after a failed save.
  const [errorByKind, setErrorByKind] = useState<Record<string, string | null>>({});

  const setError = (kind: string, message: string | null) =>
    setErrorByKind((m) => ({ ...m, [kind]: message }));

  const clearField = (fieldKey: string) =>
    setFieldValues((m) => {
      const next = { ...m };
      delete next[fieldKey];
      return next;
    });

  const onToggle = (entry: NotificationSettingEntry, next: boolean) => {
    setError(entry.kind, null);
    update.mutate(
      { kind: entry.kind, body: { enabled: next } },
      { onError: () => setError(entry.kind, 'Couldn’t save. Try again.') },
    );
  };

  const onThresholdBlur = (entry: NotificationSettingEntry, key: string) => {
    const fieldKey = `${entry.kind}:${key}`;
    const raw = fieldValues[fieldKey];
    if (raw === undefined) return; // not edited

    const parsed = Number(raw);
    const current = entry.thresholds[key];

    // Empty / invalid → revert to the saved value, no PATCH.
    if (raw.trim() === '' || !Number.isFinite(parsed)) {
      clearField(fieldKey);
      return;
    }
    // Unchanged → just drop the override.
    if (parsed === current) {
      clearField(fieldKey);
      return;
    }

    // Send the COMPLETE thresholds object for this kind with this key updated.
    const thresholds = { ...entry.thresholds, [key]: parsed };
    setError(entry.kind, null);
    update.mutate(
      { kind: entry.kind, body: { thresholds } },
      {
        onError: () => setError(entry.kind, 'Couldn’t save. Try again.'),
        // Resync to cache (server value on success / rolled-back value on error).
        onSettled: () => clearField(fieldKey),
      },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Notification settings', headerBackTitle: 'Settings' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !data) {
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Notification settings', headerBackTitle: 'Settings' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {data.map((entry) => {
          const thresholdKeys = Object.keys(entry.thresholds);
          const error = errorByKind[entry.kind];

          return (
            <View key={entry.kind} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardInfo}>
                  <View style={styles.titleRow}>
                    <View
                      style={[styles.severityDot, { backgroundColor: severityColor(entry.severity) }]}
                    />
                    <Text style={styles.title}>{entry.description}</Text>
                  </View>
                  <Text style={styles.scope}>{entry.scope}</Text>
                </View>
                <Switch
                  value={entry.enabled}
                  onValueChange={(next) => onToggle(entry, next)}
                  trackColor={{ true: ACCENT, false: '#D5D8DC' }}
                  ios_backgroundColor="#D5D8DC"
                />
              </View>

              {thresholdKeys.length > 0 ? (
                <View style={styles.thresholds}>
                  {thresholdKeys.map((key) => {
                    const fieldKey = `${entry.kind}:${key}`;
                    const value = fieldValues[fieldKey] ?? String(entry.thresholds[key]);
                    return (
                      <View key={key} style={styles.thresholdRow}>
                        <Text style={styles.thresholdLabel}>{thresholdLabel(key)}</Text>
                        <TextInput
                          style={styles.thresholdInput}
                          value={value}
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          selectTextOnFocus
                          onChangeText={(text) =>
                            setFieldValues((m) => ({ ...m, [fieldKey]: text }))
                          }
                          onBlur={() => onThresholdBlur(entry, key)}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  error: {
    fontSize: 13,
    color: CRITICAL,
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
