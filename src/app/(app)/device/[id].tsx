import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Placeholder device-detail screen. The real detail view + temperature chart
 * are built in the next prompt; for now it just echoes the route param.
 */
export default function DeviceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Device ${id}` }} />
      <Text style={styles.title}>Device {id}</Text>
      <Text style={styles.subtitle}>Detail & chart coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 8,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
  },
  subtitle: {
    fontSize: 15,
    color: '#60646C',
  },
});
