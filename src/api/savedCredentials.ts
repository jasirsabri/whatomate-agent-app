import * as SecureStore from 'expo-secure-store';

const SAVED_EMAIL_KEY = 'whatomate_saved_email';
const SAVED_PASSWORD_KEY = 'whatomate_saved_password';

export interface SavedCredentials {
  email: string;
  password: string;
}

/**
 * Stored via expo-secure-store — the same hardware-backed encrypted
 * storage (iOS Keychain / Android Keystore) already used for the session
 * token, not plain storage. This is only ever written when the person has
 * explicitly opted in via the "Remember me" toggle on the login screen.
 */
export async function saveCredentials(email: string, password: string): Promise<void> {
  await SecureStore.setItemAsync(SAVED_EMAIL_KEY, email);
  await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password);
}

export async function loadCredentials(): Promise<SavedCredentials | null> {
  const email = await SecureStore.getItemAsync(SAVED_EMAIL_KEY);
  const password = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
  if (!email || !password) return null;
  return { email, password };
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(SAVED_EMAIL_KEY);
  await SecureStore.deleteItemAsync(SAVED_PASSWORD_KEY);
}

export async function hasSavedCredentials(): Promise<boolean> {
  return (await loadCredentials()) !== null;
}
