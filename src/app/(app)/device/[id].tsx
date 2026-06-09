import { Circle, matchFont } from '@shopify/react-native-skia';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { CartesianChart, Line, useChartPressState } from 'victory-native';

import { formatLastSeen, isOnline } from '@/lib/deviceStatus';
import { useDevices, useReadings } from '@/lib/hooks';
import { DEFAULT_RANGE, RANGES, type RangeKey } from '@/lib/ranges';

const ACCENT = '#208AEF';

// A Skia font is required for axis labels. matchFont uses a system font, so we
// don't need to bundle a .ttf.
const axisFont = matchFont({
  fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
  fontSize: 11,
});

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** Format an x-axis tick (epoch ms) readably for the selected range. */
function formatXLabel(ms: number, range: RangeKey): string {
  const d = new Date(ms);
  // Multi-day ranges: European day.month. (e.g. "24.5.")
  if (range === '7d' || range === '30d') {
    return `${d.getDate()}.${d.getMonth() + 1}.`;
  }
  // Short ranges: time of day.
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Tooltip timestamp: "DD.MM. HH:MM" (e.g. "24.5. 14:00"). */
function formatTooltipTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}. ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

function RangeSelector({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
}) {
  return (
    <View style={styles.segment}>
      {RANGES.map((r) => {
        const selected = r.key === value;
        return (
          <Pressable
            key={r.key}
            onPress={() => onChange(r.key)}
            style={[styles.segmentItem, selected && styles.segmentItemSelected]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {r.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const deviceId = Number(id);

  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);

  // Read the device from the cached devices list — no extra single-device fetch.
  const { data: devices } = useDevices();
  const entry = devices?.find((d) => d.device.id === deviceId);
  const device = entry?.device;
  const latest = entry?.latest ?? null;
  const deviceName = device?.name ?? 'Device';

  const { data: readings, isLoading, isError, refetch, isFetching } = useReadings(deviceId, range);

  // Map readings → chart points (epoch ms + temperature), guard NaN, sort by time.
  const chartData = useMemo(() => {
    return (readings ?? [])
      .map((r) => ({ time: new Date(r.time).getTime(), temperature: r.temperature }))
      .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.temperature))
      .sort((a, b) => a.time - b.time);
  }, [readings]);

  // Touch interaction: marker dot follows the finger via shared values (UI thread),
  // and we mirror the matched data-point index into React state for the readout.
  const { state, isActive } = useChartPressState({ x: 0, y: { temperature: 0 } });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useAnimatedReaction(
    () => state.matchedIndex.value,
    (idx) => {
      runOnJS(setActiveIndex)(idx);
    },
  );

  const activePoint =
    isActive && activeIndex != null && activeIndex >= 0 && activeIndex < chartData.length
      ? chartData[activeIndex]
      : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: deviceName, headerBackTitle: 'Devices' }} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          {device?.location ? <Text style={styles.location}>{device.location}</Text> : null}
          <Text style={styles.currentTemp}>
            {latest ? `${latest.temperature.toFixed(1)}°C` : '—'}
          </Text>
          <View style={styles.statusRow}>
            <StatusPill online={isOnline(device?.last_seen_at ?? null)} />
            <Text style={styles.lastSeen}>{formatLastSeen(device?.last_seen_at ?? null)}</Text>
          </View>
        </View>

        {/* Range selector */}
        <RangeSelector value={range} onChange={setRange} />

        {/* Chart */}
        <View style={styles.chartCard}>
          {isLoading ? (
            <View style={styles.chartState}>
              <ActivityIndicator size="large" />
            </View>
          ) : isError ? (
            <View style={styles.chartState}>
              <Text style={styles.stateTitle}>Couldn’t load readings</Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                onPress={() => refetch()}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : chartData.length === 0 ? (
            <View style={styles.chartState}>
              <Text style={styles.stateTitle}>No data for this range</Text>
              <Text style={styles.stateSubtitle}>Try a different time range.</Text>
            </View>
          ) : (
            <View style={styles.chart}>
              <CartesianChart
                data={chartData}
                xKey="time"
                yKeys={['temperature']}
                chartPressState={state}
                domainPadding={{ top: 24, bottom: 24, left: 8, right: 8 }}
                axisOptions={{
                  font: axisFont,
                  lineColor: '#E2E4E8',
                  labelColor: '#60646C',
                  formatXLabel: (v) => formatXLabel(v, range),
                  formatYLabel: (v) => `${v.toFixed(1)}°`,
                }}>
                {({ points }) => (
                  <>
                    <Line points={points.temperature} color={ACCENT} strokeWidth={2} />
                    {isActive ? (
                      <>
                        <Circle
                          cx={state.x.position}
                          cy={state.y.temperature.position}
                          r={8}
                          color={ACCENT}
                          opacity={0.16}
                        />
                        <Circle
                          cx={state.x.position}
                          cy={state.y.temperature.position}
                          r={4.5}
                          color={ACCENT}
                        />
                        <Circle
                          cx={state.x.position}
                          cy={state.y.temperature.position}
                          r={2}
                          color="#ffffff"
                        />
                      </>
                    ) : null}
                  </>
                )}
              </CartesianChart>

              {/* Touch readout (nearest data point) */}
              {activePoint ? (
                <View style={styles.readout} pointerEvents="none">
                  <Text style={styles.readoutTemp}>{activePoint.temperature.toFixed(1)}°C</Text>
                  <Text style={styles.readoutTime}>{formatTooltipTime(activePoint.time)}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {isFetching && !isLoading ? <Text style={styles.updating}>Updating…</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6F8',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  header: {
    gap: 6,
  },
  location: {
    fontSize: 15,
    color: '#60646C',
  },
  currentTemp: {
    fontSize: 40,
    fontWeight: '700',
    color: '#000000',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  segment: {
    flexDirection: 'row',
    backgroundColor: '#E9EBEE',
    borderRadius: 10,
    padding: 3,
    gap: 3,
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
    color: '#60646C',
  },
  segmentTextSelected: {
    color: '#000000',
  },
  chartCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    padding: 12,
  },
  chart: {
    height: 280,
  },
  readout: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E2E4E8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  readoutTemp: {
    fontSize: 15,
    fontWeight: '700',
    color: ACCENT,
  },
  readoutTime: {
    fontSize: 13,
    color: '#60646C',
  },
  chartState: {
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  stateTitle: {
    fontSize: 16,
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
    marginTop: 4,
    height: 42,
    borderRadius: 10,
    paddingHorizontal: 26,
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
  updating: {
    textAlign: 'center',
    fontSize: 12,
    color: '#9AA0A6',
  },
});
