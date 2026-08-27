import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { clearTokens, loadStoredTokens, setSessionExpiredHandler } from '../api/client';
import { login as loginRequest, logout as logoutRequest } from '../api/auth';
import { getExpoPushToken } from '../notifications';
import { unregisterPushToken } from '../api/pushBridge';

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Set when the access token expired naturally and the app had to sign
   * out on its own — as opposed to the person tapping "Sign Out"
   * themselves. LoginScreen shows this once, then it's cleared. */
  sessionExpiredMessage: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    // Must happen before clearTokens() below — unregisterPushToken needs
    // a still-valid access token to authenticate with the bridge service.
    // Otherwise a signed-out device would keep receiving push
    // notifications meant for whoever's no longer using it.
    const pushToken = await getExpoPushToken();
    if (pushToken) {
      await unregisterPushToken(pushToken);
    }
    await logoutRequest(); // best-effort — revokes the refresh token server-side
    await clearTokens();
    setIsAuthenticated(false);
    setSessionExpiredMessage(null); // a deliberate sign-out isn't an "expiry"
  }, []);

  // The access token doesn't currently refresh itself (see client.ts for
  // why) — when it naturally expires, apiClient's 401 handler calls this
  // to drop us back to the login screen, with an explanation rather than
  // just silently landing there.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setIsAuthenticated(false);
      setSessionExpiredMessage('Your session expired. Please sign in again.');
    });
  }, []);

  useEffect(() => {
    (async () => {
      const hasTokens = await loadStoredTokens();
      setIsAuthenticated(hasTokens);
      setIsLoading(false);
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await loginRequest(email, password);
    setIsAuthenticated(true);
    setSessionExpiredMessage(null);
  }, []);

  const value = useMemo(
    () => ({ isLoading, isAuthenticated, sessionExpiredMessage, signIn, signOut }),
    [isLoading, isAuthenticated, sessionExpiredMessage, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
