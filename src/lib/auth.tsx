/**
 * Auth context/provider.
 *
 * Holds auth status + current user, validates a stored token on launch, and
 * exposes signIn/signOut. It also wires the api client's global 401 handler so
 * an expired session anywhere flips the app to "unauthenticated".
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import * as api from '@/lib/api';
import { clearToken, getToken, setToken } from '@/lib/tokenStore';
import type { LoginResponse, User } from '@/lib/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Strip the token off the flat login response to get just the user fields. */
function toUser(res: LoginResponse): User {
  return {
    id: res.id,
    email: res.email,
    display_name: res.display_name,
    is_admin: res.is_admin,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  // Launch-time token validation: if a token exists, confirm it with /auth/me.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) setStatus('unauthenticated');
        return;
      }
      try {
        const me = await api.getMe();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        // Invalid/expired token or network failure → clear and require login.
        await clearToken();
        if (!cancelled) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Global 401 handler: the api layer has already cleared the token; we just
  // flip local state so the router redirects to login.
  useEffect(() => {
    api.setOnUnauthorized(() => {
      setUser(null);
      setStatus('unauthenticated');
    });
    return () => api.setOnUnauthorized(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    await setToken(res.token);
    setUser(toUser(res));
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort server-side logout; clear locally regardless of the result.
    try {
      await api.logout();
    } catch {
      // ignore — we still clear the local session below
    }
    await clearToken();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
