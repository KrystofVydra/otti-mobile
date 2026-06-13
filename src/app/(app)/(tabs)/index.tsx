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
import { useDevices } from '@/lib/hooks';
import type { DeviceListEntry } from '@/lib/types';

function formatTemperature(entry: DeviceListEntry): string {
  if (!entry.latest) return '—';
  return `${entry.latest.temperature.toFixed(1)}°C`;
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: online ? '#1FA463' : '#9AA0A6' }]} />
      <Text style={[styles.pillText, { color: online ? '#1FA463' : '#60646C' }]}>
        {online ? 'Online' : 'Offline'}
      </Text>
    </View>
  );
}

function DeviceCard({ entry, onPress }: { entry: DeviceListEntry; onPress: () => void }) {
  const { device, latest } = entry;
  const online = isOnline(device.last_seen_at);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}>
      <View style={styles.cardTop}>
        <View style={styles.cardInfo}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {device.name}
          </Text>
          <Text style={styles.deviceLocation} numberOfLines={1}>
            {device.location}
          </Text>
        </View>
        <Text style={styles.temperature}>{formatTemperature(entry)}</Text>
      </View>

      <View style={styles.cardBottom}>
        <StatusPill online={online} />
        <Text style={styles.lastSeen}>
          {latest ? formatLastSeen(device.last_seen_at) : 'No data'}
        </Text>
      </View>
    </Pressable>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useDevices();

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
          <Text style={styles.stateTitle}>Couldn’t load devices</Text>
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
        keyExtractor={(item) => String(item.device.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Devices</Text>
            <Pressable
              style={({ pressed }) => [styles.addButton, pressed && styles.cardPressed]}
              onPress={() => router.push('/provision')}>
              <Text style={styles.addButtonText}>+ Add device</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <DeviceCard
            entry={item}
            onPress={() =>
              router.push({ pathname: '/device/[id]', params: { id: String(item.device.id) } })
            }
          />
        )}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.stateTitle}>No devices yet</Text>
            <Text style={styles.stateSubtitle}>
              Devices you add will appear here with their latest temperature.
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
    backgroundColor: '#208AEF',
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
  deviceName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  deviceLocation: {
    fontSize: 14,
    color: '#60646C',
  },
  temperature: {
    fontSize: 26,
    fontWeight: '700',
    color: '#208AEF',
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
    color: '#60646C',
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
  },
  stateSubtitle: {
    fontSize: 14,
    color: '#60646C',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 28,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
