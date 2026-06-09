import { Redirect } from 'expo-router';

import AppTabs from '@/components/app-tabs';
import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const { status } = useAuth();

  // Not signed in → send to the login screen.
  if (status !== 'authenticated') {
    return <Redirect href="/login" />;
  }

  return <AppTabs />;
}
