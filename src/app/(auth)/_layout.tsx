import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/lib/auth';

export default function AuthLayout() {
  const { status } = useAuth();

  // Already signed in → bounce out of the auth area to the app.
  if (status === 'authenticated') {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
