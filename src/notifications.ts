import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const SOUND_ENABLED_KEY = 'whatomate_notification_sound_enabled';

// Default on — most agents will want this; explicit toggle to opt out.
let soundEnabled = true;

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

/** Called once at app start (see App.tsx), alongside loadServerUrl() —
 * restores the saved preference, and sets up the pieces that must exist
 * before any notification can be scheduled: the foreground handler (by
 * default expo-notifications shows nothing at all while the app is open)
 * and, on Android, a notification channel (required since Android 8 —
 * notifications silently vanish without one). */
export async function initializeNotifications(): Promise<void> {
  const stored = await SecureStore.getItemAsync(SOUND_ENABLED_KEY);
  if (stored !== null) {
    soundEnabled = stored === 'true';
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: soundEnabled,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'New messages',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export async function setSoundEnabled(enabled: boolean): Promise<void> {
  soundEnabled = enabled;
  await SecureStore.setItemAsync(SOUND_ENABLED_KEY, String(enabled));
}

/** Only prompts if permission hasn't already been decided — won't
 * re-prompt every time the toggle is flipped on if it was already denied
 * or granted once (matches standard OS-level permission conventions). */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getNotificationPermissionStatus(): Promise<string> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

let cachedPushToken: string | null = null;

/** The token that identifies this specific device to Expo's push service
 * — this is what gets sent to the bridge service's /register endpoint.
 * Cached after the first successful fetch, since multiple call sites
 * (registration, heartbeat, unregister-on-sign-out) all need the same
 * value and there's no reason to re-fetch it from Expo's servers each
 * time. Returns null on anything that stops it from being obtainable (no
 * permission yet, running in a simulator, missing project ID, etc.)
 * rather than throwing, since callers should treat "no token" as a
 * normal, handleable case, not an error condition. */
export async function getExpoPushToken(): Promise<string | null> {
  if (cachedPushToken) return cachedPushToken;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.error('[notifications] no EAS project ID configured in app.json');
      return null;
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    cachedPushToken = data;
    return data;
  } catch (err) {
    console.error('[notifications] failed to get push token:', err);
    return null;
  }
}

/** Fires immediately (trigger: null) — this is a local, on-device
 * notification, not a push. No server, no Expo push token, no Firebase
 * needed; it only works while the app is running and connected to the
 * socket, which is exactly the "app is open" case this feature targets.
 * Actual push notifications (app backgrounded/killed) are a separate,
 * still-queued piece of work.
 *
 * contactId is attached as data so tapping the notification can open the
 * right chat — see addNotificationTapListener / checkLastNotificationResponse. */
export async function notifyNewMessage(
  title: string,
  body: string,
  contactId: string
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body: body || 'New message', data: { contactId } },
    trigger: null,
  });
}

/** Two different notification kinds need two different taps: one opens a
 * specific chat (agent notifications, data: { contactId }), the other
 * opens the Queue tab (manager "new chat needs an agent" alerts, data:
 * { screen: 'queue' } — sent by the bridge service, not this app). */
export type NotificationTapAction = { type: 'chat'; contactId: string } | { type: 'queue' };

function extractTapAction(notification: Notifications.Notification): NotificationTapAction | null {
  const data = notification.request.content.data;
  if (typeof data?.contactId === 'string') {
    return { type: 'chat', contactId: data.contactId };
  }
  if (data?.screen === 'queue') {
    return { type: 'queue' };
  }
  return null;
}

/** Covers the app-already-running case (foregrounded or briefly
 * backgrounded) — fires when the person taps a notification while the JS
 * environment is still alive. Returns an unsubscribe function. */
export function addNotificationTapListener(
  onAction: (action: NotificationTapAction) => void
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const action = extractTapAction(response.notification);
    if (action) onAction(action);
  });
  return () => subscription.remove();
}

/** Covers the cold-start case — the app process wasn't running at all and
 * got launched by the notification tap. Check once at startup; the tap
 * listener above won't fire for this since there was nothing listening
 * yet when the tap actually happened. */
export async function checkLastNotificationResponse(): Promise<NotificationTapAction | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  return response ? extractTapAction(response.notification) : null;
}
