import axios from 'axios';
import { getServerUrl } from '../config';
import { storeTokens, getCurrentRefreshToken } from './client';
import { extractCookieValue, listCookieNames } from './cookies';

export async function login(email: string, password: string): Promise<void> {
  const response = await axios.post(
    `${getServerUrl()}/api/auth/login`,
    { email, password },
    { withCredentials: false }
  );

  const setCookie = response.headers?.['set-cookie'];
  const accessToken = extractCookieValue(setCookie, 'whm_access');
  const refreshToken = extractCookieValue(setCookie, 'whm_refresh'); // usually absent — see client.ts

  if (!accessToken) {
    const cookieNames = listCookieNames(setCookie);
    throw new Error(
      `Login succeeded but no access token was found ` +
        `(cookies present: ${cookieNames.join(', ') || 'none'}).`
    );
  }

  await storeTokens({ accessToken, refreshToken });
}

/**
 * Best-effort server-side logout: revokes the refresh token so it can't be
 * reused even if a copy of it leaked somehow. Safe to call even if this
 * fails — local token clearing (in AuthContext.signOut) is what actually
 * matters for the app itself.
 */
export async function logout(): Promise<void> {
  const refreshToken = getCurrentRefreshToken();
  if (!refreshToken) return;
  try {
    await axios.post(
      `${getServerUrl()}/api/auth/logout`,
      { refresh_token: refreshToken },
      { withCredentials: false, timeout: 5000 }
    );
  } catch {
    // Ignore — signing out locally still happens regardless.
  }
}
