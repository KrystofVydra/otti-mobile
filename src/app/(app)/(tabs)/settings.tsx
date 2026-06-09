import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';

/**
 * Minimal Settings tab. For now it shows the signed-in user and offers logout;
 * real settings come later. (Replaced the create-expo-app "explore" demo tab.)
 */
export default function SettingsScreen() {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.heading}>Settings</Text>

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
    backgroundColor: '#F5F6F8',
  },
  container: {
    flex: 1,
    padding: 16,
    gap: 24,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ECEDEF',
    gap: 4,
  },
  label: {
    fontSize: 14,
    color: '#60646C',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
  },
  email: {
    fontSize: 15,
    color: '#60646C',
  },
  button: {
    height: 50,
    borderRadius: 10,
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
