import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatLastSeen, isOnline } from '@/lib/deviceStatus';
import { useControllers } from '@/lib/hooks';
import type { ControllerLatest, ControllerListEntry } from '@/lib/types';

const ACCENT = '#208AEF';
const ONLINE = '#1FA463';
const OFFLINE_DOT = '#9AA0A6';
const SECONDARY = '#60646C';
const FAILURE = '#D7263D';
const WARNING = '#E8833A';
const WARNING_BG = '#FBEFE2';
const WARNING_TEXT = '#B86B1E';
const ERROR_BG = '#FCE8EC';

// Battery percentage thresholds (web app parity): < critical = red, < low = orange.
const BATTERY_CRITICAL_PCT = 20;
const BATTERY_LOW_PCT = 50;

/** Averaged temperature, 1 decimal + °C. "—" when no telemetry / no temp yet. */
function formatTemperature(latest: ControllerLatest | null): string {
  if (!latest || latest.temperature_avg == null) return '—';
  return `${latest.temperature_avg.toFixed(1)}°C`;
}

/** Battery color by the web app's thresholds: <20 red, <50 orange, else neutral. */
function batteryColor(pct: number): string {
  if (pct < BATTERY_CRITICAL_PCT) return FAILURE;
  if (pct < BATTERY_LOW_PCT) return WARNING;
  return SECONDARY;
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: online ? ONLINE : OFFLINE_DOT }]} />
      <Text style={[styles.pillText, { color: online ? ONLINE : SECONDARY }]}>
        {online ? 'Online' : 'Offline'}
      </Text>
    </View>
  );
}

function ControllerCard({
  entry,
  onPress,
}: {
  entry: ControllerListEntry;
  onPress: () => void;
}) {
  const { name, location, node_count, last_seen_at, latest } = entry;
  const online = isOnline(last_seen_at);
  const batteryPct = latest?.battery_pct ?? null;
  const doorOpen = latest?.door_open === true;
  const anyError = latest?.any_node_error === true;
  const hasBadges = batteryPct != null || doorOpen || anyError;
  const nodeLabel = `${node_count} ${node_count === 1 ? 'node' : 'nodes'}`;
  // "Updated" text is driven by the READING timestamp (latest.time), NOT the
  // controller's last_seen_at. A null latest (never reported) → "No readings yet".
  const updatedText = latest ? `Updated ${formatLastSeen(latest.time)}` : 'No readings yet';

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}>
      <View style={styles.cardTop}>
        <View style={styles.cardInfo}>
          <Text style={styles.controllerName} numberOfLines={1}>
            {name}
          </Text>
          {location ? (
            <Text style={styles.location} numberOfLines={1}>
              {location}
            </Text>
          ) : null}
        </View>
        <Text style={styles.temperature}>{formatTemperature(latest)}</Text>
      </View>

      {hasBadges ? (
        <View style={styles.badgeRow}>
          {batteryPct != null ? (
            <View style={styles.battery}>
              <Text style={styles.batteryIcon}>🔋</Text>
              <Text style={[styles.batteryText, { color: batteryColor(batteryPct) }]}>
                {batteryPct}%
              </Text>
            </View>
          ) : null}
          {doorOpen ? (
            <View style={[styles.chip, styles.chipWarning]}>
              <Text style={[styles.chipText, styles.chipWarningText]}>Door open</Text>
            </View>
          ) : null}
          {anyError ? (
            <View style={[styles.chip, styles.chipError]}>
              <Text style={[styles.chipText, styles.chipErrorText]}>⚠ Sensor issue</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.cardBottom}>
        <StatusPill online={online} />
        <Text style={styles.lastSeen}>
          {nodeLabel} · {updatedText}
        </Text>
      </View>
    </Pressable>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useControllers();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.stateTitle}>Couldn’t load controllers</Text>
          <Text style={styles.stateSubtitle}>Check your connection and try again.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.cardPressed]}
            onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Controllers</Text>
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.cardPressed]}
              onPress={() => router.push('/provision')}>
              <Text style={styles.addButtonText}>+ Add device</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <ControllerCard
            entry={item}
            onPress={() =>
              router.push({ pathname: '/device/[id]', params: { id: String(item.id) } })
            }
          />
        )}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.stateTitle}>No controllers yet</Text>
            <Text style={styles.stateSubtitle}>
              Add a device to start monitoring your fridges and freezers here.
            </Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6F8',
  },
  centered: {
    flexGrow: 1,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  listContent: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
  },
  addButton: {
    backgroundColor: ACCENT,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    gap: 14,
    // subtle shadow
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  controllerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  location: {
    fontSize: 14,
    color: SECONDARY,
  },
  temperature: {
    fontSize: 26,
    fontWeight: '700',
    color: ACCENT,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  battery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  batteryIcon: {
    fontSize: 13,
  },
  batteryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chipWarning: {
    backgroundColor: WARNING_BG,
  },
  chipWarningText: {
    color: WARNING_TEXT,
  },
  chipError: {
    backgroundColor: ERROR_BG,
  },
  chipErrorText: {
    color: FAILURE,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  lastSeen: {
    fontSize: 13,
    color: SECONDARY,
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
});
