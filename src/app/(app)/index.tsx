import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';

/**
 * Placeholder authenticated landing screen. Proves end-to-end auth by showing
 * the logged-in user and offering logout. Replaced by the real dashboard next.
 */
export default function HomeScreen() {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.name}>{user?.display_name ?? '—'}</Text>
          <Text style={styles.email}>{user?.email ?? '—'}</Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={signOut}>
          <Text style={styles.buttonText}>Log out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 32,
  },
  card: {
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 14,
    color: '#60646C',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
  },
  email: {
    fontSize: 16,
    color: '#60646C',
  },
  button: {
    height: 50,
    borderRadius: 10,
    paddingHorizontal: 32,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
