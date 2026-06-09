/**
 * Secure token storage — the ONLY place expo-secure-store is touched.
 * The bearer token lives in the iOS Keychain (Android Keystore) via SecureStore.
 */
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'otti_session_token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
