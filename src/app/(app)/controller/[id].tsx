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
import { useController, useControllerReadings } from '@/lib/hooks';
import { DEFAULT_RANGE, RANGES, type RangeKey } from '@/lib/ranges';
import type { Node, NodeError } from '@/lib/types';

const ACCENT = '#208AEF';
const ONLINE = '#1FA463';
const OFFLINE_DOT = '#9AA0A6';
const SECONDARY = '#60646C';
const FAILURE = '#D7263D';
const WARNING = '#E8833A';
const ERROR_BG = '#FCE8EC';

const BATTERY_CRITICAL_PCT = 20;
const BATTERY_LOW_PCT = 50;

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

/** Absolute timestamp: "DD.MM. HH:MM" (e.g. "24.5. 14:00"). */
function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}. ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Battery color by the web app's thresholds: <20 red, <50 orange, else neutral. */
function batteryColor(pct: number): string {
  if (pct < BATTERY_CRITICAL_PCT) return FAILURE;
  if (pct < BATTERY_LOW_PCT) return WARNING;
  return SECONDARY;
}

/** Human label for a per-node error code. */
function nodeErrorLabel(err: NodeError): string {
  switch (err) {
    case 'sensor_temp':
      return 'Temp sensor error';
    case 'sensor_lux':
      return 'Light sensor error';
    case 'sensor_both':
      return 'Sensor error';
    case 'comms':
      return 'Comms error';
  }
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

function NodeTile({ node }: { node: Node }) {
  const name = node.name ?? `Node ${node.node_index}`;
  const online = isOnline(node.last_seen_at);
  const temp = node.latest?.temperature;
  const tempText = temp != null ? `${temp.toFixed(1)}°C` : '—';
  const showLux = node.has_lux && node.latest?.lux != null;
  const err = node.latest?.err ?? null;
  const lastSeenText =
    node.latest == null ? 'No readings yet' : formatLastSeen(node.last_seen_at);

  return (
    <View style={styles.nodeCard}>
      <View style={styles.nodeTop}>
        <View style={styles.nodeInfo}>
          <View style={styles.nodeNameRow}>
            <Text style={styles.nodeName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.nodeIndex}>#{node.node_index}</Text>
          </View>
          <StatusPill online={online} />
        </View>
        <Text style={styles.nodeTemp}>{tempText}</Text>
      </View>

      {showLux || err ? (
        <View style={styles.nodeBadgeRow}>
          {showLux ? <Text style={styles.lux}>{node.latest?.lux} lx</Text> : null}
          {err ? (
            <View style={[styles.chip, styles.chipError]}>
              <Text style={[styles.chipText, styles.chipErrorText]}>⚠ {nodeErrorLabel(err)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.lastSeen}>{lastSeenText}</Text>
    </View>
  );
}

function TelemetryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

export default function ControllerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const controllerId = Number(id);

  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);

  const {
    data: controller,
    isLoading: controllerLoading,
    isError: controllerError,
    refetch: refetchController,
  } = useController(controllerId);

  const {
    data: readings,
    isLoading: readingsLoading,
    isError: readingsError,
    refetch: refetchReadings,
    isFetching: readingsFetching,
  } = useControllerReadings(controllerId, range);

  // Map readings → chart points (epoch ms + avg temperature), guard NaN, sort.
  // Keep the y key named "temperature" so the proven chart code is unchanged.
  const chartData = useMemo(() => {
    return (readings ?? [])
      .map((r) => ({ time: new Date(r.time).getTime(), temperature: r.temperature_avg }))
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

  const headerTitle = controller?.name ?? 'Controller';

  // Controller loading / error gate (chart + nodes need the detail payload).
  if (controllerLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: headerTitle, headerBackTitle: 'Controllers' }} />
        <View style={styles.fullCentered}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (controllerError || !controller) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: headerTitle, headerBackTitle: 'Controllers' }} />
        <View style={styles.fullCentered}>
          <Text style={styles.stateTitle}>Couldn’t load controller</Text>
          <Text style={styles.stateSubtitle}>Check your connection and try again.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            onPress={() => refetchController()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { sn, location, gateway, nodes, latest_telemetry } = controller;

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: controller.name, headerBackTitle: 'Controllers' }} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          {location ? <Text style={styles.location}>{location}</Text> : null}
          <Text style={styles.subtle}>
            via {gateway.name} · sn: {sn}
          </Text>
        </View>

        {/* Temperature chart (primary element) */}
        <View>
          <Text style={styles.sectionTitle}>Temperature (avg of all nodes)</Text>
          <RangeSelector value={range} onChange={setRange} />

          <View style={styles.chartCard}>
            {readingsLoading ? (
              <View style={styles.chartState}>
                <ActivityIndicator size="large" />
              </View>
            ) : readingsError ? (
              <View style={styles.chartState}>
                <Text style={styles.stateTitle}>Couldn’t load readings</Text>
                <Pressable
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                  onPress={() => refetchReadings()}>
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
                    labelColor: SECONDARY,
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
                    <Text style={styles.readoutTime}>{formatTimestamp(activePoint.time)}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
          {readingsFetching && !readingsLoading ? (
            <Text style={styles.updating}>Updating…</Text>
          ) : null}
        </View>

        {/* Nodes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nodes ({nodes.length})</Text>
          {nodes.map((node) => (
            <NodeTile key={node.id} node={node} />
          ))}
        </View>

        {/* Controller telemetry strip */}
        <View style={styles.telemetryCard}>
          {latest_telemetry ? (
            <View style={styles.telemetryRow}>
              <TelemetryStat
                label="Battery"
                value={`${latest_telemetry.battery_pct}%`}
                color={batteryColor(latest_telemetry.battery_pct)}
              />
              <TelemetryStat label="Door" value={latest_telemetry.door_open ? 'Open' : 'Closed'} />
              <TelemetryStat
                label="Last telemetry"
                value={formatTimestamp(new Date(latest_telemetry.time).getTime())}
              />
            </View>
          ) : (
            <Text style={styles.subtle}>No telemetry yet</Text>
          )}
          <Text style={styles.pointsInRange}>Points in range: {readings?.length ?? 0}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6F8',
  },
  fullCentered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  header: {
    gap: 4,
  },
  location: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '600',
  },
  subtle: {
    fontSize: 13,
    color: SECONDARY,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 10,
  },
  // Range selector
  segment: {
    flexDirection: 'row',
    backgroundColor: '#E9EBEE',
    borderRadius: 10,
    padding: 3,
    gap: 3,
    marginBottom: 12,
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
  // Chart
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
    color: SECONDARY,
  },
  chartState: {
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  updating: {
    textAlign: 'center',
    fontSize: 12,
    color: '#9AA0A6',
    marginTop: 6,
  },
  // Node tiles
  nodeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    padding: 16,
    gap: 10,
  },
  nodeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  nodeInfo: {
    flex: 1,
    gap: 6,
  },
  nodeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nodeName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    flexShrink: 1,
  },
  nodeIndex: {
    fontSize: 13,
    color: '#9AA0A6',
    fontWeight: '600',
  },
  nodeTemp: {
    fontSize: 22,
    fontWeight: '700',
    color: ACCENT,
  },
  nodeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  lux: {
    fontSize: 13,
    fontWeight: '600',
    color: SECONDARY,
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
  chipError: {
    backgroundColor: ERROR_BG,
  },
  chipErrorText: {
    color: FAILURE,
  },
  // Telemetry strip
  telemetryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    padding: 16,
    gap: 12,
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  stat: {
    flex: 1,
    gap: 4,
  },
  statLabel: {
    fontSize: 12,
    color: SECONDARY,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  pointsInRange: {
    fontSize: 12,
    color: '#9AA0A6',
  },
  // Shared pill + states
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
    fontSize: 16,
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
});
