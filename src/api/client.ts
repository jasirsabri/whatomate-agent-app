import axios, { InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { getServerUrl } from '../config';
import { extractCookieValue } from './cookies';
import { decodeJwtPayload } from '../ws/decodeJwt';

const ACCESS_TOKEN_KEY = 'whatomate_access_token';
const REFRESH_TOKEN_KEY = 'whatomate_refresh_token';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

/** AuthContext registers this so it can flip back to the login screen if a
 * refresh ever fails (refresh token expired/revoked). */
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

/** Called once on app start to restore a previous session, if any. Only
 * accessToken is required — we've confirmed refreshToken can't reliably be
 * obtained on Android (see storeTokens below), so it's treated as a bonus
 * when present rather than a requirement. */
export async function loadStoredTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  return Boolean(accessToken);
}

export async function storeTokens(tokens: {
  accessToken: string;
  refreshToken?: string | null;
}): Promise<void> {
  accessToken = tokens.accessToken;
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);

  if (tokens.refreshToken) {
    refreshToken = tokens.refreshToken;
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }
}

export function getCurrentRefreshToken(): string | null {
  return refreshToken;
}

export function getCurrentAccessToken(): string | null {
  return accessToken;
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export const apiClient = axios.create({
  timeout: 15000,
  // We manage tokens ourselves (extracted from Set-Cookie once, then sent
  // as a normal Bearer header) rather than relying on cookies for actual
  // auth on every request — this also means every request already carries
  // an Authorization header, which is exactly what Whatomate's CSRF check
  // exempts (see internal/middleware/csrf.go).
  withCredentials: false,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Read fresh on every request rather than baked in at module load, so
  // changing the server URL from Settings takes effect immediately.
  config.baseURL = getServerUrl();
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

// If several requests 401 at once, only refresh once and let the rest
// piggy-back on that single in-flight refresh call.
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  if (!refreshToken) return null;
  try {
    const response = await axios.post(
      `${getServerUrl()}/api/auth/refresh`,
      { refresh_token: refreshToken },
      { withCredentials: false }
    );
    const setCookie = response.headers?.['set-cookie'];
    const newAccessToken = extractCookieValue(setCookie, 'whm_access');
    const newRefreshToken = extractCookieValue(setCookie, 'whm_refresh');
    if (!newAccessToken || !newRefreshToken) return null;

    await storeTokens({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    return newAccessToken;
  } catch {
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    if (error?.response?.status === 401 && original && !original._retry) {
      original._retry = true;

      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccessToken = await refreshPromise;

      if (newAccessToken) {
        original.headers.set('Authorization', `Bearer ${newAccessToken}`);
        return apiClient(original);
      }

      await clearTokens();
      onSessionExpired?.();
    }

    return Promise.reject(error);
  }
);

/**
 * Returns a definitely-not-about-to-expire access token, refreshing first
 * if needed. Used by the WebSocket layer, which needs a valid JWT for its
 * connect-time handshake and can't rely on the request interceptor above
 * (that only reacts to a 401 after the fact).
 */
export async function ensureFreshAccessToken(): Promise<string | null> {
  if (!accessToken) return null;

  const claims = decodeJwtPayload(accessToken);
  const nowSeconds = Date.now() / 1000;
  const expiringSoon = !claims?.exp || claims.exp - nowSeconds < 15;

  if (!expiringSoon) return accessToken;

  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
