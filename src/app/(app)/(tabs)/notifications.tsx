import { useRouter } from 'expo-router';
import { useState } from 'react';
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
import { useQueryClient } from '@tanstack/react-query';

import { formatLastSeen } from '@/lib/deviceStatus';
import { useMarkAllRead, useMarkRead, useNotifications } from '@/lib/hooks';
import {
  isTestNotification,
  type AppNotification,
  type NotificationSeverity,
  type NotificationStatus,
} from '@/lib/types';

const ACCENT = '#208AEF';
const CRITICAL = '#D7263D';
const ALERT = '#E8833A';
const SECONDARY = '#60646C';
const UNREAD_TINT = '#EAF3FE';

const FILTERS: { key: NotificationStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'all', label: 'All' },
  { key: 'resolved', label: 'Resolved' },
];

function severityColor(severity: NotificationSeverity): string {
  return severity === 'critical' ? CRITICAL : ALERT;
}

function emptyText(status: NotificationStatus): { title: string; subtitle: string } {
  switch (status) {
    case 'active':
      return { title: 'No active notifications', subtitle: 'You’re all caught up.' };
    case 'resolved':
      return { title: 'No resolved notifications', subtitle: 'Resolved alerts will show here.' };
    default:
      return { title: 'No notifications', subtitle: 'Nothing here yet.' };
  }
}

function FilterBar({
  value,
  onChange,
}: {
  value: NotificationStatus;
  onChange: (s: NotificationStatus) => void;
}) {
  return (
    <View style={styles.segment}>
      {FILTERS.map((f) => {
        const selected = f.key === value;
        return (
          <Pressable
            key={f.key}
            onPress={() => onChange(f.key)}
            style={[styles.segmentItem, selected && styles.segmentItemSelected]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {f.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NotificationRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (n: AppNotification) => void;
}) {
  const unread = item.read_at == null;
  const resolved = item.resolved_at != null;
  const isTest = isTestNotification(item);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        unread && styles.rowUnread,
        pressed && styles.rowPressed,
      ]}
      onPress={() => onPress(item)}>
      <View style={[styles.severityBar, { backgroundColor: severityColor(item.severity) }]} />
      <View style={styles.rowBody}>
        <View style={styles.titleLine}>
          {unread ? <View style={styles.unreadDot} /> : null}
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {item.subject_name}
          </Text>
        </View>
        <Text style={styles.summary}>{item.summary}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.time}>{formatLastSeen(item.opened_at)}</Text>
          {isTest ? (
            <View style={styles.testBadge}>
              <Text style={styles.testBadgeText}>TEST</Text>
            </View>
          ) : null}
          {resolved ? <Text style={styles.resolved}>Resolved</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<NotificationStatus>('active');

  const { data, isLoading, isError, refetch, isRefetching } = useNotifications(status);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  const handlePressRow = (n: AppNotification) => {
    // Marking read also dismisses the unread state even when we don't navigate.
    if (n.read_at == null) {
      markRead.mutate(n.id);
    }
    if (n.controller_id != null) {
      router.push({ pathname: '/controller/[id]', params: { id: String(n.controller_id) } });
    }
  };

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['unreadCount'] });
  };

  const header = (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Notifications</Text>
        {unread > 0 ? (
          <Pressable
            style={({ pressed }) => [
              styles.markAllButton,
              (pressed || markAllRead.isPending) && styles.markAllPressed,
            ]}
            disabled={markAllRead.isPending}
            onPress={() => markAllRead.mutate()}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>
      <FilterBar value={status} onChange={setStatus} />
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.headerPad}>{header}</View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.headerPad}>{header}</View>
        <View style={styles.centered}>
          <Text style={styles.stateTitle}>Couldn’t load notifications</Text>
          <Text style={styles.stateSubtitle}>Check your connection and try again.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.rowPressed]}
            onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const empty = emptyText(status);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        renderItem={({ item }) => <NotificationRow item={item} onPress={handlePressRow} />}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.stateTitle}>{empty.title}</Text>
            <Text style={styles.stateSubtitle}>{empty.subtitle}</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6F8',
  },
  listContent: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  headerPad: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  centered: {
    flexGrow: 1,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
  },
  markAllButton: {
    backgroundColor: ACCENT,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  markAllPressed: {
    opacity: 0.6,
  },
  markAllText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Filter segmented control
  segment: {
    flexDirection: 'row',
    backgroundColor: '#E9EBEE',
    borderRadius: 10,
    padding: 3,
    gap: 3,
    marginBottom: 6,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentItemSelected: {
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: SECONDARY,
  },
  segmentTextSelected: {
    color: '#000000',
  },
  // Notification row
  row: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    overflow: 'hidden',
  },
  rowUnread: {
    backgroundColor: UNREAD_TINT,
    borderColor: '#D6E6FB',
  },
  rowPressed: {
    opacity: 0.85,
  },
  severityBar: {
    width: 4,
  },
  rowBody: {
    flex: 1,
    padding: 14,
    gap: 5,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  title: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  titleUnread: {
    fontWeight: '700',
  },
  summary: {
    fontSize: 14,
    color: SECONDARY,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  time: {
    fontSize: 12,
    color: '#9AA0A6',
  },
  testBadge: {
    borderWidth: 1,
    borderColor: '#C0C4CA',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  testBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: SECONDARY,
    letterSpacing: 0.5,
  },
  resolved: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9AA0A6',
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
