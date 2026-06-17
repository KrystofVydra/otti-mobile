import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const { status } = useAuth();

  // Not signed in → send to the login screen.
  if (status !== 'authenticated') {
    return <Redirect href="/login" />;
  }

  // The tab bar lives in the (tabs) group; controller detail and provisioning
  // are pushed over it.
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="controller/[id]" options={{ headerShown: true }} />
      <Stack.Screen name="notification-settings" options={{ headerShown: true }} />
      <Stack.Screen name="provision" options={{ headerShown: true, presentation: 'modal' }} />
    </Stack>
  );
}
