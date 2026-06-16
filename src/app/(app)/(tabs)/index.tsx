import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * TEMPORARY STUB (topology migration 1/3).
 *
 * The old device-based dashboard was removed when the data layer migrated from
 * /devices to /controllers. The real controller dashboard is rebuilt in prompt
 * 2/3. Until then this renders a placeholder so the project typechecks.
 */
export default function DashboardScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        <Text style={styles.title}>Controllers</Text>
        <Text style={styles.subtitle}>Dashboard rebuild in progress.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F6F8',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
  },
  subtitle: {
    fontSize: 15,
    color: '#60646C',
  },
});
