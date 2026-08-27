import axios from 'axios';
import { getPushBridgeUrl } from '../config';
import { getCurrentAccessToken } from './client';
import { logApiError } from './logging';

/** All three calls are authenticated with the agent's own Whatomate
 * access token — the bridge validates it by asking Whatomate's own
 * /api/me who it belongs to, rather than us reimplementing verification.
 * Silently no-ops if signed out (nothing valid to authenticate with) —
 * callers don't need to check auth state themselves first. */
async function callBridge(path: string, expoPushToken: string): Promise<void> {
  const accessToken = getCurrentAccessToken();
  if (!accessToken) return;

  await axios.post(
    `${getPushBridgeUrl()}${path}`,
    { expo_push_token: expoPushToken },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
  );
}

/** Best-effort throughout this file — a failed registration/heartbeat
 * shouldn't interrupt anything the person is doing. Worst case, push
 * notifications just don't arrive for this device; everything else about
 * the app keeps working normally. */
export async function registerPushToken(expoPushToken: string): Promise<void> {
  try {
    await callBridge('/register', expoPushToken);
  } catch (err) {
    logApiError('Failed to register push token:', err);
  }
}

export async function unregisterPushToken(expoPushToken: string): Promise<void> {
  try {
    await callBridge('/unregister', expoPushToken);
  } catch (err) {
    logApiError('Failed to unregister push token:', err);
  }
}

export async function sendPushHeartbeat(expoPushToken: string): Promise<void> {
  try {
    await callBridge('/heartbeat', expoPushToken);
  } catch (err) {
    logApiError('Push heartbeat failed:', err);
  }
}
