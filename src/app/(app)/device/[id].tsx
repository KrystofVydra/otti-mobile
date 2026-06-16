import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * TEMPORARY STUB (topology migration 1/3).
 *
 * The old device detail (header + temperature chart + range selector + tooltip)
 * was removed when the data layer migrated from /devices to /controllers. The
 * real controller detail screen is rebuilt in prompt 3/3 (and the route may be
 * renamed then). Until then this renders a placeholder so the project typechecks.
 */
export default function ControllerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Controller', headerBackTitle: 'Controllers' }} />
      <View style={styles.container}>
        <Text style={styles.title}>Controller {id}</Text>
        <Text style={styles.subtitle}>Detail rebuild in progress.</Text>
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
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
  },
  subtitle: {
    fontSize: 15,
    color: '#60646C',
  },
});
